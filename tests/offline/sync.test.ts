import "fake-indexeddb/auto";
import { deleteDB } from "idb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../src/client/api/client";
import type {
  ActivityEvent,
  OfflineBatchInput,
  OfflineBatchReceipt,
  TodayPlan
} from "../../src/shared/learning";
import type { IdleEventInput } from "../../src/shared/stars";
import {
  OFFLINE_DB_NAME,
  applyBatchReceipt,
  cacheIssuedPlan,
  getAcknowledgedCursor,
  getDeviceState,
  getQueueCounts,
  handleDeviceActionRequired,
  listActivities,
  listPendingBatches,
  listRejectedActivities,
  loadCachedTodayPlan,
  markStudentAuthenticated,
  queueAttempt,
  queueIdleEvent,
  rebindRecoveryGroup,
  updateCachedPlanActivityCursor
} from "../../src/client/offline/db";
import { syncPending, type SyncApi } from "../../src/client/offline/sync";

const stars = {
  balance: 6,
  earnedToday: 2,
  deductedToday: 1,
  lastReason: "서버 확정"
};

function plan(overrides: Partial<TodayPlan> = {}): TodayPlan {
  return {
    planId: "plan-daily-1",
    planKind: "daily",
    recoverySourcePlanId: null,
    date: "2026-07-16",
    submitUntil: "2026-07-17T14:59:59.999Z",
    offlineEpoch: 3,
    activityCursor: 2,
    studentDisplayName: "수아",
    completedItemIds: [],
    requiredItemIds: ["ko-01"],
    stars,
    items: [{
      id: "ko-01",
      version: 1,
      payload: {
        id: "ko-01",
        kind: "korean-reading",
        subject: "korean",
        unit: "받침 읽기",
        title: "짧은 글 읽기",
        level: "1",
        readLabel: "따라 읽어 보세요",
        text: "별빛이 반짝여요.",
        hint: "천천히 읽어요.",
        tokens: ["별빛이", "반짝여요"]
      }
    }],
    ...overrides
  };
}

function attempt(
  clientAttemptId: string,
  occurredAt = "2026-07-16T01:10:00.000Z",
  planId = "plan-daily-1"
): import("../../src/shared/learning").AttemptInput {
  return {
    clientAttemptId,
    planId,
    itemId: "ko-01",
    contentVersion: 1,
    studyDate: "2026-07-16",
    occurredAt,
    readingScore: 100,
    missedTokens: [],
    mathAnswer: null,
    durationMs: 45_000,
    difficultyFeedback: null
  };
}

function idle(clientIdleEventId: string): IdleEventInput {
  return {
    clientIdleEventId,
    learningSessionId: "learning-session-must-not-persist-0001",
    planId: "plan-daily-1",
    itemId: "ko-01",
    contentVersion: 1,
    studyDate: "2026-07-16",
    idleStartedAt: "2026-07-16T01:00:00.000Z",
    occurredAt: "2026-07-16T01:05:00.000Z"
  };
}

function clientId(event: ActivityEvent): string {
  return event.kind === "attempt"
    ? event.payload.clientAttemptId
    : event.payload.clientIdleEventId;
}

function receiptFor(
  input: OfflineBatchInput,
  overrides: Partial<OfflineBatchReceipt> = {}
): OfflineBatchReceipt {
  const currentDailyPlan = plan({
    activityCursor: 12,
    completedItemIds: ["ko-01"],
    stars
  });
  return {
    clientBatchId: input.clientBatchId,
    duplicate: false,
    orderConflict: false,
    batchEndCursor: 12,
    activityCursor: 12,
    receipts: input.events.map((event, index) => ({
      clientId: clientId(event),
      kind: event.kind,
      status: event.kind === "idle" ? "ORDER_CONFLICT_WAIVED" : "APPLIED",
      code: event.kind === "idle" ? "ORDER_CONFLICT_WAIVED" : null,
      attempt: event.kind === "attempt" ? {
        id: `server-attempt-${index}`,
        duplicate: false,
        readingPass: true,
        mathPass: null,
        completed: true,
        activityCursor: 999,
        starAward: {
          awarded: true,
          amount: 1,
          balance: stars.balance,
          eventId: `star-${index}`
        }
      } : null,
      idle: event.kind === "idle" ? {
        id: `server-idle-${index}`,
        outcome: "order-conflict-waived",
        starEventId: null,
        duplicate: false,
        activityCursor: 998
      } : null
    })),
    processedPlan: plan({
      planId: "recovery-plan-old",
      planKind: "recovery",
      recoverySourcePlanId: "source-plan-old",
      date: "2026-07-15",
      activityCursor: 999
    }),
    currentDailyPlan,
    stars,
    ...overrides
  };
}

function api(overrides: Partial<SyncApi> = {}): SyncApi {
  return {
    getToday: vi.fn().mockResolvedValue(plan()),
    createRecoveryPlan: vi.fn().mockResolvedValue(plan({
      planId: "plan-recovery-1",
      planKind: "recovery",
      recoverySourcePlanId: "plan-daily-1",
      offlineEpoch: 8,
      activityCursor: 20
    })),
    applyOfflineBatch: vi.fn().mockImplementation(async (input) => receiptFor(input)),
    ...overrides
  };
}

async function readyWithPlan(current = plan()): Promise<void> {
  await markStudentAuthenticated();
  await cacheIssuedPlan(current, current.stars);
}

describe("unified persistent offline synchronization", () => {
  beforeEach(async () => {
    await deleteDB(OFFLINE_DB_NAME);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-07-16T02:00:00.000Z"));
  });

  it("reserves one exact oldest group before I/O and reuses the same batch/envelope after a lost response while new rows wait", async () => {
    await readyWithPlan();
    await queueAttempt(attempt("attempt-reserved-0001"));
    await queueIdleEvent(idle("idle-reserved-0001"));
    const firstInputs: OfflineBatchInput[] = [];
    const firstApi = api({
      applyOfflineBatch: vi.fn().mockImplementation(async (input) => {
        firstInputs.push(structuredClone(input));
        throw new TypeError("response lost");
      })
    });

    await expect(syncPending(firstApi)).resolves.toMatchObject({
      sent: 0,
      remaining: 2
    });
    const [reservation] = await listPendingBatches();
    expect(reservation).toMatchObject({
      orderedClientIds: ["idle-reserved-0001", "attempt-reserved-0001"],
      planId: "plan-daily-1",
      offlineEpoch: 3,
      startCursor: 2
    });
    expect(reservation?.requestFingerprint).toMatch(/^[0-9a-f]{16}$/);
    expect(firstInputs[0]?.clientBatchId).toBe(reservation?.clientBatchId);
    expect(firstInputs[0]?.events.map(clientId)).toEqual(reservation?.orderedClientIds);
    expect(firstInputs[0]?.events[0]).toMatchObject({ kind: "idle", legacy: true });
    expect(JSON.stringify(firstInputs[0])).not.toContain("learning-session-must-not-persist");

    await queueAttempt(attempt(
      "attempt-newer-waits-0002",
      "2026-07-16T01:20:00.000Z"
    ));
    const retried: OfflineBatchInput[] = [];
    const retryApi = api({
      applyOfflineBatch: vi.fn().mockImplementation(async (input) => {
        retried.push(structuredClone(input));
        return receiptFor(input);
      })
    });

    await expect(syncPending(retryApi)).resolves.toMatchObject({
      sent: 2,
      remaining: 1
    });
    expect(retried[0]).toEqual(firstInputs[0]);
    expect(retried[0]?.events.map(clientId))
      .not.toContain("attempt-newer-waits-0002");
    await expect(listPendingBatches()).resolves.toEqual([]);
    await expect(listActivities()).resolves.toMatchObject([
      { clientId: "attempt-newer-waits-0002" }
    ]);
  });

  it("caps one immutable same-authority reservation at exactly 100 ordered events", async () => {
    await readyWithPlan();
    for (let index = 0; index < 101; index += 1) {
      await queueAttempt(attempt(
        `attempt-bulk-${index.toString().padStart(4, "0")}`,
        new Date(Date.parse("2026-07-16T01:00:00.000Z") + index).toISOString()
      ));
    }
    let first: OfflineBatchInput | undefined;
    await syncPending(api({
      applyOfflineBatch: vi.fn().mockImplementation(async (input) => {
        first = structuredClone(input);
        throw new TypeError("lost response");
      })
    }));

    expect(first?.events).toHaveLength(100);
    expect(first?.events.map(clientId)).toEqual(
      Array.from({ length: 100 }, (_value, index) =>
        `attempt-bulk-${index.toString().padStart(4, "0")}`
      )
    );

    let retried: OfflineBatchInput | undefined;
    await expect(syncPending(api({
      applyOfflineBatch: vi.fn().mockImplementation(async (input) => {
        retried = structuredClone(input);
        return receiptFor(input);
      })
    }))).resolves.toMatchObject({ sent: 100, remaining: 1 });
    expect(retried).toEqual(first);
  });

  it("never lets a newer acknowledged cursor hide an older queued base cursor", async () => {
    await readyWithPlan(plan({ activityCursor: 1 }));
    await queueAttempt(attempt("attempt-stale-base-0001"));
    await updateCachedPlanActivityCursor("plan-daily-1", 50);
    const inputs: OfflineBatchInput[] = [];
    const client = api({
      applyOfflineBatch: vi.fn().mockImplementation(async (input) => {
        inputs.push(input);
        throw new TypeError("offline");
      })
    });

    await syncPending(client);

    expect(inputs[0]?.startCursor).toBe(1);
    await expect(getAcknowledgedCursor("plan-daily-1")).resolves.toBe(50);
  });

  it("applies success effects in one abortable transaction, trusts only the top-level cursor, and caches only currentDailyPlan", async () => {
    await readyWithPlan();
    await queueAttempt(attempt("attempt-atomic-receipt-0001"));
    let submitted: OfflineBatchInput | undefined;
    await syncPending(api({
      applyOfflineBatch: vi.fn().mockImplementation(async (input) => {
        submitted = input;
        throw new TypeError("lost response");
      })
    }));
    expect(submitted).toBeDefined();
    await updateCachedPlanActivityCursor("plan-daily-1", 15);
    const receipt = receiptFor(submitted!, { activityCursor: 12 });

    await expect(applyBatchReceipt(receipt, { abortBeforeCommit: true }))
      .rejects.toBeDefined();
    await expect(listActivities()).resolves.toHaveLength(1);
    await expect(listPendingBatches()).resolves.toHaveLength(1);
    await expect(getAcknowledgedCursor("plan-daily-1")).resolves.toBe(15);
    expect((await loadCachedTodayPlan("2026-07-16"))?.planId)
      .toBe("plan-daily-1");

    await applyBatchReceipt(receipt);

    await expect(listActivities()).resolves.toEqual([]);
    await expect(listPendingBatches()).resolves.toEqual([]);
    await expect(getAcknowledgedCursor("plan-daily-1")).resolves.toBe(15);
    expect(await loadCachedTodayPlan("2026-07-15")).toBeUndefined();
    expect(await loadCachedTodayPlan("2026-07-16"))
      .toEqual(receipt.currentDailyPlan);
  });

  it("atomically rejects a receipt whose canonical event kind does not match the reserved journal row", async () => {
    await readyWithPlan();
    await queueAttempt(attempt("attempt-kind-mismatch-0001"));
    let submitted: OfflineBatchInput | undefined;
    await syncPending(api({
      applyOfflineBatch: vi.fn().mockImplementation(async (input) => {
        submitted = input;
        throw new TypeError("lost response");
      })
    }));
    const mismatched = receiptFor(submitted!);
    mismatched.receipts[0] = {
      ...mismatched.receipts[0]!,
      kind: "idle"
    };

    await expect(applyBatchReceipt(mismatched)).rejects.toMatchObject({
      code: "RESERVATION_INVALID"
    });
    await expect(listActivities()).resolves.toHaveLength(1);
    await expect(listPendingBatches()).resolves.toHaveLength(1);
  });

  it("fetches and caches the current ordinary plan before sending any yesterday batch", async () => {
    const yesterday = plan({
      planId: "plan-yesterday",
      date: "2026-07-15",
      activityCursor: 4
    });
    await readyWithPlan(yesterday);
    await queueAttempt({
      ...attempt("attempt-yesterday-0001", "2026-07-15T01:00:00.000Z", yesterday.planId),
      studyDate: yesterday.date
    });
    const today = plan();
    const order: string[] = [];
    const client = api({
      getToday: vi.fn().mockImplementation(async () => {
        order.push("today");
        return today;
      }),
      applyOfflineBatch: vi.fn().mockImplementation(async (input) => {
        order.push("batch");
        return receiptFor(input);
      })
    });

    await syncPending(client);

    expect(order).toEqual(["today", "batch"]);
    expect(await loadCachedTodayPlan(today.date)).toEqual(
      expect.objectContaining({
        planId: today.planId,
        planKind: "daily",
        date: today.date,
        activityCursor: 12
      })
    );
    expect(await loadCachedTodayPlan(yesterday.date)).toBeUndefined();
  });

  it("sends no batch or reservation when the authoritative current-plan read does not succeed", async () => {
    await readyWithPlan();
    await queueAttempt(attempt("attempt-no-current-plan-0001"));
    const applyOfflineBatch = vi.fn();

    await expect(syncPending(api({
      getToday: vi.fn().mockRejectedValue(new TypeError("offline")),
      applyOfflineBatch
    }))).resolves.toMatchObject({ sent: 0, remaining: 1 });

    expect(applyOfflineBatch).not.toHaveBeenCalled();
    await expect(listPendingBatches()).resolves.toEqual([]);
  });

  it("treats CURRENT_DAILY_PLAN_REQUIRED as nonterminal and retries the identical reservation after refreshing today", async () => {
    await readyWithPlan();
    await queueAttempt(attempt("attempt-midnight-0001"));
    const inputs: OfflineBatchInput[] = [];
    const getToday = vi.fn().mockResolvedValue(plan());
    const applyOfflineBatch = vi.fn().mockImplementation(async (input) => {
      inputs.push(structuredClone(input));
      if (inputs.length === 1) {
        throw new ApiError(409, "CURRENT_DAILY_PLAN_REQUIRED");
      }
      return receiptFor(input);
    });

    await syncPending(api({ getToday, applyOfflineBatch }));

    expect(getToday).toHaveBeenCalledTimes(2);
    expect(inputs).toHaveLength(2);
    expect(inputs[1]).toEqual(inputs[0]);
    await expect(listActivities()).resolves.toEqual([]);
  });

  it("preserves a 401 reservation, clears authority, and blocks journal access until a fresh PIN login", async () => {
    await readyWithPlan();
    await queueAttempt(attempt("attempt-auth-blocked-0001"));
    await syncPending(api({
      applyOfflineBatch: vi.fn().mockRejectedValue(
        new ApiError(401, "AUTH_REQUIRED")
      )
    }));

    await expect(getDeviceState()).resolves.toBe("auth-required");
    await expect(listActivities()).rejects.toMatchObject({ code: "AUTH_REQUIRED" });

    await markStudentAuthenticated();
    await expect(listActivities()).resolves.toHaveLength(1);
    await expect(listPendingBatches()).resolves.toHaveLength(1);
  });

  it("treats ROLE_FORBIDDEN as authorization loss and preserves the reservation and rows", async () => {
    await readyWithPlan();
    await queueAttempt(attempt("attempt-role-forbidden-0001"));

    await expect(syncPending(api({
      applyOfflineBatch: vi.fn().mockRejectedValue(
        new ApiError(403, "ROLE_FORBIDDEN")
      )
    }))).resolves.toMatchObject({
      sent: 0,
      remaining: 1,
      rejected: 0,
      stopped: "auth-required"
    });

    await expect(getDeviceState()).resolves.toBe("auth-required");
    await expect(listActivities()).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
    await markStudentAuthenticated();
    await expect(listActivities()).resolves.toHaveLength(1);
    await expect(listPendingBatches()).resolves.toHaveLength(1);
    await expect(listRejectedActivities()).resolves.toEqual([]);
  });

  it.each(["DEVICE_REVOKED", "DEVICE_NOT_TRUSTED"] as const)(
    "atomically enters recovery and invalidates the old reservation for %s",
    async (code) => {
      await readyWithPlan();
      await queueAttempt(attempt(`attempt-${code.toLowerCase()}-0001`));
      await syncPending(api({
        applyOfflineBatch: vi.fn().mockRejectedValue(new ApiError(403, code))
      }));

      await expect(getDeviceState()).resolves.toBe("device-action-required");
      await markStudentAuthenticated();
      await expect(listPendingBatches()).resolves.toEqual([]);
      await expect(listActivities()).resolves.toMatchObject([{
        planId: "plan-daily-1",
        sourcePlanId: "plan-daily-1",
        requiresRecovery: true
      }]);
    }
  );

  it("reveals either all or none of a device-recovery transition after an injected abort and reopen", async () => {
    await readyWithPlan();
    await queueAttempt(attempt("attempt-device-abort-0001"));
    await syncPending(api({
      applyOfflineBatch: vi.fn().mockRejectedValue(new TypeError("lost response"))
    }));

    await expect(handleDeviceActionRequired(
      "DEVICE_REVOKED",
      { abortBeforeCommit: true }
    )).rejects.toBeDefined();

    await expect(getDeviceState()).resolves.toBe("ready");
    await expect(listActivities()).resolves.toEqual([
      expect.objectContaining({ requiresRecovery: false, sourcePlanId: null })
    ]);
    await expect(listPendingBatches()).resolves.toHaveLength(1);
    await expect(loadCachedTodayPlan("2026-07-16")).resolves.toBeDefined();

    await handleDeviceActionRequired("DEVICE_REVOKED");
    await expect(getDeviceState()).resolves.toBe("device-action-required");
    await markStudentAuthenticated();
    await expect(listActivities()).resolves.toEqual([
      expect.objectContaining({
        requiresRecovery: true,
        sourcePlanId: "plan-daily-1"
      })
    ]);
    await expect(listPendingBatches()).resolves.toEqual([]);
  });

  it("reveals either the complete old or complete rebound recovery envelope after an injected abort and reopen", async () => {
    await readyWithPlan();
    const original = attempt("attempt-rebind-abort-0001");
    await queueAttempt(original);
    await handleDeviceActionRequired("DEVICE_REVOKED");
    await markStudentAuthenticated();
    const recovery = plan({
      planId: "plan-recovery-abort",
      planKind: "recovery",
      recoverySourcePlanId: "plan-daily-1",
      offlineEpoch: 12,
      activityCursor: 40
    });

    await expect(rebindRecoveryGroup(
      "plan-daily-1",
      recovery,
      { abortBeforeCommit: true }
    )).rejects.toBeDefined();

    await expect(listActivities()).resolves.toEqual([
      expect.objectContaining({
        planId: "plan-daily-1",
        offlineEpoch: 3,
        baseCursor: 2,
        requiresRecovery: true,
        event: expect.objectContaining({
          payload: expect.objectContaining({ planId: "plan-daily-1" })
        })
      })
    ]);

    await rebindRecoveryGroup("plan-daily-1", recovery);
    await expect(listActivities()).resolves.toEqual([
      expect.objectContaining({
        planId: recovery.planId,
        offlineEpoch: recovery.offlineEpoch,
        baseCursor: recovery.activityCursor,
        requiresRecovery: false,
        event: expect.objectContaining({
          payload: expect.objectContaining({
            clientAttemptId: original.clientAttemptId,
            planId: recovery.planId,
            readingScore: original.readingScore,
            occurredAt: original.occurredAt
          })
        })
      })
    ]);
  });

  it("holds SOURCE_DEVICE_STILL_ACTIVE without a normal batch, then rebinds with a new reservation only after an explicit post-login retry", async () => {
    await readyWithPlan();
    const original = attempt("attempt-recovery-held-0001");
    await queueAttempt(original);
    await queueIdleEvent(idle("idle-recovery-held-0001"));
    await handleDeviceActionRequired("DEVICE_NOT_TRUSTED");
    await markStudentAuthenticated();
    const applyOfflineBatch = vi.fn();
    const createRecoveryPlan = vi.fn().mockRejectedValue(
      new ApiError(409, "SOURCE_DEVICE_STILL_ACTIVE")
    );

    await expect(syncPending(api({ createRecoveryPlan, applyOfflineBatch })))
      .resolves.toMatchObject({
        recoveryBlockedCode: "SOURCE_DEVICE_STILL_ACTIVE",
        guidance: "보호자 기기 관리에서 이전 기기를 해제해 주세요"
      });
    expect(applyOfflineBatch).not.toHaveBeenCalled();
    await expect(listActivities()).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourcePlanId: "plan-daily-1",
        recoveryBlockedCode: "SOURCE_DEVICE_STILL_ACTIVE"
      })
    ]));

    const noAutomaticRetry = api({ createRecoveryPlan, applyOfflineBatch });
    await syncPending(noAutomaticRetry);
    expect(createRecoveryPlan).toHaveBeenCalledTimes(1);

    const recovery = plan({
      planId: "plan-recovery-1",
      planKind: "recovery",
      recoverySourcePlanId: "plan-daily-1",
      offlineEpoch: 9,
      activityCursor: 30
    });
    const reboundInputs: OfflineBatchInput[] = [];
    await syncPending(api({
      createRecoveryPlan: vi.fn().mockResolvedValue(recovery),
      applyOfflineBatch: vi.fn().mockImplementation(async (input) => {
        reboundInputs.push(structuredClone(input));
        return receiptFor(input);
      })
    }), { retryRecoveryBlocked: true });

    expect(reboundInputs).toHaveLength(1);
    expect(reboundInputs[0]).toMatchObject({
      planId: recovery.planId,
      offlineEpoch: recovery.offlineEpoch,
      startCursor: recovery.activityCursor
    });
    const reboundAttempt = reboundInputs[0]!.events.find((event) => event.kind === "attempt");
    expect(reboundAttempt).toMatchObject({
      legacy: false,
      payload: {
        ...original,
        planId: recovery.planId
      }
    });
    const reboundIdle = reboundInputs[0]!.events.find((event) => event.kind === "idle");
    expect(reboundIdle).toMatchObject({ kind: "idle", legacy: true });
    expect(JSON.stringify(reboundIdle)).not.toContain("learningSessionId");
  });

  it.each(["PLAN_SUBMISSION_EXPIRED", "PLAN_NOT_ISSUED"])(
    "terminally rejects the complete recovery source group with redacted local evidence for %s",
    async (code) => {
      await readyWithPlan();
      await queueAttempt({
        ...attempt("attempt-recovery-terminal-0001"),
        missedTokens: ["비밀 정답 단서"]
      });
      await queueIdleEvent(idle("idle-recovery-terminal-0001"));
      await handleDeviceActionRequired("DEVICE_REVOKED");
      await markStudentAuthenticated();

      await syncPending(api({
        createRecoveryPlan: vi.fn().mockRejectedValue(new ApiError(409, code)),
        applyOfflineBatch: vi.fn()
      }));

      await expect(listActivities()).resolves.toEqual([]);
      const rejected = await listRejectedActivities();
      expect(rejected).toHaveLength(2);
      expect(rejected.every((entry) => entry.code === code)).toBe(true);
      expect(JSON.stringify(rejected)).not.toContain("비밀 정답 단서");
      expect(JSON.stringify(rejected)).not.toContain("learning-session-must-not-persist");
    }
  );

  it("moves terminal batch rows to redacted rejections but never terminally classifies network or 5xx", async () => {
    await readyWithPlan();
    await queueAttempt({
      ...attempt("attempt-terminal-batch-0001"),
      missedTokens: ["원문 답"]
    });
    await syncPending(api({
      applyOfflineBatch: vi.fn().mockRejectedValue(
        new ApiError(400, "INVALID_REQUEST")
      )
    }));

    await expect(getQueueCounts()).resolves.toEqual({
      activities: 0,
      provisionalAttempts: 0,
      rejected: 1
    });
    await expect(getDeviceState()).resolves.toBe("ready");
    expect(JSON.stringify(await listRejectedActivities())).not.toContain("원문 답");
  });
});
