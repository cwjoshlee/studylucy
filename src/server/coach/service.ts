import type Database from "better-sqlite3";
import type {
  AiCoachProvider,
  AiCoachSettingsView,
  CoachMessageRequest,
  CoachMessageResponse
} from "../../shared/learning";
import { decryptApiKey, encryptApiKey, type EncryptedApiKey } from "./crypto";

const DEFAULTS = {
  enabled: false,
  provider: "gemini" as const,
  model: "gemini-2.5-flash-lite",
  monthlyBudgetWon: 1000
};
const MODEL_BY_PROVIDER: Record<AiCoachProvider, string> = {
  gemini: "gemini-2.5-flash-lite",
  openai: "gpt-5-nano"
};
const PERSONA = "초등 학습을 다정하게 돕는 차나핑 코치다. 한국어로 짧고 안전하게 격려한다. 정답이나 개인정보를 요구하지 않는다.";
const LOCAL_MESSAGE = "차근차근 한 번 더 해 보자!";

type SettingsRow = {
  enabled: number;
  provider: AiCoachProvider;
  model: string;
  monthlyBudgetWon: number;
  ciphertext: string | null;
  iv: string | null;
  tag: string | null;
};
type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type AiCoachServiceDeps = {
  db: Database.Database;
  encryptionKey: Buffer | null;
  fetcher?: Fetcher;
  now?: () => Date;
};

export type AiCoachSettingsInput = {
  enabled?: boolean;
  provider?: AiCoachProvider;
  monthlyBudgetWon?: number;
  apiKey?: string;
  deleteApiKey?: boolean;
};

function monthAt(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit"
  }).format(now).slice(0, 7);
}

function safeMessage(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const message = value.trim();
  if (message.length < 4 || message.length > 45) return null;
  if (!/^[가-힣]+(?: [가-힣]+){1,8}$/.test(message)) return null;
  if (/바보|멍청|못하|틀렸|느려|게으르|벌|혼나|실패|포기|정답|답은|죽|해치|욕|비밀|개인정보|연락|전화|번호|카톡|메일|주소|링크/.test(message)) {
    return null;
  }
  return message;
}

function parseJsonMessage(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed !== null && typeof parsed === "object" && "message" in parsed
      ? safeMessage((parsed as { message: unknown }).message)
      : null;
  } catch {
    return null;
  }
}

export class AiCoachService {
  private readonly fetcher: Fetcher;
  private readonly now: () => Date;

  constructor(private readonly deps: AiCoachServiceDeps) {
    this.fetcher = deps.fetcher ?? fetch;
    this.now = deps.now ?? (() => new Date());
  }

  getSettings(): AiCoachSettingsView {
    const row = this.settingsRow();
    return {
      enabled: row.enabled === 1,
      provider: row.provider,
      model: row.model,
      monthlyBudgetWon: row.monthlyBudgetWon,
      monthSpentWon: this.monthSpent(),
      hasApiKey: row.ciphertext !== null && row.iv !== null && row.tag !== null
    };
  }

  updateSettings(input: AiCoachSettingsInput): AiCoachSettingsView {
    const previous = this.settingsRow();
    const enabled = input.enabled ?? previous.enabled === 1;
    const provider = input.provider ?? previous.provider;
    const budget = input.monthlyBudgetWon ?? previous.monthlyBudgetWon;
    const keyChanged = input.apiKey !== undefined || input.deleteApiKey === true;
    if ((enabled || input.apiKey !== undefined) && this.deps.encryptionKey === null) {
      throw new Error("LLM_ENCRYPTION_KEY is required for enabled AI coach settings");
    }
    if (enabled && input.deleteApiKey === true) {
      throw new Error("AI coach requires an API key when enabled");
    }
    if (enabled && !keyChanged && !this.hasStoredKey(previous)) {
      throw new Error("AI coach requires an API key when enabled");
    }
    const encrypted = input.apiKey === undefined ? null : encryptApiKey(input.apiKey, this.deps.encryptionKey!);
    this.deps.db.prepare(`
      UPDATE ai_coach_settings
      SET enabled = ?, provider = ?, model = ?, monthly_budget_won = ?,
          api_key_ciphertext = ?, api_key_iv = ?, api_key_tag = ?, updated_at = ?
      WHERE singleton = 1
    `).run(
      enabled ? 1 : 0, provider, MODEL_BY_PROVIDER[provider], budget,
      input.deleteApiKey ? null : encrypted?.ciphertext ?? previous.ciphertext,
      input.deleteApiKey ? null : encrypted?.iv ?? previous.iv,
      input.deleteApiKey ? null : encrypted?.tag ?? previous.tag,
      this.now().toISOString()
    );
    return this.getSettings();
  }

  async message(input: CoachMessageRequest): Promise<CoachMessageResponse> {
    const settings = this.settingsRow();
    if (settings.enabled !== 1 || this.deps.encryptionKey === null || !this.hasStoredKey(settings)) {
      return this.local();
    }
    if (this.monthSpent() + 1 > settings.monthlyBudgetWon) return this.local();
    let apiKey: string;
    try {
      apiKey = decryptApiKey({ ciphertext: settings.ciphertext!, iv: settings.iv!, tag: settings.tag! }, this.deps.encryptionKey);
    } catch {
      return this.local();
    }

    this.recordUsage(settings, 0, 0, 1);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4_000);
    try {
      const provider = await this.callProvider(settings, apiKey, input, controller.signal);
      const actual = Math.max(1, Math.ceil((provider.inputTokens + provider.outputTokens) / 1_000));
      this.recordUsage(settings, provider.inputTokens, provider.outputTokens, actual - 1);
      const message = parseJsonMessage(provider.text);
      if (message === null) return this.local();
      return { message, source: "llm" };
    } catch {
      return this.local();
    } finally {
      clearTimeout(timer);
    }
  }

  private settingsRow(): SettingsRow {
    const row = this.deps.db.prepare(`
      SELECT enabled, provider, model, monthly_budget_won AS monthlyBudgetWon,
        api_key_ciphertext AS ciphertext, api_key_iv AS iv, api_key_tag AS tag
      FROM ai_coach_settings WHERE singleton = 1
    `).get() as SettingsRow | undefined;
    if (row === undefined) throw new Error("AI coach settings missing");
    return row;
  }

  private hasStoredKey(row: Pick<SettingsRow, "ciphertext" | "iv" | "tag">): boolean {
    return row.ciphertext !== null && row.iv !== null && row.tag !== null;
  }

  private monthSpent(): number {
    const row = this.deps.db.prepare(`
      SELECT COALESCE(SUM(estimated_won), 0) AS spent
      FROM ai_coach_usage WHERE month = ?
    `).get(monthAt(this.now())) as { spent: number };
    return row.spent;
  }

  private recordUsage(settings: SettingsRow, inputTokens: number, outputTokens: number, estimatedWon: number): void {
    this.deps.db.prepare(`
      INSERT INTO ai_coach_usage (month, provider, model, input_tokens, output_tokens, estimated_won, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(monthAt(this.now()), settings.provider, settings.model, inputTokens, outputTokens, estimatedWon, this.now().toISOString());
  }

  private async callProvider(
    settings: SettingsRow,
    apiKey: string,
    input: CoachMessageRequest,
    signal: AbortSignal
  ): Promise<{ text: unknown; inputTokens: number; outputTokens: number }> {
    const coachInput = JSON.stringify(input);
    if (settings.provider === "gemini") {
      const response = await this.fetcher(
        `https://generativelanguage.googleapis.com/v1beta/models/${settings.model}:generateContent`,
        {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: `${PERSONA}\n${coachInput}` }] }],
            generationConfig: { responseMimeType: "application/json" }
          }),
          signal
        }
      );
      if (!response.ok) throw new Error("provider request failed");
      const body = await response.json() as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: unknown }> } }>;
        usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
      };
      return {
        text: body.candidates?.[0]?.content?.parts?.[0]?.text,
        inputTokens: body.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: body.usageMetadata?.candidatesTokenCount ?? 0
      };
    }
    const response = await this.fetcher("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "gpt-5-nano",
        input: [
          { role: "developer", content: PERSONA },
          { role: "user", content: coachInput }
        ],
        text: { format: { type: "json_object" } }
      }),
      signal
    });
    if (!response.ok) throw new Error("provider request failed");
    const body = await response.json() as {
      output_text?: unknown;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    return {
      text: body.output_text,
      inputTokens: body.usage?.input_tokens ?? 0,
      outputTokens: body.usage?.output_tokens ?? 0
    };
  }

  private local(): CoachMessageResponse {
    return { message: LOCAL_MESSAGE, source: "local" };
  }
}
