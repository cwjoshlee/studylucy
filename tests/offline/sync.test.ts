import "fake-indexeddb/auto";
import { deleteDB, openDB } from "idb";
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
  getConfirmedStars,
  getDeviceState,
  getProvisionalItemIds,
  getQueueCounts,
  handleDeviceActionRequired,
  listActivities,
  listPendingBatches,
  listRejectedActivities,
  loadCachedTodayPlan,
  markStudentAuthenticated,
  queueAttempt,
  queueIdleEvent,
  rejectRecoveryGroup,
  rebindRecoveryGroup,
  reserveNextBatch,
  setRecoveryBlocked,
  updateCachedPlanActivityCursor
} from "../../src/client/offline/db";
import { syncPending, type SyncApi } from "../../src/client/offline/sync";

const stars = {
  balance: 6,
  earnedToday: 2,
  deductedToday: 1,
  lastReason: "서버 확정"
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

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

function mathPlan(): TodayPlan {
  const current = plan();
  return {
    ...current,
    requiredItemIds: ["ko-01", "math-01"],
    items: [
      ...current.items,
      {
        id: "math-01",
        version: 1,
        payload: {
          id: "math-01",
          subject: "math",
          unit: "더하기",
          title: "별을 더해요",
          level: "1",
          readLabel: "문제를 읽어 보세요",
          text: "별 세 개와 두 개를 모아요.",
          hint: "천천히 더해요.",
          tokens: ["별", "세 개", "두 개"],
          kind: "math-story",
          question: "별은 모두 몇 개일까요?",
          answer: 5,
          unitLabel: "개",
          checkHint: "3과 2를 더해요."
        }
      }
    ]
  };
}

function mathAttempt(clientAttemptId: string, mathAnswer: number) {
  return {
    ...attempt(clientAttemptId),
    itemId: "math-01",
    mathAnswer
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

  it("refetches after a receipt-generation race so a delayed startup plan cannot replace the receipt authority", async () => {
    const stalePlan = plan({ activityCursor: 2, completedItemIds: [], stars });
    const receiptStars = {
      balance: 9,
      earnedToday: 5,
      deductedToday: 1,
      lastReason: "영수증 확정"
    };
    const receiptPlan = plan({
      activityCursor: 12,
      completedItemIds: ["ko-01"],
      stars: receiptStars
    });
    await readyWithPlan(stalePlan);
    await queueAttempt(attempt("attempt-concurrent-plan-race-0001"));
    const delayedFirstToday = deferred<TodayPlan>();
    const firstTodayStarted = deferred<void>();
    let todayCall = 0;
    const client = api({
      getToday: vi.fn().mockImplementation(() => {
        todayCall += 1;
        if (todayCall === 1) {
          firstTodayStarted.resolve();
          return delayedFirstToday.promise;
        }
        return Promise.resolve(todayCall === 2 ? stalePlan : receiptPlan);
      }),
      applyOfflineBatch: vi.fn().mockImplementation(async (input) =>
        receiptFor(input, { currentDailyPlan: receiptPlan, stars: receiptStars })
      )
    });

    const delayedStartupSync = syncPending(client);
    await firstTodayStarted.promise;
    expect(client.getToday).toHaveBeenCalledTimes(1);
    const receiptSync = syncPending(client);
    await expect(receiptSync).resolves.toMatchObject({ sent: 1, remaining: 0 });

    delayedFirstToday.resolve(stalePlan);
    await expect(delayedStartupSync).resolves.toMatchObject({
      sent: 0,
      remaining: 0,
      stopped: null
    });

    expect(client.getToday).toHaveBeenCalledTimes(3);
    await expect(loadCachedTodayPlan(stalePlan.date)).resolves.toMatchObject({
      activityCursor: receiptPlan.activityCursor,
      completedItemIds: receiptPlan.completedItemIds,
      stars: receiptStars
    });
    await expect(getConfirmedStars()).resolves.toEqual(receiptStars);
  });

  it("persists only trusted correct reading and math completion verdicts without exposing answers in projections", async () => {
    const current = mathPlan();
    await readyWithPlan(current);
    await queueAttempt(attempt("attempt-reading-correct-0001"));
    await queueAttempt({
      ...attempt("attempt-reading-incorrect-0001", "2026-07-16T01:11:00.000Z"),
      missedTokens: ["반짝여요"]
    });
    await queueAttempt(mathAttempt("attempt-math-correct-0001", 5));
    await queueAttempt({
      ...mathAttempt("attempt-math-incorrect-0001", 4),
      occurredAt: "2026-07-16T01:12:00.000Z"
    });
    await queueIdleEvent(idle("idle-never-provisional-0001"));

    const rows = await listActivities();
    expect(rows.map((row) => [row.clientId, row.provisionalCompleted]))
      .toEqual(expect.arrayContaining([
        ["attempt-reading-correct-0001", true],
        ["attempt-reading-incorrect-0001", false],
        ["attempt-math-correct-0001", true],
        ["attempt-math-incorrect-0001", false],
        ["idle-never-provisional-0001", false]
      ]));
    const ids = await getProvisionalItemIds();
    const counts = await getQueueCounts();
    expect(ids.sort()).toEqual(["ko-01", "math-01"]);
    expect(counts.provisionalAttempts).toBe(2);
    expect(JSON.stringify({ ids, counts })).not.toContain("learning-session");
    expect(JSON.stringify({ ids, counts })).not.toContain('"mathAnswer"');
  });

  it("safely derives a missing v2 provisional verdict only from an available exact plan snapshot", async () => {
    await readyWithPlan();
    await queueAttempt(attempt("attempt-v2-optional-verdict-0001"));
    const database = await openDB(OFFLINE_DB_NAME, 2);
    const row = await database.get("activityQueue", "attempt-v2-optional-verdict-0001");
    delete row.provisionalCompleted;
    await database.put("activityQueue", row);
    database.close();

    await expect(getProvisionalItemIds()).resolves.toEqual(["ko-01"]);
    await expect(getQueueCounts()).resolves.toMatchObject({ provisionalAttempts: 1 });
  });

  it("keeps a persisted provisional completion through revoke, hold, and rebind until a successful receipt removes it", async () => {
    await readyWithPlan();
    await queueAttempt(attempt("attempt-provisional-recovery-success-0001"));

    await handleDeviceActionRequired("DEVICE_REVOKED");
    await markStudentAuthenticated();
    await expect(getProvisionalItemIds()).resolves.toEqual(["ko-01"]);

    await setRecoveryBlocked("plan-daily-1");
    await expect(getProvisionalItemIds()).resolves.toEqual(["ko-01"]);

    const recovery = plan({
      planId: "plan-recovery-provisional-success",
      planKind: "recovery",
      recoverySourcePlanId: "plan-daily-1",
      offlineEpoch: 11,
      activityCursor: 30
    });
    await rebindRecoveryGroup("plan-daily-1", recovery);
    await expect(getProvisionalItemIds()).resolves.toEqual(["ko-01"]);
    await expect(getQueueCounts()).resolves.toMatchObject({ provisionalAttempts: 1 });

    const batch = await reserveNextBatch();
    expect(batch).toBeDefined();
    await applyBatchReceipt(receiptFor(batch!));

    await expect(getProvisionalItemIds()).resolves.toEqual([]);
    await expect(getQueueCounts()).resolves.toMatchObject({ provisionalAttempts: 0 });
  });

  it("removes a persisted provisional completion when its recovery group is terminally rejected", async () => {
    await readyWithPlan();
    await queueAttempt(attempt("attempt-provisional-recovery-terminal-0001"));
    await handleDeviceActionRequired("DEVICE_NOT_TRUSTED");
    await markStudentAuthenticated();
    await expect(getProvisionalItemIds()).resolves.toEqual(["ko-01"]);

    await rejectRecoveryGroup("plan-daily-1", "PLAN_NOT_ISSUED");

    await expect(getProvisionalItemIds()).resolves.toEqual([]);
    await expect(getQueueCounts()).resolves.toMatchObject({ provisionalAttempts: 0 });
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
