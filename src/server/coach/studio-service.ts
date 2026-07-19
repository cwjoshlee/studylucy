import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  AiBatchRequestSchema,
  LearningItemPayloadSchema,
  type AiBatchRequest,
  type AiCoachProvider,
  type AiDraftItemView,
  type AiDraftView,
  type AiProviderSettingsView,
  type AiStudioSettingsView,
  type GuardianAiReport,
  type LearningItemPayload
} from "../../shared/learning";
import { decryptApiKey, encryptApiKey } from "./crypto";

const DEFAULT_MODELS: Record<AiCoachProvider, string> = {
  gemini: "gemini-2.5-flash-lite",
  openai: "gpt-5-nano"
};
const MODEL_PATTERN = /^[A-Za-z0-9._:-]{2,120}$/;
const DEFAULT_TIMEOUT_MS = 10_000;
const STUDIO_OUTPUT_TOKEN_CAPS = {
  generate: 1_024,
  review: 256,
  report: 512
} as const;
const STUDIO_PERSONA = [
  "초등 1학년 학습 콘텐츠를 JSON으로만 다룬다.",
  "개인정보, 의학적 진단, 폭력적이거나 수치심을 주는 표현을 사용하지 않는다.",
  "주어진 스키마와 덧셈·뺄셈 범위를 지킨다."
].join(" ");
// This is a deterministic local guard for representative high-risk child content,
// not an exhaustive moderation system. It runs before and after provider review.
const CHILD_CONTENT_SAFETY_PATTERNS = [
  /(?:자살|자해|죽고\s*싶|목숨을\s*끊|손목을\s*그어|suicide|self[- ]?harm|kill\s+yourself)/iu,
  /(?:야동|음란|성관계|성행위|섹스|성기|알몸|나체|포르노|porn(?:ography)?|sexual\s+content|nude)/iu,
  /(?:(?:칼|흉기).{0,16}(?:찌르|베기|죽이)|(?:총|권총).{0,16}(?:쏘|죽이)|(?:폭탄|무기).{0,16}(?:만들|제작)|(?:사람|동물).{0,16}(?:죽이|해치|때리).{0,8}방법|how\s+to.{0,24}(?:make\s+(?:a\s+)?bomb|kill|stab|shoot))/iu,
  /(?:(?:전화번호|휴대폰\s*번호|연락처|집\s*주소|주소|카톡\s*(?:아이디|ID)|이메일|비밀번호|학교\s*이름|사진).{0,20}(?:알려|보내|적어|입력|주세요|줘)|(?:tell|send|share).{0,24}(?:phone\s+number|address|email|password|school\s+name|photo))/iu,
  /(?:바보|멍청|쓸모없|못하|창피|망신|혼내|벌\s*받|학대|너\s*때문|실망이야|stupid|worthless|shame\s+on\s+you)/iu,
  /(?:https?:\/\/|www\.|\[[^\]]{1,120}\]\([^)]{1,300}\)|\b(?:[a-z0-9-]+\.)+(?:com|net|org|kr|io|co)(?:\/[^\s]*)?\b|(?:링크|사이트).{0,12}(?:눌러|클릭|접속))/iu,
  /\b\d{2,3}[- ]?\d{3,4}[- ]?\d{4}\b|\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/u
] as const;

function containsUnsafeChildContent(value: unknown): boolean {
  const serialized = JSON.stringify(value);
  return typeof serialized === "string" &&
    CHILD_CONTENT_SAFETY_PATTERNS.some((pattern) => pattern.test(serialized));
}

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

type ProviderRow = {
  provider: AiCoachProvider;
  enabled: number;
  model: string;
  ciphertext: string | null;
  iv: string | null;
  tag: string | null;
  inputWonPer1K: number;
  outputWonPer1K: number;
};

type CompleteUsage = { inputTokens: number; outputTokens: number };
type UsageReservation = {
  id: number;
  reservedWon: number;
  provider: AiCoachProvider;
  model: string;
  inputWonPer1K: number;
  outputWonPer1K: number;
  apiKey: string;
};

type DraftRow = {
  id: string;
  subject: "korean" | "math";
  step: AiBatchRequest["step"];
  requestedCount: number;
  difficulty: number;
  weakTopicsJson: string;
  status: AiDraftView["status"];
};

type DraftItemRow = {
  id: string;
  sourceProvider: AiCoachProvider;
  payloadJson: string;
  reviewJson: string;
  status: AiDraftItemView["status"];
};

const GenerationResponseSchema = z.object({
  items: z.array(z.unknown()).max(40)
}).strict();
const ReviewResponseSchema = z.object({
  accepted: z.boolean(),
  reasons: z.array(z.enum([
    "WRONG_FORMAT",
    "WRONG_ANSWER",
    "OUT_OF_RANGE",
    "UNSAFE",
    "DUPLICATE",
    "OTHER"
  ])).max(8)
}).strict().transform((review) => ({
  accepted: review.accepted && review.reasons.length === 0,
  reasons: review.reasons
}));
const ReportResponseSchema = z.object({
  summary: z.string().trim().min(4).max(500)
}).strict();
const StoredReviewSchema = z.object({
  accepted: z.boolean(),
  reasons: z.array(z.string().min(1).max(80)).max(12)
}).strict();

export type AiProviderSettingsInput = {
  enabled?: boolean;
  model?: string;
  apiKey?: string;
  deleteApiKey?: boolean;
  inputWonPer1K?: number;
  outputWonPer1K?: number;
};

export type AiStudioServiceDeps = {
  db: Database.Database;
  encryptionKey: Buffer | null;
  fetcher?: Fetcher;
  now?: () => Date;
  timeoutMs?: number;
  randomId?: () => string;
};

export type AiStudioErrorCode =
  | "AI_STUDIO_INVALID_REQUEST"
  | "AI_STUDIO_NOT_FOUND"
  | "AI_STUDIO_NOT_REVIEWABLE"
  | "AI_STUDIO_ENCRYPTION_UNAVAILABLE"
  | "AI_STUDIO_API_KEY_REQUIRED"
  | "AI_STUDIO_BOTH_PROVIDERS_REQUIRED"
  | "AI_STUDIO_BUDGET_EXCEEDED"
  | "AI_STUDIO_PROVIDER_FAILED"
  | "AI_STUDIO_NO_PUBLISHABLE_ITEMS";

export class AiStudioError extends Error {
  constructor(readonly code: AiStudioErrorCode) {
    super(code);
  }
}

function monthAt(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit"
  }).format(now).slice(0, 7);
}

function hasStoredKey(row: Pick<ProviderRow, "ciphertext" | "iv" | "tag">): boolean {
  return row.ciphertext !== null && row.iv !== null && row.tag !== null;
}

export function ensureAiProviderSettings(
  db: Database.Database,
  now: Date
): void {
  const legacy = db.prepare(`
    SELECT enabled, provider, model,
      api_key_ciphertext AS ciphertext,
      api_key_iv AS iv,
      api_key_tag AS tag
    FROM ai_coach_settings WHERE singleton = 1
  `).get() as {
    enabled: number;
    provider: AiCoachProvider;
    model: string;
    ciphertext: string | null;
    iv: string | null;
    tag: string | null;
  } | undefined;
  const insert = db.prepare(`
    INSERT OR IGNORE INTO ai_provider_settings (
      provider, enabled, model, api_key_ciphertext, api_key_iv,
      api_key_tag, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  for (const provider of ["gemini", "openai"] as const) {
    const selected = legacy?.provider === provider;
    insert.run(
      provider,
      selected ? legacy.enabled : 0,
      selected ? legacy.model : DEFAULT_MODELS[provider],
      selected ? legacy.ciphertext : null,
      selected ? legacy.iv : null,
      selected ? legacy.tag : null,
      now.toISOString()
    );
  }
}

function otherProvider(provider: AiCoachProvider): AiCoachProvider {
  return provider === "gemini" ? "openai" : "gemini";
}

function parseOpenAiOutputText(value: unknown): unknown {
  if (value === null || typeof value !== "object" || !("output" in value)) {
    throw new AiStudioError("AI_STUDIO_PROVIDER_FAILED");
  }
  const output = (value as { output?: unknown }).output;
  if (!Array.isArray(output)) {
    throw new AiStudioError("AI_STUDIO_PROVIDER_FAILED");
  }
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
  if (text.trim().length === 0) {
    throw new AiStudioError("AI_STUDIO_PROVIDER_FAILED");
  }
  return text;
}

function completeUsage(provider: AiCoachProvider, value: unknown): CompleteUsage | null {
  if (value === null || typeof value !== "object") return null;
  const body = value as {
    usage?: { input_tokens?: unknown; output_tokens?: unknown };
    usageMetadata?: { promptTokenCount?: unknown; candidatesTokenCount?: unknown };
  };
  const inputTokens = provider === "openai"
    ? body.usage?.input_tokens
    : body.usageMetadata?.promptTokenCount;
  const outputTokens = provider === "openai"
    ? body.usage?.output_tokens
    : body.usageMetadata?.candidatesTokenCount;
  return Number.isSafeInteger(inputTokens) && Number(inputTokens) >= 0 &&
    Number.isSafeInteger(outputTokens) && Number(outputTokens) >= 0
    ? { inputTokens: Number(inputTokens), outputTokens: Number(outputTokens) }
    : null;
}

function estimatedInputTokens(persona: string, prompt: Record<string, unknown>): number {
  return Math.max(1, Buffer.byteLength(`${persona}\n${JSON.stringify(prompt)}`, "utf8"));
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

function parseProviderJson(value: unknown): unknown {
  if (typeof value !== "string") {
    throw new AiStudioError("AI_STUDIO_PROVIDER_FAILED");
  }
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new AiStudioError("AI_STUDIO_PROVIDER_FAILED");
  }
}

function normalized(value: string | number): string {
  return String(value)
    .normalize("NFC")
    .toLocaleLowerCase("ko")
    .replace(/[^0-9a-z\uAC00-\uD7A3]/gu, "");
}

function contentSignature(payload: LearningItemPayload): string {
  return payload.kind === "math-story"
    ? [payload.title, payload.question, payload.answer].map(normalized).join("|")
    : payload.kind === "korean-dictation"
      ? [payload.title, payload.promptText, payload.answerText].map(normalized).join("|")
      : [payload.title, payload.text].map(normalized).join("|");
}

function validateCandidate(
  value: unknown,
  request: AiBatchRequest
): { payload: LearningItemPayload | null; reasons: string[] } {
  const parsed = LearningItemPayloadSchema.safeParse(value);
  if (!parsed.success) return { payload: null, reasons: ["WRONG_FORMAT"] };
  const payload = parsed.data;
  const reasons: string[] = [];
  if (payload.subject !== request.subject || payload.level !== `${request.difficulty}단계`) {
    reasons.push("OUT_OF_RANGE");
  }
  if (containsUnsafeChildContent(payload)) reasons.push("UNSAFE_CONTENT");
  if (request.subject === "math") {
    if (payload.kind !== "math-story" || payload.calculation === undefined) {
      reasons.push("WRONG_FORMAT");
    }
  } else if (payload.kind !== "korean-dictation") {
    reasons.push("WRONG_FORMAT");
  } else if (request.step !== "challenge" &&
      (payload.mode !== "word" || /\s/u.test(payload.answerText.trim()))) {
    reasons.push("WRONG_FORMAT");
  } else if (request.step === "challenge") {
    if (payload.mode !== "sentence") {
      reasons.push("WRONG_FORMAT");
    } else if (payload.answerText.length > 30 ||
        payload.answerText.trim().split(/\s+/u).length > 8) {
      reasons.push("OUT_OF_RANGE");
    }
  }
  return { payload, reasons: [...new Set(reasons)] };
}

export class AiStudioService {
  private readonly fetcher: Fetcher;
  private readonly now: () => Date;
  private readonly timeoutMs: number;
  private readonly randomId: () => string;

  constructor(private readonly deps: AiStudioServiceDeps) {
    this.fetcher = deps.fetcher ?? fetch;
    this.now = deps.now ?? (() => new Date());
    this.timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.randomId = deps.randomId ?? randomUUID;
    ensureAiProviderSettings(deps.db, this.now());
  }

  getProviderSettings(): AiProviderSettingsView[] {
    return this.providerRows().map((row) => ({
      provider: row.provider,
      enabled: row.enabled === 1,
      model: row.model,
      hasApiKey: hasStoredKey(row),
      inputWonPer1K: row.inputWonPer1K,
      outputWonPer1K: row.outputWonPer1K
    }));
  }

  getSettings(): AiStudioSettingsView {
    const budget = this.deps.db.prepare(`
      SELECT monthly_budget_won AS monthlyBudgetWon
      FROM ai_coach_settings WHERE singleton = 1
    `).get() as { monthlyBudgetWon: number };
    return {
      providers: this.getProviderSettings(),
      monthlyBudgetWon: budget.monthlyBudgetWon,
      monthSpentWon: this.monthSpent()
    };
  }

  updateBudget(input: { monthlyBudgetWon: number }): AiStudioSettingsView {
    if (!Number.isInteger(input.monthlyBudgetWon) ||
        input.monthlyBudgetWon < 0 || input.monthlyBudgetWon > 10_000) {
      throw new AiStudioError("AI_STUDIO_INVALID_REQUEST");
    }
    this.deps.db.prepare(`
      UPDATE ai_coach_settings SET monthly_budget_won = ?, updated_at = ?
      WHERE singleton = 1
    `).run(input.monthlyBudgetWon, this.now().toISOString());
    return this.getSettings();
  }

  updateProvider(
    provider: AiCoachProvider,
    input: AiProviderSettingsInput
  ): AiProviderSettingsView {
    if ((input.model !== undefined && !MODEL_PATTERN.test(input.model)) ||
        Object.keys(input).length === 0 ||
        (input.apiKey !== undefined && input.deleteApiKey === true) ||
        (input.apiKey !== undefined && (input.apiKey.length < 1 || input.apiKey.length > 500)) ||
        (input.inputWonPer1K !== undefined &&
          (!Number.isInteger(input.inputWonPer1K) || input.inputWonPer1K < 0 || input.inputWonPer1K > 1_000_000)) ||
        (input.outputWonPer1K !== undefined &&
          (!Number.isInteger(input.outputWonPer1K) || input.outputWonPer1K < 0 || input.outputWonPer1K > 1_000_000))) {
      throw new AiStudioError("AI_STUDIO_INVALID_REQUEST");
    }
    const previous = this.providerRow(provider);
    const enabled = input.enabled ?? previous.enabled === 1;
    const keyChanged = input.apiKey !== undefined || input.deleteApiKey === true;
    if ((enabled || input.apiKey !== undefined) && this.deps.encryptionKey === null) {
      throw new AiStudioError("AI_STUDIO_ENCRYPTION_UNAVAILABLE");
    }
    if (enabled && input.deleteApiKey === true) {
      throw new AiStudioError("AI_STUDIO_API_KEY_REQUIRED");
    }
    if (enabled && !keyChanged && !hasStoredKey(previous)) {
      throw new AiStudioError("AI_STUDIO_API_KEY_REQUIRED");
    }
    const encrypted = input.apiKey === undefined
      ? null
      : encryptApiKey(input.apiKey, this.deps.encryptionKey!);
    this.deps.db.prepare(`
      UPDATE ai_provider_settings
      SET enabled = ?, model = ?, api_key_ciphertext = ?, api_key_iv = ?,
          api_key_tag = ?, input_won_per_1k = ?, output_won_per_1k = ?, updated_at = ?
      WHERE provider = ?
    `).run(
      enabled ? 1 : 0,
      input.model ?? previous.model,
      input.deleteApiKey ? null : encrypted?.ciphertext ?? previous.ciphertext,
      input.deleteApiKey ? null : encrypted?.iv ?? previous.iv,
      input.deleteApiKey ? null : encrypted?.tag ?? previous.tag,
      input.inputWonPer1K ?? previous.inputWonPer1K,
      input.outputWonPer1K ?? previous.outputWonPer1K,
      this.now().toISOString(),
      provider
    );
    return this.getProviderSettings().find((view) => view.provider === provider)!;
  }

  async createDraft(input: AiBatchRequest): Promise<AiDraftView> {
    const request = AiBatchRequestSchema.safeParse(input);
    if (!request.success) throw new AiStudioError("AI_STUDIO_INVALID_REQUEST");
    const settings = this.providerRows();
    if (this.deps.encryptionKey === null ||
        settings.some((row) => row.enabled !== 1 || !hasStoredKey(row))) {
      throw new AiStudioError("AI_STUDIO_BOTH_PROVIDERS_REQUIRED");
    }
    const halves: Record<AiCoachProvider, number> = {
      gemini: Math.ceil(request.data.count / 2),
      openai: Math.floor(request.data.count / 2)
    };
    const generated = await Promise.all(
      (["gemini", "openai"] as const).map(async (provider) => ({
        provider,
        items: await this.generate(provider, halves[provider], request.data)
      }))
    );
    const reviewed = await Promise.all(generated.flatMap(({ provider, items }) =>
      items.map(async (candidate) => {
        const validation = validateCandidate(candidate, request.data);
        const preReviewReasons = validation.reasons;
        return {
          provider,
          candidate,
          preReviewReasons,
          review: preReviewReasons.length === 0
            ? await this.review(
                otherProvider(provider),
                provider,
                validation.payload!,
                request.data
              )
            : null
        };
      })
    ));

    const existingSignatures = this.activeContentSignatures(request.data.subject);
    const draftId = this.randomId();
    this.deps.db.transaction(() => {
      this.deps.db.prepare(`
        INSERT INTO ai_generation_drafts (
          id, subject, step, requested_count, difficulty, weak_topics_json,
          status, created_at, published_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, NULL)
      `).run(
        draftId,
        request.data.subject,
        request.data.step,
        request.data.count,
        request.data.difficulty,
        JSON.stringify(request.data.weakTopics),
        this.now().toISOString()
      );
      const insert = this.deps.db.prepare(`
        INSERT INTO ai_generation_items (
          id, draft_id, source_provider, payload_json, review_json, status,
          sort_order
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      const seenSignatures = new Set(existingSignatures);
      reviewed.forEach(({ provider, candidate, preReviewReasons, review }, sortOrder) => {
        const validation = validateCandidate(candidate, request.data);
        const reasons = [...preReviewReasons, ...validation.reasons];
        if (review !== null && !review.accepted) {
          reasons.push(...(review.reasons.length === 0
            ? ["REVIEW_REJECTED"]
            : review.reasons.map((reason) => `REVIEW_${reason}`)));
        }
        if (validation.payload !== null) {
          const signature = contentSignature(validation.payload);
          if (seenSignatures.has(signature)) {
            reasons.push("DUPLICATE_CONTENT");
          } else {
            seenSignatures.add(signature);
          }
        }
        const itemId = this.randomId();
        const payload = validation.payload === null || validation.reasons.length > 0
          ? this.invalidPlaceholder(itemId, request.data)
          : { ...validation.payload, id: itemId };
        const accepted = reasons.length === 0;
        insert.run(
          itemId,
          draftId,
          provider,
          JSON.stringify(payload),
          JSON.stringify({ accepted, reasons: [...new Set(reasons)] }),
          accepted ? "accepted" : "rejected",
          sortOrder
        );
      });
    }).immediate();
    return this.getDraft(draftId);
  }

  getDraft(id: string): AiDraftView {
    const row = this.deps.db.prepare(`
      SELECT id, subject, step, requested_count AS requestedCount,
        difficulty, weak_topics_json AS weakTopicsJson, status
      FROM ai_generation_drafts WHERE id = ?
    `).get(id) as DraftRow | undefined;
    if (row === undefined) throw new AiStudioError("AI_STUDIO_NOT_FOUND");
    const items = this.deps.db.prepare(`
      SELECT id, source_provider AS sourceProvider, payload_json AS payloadJson,
        review_json AS reviewJson, status
      FROM ai_generation_items WHERE draft_id = ?
      ORDER BY sort_order, id
    `).all(id) as DraftItemRow[];
    try {
      return {
        id: row.id,
        subject: row.subject,
        step: row.step,
        requestedCount: row.requestedCount,
        difficulty: row.difficulty,
        weakTopics: JSON.parse(row.weakTopicsJson) as string[],
        status: row.status,
        items: items.map((item) => ({
          id: item.id,
          sourceProvider: item.sourceProvider,
          payload: LearningItemPayloadSchema.parse(JSON.parse(item.payloadJson)),
          review: StoredReviewSchema.parse(JSON.parse(item.reviewJson)),
          status: item.status
        }))
      };
    } catch {
      throw new AiStudioError("AI_STUDIO_INVALID_REQUEST");
    }
  }

  updateDraftItem(
    draftId: string,
    itemId: string,
    input: { payload: LearningItemPayload }
  ): AiDraftView {
    this.deps.db.transaction(() => {
      const draft = this.getDraft(draftId);
      if (draft.status !== "draft") throw new AiStudioError("AI_STUDIO_NOT_REVIEWABLE");
      const item = draft.items.find((candidate) => candidate.id === itemId);
      if (item === undefined) throw new AiStudioError("AI_STUDIO_NOT_FOUND");
      if (item.status === "rejected") throw new AiStudioError("AI_STUDIO_NOT_REVIEWABLE");
      const validation = validateCandidate(
        { ...input.payload, id: itemId },
        {
          subject: draft.subject,
          step: draft.step,
          count: draft.requestedCount,
          difficulty: draft.difficulty,
          weakTopics: draft.weakTopics
        }
      );
      if (validation.payload === null || validation.reasons.length > 0) {
        throw new AiStudioError("AI_STUDIO_INVALID_REQUEST");
      }
      const result = this.deps.db.prepare(`
        UPDATE ai_generation_items
        SET payload_json = ?, review_json = ?, status = 'edited'
        WHERE id = ? AND draft_id = ? AND status IN ('accepted', 'edited')
          AND EXISTS (
            SELECT 1 FROM ai_generation_drafts
            WHERE id = ? AND status = 'draft'
          )
      `).run(
        JSON.stringify({ ...validation.payload, id: itemId }),
        JSON.stringify({ accepted: true, reasons: ["GUARDIAN_EDITED"] }),
        itemId,
        draftId,
        draftId
      );
      if (result.changes !== 1) throw new AiStudioError("AI_STUDIO_NOT_REVIEWABLE");
    }).immediate();
    return this.getDraft(draftId);
  }

  publishDraft(id: string): AiDraftView {
    this.deps.db.transaction(() => {
      const draft = this.getDraft(id);
      if (draft.status !== "draft") throw new AiStudioError("AI_STUDIO_NOT_REVIEWABLE");
      const publishable = draft.items.filter((item) =>
        item.status === "accepted" || item.status === "edited"
      );
      if (publishable.length === 0) {
        throw new AiStudioError("AI_STUDIO_NO_PUBLISHABLE_ITEMS");
      }
      const request: AiBatchRequest = {
        subject: draft.subject,
        step: draft.step,
        count: draft.requestedCount,
        difficulty: draft.difficulty,
        weakTopics: draft.weakTopics
      };
      const signatures = this.activeContentSignatures(draft.subject);
      for (const item of publishable) {
        const validation = validateCandidate(item.payload, request);
        if (validation.payload === null || validation.reasons.length > 0) {
          throw new AiStudioError("AI_STUDIO_INVALID_REQUEST");
        }
        const signature = contentSignature(validation.payload);
        if (signatures.has(signature)) throw new AiStudioError("AI_STUDIO_INVALID_REQUEST");
        signatures.add(signature);
      }
      const createdAt = this.now().toISOString();
      const insertItem = this.deps.db.prepare(`
        INSERT INTO content_items (
          id, skill_id, subject, status, active_version, created_at
        ) VALUES (?, ?, ?, 'published', 1, ?)
      `);
      const insertVersion = this.deps.db.prepare(`
        INSERT INTO content_versions (item_id, version, payload_json, created_at)
        VALUES (?, 1, ?, ?)
      `);
      for (const item of publishable) {
        insertItem.run(item.id, this.skillId(item.payload), item.payload.subject, createdAt);
        insertVersion.run(item.id, JSON.stringify(item.payload), createdAt);
      }
      this.deps.db.prepare(`
        UPDATE ai_generation_items SET status = 'published'
        WHERE draft_id = ? AND status IN ('accepted', 'edited')
      `).run(id);
      this.deps.db.prepare(`
        UPDATE ai_generation_drafts
        SET status = 'published', published_at = ? WHERE id = ?
      `).run(createdAt, id);
    }).immediate();
    return this.getDraft(id);
  }

  async getReport(input: { from: string; to: string }): Promise<GuardianAiReport> {
    const local = this.localReport(input.from, input.to);
    const { attemptCount, ...metrics } = local;
    if (attemptCount === 0) return metrics;
    const provider = this.providerRows().find((row) => row.enabled === 1 && hasStoredKey(row));
    if (provider === undefined || this.deps.encryptionKey === null) return metrics;
    try {
      const value = await this.callProvider(provider, {
        action: "report",
        metrics: {
          completionRate: metrics.completionRate,
          commonMistakes: metrics.commonMistakes,
          challengePerfect: metrics.challengePerfect
        }
      });
      const parsed = ReportResponseSchema.safeParse(value);
      if (!parsed.success || containsUnsafeChildContent(parsed.data.summary)) return metrics;
      return { ...metrics, source: "llm", summary: parsed.data.summary };
    } catch {
      return metrics;
    }
  }

  private providerRows(): ProviderRow[] {
    return this.deps.db.prepare(`
      SELECT provider, enabled, model,
        api_key_ciphertext AS ciphertext, api_key_iv AS iv, api_key_tag AS tag,
        input_won_per_1k AS inputWonPer1K,
        output_won_per_1k AS outputWonPer1K
      FROM ai_provider_settings
      ORDER BY CASE provider WHEN 'gemini' THEN 0 ELSE 1 END
    `).all() as ProviderRow[];
  }

  private providerRow(provider: AiCoachProvider): ProviderRow {
    const row = this.providerRows().find((candidate) => candidate.provider === provider);
    if (row === undefined) throw new AiStudioError("AI_STUDIO_NOT_FOUND");
    return row;
  }

  private async generate(
    provider: AiCoachProvider,
    count: number,
    input: AiBatchRequest
  ): Promise<unknown[]> {
    const value = await this.callProvider(this.providerRow(provider), {
      action: "generate",
      subject: input.subject,
      step: input.step,
      count,
      difficulty: input.difficulty,
      weakTopics: input.weakTopics,
      requiredKind: input.subject === "math" ? "math-story" : "korean-dictation",
      mathRules: input.subject === "math"
        ? "calculation required; plus/minus only; no negative intermediate; answer 0..99"
        : undefined,
      koreanRules: input.subject === "korean"
        ? input.step === "challenge"
          ? "sentence mode only; answerText max 30 characters and 8 words"
          : "single word mode only"
        : undefined
    });
    const parsed = GenerationResponseSchema.safeParse(value);
    if (!parsed.success || parsed.data.items.length !== count) {
      throw new AiStudioError("AI_STUDIO_PROVIDER_FAILED");
    }
    return parsed.data.items;
  }

  private async review(
    reviewer: AiCoachProvider,
    author: AiCoachProvider,
    candidate: unknown,
    input: AiBatchRequest
  ): Promise<z.infer<typeof ReviewResponseSchema>> {
    const value = await this.callProvider(this.providerRow(reviewer), {
      action: "review",
      authorProvider: author,
      subject: input.subject,
      step: input.step,
      difficulty: input.difficulty,
      candidate
    });
    const parsed = ReviewResponseSchema.safeParse(value);
    if (!parsed.success) throw new AiStudioError("AI_STUDIO_PROVIDER_FAILED");
    return parsed.data;
  }

  private async callProvider(
    settings: ProviderRow,
    prompt: Record<string, unknown>
  ): Promise<unknown> {
    const action = prompt.action;
    if (action !== "generate" && action !== "review" && action !== "report") {
      throw new AiStudioError("AI_STUDIO_INVALID_REQUEST");
    }
    const outputTokenCap = STUDIO_OUTPUT_TOKEN_CAPS[action];
    const reservation = this.reserveBudget(
      settings.provider,
      estimatedInputTokens(STUDIO_PERSONA, prompt),
      outputTokenCap
    );
    if (reservation === null) {
      throw new AiStudioError("AI_STUDIO_BUDGET_EXCEEDED");
    }
    let apiKey = reservation.apiKey;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = reservation.provider === "gemini"
        ? await this.fetcher(
            `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(reservation.model)}:generateContent`,
            {
              method: "POST",
              headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
              body: JSON.stringify({
                contents: [{ role: "user", parts: [{ text: JSON.stringify(prompt) }] }],
                systemInstruction: { parts: [{ text: STUDIO_PERSONA }] },
                generationConfig: {
                  responseMimeType: "application/json",
                  maxOutputTokens: outputTokenCap
                }
              }),
              signal: controller.signal
            }
          )
        : await this.fetcher("https://api.openai.com/v1/responses", {
            method: "POST",
            headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
            body: JSON.stringify({
              model: reservation.model,
              input: [
                { role: "developer", content: STUDIO_PERSONA },
                { role: "user", content: JSON.stringify(prompt) }
              ],
              max_output_tokens: outputTokenCap,
              store: false,
              text: { format: { type: "json_object" } }
            }),
            signal: controller.signal
          });
      if (!response.ok) throw new AiStudioError("AI_STUDIO_PROVIDER_FAILED");
      const body: unknown = await response.json();
      const usage = completeUsage(reservation.provider, body);
      if (usage !== null) this.reconcileBudget(reservation, usage);
      const text = reservation.provider === "gemini"
        ? (body as { candidates?: Array<{ content?: { parts?: Array<{ text?: unknown }> } }> })
            .candidates?.[0]?.content?.parts?.[0]?.text
        : parseOpenAiOutputText(body);
      if (typeof text === "string" && text.includes(apiKey)) {
        throw new AiStudioError("AI_STUDIO_PROVIDER_FAILED");
      }
      return parseProviderJson(text);
    } catch (error) {
      if (error instanceof AiStudioError) throw error;
      throw new AiStudioError("AI_STUDIO_PROVIDER_FAILED");
    } finally {
      clearTimeout(timer);
      apiKey = "";
      reservation.apiKey = "";
    }
  }

  private monthSpent(): number {
    const spent = this.deps.db.prepare(`
      SELECT COALESCE(SUM(estimated_won), 0) AS spent
      FROM ai_coach_usage WHERE month = ?
    `).get(monthAt(this.now())) as { spent: number };
    return spent.spent;
  }

  private reserveBudget(
    provider: AiCoachProvider,
    inputTokens: number,
    outputTokens: number
  ): UsageReservation | null {
    return this.deps.db.transaction(() => {
      const current = this.deps.db.prepare(`
        SELECT coach.monthly_budget_won AS budget,
          provider.provider, provider.enabled, provider.model,
          provider.api_key_ciphertext AS ciphertext,
          provider.api_key_iv AS iv, provider.api_key_tag AS tag,
          provider.input_won_per_1k AS inputWonPer1K,
          provider.output_won_per_1k AS outputWonPer1K
        FROM ai_coach_settings AS coach
        JOIN ai_provider_settings AS provider ON provider.provider = ?
        WHERE coach.singleton = 1
      `).get(provider) as (ProviderRow & { budget: number }) | undefined;
      if (current === undefined || current.enabled !== 1 ||
          this.deps.encryptionKey === null || !hasStoredKey(current)) {
        throw new AiStudioError("AI_STUDIO_API_KEY_REQUIRED");
      }
      let apiKey: string;
      try {
        apiKey = decryptApiKey({
          ciphertext: current.ciphertext!,
          iv: current.iv!,
          tag: current.tag!
        }, this.deps.encryptionKey);
      } catch {
        throw new AiStudioError("AI_STUDIO_API_KEY_REQUIRED");
      }
      const spent = this.deps.db.prepare(`
        SELECT COALESCE(SUM(estimated_won), 0) AS spent
        FROM ai_coach_usage WHERE month = ?
      `).get(monthAt(this.now())) as { spent: number };
      const reservedWon = estimatedWon(
        inputTokens,
        outputTokens,
        current.inputWonPer1K,
        current.outputWonPer1K
      );
      if (reservedWon === null) return null;
      const projected = spent.spent + reservedWon;
      if (!Number.isSafeInteger(spent.spent) || !Number.isSafeInteger(current.budget) ||
          !Number.isSafeInteger(projected) || projected > current.budget) return null;
      const result = this.deps.db.prepare(`
        INSERT INTO ai_coach_usage (
          month, provider, model, input_tokens, output_tokens,
          estimated_won, created_at, reserved_input_tokens,
          reserved_output_tokens, input_won_per_1k, output_won_per_1k
        ) VALUES (?, ?, ?, 0, 0, ?, ?, ?, ?, ?, ?)
      `).run(
        monthAt(this.now()),
        current.provider,
        current.model,
        reservedWon,
        this.now().toISOString(),
        inputTokens,
        outputTokens,
        current.inputWonPer1K,
        current.outputWonPer1K
      );
      return {
        id: Number(result.lastInsertRowid),
        reservedWon,
        provider: current.provider,
        model: current.model,
        inputWonPer1K: current.inputWonPer1K,
        outputWonPer1K: current.outputWonPer1K,
        apiKey
      };
    }).immediate();
  }

  private reconcileBudget(
    reservation: UsageReservation,
    usage: CompleteUsage
  ): void {
    const observedWon = estimatedWon(
      usage.inputTokens,
      usage.outputTokens,
      reservation.inputWonPer1K,
      reservation.outputWonPer1K
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

  private activeContentSignatures(subject: "korean" | "math"): Set<string> {
    const rows = this.deps.db.prepare(`
      SELECT cv.payload_json AS payloadJson
      FROM content_items AS ci
      JOIN content_versions AS cv
        ON cv.item_id = ci.id AND cv.version = ci.active_version
      WHERE ci.subject = ? AND ci.status = 'published'
    `).all(subject) as Array<{ payloadJson: string }>;
    return new Set(rows.flatMap(({ payloadJson }) => {
      const parsed = LearningItemPayloadSchema.safeParse(JSON.parse(payloadJson));
      return parsed.success ? [contentSignature(parsed.data)] : [];
    }));
  }

  private invalidPlaceholder(id: string, input: AiBatchRequest): LearningItemPayload {
    return input.subject === "math"
      ? {
          id,
          kind: "math-story",
          subject: "math",
          unit: "받아올림과 받아내림",
          title: "형식 오류",
          level: `${input.difficulty}단계`,
          readLabel: "검토 필요",
          text: "생성 형식을 확인해야 해요.",
          hint: "",
          tokens: ["검토"],
          question: "검토가 필요해요.",
          answer: 0,
          unitLabel: "",
          checkHint: "형식을 확인해요."
        }
      : {
          id,
          kind: "korean-dictation",
          subject: "korean",
          unit: "낱말 받아쓰기",
          title: "형식 오류",
          level: `${input.difficulty}단계`,
          readLabel: "검토 필요",
          text: "검토",
          hint: "",
          tokens: ["검토"],
          promptText: "검토",
          answerText: "검토",
          mode: "word"
        };
  }

  private skillId(payload: LearningItemPayload): string {
    return payload.subject === "korean"
      ? "skill-korean-reading"
      : payload.kind === "math-story" && payload.calculation !== undefined
        ? "skill-math-calculation"
        : "skill-math-story";
  }

  private localReport(from: string, to: string): GuardianAiReport & { attemptCount: number } {
    const rows = this.deps.db.prepare(`
      SELECT a.completed, a.reading_pass AS readingPass,
        a.math_pass AS mathPass, a.dictation_pass AS dictationPass,
        a.missed_tokens_json AS missedTokensJson,
        cv.payload_json AS payloadJson,
        COALESCE(ipi.step, 'current') AS step
      FROM attempts AS a
      JOIN users AS u ON u.id = a.user_id
      JOIN content_versions AS cv
        ON cv.item_id = a.item_id AND cv.version = a.content_version
      LEFT JOIN issued_plan_items AS ipi
        ON ipi.plan_id = a.issued_plan_id AND ipi.item_id = a.item_id
      WHERE u.role = 'student' AND a.study_date BETWEEN ? AND ?
      ORDER BY a.created_at, a.id
    `).all(from, to) as Array<{
      completed: number;
      readingPass: number;
      mathPass: number | null;
      dictationPass: number | null;
      missedTokensJson: string;
      payloadJson: string;
      step: "foundation" | "current" | "challenge";
    }>;
    if (rows.length === 0) {
      return {
        source: "local",
        summary: "선택한 기간에 저장된 학습 기록이 없어요.",
        completionRate: 0,
        commonMistakes: [],
        challengePerfect: false,
        attemptCount: 0
      };
    }
    const completed = rows.filter((row) => row.completed === 1).length;
    const completionRate = Math.round(completed * 100 / rows.length);
    const mistakes = new Map<string, number>();
    for (const row of rows) {
      for (const token of JSON.parse(row.missedTokensJson) as string[]) {
        mistakes.set(token, (mistakes.get(token) ?? 0) + 1);
      }
      const payload = LearningItemPayloadSchema.safeParse(JSON.parse(row.payloadJson));
      if (payload.success && payload.data.kind === "math-story" && row.mathPass === 0) {
        mistakes.set(payload.data.unit, (mistakes.get(payload.data.unit) ?? 0) + 1);
      }
    }
    const commonMistakes = [...mistakes]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "ko"))
      .slice(0, 5)
      .map(([topic]) => topic);
    const challengePerfect = (this.deps.db.prepare(`
      SELECT EXISTS(
        SELECT 1 FROM star_events AS event
        JOIN users AS student ON student.id = event.student_id
        WHERE student.role = 'student'
          AND event.study_date BETWEEN ? AND ?
          AND event.reason_code = 'CHALLENGE_PERFECT'
      ) AS found
    `).get(from, to) as { found: number }).found === 1;
    return {
      source: "local",
      summary: `총 ${rows.length}번의 학습 중 ${completed}번을 완료해 완료율은 ${completionRate}%예요.`,
      completionRate,
      commonMistakes,
      challengePerfect,
      attemptCount: rows.length
    };
  }
}
