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
      candidates: [{ content: { parts: [{ text: JSON.stringify({ message: "천천히 다시 해 볼까?" }) }] } }]
    }), { status: 200 }));
    const service = new AiCoachService({ db, encryptionKey: key, fetcher });
    service.updateSettings({ enabled: true, apiKey: "provider-secret" });

    await expect(service.message({
      event: "retry", subject: "math", retryCount: 1, hintStage: "first"
    })).resolves.toEqual({ message: "천천히 다시 해 볼까?", source: "llm" });

    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent");
    const sent = JSON.stringify(init.body);
    expect(sent).toContain("retry");
    expect(sent).toContain("math");
    expect(sent).not.toMatch(/name|pin|transcript|answer|cookie|device|plan|provider-secret/i);
    db.close();
  });

  it("uses OpenAI Responses gpt-5-nano and makes no request after the cap is exhausted", async () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      output_text: JSON.stringify({ message: "한 걸음씩 해 보자!" }),
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
    expect(JSON.stringify(fetcher.mock.calls[0]?.[1]?.body)).toContain("gpt-5-nano");
    expect(fallback.source).toBe("local");
    db.close();
  });
});
