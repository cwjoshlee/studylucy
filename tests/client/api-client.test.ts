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

  it("sends guardian ledger filters with the hard 100-row page limit", async () => {
    const ledger = {
      summary: {
        balance: 3,
        earnedToday: 3,
        deductedToday: 0,
        lastReason: "보너스"
      },
      events: [],
      nextCursor: null
    };
    const fetcher = vi.fn().mockResolvedValue(new Response(
      JSON.stringify(ledger),
      { status: 200, headers: { "content-type": "application/json" } }
    ));
    const api = new ApiClient(fetcher);

    await expect(api.getGuardianStars({
      from: "2026-07-01",
      to: "2026-07-16",
      direction: "deducted",
      reason: "IDLE_TIMEOUT",
      cursor: "cursor-1"
    })).resolves.toEqual(ledger);

    expect(fetcher).toHaveBeenCalledWith(
      "/api/guardian/stars?from=2026-07-01&to=2026-07-16&direction=deducted&reason=IDLE_TIMEOUT&cursor=cursor-1&limit=100",
      expect.objectContaining({ method: "GET" })
    );
  });

  it("maps guardian star and plan mutations to their protected API routes", async () => {
    const fetcher = vi.fn().mockImplementation(() => Promise.resolve(new Response(
      JSON.stringify({}),
      { status: 200, headers: { "content-type": "application/json" } }
    )));
    const api = new ApiClient(fetcher);

    await api.approveStarAdjustment("pending-1", { approvedStars: 1, note: "" });
    await api.waiveStarAdjustment("pending-2", { note: "아파서 쉬었어요" });
    await api.applyManualStars({
      delta: 2,
      reason: "약속을 잘 지켰어요",
      clientCommandId: "guardian-command-0001"
    });
    await api.reverseStarEvent("event-1", { note: "잘못 입력했어요" });
    await api.updateGuardianDailyPlan("2026-07-17", {
      koreanTarget: 2,
      mathTarget: 2,
      isRestDay: false
    });

    expect(fetcher.mock.calls.map(([path, init]) => ({
      path,
      method: init?.method,
      body: init?.body
    }))).toEqual([
      {
        path: "/api/guardian/star-adjustments/pending-1/approve",
        method: "POST",
        body: JSON.stringify({ approvedStars: 1, note: "" })
      },
      {
        path: "/api/guardian/star-adjustments/pending-2/waive",
        method: "POST",
        body: JSON.stringify({ note: "아파서 쉬었어요" })
      },
      {
        path: "/api/guardian/stars/manual",
        method: "POST",
        body: JSON.stringify({
          delta: 2,
          reason: "약속을 잘 지켰어요",
          clientCommandId: "guardian-command-0001"
        })
      },
      {
        path: "/api/guardian/stars/event-1/reverse",
        method: "POST",
        body: JSON.stringify({ note: "잘못 입력했어요" })
      },
      {
        path: "/api/guardian/daily-plans/2026-07-17",
        method: "PUT",
        body: JSON.stringify({
          koreanTarget: 2,
          mathTarget: 2,
          isRestDay: false
        })
      }
    ]);
  });
});
