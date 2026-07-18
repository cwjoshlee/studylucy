import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AiBatchRequestSchema,
  type LearningItemPayload
} from "../../src/shared/learning";
import {
  AiStudioError,
  AiStudioService
} from "../../src/server/coach/studio-service";
import { encryptApiKey } from "../../src/server/coach/crypto";
import { openDatabase } from "../../src/server/db/client";
import { migrate } from "../../src/server/db/migrate";
import { seedInitialContent } from "../../src/server/db/seed";
import { createTestHarness } from "../helpers/app";

const encryptionKey = Buffer.alloc(32, 19);
const now = () => new Date("2026-07-18T03:00:00.000Z");
const secrets = {
  gemini: "gemini-provider-secret-never-rendered",
  openai: "openai-provider-secret-never-rendered"
};

function mathItem(id: string, answer: number): LearningItemPayload {
  return {
    id,
    kind: "math-story",
    subject: "math",
    unit: "받아올림과 받아내림",
    title: `두 수 계산 ${answer}`,
    level: "4단계",
    readLabel: "식을 읽고 계산하기",
    text: `${answer - 2}에 2를 더해요.`,
    hint: "일의 자리부터 차분히 계산해요.",
    tokens: [String(answer - 2), "2"],
    question: "계산한 답은 얼마일까요?",
    answer,
    unitLabel: "",
    checkHint: "더하기를 다시 확인해 봐요.",
    calculation: {
      operands: [answer - 2, 2],
      operators: ["+"],
      layout: "vertical"
    }
  };
}

function openAiOutput(value: unknown): object {
  return {
    output: [{
      type: "message",
      role: "assistant",
      content: [{
        type: "output_text",
        text: JSON.stringify(value),
        annotations: []
      }]
    }],
    usage: { input_tokens: 10, output_tokens: 10 }
  };
}

function promptFromRequest(url: string, init: RequestInit): Record<string, unknown> {
  const body = JSON.parse(String(init.body)) as {
    contents?: Array<{ parts?: Array<{ text?: string }> }>;
    input?: Array<{ content?: string }>;
  };
  const text = url.includes("generativelanguage.googleapis.com")
    ? body.contents?.[0]?.parts?.[0]?.text
    : body.input?.at(-1)?.content;
  if (text === undefined) throw new Error("missing test prompt");
  return JSON.parse(text) as Record<string, unknown>;
}

function responseFor(url: string, value: unknown): Response {
  return url.includes("generativelanguage.googleapis.com")
    ? new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: JSON.stringify(value) }] } }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 10 }
      }), { status: 200 })
    : new Response(JSON.stringify(openAiOutput(value)), { status: 200 });
}

function studio(options: {
  fetcher?: typeof fetch;
  timeoutMs?: number;
  encryption?: Buffer | null;
} = {}) {
  const db = openDatabase(":memory:");
  migrate(db);
  seedInitialContent(db);
  const service = new AiStudioService({
    db,
    encryptionKey: options.encryption === undefined
      ? encryptionKey
      : options.encryption,
    fetcher: options.fetcher,
    now,
    timeoutMs: options.timeoutMs,
    randomId: (() => {
      let sequence = 0;
      return () => `studio-id-${++sequence}`;
    })()
  });
  return { db, service };
}

function counts(db: ReturnType<typeof openDatabase>) {
  return {
    content: (db.prepare("SELECT COUNT(*) AS count FROM content_items").get() as { count: number }).count,
    plans: (db.prepare("SELECT COUNT(*) AS count FROM issued_daily_plans").get() as { count: number }).count,
    requirements: (db.prepare("SELECT COUNT(*) AS count FROM daily_requirements").get() as { count: number }).count,
    attempts: (db.prepare("SELECT COUNT(*) AS count FROM attempts").get() as { count: number }).count
  };
}

describe("AI learning studio", () => {
  it("validates the strict batch request contract", () => {
    expect(AiBatchRequestSchema.parse({
      subject: "math",
      step: "current",
      count: 7,
      difficulty: 4,
      weakTopics: ["받아올림"]
    })).toMatchObject({ count: 7, difficulty: 4 });
    expect(() => AiBatchRequestSchema.parse({
      subject: "math",
      step: "current",
      count: 1,
      difficulty: 6,
      weakTopics: [],
      extra: true
    })).toThrow();
  });

  it("migrates the selected legacy coach provider into its provider row", () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const encrypted = encryptApiKey("legacy-openai-secret", encryptionKey);
    db.prepare(`
      UPDATE ai_coach_settings
      SET enabled = 1, provider = 'openai', model = 'legacy-selected-model',
          api_key_ciphertext = ?, api_key_iv = ?, api_key_tag = ?
      WHERE singleton = 1
    `).run(encrypted.ciphertext, encrypted.iv, encrypted.tag);

    const service = new AiStudioService({ db, encryptionKey, now });

    expect(service.getProviderSettings()).toEqual([
      { provider: "gemini", enabled: false, model: "gemini-2.5-flash-lite", hasApiKey: false },
      { provider: "openai", enabled: true, model: "legacy-selected-model", hasApiKey: true }
    ]);
    db.close();
  });

  it("splits odd batches Gemini-first, cross-reviews every candidate, and uses configured models", async () => {
    const generationCalls: Array<{ provider: string; count: number; model: string }> = [];
    const reviewCalls: Array<{ reviewer: string; author: string }> = [];
    const publicResponses: unknown[] = [];
    const geminiItems = [10, 11, 12, 13].map((answer) => mathItem(`gemini-${answer}`, answer));
    const duplicate = { ...geminiItems[0]!, id: "openai-duplicate" };
    const openaiItems = [duplicate, mathItem("openai-20", 20), mathItem("openai-21", 21)];
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const provider = url.includes("generativelanguage.googleapis.com") ? "gemini" : "openai";
      const prompt = promptFromRequest(url, init!);
      const body = JSON.parse(String(init!.body)) as { model?: string };
      const model = provider === "gemini"
        ? /\/models\/([^:]+):generateContent/.exec(url)?.[1] ?? ""
        : body.model ?? "";
      if (prompt.action === "generate") {
        generationCalls.push({ provider, count: Number(prompt.count), model });
        return responseFor(url, { items: provider === "gemini" ? geminiItems : openaiItems });
      }
      if (prompt.action === "review") {
        reviewCalls.push({ reviewer: provider, author: String(prompt.authorProvider) });
        return responseFor(url, { accepted: true, reasons: [] });
      }
      throw new Error("unexpected provider action");
    });
    const { db, service } = studio({ fetcher });

    publicResponses.push(service.updateProvider("gemini", {
      enabled: true,
      model: "guardian-gemini-model",
      apiKey: secrets.gemini
    }));
    publicResponses.push(service.updateProvider("openai", {
      enabled: true,
      model: "guardian-openai-model",
      apiKey: secrets.openai
    }));
    const saved = await service.createDraft({
      subject: "math",
      step: "current",
      count: 7,
      difficulty: 4,
      weakTopics: ["받아올림"]
    });
    publicResponses.push(service.getProviderSettings(), saved);

    expect(generationCalls.map(({ provider, count }) => ({ provider, count })))
      .toEqual([{ provider: "gemini", count: 4 }, { provider: "openai", count: 3 }]);
    expect(generationCalls.map((call) => call.model))
      .toEqual(["guardian-gemini-model", "guardian-openai-model"]);
    expect(reviewCalls).toHaveLength(7);
    expect(reviewCalls.every((call) => call.reviewer !== call.author)).toBe(true);
    expect(saved.status).toBe("draft");
    expect(saved.items).toHaveLength(7);
    const rejected = saved.items.find((item) => item.payload.title === "두 수 계산 10" && item.sourceProvider === "openai");
    expect(rejected?.status).toBe("rejected");
    expect(rejected?.review.accepted).toBe(false);
    expect(rejected?.review.reasons).toContain("DUPLICATE_CONTENT");
    expect(JSON.stringify(publicResponses)).not.toContain(secrets.gemini);
    expect(JSON.stringify(publicResponses)).not.toContain(secrets.openai);
    for (const call of fetcher.mock.calls) {
      const [url, init] = call as [string, RequestInit];
      const headers = new Headers(init.headers);
      const expectedSecret = url.includes("googleapis.com") ? secrets.gemini : secrets.openai;
      expect([...headers.values()].join(" ")).toContain(expectedSecret);
      expect(String(init.body)).not.toContain(expectedSecret);
      if (!url.includes("googleapis.com")) {
        expect(JSON.parse(String(init.body))).toMatchObject({ store: false });
      }
    }

    const beforePublish = counts(db);
    const published = service.publishDraft(saved.id);
    expect(published.status).toBe("published");
    expect(published.items.filter((item) => item.status === "published")).toHaveLength(6);
    expect(published.items.find((item) => item.id === rejected?.id)?.status).toBe("rejected");
    expect(counts(db)).toEqual({ ...beforePublish, content: beforePublish.content + 6 });
    expect(db.prepare("SELECT 1 FROM content_items WHERE id = ?").get(rejected!.id)).toBeUndefined();
    expect(() => service.updateDraftItem(saved.id, saved.items[0]!.id, {
      payload: saved.items[0]!.payload
    })).toThrowError(AiStudioError);
    db.close();
  });

  it("publishes no content when final validation fails", async () => {
    const item = mathItem("candidate", 15);
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const prompt = promptFromRequest(url, init!);
      return responseFor(url, prompt.action === "generate"
        ? { items: [item] }
        : { accepted: true, reasons: [] });
    });
    const { db, service } = studio({ fetcher });
    service.updateProvider("gemini", { enabled: true, model: "gemini-model", apiKey: secrets.gemini });
    service.updateProvider("openai", { enabled: true, model: "openai-model", apiKey: secrets.openai });
    const draft = await service.createDraft({
      subject: "math", step: "current", count: 2, difficulty: 4, weakTopics: []
    });
    const accepted = draft.items.find((entry) => entry.status === "accepted")!;
    db.prepare("UPDATE ai_generation_items SET payload_json = ? WHERE id = ?")
      .run(JSON.stringify({ ...accepted.payload, answer: 99 }), accepted.id);
    const before = counts(db);

    expect(() => service.publishDraft(draft.id)).toThrowError(AiStudioError);
    expect(counts(db)).toEqual(before);
    expect(db.prepare("SELECT status FROM ai_generation_drafts WHERE id = ?").get(draft.id))
      .toEqual({ status: "draft" });
    db.close();
  });

  it("reviews every candidate but redacts unsafe, out-of-range, and wrong-format generation failures", async () => {
    const unsafe = { ...mathItem("unsafe", 24), text: "https://unsafe.example 를 눌러요." };
    const outOfRange = { ...mathItem("out-of-range", 25), level: "5단계" };
    const reviewFailure = mathItem("review-failure", 26);
    const items = {
      gemini: [unsafe, outOfRange],
      openai: [{ id: "wrong-format" }, reviewFailure]
    };
    let reviewCount = 0;
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const provider = url.includes("generativelanguage.googleapis.com") ? "gemini" : "openai";
      const prompt = promptFromRequest(url, init!);
      if (prompt.action === "generate") return responseFor(url, { items: items[provider] });
      reviewCount += 1;
      const candidate = prompt.candidate as { id?: string };
      return responseFor(url, candidate.id === "review-failure"
        ? { accepted: false, reasons: ["WRONG_ANSWER"] }
        : { accepted: true, reasons: [] });
    });
    const { db, service } = studio({ fetcher });
    service.updateProvider("gemini", { enabled: true, model: "gemini-model", apiKey: secrets.gemini });
    service.updateProvider("openai", { enabled: true, model: "openai-model", apiKey: secrets.openai });

    const draft = await service.createDraft({
      subject: "math", step: "current", count: 4, difficulty: 4, weakTopics: []
    });

    expect(reviewCount).toBe(4);
    expect(draft.items.every((item) => item.status === "rejected")).toBe(true);
    expect(draft.items.flatMap((item) => item.review.reasons)).toEqual(expect.arrayContaining([
      "UNSAFE_CONTENT", "OUT_OF_RANGE", "WRONG_FORMAT", "REVIEW_WRONG_ANSWER"
    ]));
    expect(JSON.stringify(draft)).not.toContain("https://unsafe.example");
    expect(() => service.publishDraft(draft.id)).toThrowError(AiStudioError);
    db.close();
  });

  it("rejects a key string echoed by a provider instead of persisting or returning it", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const prompt = promptFromRequest(url, init!);
      if (prompt.action === "generate") {
        const item = mathItem("echo", 27);
        return responseFor(url, {
          items: [{ ...item, title: url.includes("googleapis.com") ? secrets.gemini : secrets.openai }]
        });
      }
      return responseFor(url, { accepted: true, reasons: [] });
    });
    const { db, service } = studio({ fetcher });
    service.updateProvider("gemini", { enabled: true, model: "gemini-model", apiKey: secrets.gemini });
    service.updateProvider("openai", { enabled: true, model: "openai-model", apiKey: secrets.openai });

    await expect(service.createDraft({
      subject: "math", step: "current", count: 2, difficulty: 4, weakTopics: []
    })).rejects.toBeInstanceOf(AiStudioError);
    expect(db.prepare("SELECT COUNT(*) AS count FROM ai_generation_drafts").get())
      .toEqual({ count: 0 });
    expect(JSON.stringify(db.prepare("SELECT * FROM ai_generation_items").all()))
      .not.toContain("provider-secret-never-rendered");
    db.close();
  });

  it("rechecks active-content duplicates at publish time and rolls back the whole publish", async () => {
    const generated = [mathItem("first", 28), mathItem("second", 29)];
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const prompt = promptFromRequest(url, init!);
      if (prompt.action === "generate") {
        return responseFor(url, { items: [generated[url.includes("googleapis.com") ? 0 : 1]] });
      }
      return responseFor(url, { accepted: true, reasons: [] });
    });
    const { db, service } = studio({ fetcher });
    service.updateProvider("gemini", { enabled: true, model: "gemini-model", apiKey: secrets.gemini });
    service.updateProvider("openai", { enabled: true, model: "openai-model", apiKey: secrets.openai });
    const draft = await service.createDraft({
      subject: "math", step: "current", count: 2, difficulty: 4, weakTopics: []
    });
    const racingPayload = { ...draft.items[0]!.payload, id: "racing-content" };
    db.prepare(`
      INSERT INTO content_items (id, skill_id, subject, status, active_version, created_at)
      VALUES ('racing-content', 'skill-math-calculation', 'math', 'published', 1, ?)
    `).run(now().toISOString());
    db.prepare(`
      INSERT INTO content_versions (item_id, version, payload_json, created_at)
      VALUES ('racing-content', 1, ?, ?)
    `).run(JSON.stringify(racingPayload), now().toISOString());
    const before = counts(db);

    expect(() => service.publishDraft(draft.id)).toThrowError(AiStudioError);
    expect(counts(db)).toEqual(before);
    expect(db.prepare("SELECT status FROM ai_generation_drafts WHERE id = ?").get(draft.id))
      .toEqual({ status: "draft" });
    db.close();
  });

  it.each(["missing-key", "budget", "timeout"] as const)(
    "leaves content, plans, and progress unchanged on %s failure",
    async (failure) => {
      const timeoutFetcher = vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        }));
      const { db, service } = studio({
        fetcher: failure === "timeout" ? timeoutFetcher as typeof fetch : vi.fn(),
        timeoutMs: 5
      });
      if (failure !== "missing-key") {
        service.updateProvider("gemini", { enabled: true, model: "gemini-model", apiKey: secrets.gemini });
        service.updateProvider("openai", { enabled: true, model: "openai-model", apiKey: secrets.openai });
      }
      if (failure === "budget") {
        db.prepare("UPDATE ai_coach_settings SET monthly_budget_won = 0 WHERE singleton = 1").run();
      }
      const before = counts(db);

      await expect(service.createDraft({
        subject: "math", step: "current", count: 2, difficulty: 4, weakTopics: []
      })).rejects.toBeInstanceOf(AiStudioError);
      expect(counts(db)).toEqual(before);
      expect(db.prepare("SELECT COUNT(*) AS count FROM ai_generation_drafts").get())
        .toEqual({ count: 0 });
      db.close();
    }
  );

  it("returns a deterministic local report when no provider key is configured", async () => {
    const { db, service } = studio({ encryption: null });

    const first = await service.getReport({ from: "2026-07-14", to: "2026-07-18" });
    const second = await service.getReport({ from: "2026-07-14", to: "2026-07-18" });

    expect(first).toEqual(second);
    expect(first).toEqual({
      source: "local",
      summary: "선택한 기간에 저장된 학습 기록이 없어요.",
      completionRate: 0,
      commonMistakes: [],
      challengePerfect: false
    });
    db.close();
  });

  it("computes local completion, mistake, and challenge metrics before optional AI wording", async () => {
    const { db, service } = studio({ encryption: null });
    db.prepare(`
      INSERT INTO users (id, role, display_name, created_at)
      VALUES ('report-student', 'student', '수아', ?)
    `).run(now().toISOString());
    const insert = db.prepare(`
      INSERT INTO attempts (
        id, client_attempt_id, user_id, item_id, content_version, study_date,
        reading_score, reading_pass, missed_tokens_json, math_answer_json,
        math_pass, duration_ms, difficulty_feedback, created_at, completed
      ) VALUES (?, ?, 'report-student', ?, 4, '2026-07-18', ?, ?, ?, ?, ?, 1000, NULL, ?, ?)
    `);
    insert.run(
      "report-korean", "report-client-korean", "ko-01", 100, 1,
      JSON.stringify(["받침"]), null, null, now().toISOString(), 1
    );
    insert.run(
      "report-math", "report-client-math", "math-01", 100, 1,
      "[]", JSON.stringify(0), 0, now().toISOString(), 0
    );

    const report = await service.getReport({ from: "2026-07-18", to: "2026-07-18" });

    expect(report).toMatchObject({
      source: "local",
      completionRate: 50,
      challengePerfect: false
    });
    expect(report.commonMistakes).toContain("받침");
    expect(report.commonMistakes).toContain("세 수의 혼합 계산");
    expect(report.summary).toContain("2번의 학습 중 1번");
    db.close();
  });

  it("keeps every AI studio route guardian-only and never exposes key text", async () => {
    const harness = await createTestHarness();
    const anonymous = await harness.client().request("GET", "/api/guardian/ai-studio/settings");
    expect(anonymous.statusCode).toBe(401);
    expect(anonymous.json()).toEqual({ code: "AUTH_REQUIRED" });

    const guardian = harness.client();
    expect((await guardian.request("POST", "/api/auth/setup", {
      setupSecret: harness.config.setupSecret,
      guardianName: "보호자",
      password: "correct horse battery staple",
      studentName: "수아"
    })).statusCode).toBe(201);
    expect((await guardian.request("POST", "/api/auth/guardian/login", {
      password: "correct horse battery staple"
    })).statusCode).toBe(204);

    const response = await guardian.request("GET", "/api/guardian/ai-studio/settings");
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([
      { provider: "gemini", enabled: false, model: "gemini-2.5-flash-lite", hasApiKey: false },
      { provider: "openai", enabled: false, model: "gpt-5-nano", hasApiKey: false }
    ]);
    expect(response.body).not.toContain("api_key");
    await harness.close();
  });
});
