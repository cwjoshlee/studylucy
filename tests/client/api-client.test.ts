import { describe, expect, it, vi } from "vitest";
import { ApiClient, ApiError } from "../../src/client/api/client";

describe("ApiClient", () => {
  it("invokes browser fetch with the global receiver", async () => {
    const fetcher = function (
      this: unknown,
      _input: RequestInfo | URL,
      _init?: RequestInit
    ): Promise<Response> {
      if (this !== globalThis) throw new TypeError("Illegal invocation");
      return Promise.resolve(new Response(null, { status: 204 }));
    };
    const api = new ApiClient(fetcher);

    await expect(api.logout()).resolves.toBeUndefined();
  });

  it("sends JSON with same-origin credentials", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const api = new ApiClient(fetcher);

    await api.studentLogin("2580");

    expect(fetcher).toHaveBeenCalledWith("/api/auth/student/login", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        accept: "application/json",
        "content-type": "application/json"
      },
      body: JSON.stringify({ pin: "2580" })
    });
  });

  it("preserves exact server codes on non-2xx responses", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ code: "SETUP_ALREADY_COMPLETED" }),
      { status: 409, headers: { "content-type": "application/json" } }
    ));
    const api = new ApiClient(fetcher);

    await expect(api.setup({
      setupSecret: "s".repeat(32),
      guardianName: "엄마",
      password: "correct horse battery staple",
      studentName: "수아"
    })).rejects.toEqual(new ApiError(409, "SETUP_ALREADY_COMPLETED"));
  });

  it("returns duplicate learning receipts without rewriting them", async () => {
    const receipt = {
      id: "attempt-1",
      duplicate: true,
      readingPass: true,
      mathPass: null,
      completed: true,
      starAward: { awarded: false, amount: 0, balance: 7, eventId: "star-1" }
    };
    const fetcher = vi.fn().mockResolvedValue(new Response(
      JSON.stringify(receipt),
      { status: 200, headers: { "content-type": "application/json" } }
    ));
    const api = new ApiClient(fetcher);

    await expect(api.saveAttempt({} as never)).resolves.toEqual(receipt);
  });
});
