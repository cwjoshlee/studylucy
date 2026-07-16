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
    const result = { offlineAccessUntil: "2026-07-16T14:59:59.999Z" };
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(result), {
      status: 200,
      headers: { "content-type": "application/json" }
    }));
    const api = new ApiClient(fetcher);

    await expect(api.studentLogin("2580")).resolves.toEqual(result);

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
      activityCursor: 8,
      starAward: { awarded: false, amount: 0, balance: 7, eventId: "star-1" }
    };
    const fetcher = vi.fn().mockResolvedValue(new Response(
      JSON.stringify(receipt),
      { status: 200, headers: { "content-type": "application/json" } }
    ));
    const api = new ApiClient(fetcher);

    await expect(api.saveAttempt({} as never)).resolves.toEqual(receipt);
  });

  it("requests the server-current daily plan without a client date query", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ planId: "plan-daily-1" }),
      { status: 200, headers: { "content-type": "application/json" } }
    ));
    const api = new ApiClient(fetcher);

    await api.getToday();

    expect(fetcher).toHaveBeenCalledWith(
      "/api/student/today",
      expect.objectContaining({ method: "GET" })
    );
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

  it("uses guardian-only device lifecycle routes and exposes injected policy callbacks", async () => {
    const device = {
      publicId: "public-device-1",
      name: "수아 태블릿",
      createdAt: "2026-07-15T03:00:00.000Z",
      lastUsedAt: null,
      status: "active" as const,
      current: true
    };
    const fetcher = vi.fn().mockImplementation((path: string) => {
      if (path === "/api/guardian/devices") {
        return Promise.resolve(new Response(JSON.stringify({ devices: [device] }), {
          status: 200,
          headers: { "content-type": "application/json" }
        }));
      }
      if (path === "/api/auth/session/end") {
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      return Promise.resolve(new Response(JSON.stringify(device), {
        status: path.endsWith("/current") ? 201 : 200,
        headers: { "content-type": "application/json" }
      }));
    });
    const onSessionEnded = vi.fn();
    const onDeviceRevoked = vi.fn();
    const api = new ApiClient(fetcher, { onSessionEnded, onDeviceRevoked });

    await expect(api.registerDevice("수아 태블릿")).resolves.toEqual(device);
    await expect(api.listTrustedDevices()).resolves.toEqual([device]);
    await expect(api.revokeTrustedDevice("public-device-1")).resolves.toEqual(device);
    await api.endSession();

    expect(fetcher.mock.calls.map(([path, init]) => ({
      path,
      method: init?.method,
      body: init?.body
    }))).toEqual([
      {
        path: "/api/guardian/devices/current",
        method: "POST",
        body: JSON.stringify({ name: "수아 태블릿" })
      },
      { path: "/api/guardian/devices", method: "GET", body: undefined },
      {
        path: "/api/guardian/devices/public-device-1/revoke",
        method: "POST",
        body: undefined
      },
      { path: "/api/auth/session/end", method: "POST", body: undefined }
    ]);
    expect(onDeviceRevoked).toHaveBeenCalledWith("public-device-1");
    expect(onSessionEnded).toHaveBeenCalledOnce();
    expect(JSON.stringify(fetcher.mock.calls)).not.toContain("/api/auth/devices");
  });

  it("reports authority failures through the injected no-op policy boundary", async () => {
    const onAuthorityFailure = vi.fn();
    const api = new ApiClient(
      vi.fn().mockResolvedValue(new Response(
        JSON.stringify({ code: "DEVICE_REVOKED" }),
        { status: 403, headers: { "content-type": "application/json" } }
      )),
      { onAuthorityFailure }
    );

    await expect(api.getToday()).rejects.toMatchObject({
      status: 403,
      code: "DEVICE_REVOKED"
    });
    expect(onAuthorityFailure).toHaveBeenCalledWith("DEVICE_REVOKED");
  });
});
