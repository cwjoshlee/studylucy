import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AiBatchRequestSchema,
  type LearningItemPayload
} from "../../src/shared/learning";
import {
  AiStudioError,
  AiStudioService
} from "../../src/server/coach/studio-service";
import { buildApp } from "../../src/server/app";
import { decryptApiKey, encryptApiKey } from "../../src/server/coach/crypto";
import { parseConfig } from "../../src/server/config";
import { openDatabase } from "../../src/server/db/client";
import { migrate } from "../../src/server/db/migrate";
import { seedInitialContent } from "../../src/server/db/seed";
import { createTestHarness, TestClient } from "../helpers/app";

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

function koreanItem(
  id: string,
  answerText: string,
  mode: "word" | "sentence" = "word"
): LearningItemPayload {
  return {
    id,
    kind: "korean-dictation",
    subject: "korean",
    unit: "받침 연습",
    title: `국어 받아쓰기 ${id}`,
    level: "4단계",
    readLabel: "듣고 따라 쓰기",
    text: answerText,
    hint: "천천히 들어 보아요.",
    tokens: answerText.trim().split(/\s+/u),
    promptText: answerText,
    answerText,
    mode
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

function openAiReasoningOutput(value: unknown, withUsage = true): object {
  return {
    output: [
      { type: "reasoning", summary: [] },
      {
        type: "message",
        role: "assistant",
        content: [
          { type: "output_text", text: JSON.stringify(value).slice(0, 8) },
          { type: "output_text", text: JSON.stringify(value).slice(8) }
        ]
      }
    ],
    ...(withUsage ? { usage: { input_tokens: 12, output_tokens: 18 } } : {})
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

function multipartGeminiResponse(
  value: unknown,
  usage = { promptTokenCount: 10, candidatesTokenCount: 10 }
): Response {
  const text = JSON.stringify(value);
  return new Response(JSON.stringify({
    candidates: [{ content: { parts: [
      { text: text.slice(0, 7) },
      { inlineData: { mimeType: "image/png", data: "ignored" } },
      { text: text.slice(7, 19) },
      { text: text.slice(19) }
    ] } }],
    usageMetadata: usage
  }), { status: 200 });
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

async function productionStudioHarness() {
  const db = openDatabase(":memory:");
  migrate(db);
  seedInitialContent(db);
  const config = parseConfig({
    NODE_ENV: "production",
    HOST: "127.0.0.1",
    PORT: "8787",
    DATABASE_PATH: ":memory:",
    BACKUP_DIR: "/tmp/sua-backups",
    APP_ORIGIN: "https://sua.example.test",
    SETUP_SECRET: "s".repeat(32),
    SESSION_PEPPER: "p".repeat(32),
    LLM_ENCRYPTION_KEY: encryptionKey.toString("base64"),
    SESSION_DAYS: "14",
    TIME_ZONE: "Asia/Seoul"
  });
  let sequence = 0;
  const app = await buildApp({
    config,
    db,
    now,
    randomToken: () => Buffer.alloc(32, ++sequence).toString("base64url")
  });
  return {
    app,
    config,
    db,
    guardian: new TestClient(app, config.appOrigin),
    close: async () => {
      await app.close();
      db.close();
    }
  };
}

describe("AI learning studio", () => {
  it("accepts reasoning before fragmented message output and uses action token caps", async () => {
    const caps: number[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const prompt = promptFromRequest(url, init!);
      const requestBody = JSON.parse(String(init!.body)) as {
        max_output_tokens?: number;
        generationConfig?: { maxOutputTokens?: number };
      };
      caps.push(requestBody.max_output_tokens ?? requestBody.generationConfig?.maxOutputTokens ?? -1);
      const value = prompt.action === "generate"
        ? { items: [mathItem(`${url.includes("googleapis.com") ? "g" : "o"}-item`, 31)] }
        : { accepted: true, reasons: [] };
      return url.includes("googleapis.com")
        ? responseFor(url, value)
        : new Response(JSON.stringify(openAiReasoningOutput(value, false)), { status: 200 });
    });
    const { db, service } = studio({ fetcher });
    service.updateProvider("gemini", { enabled: true, apiKey: secrets.gemini });
    service.updateProvider("openai", { enabled: true, apiKey: secrets.openai });

    await expect(service.createDraft({
      subject: "math", step: "current", count: 2, difficulty: 4, weakTopics: []
    })).resolves.toMatchObject({ status: "draft" });

    expect(caps.filter((cap) => cap === 1024)).toHaveLength(2);
    expect(caps.filter((cap) => cap === 256)).toHaveLength(2);
    expect(db.prepare(`
      SELECT COUNT(*) AS count FROM ai_coach_usage
      WHERE provider = 'openai' AND input_tokens = 0 AND output_tokens = 0
        AND estimated_won > 1
    `).get()).toEqual({ count: 2 });
    db.close();
  });

  it("exposes guardian estimates and refuses a worst-case reservation over budget", async () => {
    const { db, service } = studio({ fetcher: vi.fn() });
    service.updateProvider("gemini", {
      enabled: true,
      apiKey: secrets.gemini,
      inputWonPer1K: 100,
      outputWonPer1K: 100
    });
    service.updateProvider("openai", {
      enabled: true,
      apiKey: secrets.openai,
      inputWonPer1K: 100,
      outputWonPer1K: 100
    });
    service.updateBudget({ monthlyBudgetWon: 25 });

    await expect(service.createDraft({
      subject: "math", step: "current", count: 2, difficulty: 4, weakTopics: []
    })).rejects.toMatchObject({ code: "AI_STUDIO_BUDGET_EXCEEDED" });
    expect(service.getSettings()).toMatchObject({
      monthlyBudgetWon: 25,
      monthSpentWon: 0,
      providers: [
        expect.objectContaining({ provider: "gemini", inputWonPer1K: 100, outputWonPer1K: 100 }),
        expect.objectContaining({ provider: "openai", inputWonPer1K: 100, outputWonPer1K: 100 })
      ]
    });
    db.close();
  });

  it("charges complete provider usage above each Studio reservation", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const prompt = promptFromRequest(url, init!);
      const value = prompt.action === "generate"
        ? { items: [mathItem(`${url.includes("googleapis.com") ? "g" : "o"}-usage`, 32)] }
        : { accepted: true, reasons: [] };
      return url.includes("googleapis.com")
        ? new Response(JSON.stringify({
            candidates: [{ content: { parts: [{ text: JSON.stringify(value) }] } }],
            usageMetadata: { promptTokenCount: 50_000, candidatesTokenCount: 50_000 }
          }), { status: 200 })
        : new Response(JSON.stringify({
            ...openAiOutput(value),
            usage: { input_tokens: 50_000, output_tokens: 50_000 }
          }), { status: 200 });
    });
    const { db, service } = studio({ fetcher });
    service.updateProvider("gemini", { enabled: true, apiKey: secrets.gemini });
    service.updateProvider("openai", { enabled: true, apiKey: secrets.openai });
    service.updateBudget({ monthlyBudgetWon: 10_000 });

    await service.createDraft({
      subject: "math", step: "current", count: 2, difficulty: 4, weakTopics: []
    });

    expect(db.prepare(`
      SELECT COUNT(*) AS count, MIN(estimated_won) AS minWon, MAX(estimated_won) AS maxWon,
        SUM(estimated_won) AS totalWon
      FROM ai_coach_usage
    `).get()).toEqual({ count: 4, minWon: 250, maxWon: 250, totalWon: 1000 });
    db.close();
  });

  it("reads the current budget and provider rates inside the reservation transaction", async () => {
    const directory = mkdtempSync(join(tmpdir(), "ai-studio-budget-race-"));
    const databasePath = join(directory, "studio.sqlite");
    const firstDb = openDatabase(databasePath);
    const secondDb = openDatabase(databasePath);
    const fetcher = vi.fn();
    try {
      migrate(firstDb);
      seedInitialContent(firstDb);
      migrate(secondDb);
      const first = new AiStudioService({ db: firstDb, encryptionKey, fetcher, now });
      const second = new AiStudioService({ db: secondDb, encryptionKey, now });
      first.updateProvider("gemini", { enabled: true, apiKey: secrets.gemini });
      first.updateProvider("openai", { enabled: true, apiKey: secrets.openai });
      first.updateBudget({ monthlyBudgetWon: 100 });

      const internal = first as unknown as {
        reserveBudget: (...args: unknown[]) => unknown;
      };
      const originalReserve = internal.reserveBudget.bind(first);
      let changed = false;
      internal.reserveBudget = (...args) => {
        if (!changed) {
          changed = true;
          second.updateBudget({ monthlyBudgetWon: 100 });
          secondDb.prepare(`
            UPDATE ai_provider_settings
            SET input_won_per_1k = 1000, output_won_per_1k = 1000
          `).run();
        }
        return originalReserve(...args);
      };

      await expect(first.createDraft({
        subject: "math", step: "current", count: 2, difficulty: 4, weakTopics: []
      })).rejects.toMatchObject({ code: "AI_STUDIO_BUDGET_EXCEEDED" });
      expect(fetcher).not.toHaveBeenCalled();
      expect(firstDb.prepare("SELECT COUNT(*) AS count FROM ai_coach_usage").get())
        .toEqual({ count: 0 });
    } finally {
      secondDb.close();
      firstDb.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("accepts key updates only over effective HTTPS from the trusted first-hop proxy", async () => {
    const harness = await productionStudioHarness();
    const { guardian } = harness;
    expect((await guardian.request("POST", "/api/auth/setup", {
      setupSecret: harness.config.setupSecret,
      guardianName: "보호자",
      password: "correct horse battery staple",
      studentName: "수아"
    })).statusCode).toBe(201);
    expect((await guardian.request("POST", "/api/auth/guardian/login", {
      password: "correct horse battery staple"
    })).statusCode).toBe(204);

    const accepted = await guardian.request(
      "PUT",
      "/api/guardian/ai-studio/settings/openai",
      { apiKey: "  provider-secret  " },
      {
        remoteAddress: "172.20.0.2",
        headers: { "x-forwarded-proto": "https" }
      }
    );
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json()).toMatchObject({
      provider: "openai",
      hasApiKey: true
    });
    const encrypted = harness.db.prepare(`
      SELECT api_key_ciphertext AS ciphertext,
             api_key_iv AS iv,
             api_key_tag AS tag
      FROM ai_provider_settings WHERE provider = 'openai'
    `).get() as { ciphertext: string; iv: string; tag: string };
    expect(decryptApiKey(encrypted, encryptionKey)).toBe("provider-secret");

    const untrustedForward = await guardian.request(
      "PUT",
      "/api/guardian/ai-studio/settings/openai",
      { apiKey: "replacement-secret" },
      {
        remoteAddress: "203.0.113.50",
        headers: { "x-forwarded-proto": "https" }
      }
    );
    expect(untrustedForward.statusCode).toBe(403);
    expect(untrustedForward.json()).toEqual({ code: "HTTPS_REQUIRED" });
    await harness.close();
  });

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
      {
        provider: "gemini", enabled: false, model: "gemini-2.5-flash-lite", hasApiKey: false,
        inputWonPer1K: 1, outputWonPer1K: 4
      },
      {
        provider: "openai", enabled: true, model: "legacy-selected-model", hasApiKey: true,
        inputWonPer1K: 1, outputWonPer1K: 4
      }
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

  it("parses multipart Gemini generation and review responses with exact usage", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const prompt = promptFromRequest(url, init!);
      const value = prompt.action === "generate"
        ? { items: [mathItem(
            url.includes("googleapis.com") ? "gemini" : "openai",
            url.includes("googleapis.com") ? 31 : 32
          )] }
        : { accepted: true, reasons: [] };
      return url.includes("googleapis.com")
        ? multipartGeminiResponse(value, { promptTokenCount: 13, candidatesTokenCount: 7 })
        : responseFor(url, value);
    });
    const { db, service } = studio({ fetcher });
    service.updateProvider("gemini", { enabled: true, apiKey: secrets.gemini });
    service.updateProvider("openai", { enabled: true, apiKey: secrets.openai });

    const draft = await service.createDraft({
      subject: "math", step: "current", count: 2, difficulty: 4, weakTopics: []
    });

    expect(draft.items).toHaveLength(2);
    expect(draft.items.every((item) => item.review.accepted)).toBe(true);
    expect(db.prepare(`
      SELECT COUNT(*) AS calls, SUM(input_tokens) AS inputTokens,
             SUM(output_tokens) AS outputTokens
      FROM ai_coach_usage WHERE provider = 'gemini'
    `).get()).toEqual({ calls: 2, inputTokens: 26, outputTokens: 14 });
    db.close();
  });

  it("charges Studio Gemini candidate plus thought tokens at the saved rate", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      candidates: [{ content: { parts: [{
        text: JSON.stringify({ summary: "도전까지 차근차근 잘 마쳤어요." })
      }] } }],
      usageMetadata: {
        promptTokenCount: 10,
        candidatesTokenCount: 5,
        thoughtsTokenCount: 55
      }
    }), { status: 200 }));
    const { db, service } = studio({ fetcher });
    db.prepare(`
      INSERT INTO users (id, role, display_name, created_at)
      VALUES ('thought-report-student', 'student', '수아', ?)
    `).run(now().toISOString());
    db.prepare(`
      INSERT INTO attempts (
        id, client_attempt_id, user_id, item_id, content_version, study_date,
        reading_score, reading_pass, missed_tokens_json, math_answer_json,
        math_pass, duration_ms, difficulty_feedback, created_at, completed
      ) VALUES (
        'thought-report-attempt', 'thought-report-client',
        'thought-report-student', 'math-01', 4, '2026-07-18',
        100, 1, '[]', '10', 1, 1000, NULL, ?, 1
      )
    `).run(now().toISOString());
    service.updateProvider("gemini", {
      enabled: true,
      apiKey: secrets.gemini,
      inputWonPer1K: 0,
      outputWonPer1K: 1000
    });

    await expect(service.getReport({ from: "2026-07-18", to: "2026-07-18" }))
      .resolves.toMatchObject({ source: "llm" });
    expect(db.prepare(`
      SELECT input_tokens AS inputTokens, output_tokens AS outputTokens,
        estimated_won AS estimatedWon
      FROM ai_coach_usage
    `).get()).toEqual({ inputTokens: 10, outputTokens: 60, estimatedWon: 60 });
    db.close();
  });

  it("retains the Studio reservation for overflowing Gemini billed output", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      candidates: [{ content: { parts: [{
        text: JSON.stringify({ summary: "도전까지 차근차근 잘 마쳤어요." })
      }] } }],
      usageMetadata: {
        promptTokenCount: 10,
        candidatesTokenCount: Number.MAX_SAFE_INTEGER,
        thoughtsTokenCount: 1
      }
    }), { status: 200 }));
    const { db, service } = studio({ fetcher });
    db.prepare(`
      INSERT INTO users (id, role, display_name, created_at)
      VALUES ('overflow-report-student', 'student', '수아', ?)
    `).run(now().toISOString());
    db.prepare(`
      INSERT INTO attempts (
        id, client_attempt_id, user_id, item_id, content_version, study_date,
        reading_score, reading_pass, missed_tokens_json, math_answer_json,
        math_pass, duration_ms, difficulty_feedback, created_at, completed
      ) VALUES (
        'overflow-report-attempt', 'overflow-report-client',
        'overflow-report-student', 'math-01', 4, '2026-07-18',
        100, 1, '[]', '10', 1, 1000, NULL, ?, 1
      )
    `).run(now().toISOString());
    service.updateProvider("gemini", {
      enabled: true,
      apiKey: secrets.gemini,
      inputWonPer1K: 0,
      outputWonPer1K: 1000
    });

    await expect(service.getReport({ from: "2026-07-18", to: "2026-07-18" }))
      .resolves.toMatchObject({ source: "llm" });
    expect(db.prepare(`
      SELECT input_tokens AS inputTokens, output_tokens AS outputTokens,
        estimated_won AS estimatedWon, reserved_output_tokens AS reservedOutputTokens
      FROM ai_coach_usage
    `).get()).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      estimatedWon: 512,
      reservedOutputTokens: 512
    });
    db.close();
  });

  it("parses a multipart Gemini guardian report and rejects all-empty parts", async () => {
    let empty = false;
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      empty
        ? new Response(JSON.stringify({
            candidates: [{ content: { parts: [
              { inlineData: { mimeType: "image/png", data: "ignored" } },
              { text: "  " }
            ] } }],
            usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 2 }
          }), { status: 200 })
        : multipartGeminiResponse(
            { summary: "도전까지 차근차근 잘 마쳤어요." },
            { promptTokenCount: 11, candidatesTokenCount: 6 }
          ));
    const { db, service } = studio({ fetcher });
    db.prepare(`
      INSERT INTO users (id, role, display_name, created_at)
      VALUES ('multipart-report-student', 'student', '수아', ?)
    `).run(now().toISOString());
    db.prepare(`
      INSERT INTO attempts (
        id, client_attempt_id, user_id, item_id, content_version, study_date,
        reading_score, reading_pass, missed_tokens_json, math_answer_json,
        math_pass, duration_ms, difficulty_feedback, created_at, completed
      ) VALUES (
        'multipart-report-attempt', 'multipart-report-client',
        'multipart-report-student', 'math-01', 4, '2026-07-18',
        100, 1, '[]', '10', 1, 1000, NULL, ?, 1
      )
    `).run(now().toISOString());
    service.updateProvider("gemini", { enabled: true, apiKey: secrets.gemini });

    await expect(service.getReport({ from: "2026-07-18", to: "2026-07-18" }))
      .resolves.toMatchObject({
        source: "llm", summary: "도전까지 차근차근 잘 마쳤어요."
      });
    empty = true;
    await expect(service.getReport({ from: "2026-07-18", to: "2026-07-18" }))
      .resolves.toMatchObject({ source: "local" });
    expect(db.prepare(`
      SELECT COUNT(*) AS calls, SUM(input_tokens) AS inputTokens,
             SUM(output_tokens) AS outputTokens
      FROM ai_coach_usage WHERE provider = 'gemini'
    `).get()).toEqual({ calls: 2, inputTokens: 16, outputTokens: 8 });
    db.close();
  });

  it("cross-reviews only the locally normalized candidate payload", async () => {
    const reviewedCandidates: unknown[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const prompt = promptFromRequest(url, init!);
      if (prompt.action === "generate") {
        const provider = url.includes("googleapis.com") ? "gemini" : "openai";
        return responseFor(url, {
          items: [{
            ...mathItem(`${provider}-normalized`, provider === "gemini" ? 33 : 34),
            unsafeUnrecognizedField: "must-not-reach-review"
          }]
        });
      }
      reviewedCandidates.push(prompt.candidate);
      return responseFor(url, { accepted: true, reasons: [] });
    });
    const { db, service } = studio({ fetcher });
    service.updateProvider("gemini", { enabled: true, apiKey: secrets.gemini });
    service.updateProvider("openai", { enabled: true, apiKey: secrets.openai });

    await service.createDraft({
      subject: "math", step: "current", count: 2, difficulty: 4, weakTopics: []
    });

    expect(reviewedCandidates).toHaveLength(2);
    expect(JSON.stringify(reviewedCandidates)).not.toContain("unsafeUnrecognizedField");
    expect(JSON.stringify(reviewedCandidates)).not.toContain("must-not-reach-review");
    db.close();
  });

  it("rejects contradictory reviewer decisions with fixed reason codes", async () => {
    const candidates = {
      gemini: mathItem("review-false-empty", 22),
      openai: mathItem("review-true-negative", 23)
    };
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const provider = url.includes("generativelanguage.googleapis.com") ? "gemini" : "openai";
      const prompt = promptFromRequest(url, init!);
      if (prompt.action === "generate") return responseFor(url, { items: [candidates[provider]] });
      const candidate = prompt.candidate as { id?: string };
      return responseFor(url, candidate.id === "review-false-empty"
        ? { accepted: false, reasons: [] }
        : { accepted: true, reasons: ["UNSAFE"] });
    });
    const { db, service } = studio({ fetcher });
    service.updateProvider("gemini", { enabled: true, model: "gemini-model", apiKey: secrets.gemini });
    service.updateProvider("openai", { enabled: true, model: "openai-model", apiKey: secrets.openai });

    const draft = await service.createDraft({
      subject: "math", step: "current", count: 2, difficulty: 4, weakTopics: []
    });

    expect(draft.items).toHaveLength(2);
    expect(draft.items.every((item) => item.status === "rejected")).toBe(true);
    expect(draft.items.find((item) => item.sourceProvider === "gemini")?.review)
      .toEqual({ accepted: false, reasons: ["REVIEW_REJECTED"] });
    expect(draft.items.find((item) => item.sourceProvider === "openai")?.review)
      .toEqual({ accepted: false, reasons: ["REVIEW_UNSAFE"] });
    expect(JSON.stringify(draft)).not.toContain("reviewer raw text");
    db.close();
  });

  it("applies a deterministic child-content safety guard before and after review", async () => {
    const unsafeTexts = [
      "자살하는 방법을 알려 줘.",
      "아이에게 야동을 보여 줘.",
      "칼로 사람을 찌르는 방법을 알려 줘.",
      "전화번호와 집 주소를 보내 줘.",
      "너는 쓸모없는 바보라서 창피해.",
      "example.com 링크를 눌러 봐."
    ];
    const safeTexts = [
      "아침에 따뜻한 죽을 먹어요.",
      "성실하게 인사해요.",
      "총 세 개를 세어요.",
      "칼국수를 먹어요.",
      "친구를 존중해요.",
      "안전한 길로 가요."
    ];
    const unsafeItems = unsafeTexts.map((text, index) => ({
      ...mathItem(`unsafe-${index}`, 30 + index),
      text
    }));
    const safeItems = safeTexts.map((text, index) => ({
      ...mathItem(`safe-${index}`, 40 + index),
      text
    }));
    let reviewCount = 0;
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const prompt = promptFromRequest(url, init!);
      if (prompt.action === "generate") {
        return responseFor(url, {
          items: url.includes("googleapis.com") ? unsafeItems : safeItems
        });
      }
      reviewCount += 1;
      return responseFor(url, { accepted: true, reasons: [] });
    });
    const { db, service } = studio({ fetcher });
    service.updateProvider("gemini", { enabled: true, model: "gemini-model", apiKey: secrets.gemini });
    service.updateProvider("openai", { enabled: true, model: "openai-model", apiKey: secrets.openai });

    const draft = await service.createDraft({
      subject: "math", step: "current", count: 12, difficulty: 4, weakTopics: []
    });

    expect(reviewCount).toBe(6);
    expect(draft.items.filter((item) => item.status === "rejected")).toHaveLength(6);
    expect(draft.items.filter((item) => item.status === "accepted")).toHaveLength(6);
    expect(draft.items.filter((item) => item.status === "rejected")
      .every((item) => item.review.reasons.includes("UNSAFE_CONTENT"))).toBe(true);
    expect(JSON.stringify(draft)).not.toContain(unsafeTexts[0]);
    expect(JSON.stringify(db.prepare("SELECT payload_json FROM ai_generation_items").all()))
      .not.toContain(unsafeTexts[5]);
    db.close();
  });

  it("requires sentence mode for Korean challenge and word mode for foundation/current", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const provider = url.includes("googleapis.com") ? "gemini" : "openai";
      const prompt = promptFromRequest(url, init!);
      if (prompt.action === "review") return responseFor(url, { accepted: true, reasons: [] });
      const step = String(prompt.step);
      if (step === "challenge") {
        return responseFor(url, { items: [
          koreanItem(`${provider}-short`, "봄바람이 살랑 불어요.", "sentence"),
          koreanItem(`${provider}-word`, "봄바람", "word"),
          koreanItem(
            `${provider}-long`,
            "나는 오늘 학교에서 친구와 함께 재미있는 받아쓰기를 아주 열심히 연습했어요.",
            "sentence"
          )
        ] });
      }
      return responseFor(url, { items: [
        koreanItem(`${step}-${provider}-word`, "봄바람", "word"),
        koreanItem(`${step}-${provider}-sentence`, "봄바람이 불어요.", "sentence")
      ] });
    });
    const { db, service } = studio({ fetcher });
    service.updateProvider("gemini", { enabled: true, model: "gemini-model", apiKey: secrets.gemini });
    service.updateProvider("openai", { enabled: true, model: "openai-model", apiKey: secrets.openai });

    const challenge = await service.createDraft({
      subject: "korean", step: "challenge", count: 6, difficulty: 4, weakTopics: []
    });
    expect(challenge.items.filter((item) => item.status === "accepted")).toHaveLength(2);
    expect(challenge.items.filter((item) => item.status === "accepted")
      .every((item) => item.payload.kind === "korean-dictation" && item.payload.mode === "sentence"))
      .toBe(true);

    for (const step of ["foundation", "current"] as const) {
      const draft = await service.createDraft({
        subject: "korean", step, count: 4, difficulty: 4, weakTopics: []
      });
      expect(draft.items.filter((item) => item.status === "accepted")).toHaveLength(2);
      expect(draft.items.filter((item) => item.status === "accepted")
        .every((item) => item.payload.kind === "korean-dictation" && item.payload.mode === "word"))
        .toBe(true);
    }
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

  it("blocks unsafe candidates before review and redacts other validation failures", async () => {
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

    expect(reviewCount).toBe(1);
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

  it("serializes same-signature publishes across services and rechecks inside the immediate transaction", async () => {
    const directory = mkdtempSync(join(tmpdir(), "ai-studio-publish-"));
    const databasePath = join(directory, "studio.sqlite");
    const firstDb = openDatabase(databasePath);
    const secondDb = openDatabase(databasePath);
    const makeService = (
      db: ReturnType<typeof openDatabase>,
      prefix: string,
      uniqueAnswer: number
    ) => {
      let sequence = 0;
      const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const prompt = promptFromRequest(url, init!);
        if (prompt.action === "review") return responseFor(url, { accepted: true, reasons: [] });
        return responseFor(url, {
          items: [url.includes("googleapis.com")
            ? mathItem(`${prefix}-shared`, 70)
            : mathItem(`${prefix}-unique`, uniqueAnswer)]
        });
      });
      return new AiStudioService({
        db,
        encryptionKey,
        fetcher,
        now,
        randomId: () => `${prefix}-${++sequence}`
      });
    };

    try {
      migrate(firstDb);
      seedInitialContent(firstDb);
      migrate(secondDb);
      const firstService = makeService(firstDb, "first", 71);
      const secondService = makeService(secondDb, "second", 72);
      firstService.updateProvider("gemini", {
        enabled: true, model: "gemini-model", apiKey: secrets.gemini
      });
      firstService.updateProvider("openai", {
        enabled: true, model: "openai-model", apiKey: secrets.openai
      });
      const request = {
        subject: "math" as const,
        step: "current" as const,
        count: 2,
        difficulty: 4,
        weakTopics: []
      };
      const firstDraft = await firstService.createDraft(request);
      const secondDraft = await secondService.createDraft(request);
      const firstPublished = firstService.publishDraft(firstDraft.id);
      expect(firstPublished.status).toBe("published");
      expect(() => secondService.updateDraftItem(
        firstDraft.id,
        firstDraft.items[0]!.id,
        { payload: firstDraft.items[0]!.payload }
      )).toThrowError(AiStudioError);
      const beforeSecond = counts(secondDb);

      const draftStateChecks: boolean[] = [];
      const signatureChecks: boolean[] = [];
      const observed = secondService as unknown as {
        getDraft: (id: string) => ReturnType<AiStudioService["getDraft"]>;
        activeContentSignatures: (subject: "korean" | "math") => Set<string>;
      };
      const originalGetDraft = observed.getDraft.bind(secondService);
      const originalSignatures = observed.activeContentSignatures.bind(secondService);
      observed.getDraft = (id) => {
        draftStateChecks.push(secondDb.inTransaction);
        return originalGetDraft(id);
      };
      observed.activeContentSignatures = (subject) => {
        signatureChecks.push(secondDb.inTransaction);
        return originalSignatures(subject);
      };

      expect(() => secondService.publishDraft(secondDraft.id)).toThrowError(AiStudioError);
      expect(draftStateChecks[0]).toBe(true);
      expect(signatureChecks).toEqual([true]);
      expect(counts(secondDb)).toEqual(beforeSecond);
      expect(secondDb.prepare("SELECT status FROM ai_generation_drafts WHERE id = ?").get(secondDraft.id))
        .toEqual({ status: "draft" });
      expect(secondDb.prepare(`
        SELECT COUNT(*) AS count
        FROM content_items AS ci
        JOIN content_versions AS cv
          ON cv.item_id = ci.id AND cv.version = ci.active_version
        WHERE ci.status = 'published'
          AND json_extract(cv.payload_json, '$.answer') = 70
      `).get()).toEqual({ count: 1 });
    } finally {
      secondDb.close();
      firstDb.close();
      rmSync(directory, { recursive: true, force: true });
    }
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

  it("returns an empty local report before provider decryption or reservation", async () => {
    const fetcher = vi.fn();
    const { db, service } = studio({ fetcher });
    service.updateProvider("gemini", { enabled: true, apiKey: secrets.gemini });

    await expect(service.getReport({ from: "2026-07-14", to: "2026-07-18" }))
      .resolves.toMatchObject({ source: "local", completionRate: 0 });
    expect(fetcher).not.toHaveBeenCalled();
    expect(db.prepare("SELECT COUNT(*) AS count FROM ai_coach_usage").get())
      .toEqual({ count: 0 });
    db.close();
  });

  it("computes local completion, mistake, and challenge metrics before optional AI wording", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) =>
      responseFor(String(input), { summary: "도전 만점 별을 받은 학습 기간이에요." }));
    const { db, service } = studio({ fetcher });
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
    db.prepare(`
      INSERT INTO star_events (
        id, student_id, requested_delta, delta, balance_after, reason_code,
        reason_text, study_date, actor_type, source_key, created_at
      ) VALUES (
        'report-challenge-perfect', 'report-student', 2, 2, 2,
        'CHALLENGE_PERFECT', '도전 단계 만점', '2026-07-18', 'system',
        'report:challenge-perfect', ?
      )
    `).run(now().toISOString());

    const report = await service.getReport({ from: "2026-07-18", to: "2026-07-18" });

    expect(report).toMatchObject({
      source: "local",
      completionRate: 50,
      challengePerfect: true
    });
    expect(report.commonMistakes).toContain("받침");
    expect(report.commonMistakes).toContain("세 수의 혼합 계산");
    expect(report.summary).toContain("2번의 학습 중 1번");

    service.updateProvider("gemini", { enabled: true, apiKey: secrets.gemini });
    await expect(service.getReport({ from: "2026-07-18", to: "2026-07-18" }))
      .resolves.toMatchObject({ source: "llm", challengePerfect: true });
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toMatchObject({
      generationConfig: { maxOutputTokens: 512 }
    });
    db.close();
  });

  it("keeps every AI studio route guardian-only and never exposes key text", async () => {
    const harness = await createTestHarness();
    const anonymous = await harness.client().request("GET", "/api/guardian/ai-studio/settings");
    expect(anonymous.statusCode).toBe(401);
    expect(anonymous.json()).toEqual({ code: "AUTH_REQUIRED" });
    const anonymousView = await harness.client().request(
      "GET",
      "/api/guardian/ai-studio/settings/view"
    );
    expect(anonymousView.statusCode).toBe(401);
    expect(anonymousView.json()).toEqual({ code: "AUTH_REQUIRED" });

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

    const legacyResponse = await guardian.request(
      "GET",
      "/api/guardian/ai-studio/settings"
    );
    expect(legacyResponse.statusCode).toBe(200);
    expect(legacyResponse.json()).toEqual([
      {
        provider: "gemini", enabled: false, model: "gemini-2.5-flash-lite",
        hasApiKey: false, inputWonPer1K: 1, outputWonPer1K: 4
      },
      {
        provider: "openai", enabled: false, model: "gpt-5-nano",
        hasApiKey: false, inputWonPer1K: 1, outputWonPer1K: 4
      }
    ]);

    const response = await guardian.request(
      "GET",
      "/api/guardian/ai-studio/settings/view"
    );
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      monthlyBudgetWon: 1000,
      monthSpentWon: 0,
      providers: [
        {
          provider: "gemini", enabled: false, model: "gemini-2.5-flash-lite",
          hasApiKey: false, inputWonPer1K: 1, outputWonPer1K: 4
        },
        {
          provider: "openai", enabled: false, model: "gpt-5-nano",
          hasApiKey: false, inputWonPer1K: 1, outputWonPer1K: 4
        }
      ]
    });
    expect(legacyResponse.body).not.toContain("api_key");
    expect(response.body).not.toContain("api_key");
    await harness.close();
  });
});
