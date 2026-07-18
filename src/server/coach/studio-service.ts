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
  type GuardianAiReport,
  type LearningItemPayload
} from "../../shared/learning";
import { decryptApiKey, encryptApiKey } from "./crypto";

const DEFAULT_MODELS: Record<AiCoachProvider, string> = {
  gemini: "gemini-2.5-flash-lite",
  openai: "gpt-5-nano"
};
const MODEL_PATTERN = /^[A-Za-z0-9._:-]{2,120}$/;
const CALL_RESERVATION_WON = 1;
const DEFAULT_TIMEOUT_MS = 10_000;
const PROVIDER_OUTPUT_TOKEN_CAP = 8_192;
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
  if (!Array.isArray(output) || output.length !== 1) {
    throw new AiStudioError("AI_STUDIO_PROVIDER_FAILED");
  }
  const item = output[0];
  if (item === null || typeof item !== "object") {
    throw new AiStudioError("AI_STUDIO_PROVIDER_FAILED");
  }
  const content = (item as { type?: unknown; content?: unknown }).content;
  if ((item as { type?: unknown }).type !== "message" || !Array.isArray(content) || content.length !== 1) {
    throw new AiStudioError("AI_STUDIO_PROVIDER_FAILED");
  }
  const entry = content[0];
  if (entry === null || typeof entry !== "object" ||
      (entry as { type?: unknown }).type !== "output_text" ||
      typeof (entry as { text?: unknown }).text !== "string") {
    throw new AiStudioError("AI_STUDIO_PROVIDER_FAILED");
  }
  return (entry as { text: string }).text;
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
      hasApiKey: hasStoredKey(row)
    }));
  }

  updateProvider(
    provider: AiCoachProvider,
    input: AiProviderSettingsInput
  ): AiProviderSettingsView {
    if ((input.model !== undefined && !MODEL_PATTERN.test(input.model)) ||
        Object.keys(input).length === 0 ||
        (input.apiKey !== undefined && input.deleteApiKey === true) ||
        (input.apiKey !== undefined && (input.apiKey.length < 1 || input.apiKey.length > 500))) {
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
          api_key_tag = ?, updated_at = ?
      WHERE provider = ?
    `).run(
      enabled ? 1 : 0,
      input.model ?? previous.model,
      input.deleteApiKey ? null : encrypted?.ciphertext ?? previous.ciphertext,
      input.deleteApiKey ? null : encrypted?.iv ?? previous.iv,
      input.deleteApiKey ? null : encrypted?.tag ?? previous.tag,
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
        const preReviewReasons = containsUnsafeChildContent(candidate)
          ? ["UNSAFE_CONTENT"]
          : [];
        return {
          provider,
          candidate,
          preReviewReasons,
          review: preReviewReasons.length === 0
            ? await this.review(otherProvider(provider), provider, candidate, request.data)
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
    this.deps.db.prepare(`
      UPDATE ai_generation_items
      SET payload_json = ?, review_json = ?, status = 'edited'
      WHERE id = ? AND draft_id = ?
    `).run(
      JSON.stringify({ ...validation.payload, id: itemId }),
      JSON.stringify({ accepted: true, reasons: ["GUARDIAN_EDITED"] }),
      itemId,
      draftId
    );
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
    const metrics = this.localReport(input.from, input.to);
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
        api_key_ciphertext AS ciphertext, api_key_iv AS iv, api_key_tag AS tag
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
    if (this.deps.encryptionKey === null || !hasStoredKey(settings)) {
      throw new AiStudioError("AI_STUDIO_API_KEY_REQUIRED");
    }
    if (!this.reserveBudget(settings)) {
      throw new AiStudioError("AI_STUDIO_BUDGET_EXCEEDED");
    }
    let apiKey: string;
    try {
      apiKey = decryptApiKey({
        ciphertext: settings.ciphertext!,
        iv: settings.iv!,
        tag: settings.tag!
      }, this.deps.encryptionKey);
    } catch {
      throw new AiStudioError("AI_STUDIO_API_KEY_REQUIRED");
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = settings.provider === "gemini"
        ? await this.fetcher(
            `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(settings.model)}:generateContent`,
            {
              method: "POST",
              headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
              body: JSON.stringify({
                contents: [{ role: "user", parts: [{ text: JSON.stringify(prompt) }] }],
                systemInstruction: { parts: [{ text: STUDIO_PERSONA }] },
                generationConfig: {
                  responseMimeType: "application/json",
                  maxOutputTokens: PROVIDER_OUTPUT_TOKEN_CAP
                }
              }),
              signal: controller.signal
            }
          )
        : await this.fetcher("https://api.openai.com/v1/responses", {
            method: "POST",
            headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
            body: JSON.stringify({
              model: settings.model,
              input: [
                { role: "developer", content: STUDIO_PERSONA },
                { role: "user", content: JSON.stringify(prompt) }
              ],
              max_output_tokens: PROVIDER_OUTPUT_TOKEN_CAP,
              store: false,
              text: { format: { type: "json_object" } }
            }),
            signal: controller.signal
          });
      if (!response.ok) throw new AiStudioError("AI_STUDIO_PROVIDER_FAILED");
      const body: unknown = await response.json();
      const text = settings.provider === "gemini"
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
    }
  }

  private reserveBudget(settings: ProviderRow): boolean {
    return this.deps.db.transaction(() => {
      const budget = this.deps.db.prepare(`
        SELECT monthly_budget_won AS budget
        FROM ai_coach_settings WHERE singleton = 1
      `).get() as { budget: number };
      const spent = this.deps.db.prepare(`
        SELECT COALESCE(SUM(estimated_won), 0) AS spent
        FROM ai_coach_usage WHERE month = ?
      `).get(monthAt(this.now())) as { spent: number };
      if (spent.spent + CALL_RESERVATION_WON > budget.budget) return false;
      this.deps.db.prepare(`
        INSERT INTO ai_coach_usage (
          month, provider, model, input_tokens, output_tokens,
          estimated_won, created_at
        ) VALUES (?, ?, ?, 0, 0, ?, ?)
      `).run(
        monthAt(this.now()),
        settings.provider,
        settings.model,
        CALL_RESERVATION_WON,
        this.now().toISOString()
      );
      return true;
    }).immediate();
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

  private localReport(from: string, to: string): GuardianAiReport {
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
        challengePerfect: false
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
    const challenges = rows.filter((row) => row.step === "challenge");
    const challengePerfect = challenges.length > 0 && challenges.every((row) =>
      row.completed === 1 && row.readingPass === 1 &&
      row.mathPass !== 0 && row.dictationPass !== 0
    );
    return {
      source: "local",
      summary: `총 ${rows.length}번의 학습 중 ${completed}번을 완료해 완료율은 ${completionRate}%예요.`,
      completionRate,
      commonMistakes,
      challengePerfect
    };
  }
}
