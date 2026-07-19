import type Database from "better-sqlite3";
import type {
  AiCoachProvider,
  AiCoachSettingsView,
  CoachMessageRequest,
  CoachMessageResponse
} from "../../shared/learning";
import { decryptApiKey, encryptApiKey } from "./crypto";
import { ensureAiProviderSettings } from "./studio-service";

const PERSONA = "초등 학습을 다정하게 돕는 차나핑 코치다. 한국어로 짧고 안전하게 격려한다. 정답이나 개인정보를 요구하지 않는다.";
const LOCAL_MESSAGE = "차근차근 한 번 더 해 보자!";
export const PROVIDER_OUTPUT_TOKEN_CAP = 64;

type SettingsRow = {
  enabled: number;
  provider: AiCoachProvider;
  model: string;
  monthlyBudgetWon: number;
  ciphertext: string | null;
  iv: string | null;
  tag: string | null;
  inputWonPer1K: number;
  outputWonPer1K: number;
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
  if (!/^[가-힣]+(?: [가-힣]+){0,8}[.!?…]?(?: [가-힣]+(?: [가-힣]+){0,8}[.!?…]?)?$/.test(message)) {
    return null;
  }
  if (/바보|멍청|못하|틀렸|느려|게으르|혼내|혼낼|혼나|벌|때리|맞아|창피|망신|실망|야단|꾸짖|반성|실패|포기|정답|답은|죽|해치|욕|비밀|개인정보|연락|전화|번호|카톡|메일|주소|링크/.test(message)) {
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

function parseOpenAiOutputText(value: unknown): string | null {
  if (value === null || typeof value !== "object" || !("output" in value)) return null;
  const output = (value as { output?: unknown }).output;
  if (!Array.isArray(output)) return null;
  const parts: string[] = [];
  for (const item of output) {
    if (item === null || typeof item !== "object" ||
        (item as { type?: unknown }).type !== "message") continue;
    const content = (item as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    for (const entry of content) {
      if (entry !== null && typeof entry === "object" &&
          (entry as { type?: unknown }).type === "output_text" &&
          typeof (entry as { text?: unknown }).text === "string") {
        parts.push((entry as { text: string }).text);
      }
    }
  }
  const text = parts.join("");
  return text.trim().length === 0 ? null : text;
}

function parseGeminiOutputText(value: unknown): string | null {
  if (value === null || typeof value !== "object" || !("candidates" in value)) {
    return null;
  }
  const candidates = (value as { candidates?: unknown }).candidates;
  if (!Array.isArray(candidates)) return null;
  const first = candidates[0];
  if (first === null || typeof first !== "object" || !("content" in first)) {
    return null;
  }
  const content = (first as { content?: unknown }).content;
  if (content === null || typeof content !== "object" || !("parts" in content)) {
    return null;
  }
  const parts = (content as { parts?: unknown }).parts;
  if (!Array.isArray(parts)) return null;
  const text = parts.flatMap((part) =>
    part !== null && typeof part === "object" &&
      typeof (part as { text?: unknown }).text === "string"
      ? [(part as { text: string }).text]
      : []
  ).join("");
  return text.trim().length === 0 ? null : text;
}

function estimatedInputTokens(input: CoachMessageRequest): number {
  return Math.max(1, Buffer.byteLength(`${PERSONA}\n${JSON.stringify(input)}`, "utf8"));
}

function estimatedWon(
  inputTokens: number,
  outputTokens: number,
  inputWonPer1K: number,
  outputWonPer1K: number
): number | null {
  if (![inputTokens, outputTokens, inputWonPer1K, outputWonPer1K]
    .every((value) => Number.isSafeInteger(value) && value >= 0)) return null;
  const inputCost = inputTokens * inputWonPer1K;
  const outputCost = outputTokens * outputWonPer1K;
  if (!Number.isSafeInteger(inputCost) || !Number.isSafeInteger(outputCost)) return null;
  const totalCost = inputCost + outputCost;
  if (!Number.isSafeInteger(totalCost)) return null;
  const won = Math.max(1, Math.ceil(totalCost / 1_000));
  return Number.isSafeInteger(won) ? won : null;
}

function completeUsage(inputTokens: unknown, outputTokens: unknown): {
  inputTokens: number;
  outputTokens: number;
} | null {
  return Number.isSafeInteger(inputTokens) && Number(inputTokens) >= 0 &&
    Number.isSafeInteger(outputTokens) && Number(outputTokens) >= 0
    ? { inputTokens: Number(inputTokens), outputTokens: Number(outputTokens) }
    : null;
}

function completeGeminiUsage(value: unknown): {
  inputTokens: number;
  outputTokens: number;
} | null {
  if (value === null || typeof value !== "object") return null;
  const usage = value as Record<string, unknown>;
  const inputTokens = usage.promptTokenCount;
  const candidateTokens = usage.candidatesTokenCount;
  const thoughtTokens = Object.prototype.hasOwnProperty.call(usage, "thoughtsTokenCount")
    ? usage.thoughtsTokenCount
    : 0;
  if (!Number.isSafeInteger(inputTokens) || Number(inputTokens) < 0 ||
      !Number.isSafeInteger(candidateTokens) || Number(candidateTokens) < 0 ||
      !Number.isSafeInteger(thoughtTokens) || Number(thoughtTokens) < 0) {
    return null;
  }
  const candidate = Number(candidateTokens);
  const thought = Number(thoughtTokens);
  if (candidate > Number.MAX_SAFE_INTEGER - thought) return null;
  return { inputTokens: Number(inputTokens), outputTokens: candidate + thought };
}

export class AiCoachService {
  private readonly fetcher: Fetcher;
  private readonly now: () => Date;

  constructor(private readonly deps: AiCoachServiceDeps) {
    this.fetcher = deps.fetcher ?? fetch;
    this.now = deps.now ?? (() => new Date());
    ensureAiProviderSettings(deps.db, this.now());
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
    const providerRow = this.providerSettingsRow(provider);
    const keyChanged = input.apiKey !== undefined || input.deleteApiKey === true;
    if ((enabled || input.apiKey !== undefined) && this.deps.encryptionKey === null) {
      throw new Error("LLM_ENCRYPTION_KEY is required for enabled AI coach settings");
    }
    if (enabled && input.deleteApiKey === true) {
      throw new Error("AI coach requires an API key when enabled");
    }
    if (enabled && !keyChanged && !this.hasStoredKey(providerRow)) {
      throw new Error("AI coach requires an API key when enabled");
    }
    const encrypted = input.apiKey === undefined ? null : encryptApiKey(input.apiKey, this.deps.encryptionKey!);
    const ciphertext = input.deleteApiKey
      ? null
      : encrypted?.ciphertext ?? providerRow.ciphertext;
    const iv = input.deleteApiKey ? null : encrypted?.iv ?? providerRow.iv;
    const tag = input.deleteApiKey ? null : encrypted?.tag ?? providerRow.tag;
    this.deps.db.prepare(`
      UPDATE ai_provider_settings
      SET enabled = ?, api_key_ciphertext = ?, api_key_iv = ?,
          api_key_tag = ?, updated_at = ?
      WHERE provider = ?
    `).run(
      enabled ? 1 : 0,
      ciphertext,
      iv,
      tag,
      this.now().toISOString(),
      provider
    );
    this.deps.db.prepare(`
      UPDATE ai_coach_settings
      SET enabled = ?, provider = ?, model = ?, monthly_budget_won = ?,
          api_key_ciphertext = ?, api_key_iv = ?, api_key_tag = ?, updated_at = ?
      WHERE singleton = 1
    `).run(
      enabled ? 1 : 0, provider, providerRow.model, budget,
      ciphertext,
      iv,
      tag,
      this.now().toISOString()
    );
    return this.getSettings();
  }

  async message(input: CoachMessageRequest): Promise<CoachMessageResponse> {
    if (this.deps.encryptionKey === null) return this.local();
    const reservation = this.reserveUsage(estimatedInputTokens(input));
    if (reservation === null) return this.local();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4_000);
    try {
      const provider = await this.callProvider(
        reservation.settings,
        reservation.apiKey,
        input,
        controller.signal
      );
      if (provider.usage !== null) this.reconcileUsage(reservation, provider.usage);
      const message = parseJsonMessage(provider.text);
      if (message === null) return this.local();
      return { message, source: "llm" };
    } catch {
      return this.local();
    } finally {
      clearTimeout(timer);
      reservation.apiKey = "";
    }
  }

  private settingsRow(): SettingsRow {
    const row = this.deps.db.prepare(`
      SELECT coach.enabled, coach.provider,
        provider.model, coach.monthly_budget_won AS monthlyBudgetWon,
        provider.api_key_ciphertext AS ciphertext,
        provider.api_key_iv AS iv, provider.api_key_tag AS tag,
        provider.input_won_per_1k AS inputWonPer1K,
        provider.output_won_per_1k AS outputWonPer1K
      FROM ai_coach_settings AS coach
      JOIN ai_provider_settings AS provider
        ON provider.provider = coach.provider
      WHERE coach.singleton = 1
    `).get() as SettingsRow | undefined;
    if (row === undefined) throw new Error("AI coach settings missing");
    return row;
  }

  private providerSettingsRow(provider: AiCoachProvider): Pick<
    SettingsRow,
    "model" | "ciphertext" | "iv" | "tag"
  > {
    const row = this.deps.db.prepare(`
      SELECT model, api_key_ciphertext AS ciphertext,
        api_key_iv AS iv, api_key_tag AS tag
      FROM ai_provider_settings WHERE provider = ?
    `).get(provider) as Pick<
      SettingsRow,
      "model" | "ciphertext" | "iv" | "tag"
    > | undefined;
    if (row === undefined) throw new Error("AI provider settings missing");
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

  private reserveUsage(
    inputTokens: number
  ): { id: number; reservedWon: number; settings: SettingsRow; apiKey: string } | null {
    return this.deps.db.transaction(() => {
      const settings = this.settingsRow();
      if (settings.enabled !== 1 || this.deps.encryptionKey === null ||
          !this.hasStoredKey(settings)) return null;
      let apiKey: string;
      try {
        apiKey = decryptApiKey({
          ciphertext: settings.ciphertext!,
          iv: settings.iv!,
          tag: settings.tag!
        }, this.deps.encryptionKey);
      } catch {
        return null;
      }
      const reservedWon = estimatedWon(
        inputTokens,
        PROVIDER_OUTPUT_TOKEN_CAP,
        settings.inputWonPer1K,
        settings.outputWonPer1K
      );
      if (reservedWon === null) return null;
      const spent = this.monthSpent();
      const projected = spent + reservedWon;
      if (!Number.isSafeInteger(spent) || !Number.isSafeInteger(settings.monthlyBudgetWon) ||
          !Number.isSafeInteger(projected) || projected > settings.monthlyBudgetWon) return null;
      const result = this.deps.db.prepare(`
        INSERT INTO ai_coach_usage
          (month, provider, model, input_tokens, output_tokens, estimated_won, created_at,
           reserved_input_tokens, reserved_output_tokens, input_won_per_1k, output_won_per_1k)
        VALUES (?, ?, ?, 0, 0, ?, ?, ?, ?, ?, ?)
      `).run(
        monthAt(this.now()),
        settings.provider,
        settings.model,
        reservedWon,
        this.now().toISOString(),
        inputTokens,
        PROVIDER_OUTPUT_TOKEN_CAP,
        settings.inputWonPer1K,
        settings.outputWonPer1K
      );
      return { id: Number(result.lastInsertRowid), reservedWon, settings, apiKey };
    }).immediate();
  }

  private reconcileUsage(
    reservation: { id: number; reservedWon: number; settings: SettingsRow },
    usage: { inputTokens: number; outputTokens: number }
  ): void {
    const observedWon = estimatedWon(
      usage.inputTokens,
      usage.outputTokens,
      reservation.settings.inputWonPer1K,
      reservation.settings.outputWonPer1K
    );
    if (observedWon === null) return;
    this.deps.db.prepare(`
      UPDATE ai_coach_usage
      SET input_tokens = ?, output_tokens = ?, estimated_won = ?
      WHERE id = ?
    `).run(
      usage.inputTokens,
      usage.outputTokens,
      observedWon,
      reservation.id
    );
  }

  private async callProvider(
    settings: SettingsRow,
    apiKey: string,
    input: CoachMessageRequest,
    signal: AbortSignal
  ): Promise<{
    text: unknown;
    usage: { inputTokens: number; outputTokens: number } | null;
  }> {
    const coachInput = JSON.stringify(input);
    if (settings.provider === "gemini") {
      const response = await this.fetcher(
        `https://generativelanguage.googleapis.com/v1beta/models/${settings.model}:generateContent`,
        {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: `${PERSONA}\n${coachInput}` }] }],
            generationConfig: {
              responseMimeType: "application/json",
              maxOutputTokens: PROVIDER_OUTPUT_TOKEN_CAP
            }
          }),
          signal
        }
      );
      if (!response.ok) throw new Error("provider request failed");
      const body = await response.json() as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: unknown }> } }>;
        usageMetadata?: {
          promptTokenCount?: unknown;
          candidatesTokenCount?: unknown;
          thoughtsTokenCount?: unknown;
        };
      };
      return {
        text: parseGeminiOutputText(body),
        usage: completeGeminiUsage(body.usageMetadata)
      };
    }
    const response = await this.fetcher("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: settings.model,
        input: [
          { role: "developer", content: PERSONA },
          { role: "user", content: coachInput }
        ],
        max_output_tokens: PROVIDER_OUTPUT_TOKEN_CAP,
        store: false,
        text: { format: { type: "json_object" } }
      }),
      signal
    });
    if (!response.ok) throw new Error("provider request failed");
    const body: unknown = await response.json();
    const usage = body !== null && typeof body === "object" && "usage" in body
      ? (body as { usage?: { input_tokens?: number; output_tokens?: number } }).usage
      : undefined;
    return {
      text: parseOpenAiOutputText(body),
      usage: completeUsage(usage?.input_tokens, usage?.output_tokens)
    };
  }

  private local(): CoachMessageResponse {
    return { message: LOCAL_MESSAGE, source: "local" };
  }
}
