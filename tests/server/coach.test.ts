import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { decryptApiKey, encryptApiKey } from "../../src/server/coach/crypto";
import { AiCoachService } from "../../src/server/coach/service";
import { openDatabase } from "../../src/server/db/client";
import { migrate } from "../../src/server/db/migrate";
import { createTestHarness } from "../helpers/app";

const key = Buffer.alloc(32, 7);

function openAiResponse(message: string, inputTokens = 10, outputTokens = 10) {
  return {
    output: [{
      type: "message",
      role: "assistant",
      content: [{
        type: "output_text",
        text: JSON.stringify({ message }),
        annotations: []
      }]
    }],
    usage: { input_tokens: inputTokens, output_tokens: outputTokens }
  };
}

describe("AI coach privacy and budget boundaries", () => {
  it("accepts OpenAI reasoning items before fragmented message output", async () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const text = JSON.stringify({ message: "한 걸음씩 해 보자" });
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      output: [
        { type: "reasoning", summary: [] },
        { type: "message", content: [
          { type: "output_text", text: text.slice(0, 9) },
          { type: "output_text", text: text.slice(9) }
        ] },
        { type: "tool_call", name: "ignored" }
      ],
      usage: { input_tokens: 20, output_tokens: 10 }
    }), { status: 200 }));
    const service = new AiCoachService({ db, encryptionKey: key, fetcher });
    service.updateSettings({ enabled: true, provider: "openai", apiKey: "provider-secret" });

    await expect(service.message({
      event: "retry", subject: "korean", retryCount: 1, hintStage: "step"
    })).resolves.toEqual({ message: "한 걸음씩 해 보자", source: "llm" });
    db.close();
  });

  it("rejects production legacy API-key updates over HTTP and whitespace keys", async () => {
    const harness = await createTestHarness({ nodeEnv: "production" });
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

    const nonKeyUpdate = await guardian.request(
      "PUT",
      "/api/guardian/ai-coach-settings",
      { monthlyBudgetWon: 900 }
    );
    expect(nonKeyUpdate.statusCode).toBe(200);

    const insecure = await guardian.request(
      "PUT",
      "/api/guardian/ai-coach-settings",
      { apiKey: "provider-secret" }
    );
    expect(insecure.statusCode).toBe(403);
    expect(insecure.json()).toEqual({ code: "HTTPS_REQUIRED" });

    const whitespace = await guardian.request(
      "PUT",
      "/api/guardian/ai-coach-settings",
      { apiKey: "   " },
      { headers: { "x-forwarded-proto": "https" } }
    );
    expect(whitespace.statusCode).toBe(400);
    expect(whitespace.json()).toEqual({ code: "INVALID_REQUEST" });
    await harness.close();
  });

  it("uses randomized authenticated encryption and rejects a modified ciphertext", () => {
    const first = encryptApiKey("provider-secret", key);
    const second = encryptApiKey("provider-secret", key);

    expect(first.ciphertext).not.toBe(second.ciphertext);
    expect(decryptApiKey(first, key)).toBe("provider-secret");
    expect(() => decryptApiKey({ ...first, tag: `${first.tag.slice(0, -2)}aa` }, key))
      .toThrow();
  });

  it("exposes settings without an API key and refuses enabled saves without encryption", () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const service = new AiCoachService({ db, encryptionKey: null, fetcher: vi.fn() });

    expect(service.getSettings()).toEqual({
      enabled: false,
      provider: "gemini",
      model: "gemini-2.5-flash-lite",
      monthlyBudgetWon: 1000,
      monthSpentWon: 0,
      hasApiKey: false
    });
    expect(() => service.updateSettings({ enabled: true })).toThrow("LLM_ENCRYPTION_KEY");
    expect(() => service.updateSettings({ apiKey: "provider-secret" })).toThrow("LLM_ENCRYPTION_KEY");
    db.close();
  });

  it("sends only the fixed persona and shared coach event contract to Gemini", async () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify({ message: "천천히 다시 해 보자" }) }] } }]
    }), { status: 200 }));
    const service = new AiCoachService({ db, encryptionKey: key, fetcher });
    service.updateSettings({ enabled: true, apiKey: "provider-secret" });

    await expect(service.message({
      event: "retry", subject: "math", retryCount: 1, hintStage: "first"
    })).resolves.toEqual({ message: "천천히 다시 해 보자", source: "llm" });

    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent");
    const sent = String(init.body);
    expect(sent).toContain("retry");
    expect(sent).toContain("math");
    expect(JSON.parse(sent)).toMatchObject({
      generationConfig: { maxOutputTokens: 64 }
    });
    expect(sent).not.toMatch(/name|pin|transcript|answer|cookie|device|plan|provider-secret/i);
    db.close();
  });

  it.each([
    "천천히 다시 해 보자!",
    "한 걸음씩 해 보자. 잘하고 있어!",
    "차근차근 해 보자…"
  ])("accepts safe Korean coach punctuation %s", async (message) => {
    const db = openDatabase(":memory:");
    migrate(db);
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify({ message }) }] } }]
    }), { status: 200 }));
    const service = new AiCoachService({ db, encryptionKey: key, fetcher });
    service.updateSettings({ enabled: true, apiKey: "provider-secret" });

    await expect(service.message({
      event: "retry", subject: "korean", retryCount: 1, hintStage: "first"
    })).resolves.toEqual({ message, source: "llm" });
    db.close();
  });

  it.each([
    "가 010-1234-5678로 연락해!",
    "여기 https://example.test 를 눌러 봐",
    "천천히 again 해 보자",
    "바보야 벌 받아",
    "공부 안 하면 혼낼 거야",
    "공부 안 하면 벌 줄 거야"
  ])("fails closed for unsafe provider message %s", async (message) => {
    const db = openDatabase(":memory:");
    migrate(db);
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify({ message }) }] } }]
    }), { status: 200 }));
    const service = new AiCoachService({ db, encryptionKey: key, fetcher });
    service.updateSettings({ enabled: true, apiKey: "provider-secret" });

    await expect(service.message({
      event: "retry", subject: "korean", retryCount: 1, hintStage: "first"
    })).resolves.toMatchObject({ source: "local" });
    db.close();
  });

  it("uses OpenAI Responses gpt-5-nano and makes no request after the cap is exhausted", async () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(
      openAiResponse("한 걸음씩 해 보자")
    ), { status: 200 }));
    const service = new AiCoachService({ db, encryptionKey: key, fetcher });
    service.updateSettings({
      enabled: true, provider: "openai", apiKey: "provider-secret", monthlyBudgetWon: 1
    });

    await expect(service.message({
      event: "retry", subject: "korean", retryCount: 1, hintStage: "step"
    })).resolves.toMatchObject({ source: "llm" });
    const fallback = await service.message({ event: "retry", subject: "korean", retryCount: 2, hintStage: "step" });

    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://api.openai.com/v1/responses");
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toMatchObject({
      model: "gpt-5-nano",
      max_output_tokens: 64,
      store: false
    });
    const persisted = JSON.stringify({
      settings: db.prepare("SELECT * FROM ai_coach_settings").all(),
      usage: db.prepare("SELECT * FROM ai_coach_usage").all()
    });
    expect(persisted).not.toContain("provider-secret");
    expect(persisted).not.toContain("한 걸음씩 해 보자");
    expect(fallback.source).toBe("local");
    db.close();
  });

  it("uses the configured provider-row model instead of a hard-coded OpenAI model", async () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(
      openAiResponse("한 걸음씩 해 보자")
    ), { status: 200 }));
    const service = new AiCoachService({ db, encryptionKey: key, fetcher });
    service.updateSettings({
      enabled: true,
      provider: "openai",
      apiKey: "provider-secret",
      monthlyBudgetWon: 1
    });
    db.prepare(`
      UPDATE ai_provider_settings SET model = 'guardian-selected-openai-model'
      WHERE provider = 'openai'
    `).run();

    await expect(service.message({
      event: "retry", subject: "korean", retryCount: 1, hintStage: "step"
    })).resolves.toMatchObject({ source: "llm" });

    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toMatchObject({
      model: "guardian-selected-openai-model",
      store: false
    });
    db.close();
  });

  it.each([
    { output: [{ type: "message", content: [{ type: "output_text" }] }] },
    {
      output: [{
        content: openAiResponse("한 걸음씩 해 보자").output[0]!.content
      }]
    },
    {
      output: [{
        type: "reasoning",
        content: openAiResponse("한 걸음씩 해 보자").output[0]!.content
      }]
    },
    { output: [{ type: "message", content: null }] },
    { output: [{ type: "message", content: [null] }] },
    { output: [{ type: "message", content: [{ type: "output_text", text: "" }] }] },
    {
      output: [{
        type: "message",
        content: [
          { type: "output_text", text: JSON.stringify({ message: "한 걸음씩 해 보자" }) },
          { type: "output_text", text: JSON.stringify({ message: "차근차근 다시 해 보자" }) }
        ]
      }]
    },
  ])("falls back locally for malformed or ambiguous OpenAI raw output", async (providerBody) => {
    const db = openDatabase(":memory:");
    migrate(db);
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(providerBody), {
      status: 200
    }));
    const service = new AiCoachService({ db, encryptionKey: key, fetcher });
    service.updateSettings({ enabled: true, provider: "openai", apiKey: "provider-secret" });

    await expect(service.message({
      event: "retry", subject: "korean", retryCount: 1, hintStage: "step"
    })).resolves.toMatchObject({ source: "local" });

    expect(fetcher).toHaveBeenCalledOnce();
    db.close();
  });

  it("charges complete observed usage even when it exceeds the reservation", async () => {
    const db = openDatabase(":memory:");
    migrate(db);
    db.prepare(`
      INSERT INTO ai_coach_usage
        (month, provider, model, input_tokens, output_tokens, estimated_won, created_at)
      VALUES ('2026-07', 'openai', 'gpt-5-nano', 0, 0, 999, '2026-07-18T00:00:00.000Z')
    `).run();
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(
      openAiResponse("한 걸음씩 해 보자", 50_000, 50_000)
    ), { status: 200 }));
    const service = new AiCoachService({
      db,
      encryptionKey: key,
      fetcher,
      now: () => new Date("2026-07-18T03:00:00.000Z")
    });
    service.updateSettings({
      enabled: true,
      provider: "openai",
      apiKey: "provider-secret",
      monthlyBudgetWon: 1000
    });

    await expect(service.message({
      event: "thinking", subject: "math", retryCount: 2, hintStage: "step"
    })).resolves.toMatchObject({ source: "llm" });

    expect(fetcher).toHaveBeenCalledOnce();
    expect(db.prepare(`
      SELECT SUM(estimated_won) AS spent FROM ai_coach_usage WHERE month = '2026-07'
    `).get()).toEqual({ spent: 1249 });
    expect(db.prepare(`
      SELECT input_tokens AS inputTokens, output_tokens AS outputTokens, estimated_won AS estimatedWon
      FROM ai_coach_usage WHERE id = 2
    `).get()).toEqual({ inputTokens: 50_000, outputTokens: 50_000, estimatedWon: 250 });
    db.close();
  });

  it("keeps the reservation when complete usage would overflow safe cost arithmetic", async () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(
      openAiResponse("한 걸음씩 해 보자", Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)
    ), { status: 200 }));
    const service = new AiCoachService({ db, encryptionKey: key, fetcher });
    service.updateSettings({
      enabled: true, provider: "openai", apiKey: "provider-secret", monthlyBudgetWon: 1000
    });

    await service.message({
      event: "retry", subject: "korean", retryCount: 1, hintStage: "step"
    });

    const usage = db.prepare(`
      SELECT input_tokens AS inputTokens, output_tokens AS outputTokens,
        estimated_won AS estimatedWon, reserved_output_tokens AS reservedOutputTokens
      FROM ai_coach_usage
    `).get();
    expect(usage).toMatchObject({
      inputTokens: 0,
      outputTokens: 0,
      estimatedWon: expect.any(Number),
      reservedOutputTokens: 64
    });
    db.close();
  });

  it("keeps a priced reservation when provider usage is incomplete", async () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const response = openAiResponse("한 걸음씩 해 보자") as {
      output: unknown;
      usage: { input_tokens: number; output_tokens: number };
    };
    delete (response.usage as { output_tokens?: number }).output_tokens;
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(response), { status: 200 }));
    const service = new AiCoachService({ db, encryptionKey: key, fetcher });
    service.updateSettings({
      enabled: true, provider: "openai", apiKey: "provider-secret", monthlyBudgetWon: 1000
    });
    db.prepare(`
      UPDATE ai_provider_settings
      SET input_won_per_1k = 100, output_won_per_1k = 100
      WHERE provider = 'openai'
    `).run();

    await service.message({
      event: "retry", subject: "korean", retryCount: 1, hintStage: "step"
    });

    expect(db.prepare(`
      SELECT input_tokens AS inputTokens, output_tokens AS outputTokens,
        estimated_won AS estimatedWon, reserved_input_tokens AS reservedInputTokens,
        reserved_output_tokens AS reservedOutputTokens,
        input_won_per_1k AS inputWonPer1K, output_won_per_1k AS outputWonPer1K
      FROM ai_coach_usage
    `).get()).toMatchObject({
      inputTokens: 0,
      outputTokens: 0,
      estimatedWon: expect.any(Number),
      reservedInputTokens: expect.any(Number),
      reservedOutputTokens: 64,
      inputWonPer1K: 100,
      outputWonPer1K: 100
    });
    expect((db.prepare("SELECT estimated_won AS won FROM ai_coach_usage").get() as { won: number }).won)
      .toBeGreaterThan(1);
    db.close();
  });

  it("releases only the unused part of a complete priced reservation", async () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(
      openAiResponse("한 걸음씩 해 보자", 1, 1)
    ), { status: 200 }));
    const service = new AiCoachService({ db, encryptionKey: key, fetcher });
    service.updateSettings({
      enabled: true, provider: "openai", apiKey: "provider-secret", monthlyBudgetWon: 1000
    });
    db.prepare(`
      UPDATE ai_provider_settings
      SET input_won_per_1k = 100, output_won_per_1k = 100
      WHERE provider = 'openai'
    `).run();

    await service.message({
      event: "retry", subject: "korean", retryCount: 1, hintStage: "step"
    });

    expect(db.prepare(`
      SELECT input_tokens AS inputTokens, output_tokens AS outputTokens,
        estimated_won AS estimatedWon FROM ai_coach_usage
    `).get()).toEqual({ inputTokens: 1, outputTokens: 1, estimatedWon: 1 });
    db.close();
  });

  it("never calls a provider when the conservative reservation does not fit", async () => {
    const db = openDatabase(":memory:");
    migrate(db);
    db.prepare(`
      INSERT INTO ai_coach_usage
        (month, provider, model, input_tokens, output_tokens, estimated_won, created_at)
      VALUES ('2026-07', 'gemini', 'gemini-2.5-flash-lite', 0, 0, 1000, '2026-07-18T00:00:00.000Z')
    `).run();
    const fetcher = vi.fn();
    const service = new AiCoachService({
      db,
      encryptionKey: key,
      fetcher,
      now: () => new Date("2026-07-18T03:00:00.000Z")
    });
    service.updateSettings({ enabled: true, apiKey: "provider-secret" });

    await expect(service.message({
      event: "retry", subject: "korean", retryCount: 1, hintStage: "first"
    })).resolves.toMatchObject({ source: "local" });
    expect(fetcher).not.toHaveBeenCalled();
    expect(db.prepare(`
      SELECT SUM(estimated_won) AS spent FROM ai_coach_usage WHERE month = '2026-07'
    `).get()).toEqual({ spent: 1000 });
    db.close();
  });

  it("reads the current coach budget and provider rates inside the reservation transaction", async () => {
    const directory = mkdtempSync(join(tmpdir(), "ai-coach-budget-race-"));
    const databasePath = join(directory, "coach.sqlite");
    const firstDb = openDatabase(databasePath);
    const secondDb = openDatabase(databasePath);
    const fetcher = vi.fn();
    try {
      migrate(firstDb);
      migrate(secondDb);
      const first = new AiCoachService({
        db: firstDb,
        encryptionKey: key,
        fetcher,
        now: () => new Date("2026-07-18T03:00:00.000Z")
      });
      const second = new AiCoachService({
        db: secondDb,
        encryptionKey: key,
        now: () => new Date("2026-07-18T03:00:00.000Z")
      });
      first.updateSettings({
        enabled: true,
        provider: "openai",
        apiKey: "provider-secret",
        monthlyBudgetWon: 100
      });

      const internal = first as unknown as {
        reserveUsage: (...args: unknown[]) => unknown;
      };
      const originalReserve = internal.reserveUsage.bind(first);
      let changed = false;
      internal.reserveUsage = (...args) => {
        if (!changed) {
          changed = true;
          second.updateSettings({ monthlyBudgetWon: 100 });
          secondDb.prepare(`
            UPDATE ai_provider_settings
            SET input_won_per_1k = 1000, output_won_per_1k = 1000
            WHERE provider = 'openai'
          `).run();
        }
        return originalReserve(...args);
      };

      await expect(first.message({
        event: "retry", subject: "math", retryCount: 1, hintStage: "first"
      })).resolves.toMatchObject({ source: "local" });
      expect(fetcher).not.toHaveBeenCalled();
      expect(firstDb.prepare("SELECT COUNT(*) AS count FROM ai_coach_usage").get())
        .toEqual({ count: 0 });
    } finally {
      secondDb.close();
      firstDb.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("keeps concurrent reservations within the monthly application cap", async () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const fetcher = vi.fn().mockImplementation(async () => new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify({ message: "차근차근 해 보자" }) }] } }],
      usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 10 }
    }), { status: 200 }));
    const service = new AiCoachService({
      db,
      encryptionKey: key,
      fetcher,
      now: () => new Date("2026-07-18T03:00:00.000Z")
    });
    service.updateSettings({
      enabled: true,
      apiKey: "provider-secret",
      monthlyBudgetWon: 2
    });

    await Promise.all(Array.from({ length: 6 }, (_, retryCount) => service.message({
      event: "retry",
      subject: "math",
      retryCount,
      hintStage: "first"
    })));

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(db.prepare(`
      SELECT SUM(estimated_won) AS spent, COUNT(*) AS calls
      FROM ai_coach_usage WHERE month = '2026-07'
    `).get()).toEqual({ spent: 2, calls: 2 });
    db.close();
  });
});
