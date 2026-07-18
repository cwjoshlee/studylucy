import { describe, expect, it, vi } from "vitest";
import { decryptApiKey, encryptApiKey } from "../../src/server/coach/crypto";
import { AiCoachService } from "../../src/server/coach/service";
import { openDatabase } from "../../src/server/db/client";
import { migrate } from "../../src/server/db/migrate";

const key = Buffer.alloc(32, 7);

describe("AI coach privacy and budget boundaries", () => {
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
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      output_text: JSON.stringify({ message: "한 걸음씩 해 보자" }),
      usage: { input_tokens: 10, output_tokens: 10 }
    }), { status: 200 }));
    const service = new AiCoachService({ db, encryptionKey: key, fetcher });
    service.updateSettings({
      enabled: true, provider: "openai", apiKey: "provider-secret", monthlyBudgetWon: 1
    });

    await service.message({ event: "retry", subject: "korean", retryCount: 1, hintStage: "step" });
    const fallback = await service.message({ event: "retry", subject: "korean", retryCount: 2, hintStage: "step" });

    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://api.openai.com/v1/responses");
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toMatchObject({
      model: "gpt-5-nano",
      max_output_tokens: 64
    });
    expect(fallback.source).toBe("local");
    db.close();
  });

  it("keeps the conservative reservation when observed token usage is higher", async () => {
    const db = openDatabase(":memory:");
    migrate(db);
    db.prepare(`
      INSERT INTO ai_coach_usage
        (month, provider, model, input_tokens, output_tokens, estimated_won, created_at)
      VALUES ('2026-07', 'openai', 'gpt-5-nano', 0, 0, 999, '2026-07-18T00:00:00.000Z')
    `).run();
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      output_text: JSON.stringify({ message: "한 걸음씩 해 보자" }),
      usage: { input_tokens: 50_000, output_tokens: 50_000 }
    }), { status: 200 }));
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
    `).get()).toEqual({ spent: 1000 });
    expect(db.prepare(`
      SELECT input_tokens AS inputTokens, output_tokens AS outputTokens, estimated_won AS estimatedWon
      FROM ai_coach_usage WHERE id = 2
    `).get()).toEqual({ inputTokens: 50_000, outputTokens: 50_000, estimatedWon: 1 });
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
