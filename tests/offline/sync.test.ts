import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { deleteDB } from "idb";
import { ApiError } from "../../src/client/api/client";
import type { AttemptInput, AttemptReceipt, TodayPlan } from "../../src/shared/learning";
import type { IdleEventInput, IdleEventResult, StudentStarSummary } from "../../src/shared/stars";
import {
  OFFLINE_DB_NAME,
  cacheTodayPlan,
  getConfirmedStars,
  getDeviceState,
  getQueueCounts,
  listQueuedAttempts,
  listQueuedIdleEvents,
  loadCachedTodayPlan,
  queueAttempt,
  queueIdleEvent
} from "../../src/client/offline/db";
import { syncPending, type SyncApi } from "../../src/client/offline/sync";

const attempt: AttemptInput = {
  clientAttemptId: "client-attempt-0001",
  itemId: "korean-1",
  contentVersion: 1,
  studyDate: "2026-07-16",
  readingScore: 100,
  missedTokens: [],
  mathAnswer: null,
  durationMs: 45_000,
  difficultyFeedback: null
};

const idleEvent: IdleEventInput = {
  clientIdleEventId: "client-idle-event-0001",
  learningSessionId: "learning-session-0001",
  itemId: "korean-1",
  studyDate: "2026-07-16",
  idleStartedAt: "2026-07-16T01:00:00.000Z",
  occurredAt: "2026-07-16T01:05:00.000Z"
};

const attemptReceipt: AttemptReceipt = {
  id: "server-attempt-1",
  duplicate: true,
  readingPass: true,
  mathPass: null,
  completed: true,
  starAward: {
    awarded: false,
    amount: 0,
    balance: 7,
    eventId: "star-event-1"
  }
};

const idleResult: IdleEventResult = {
  id: "server-idle-1",
  outcome: "applied",
  starEventId: "star-event-2",
  duplicate: true
};

const confirmedStars: StudentStarSummary = {
  balance: 6,
  earnedToday: 2,
  deductedToday: 1,
  lastReason: "학습을 마쳐서 별을 받았어요."
};

const todayPlan: TodayPlan = {
  date: "2026-07-16",
  completedItemIds: [],
  requiredItemIds: ["korean-1"],
  stars: confirmedStars,
  items: [{
    id: "korean-1",
    version: 1,
    payload: {
      id: "korean-1",
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
  }]
};

function successfulApi(calls: string[] = []): SyncApi {
  return {
    async saveAttempt(input) {
      calls.push(`attempt:${input.clientAttemptId}`);
      return attemptReceipt;
    },
    async sendIdleEvent(input) {
      calls.push(`idle:${input.clientIdleEventId}`);
      return idleResult;
    },
    async getStudentStars() {
      calls.push("stars");
      return confirmedStars;
    }
  };
}

describe("offline learning synchronization", () => {
  beforeEach(async () => {
    await deleteDB(OFFLINE_DB_NAME);
  });

  it("deduplicates attempts and idle events by their client IDs", async () => {
    await queueAttempt(attempt);
    await queueAttempt(attempt);
    await queueIdleEvent(idleEvent);
    await queueIdleEvent(idleEvent);

    await expect(getQueueCounts()).resolves.toEqual({ attempts: 1, idleEvents: 1 });
  });

  it("stores only whitelisted learning data and never session, PIN, or auth token material", async () => {
    const unsafePlan = {
      ...todayPlan,
      session: "session-secret",
      pin: "2580",
      accessToken: "auth-token-secret",
      items: [{
        ...todayPlan.items[0],
        sessionCookie: "cookie-secret",
        payload: {
          ...todayPlan.items[0]!.payload,
          bearerToken: "nested-token-secret"
        }
      }]
    } as unknown as TodayPlan;
    const unsafeAttempt = {
      ...attempt,
      pin: "2580",
      accessToken: "queue-token-secret"
    } as AttemptInput;
    const unsafeIdle = {
      ...idleEvent,
      sessionCookie: "idle-session-secret"
    } as IdleEventInput;

    await cacheTodayPlan(unsafePlan);
    await queueAttempt(unsafeAttempt);
    await queueIdleEvent(unsafeIdle);

    const stored = JSON.stringify({
      plan: await loadCachedTodayPlan(todayPlan.date),
      attempts: await listQueuedAttempts(),
      idleEvents: await listQueuedIdleEvents()
    });
    for (const secret of [
      "session-secret",
      "2580",
      "auth-token-secret",
      "cookie-secret",
      "nested-token-secret",
      "queue-token-secret",
      "idle-session-secret"
    ]) {
      expect(stored).not.toContain(secret);
    }
    expect(stored).toContain("별빛이");
  });

  it("sends attempts before idle events, removes duplicate acknowledgements, and refreshes confirmed stars", async () => {
    const calls: string[] = [];
    await queueAttempt(attempt);
    await queueIdleEvent(idleEvent);

    await expect(syncPending(successfulApi(calls))).resolves.toEqual({
      attempts: { sent: 1, remaining: 0 },
      idleEvents: { sent: 1, remaining: 0 }
    });

    expect(calls).toEqual([
      `attempt:${attempt.clientAttemptId}`,
      `idle:${idleEvent.clientIdleEventId}`,
      "stars"
    ]);
    await expect(getQueueCounts()).resolves.toEqual({ attempts: 0, idleEvents: 0 });
    await expect(getConfirmedStars()).resolves.toEqual(confirmedStars);
  });

  it("stops on 401 and preserves both queues for login recovery", async () => {
    const calls: string[] = [];
    await queueAttempt(attempt);
    await queueIdleEvent(idleEvent);
    const api = successfulApi(calls);
    api.saveAttempt = async () => {
      calls.push("attempt:unauthorized");
      throw new ApiError(401, "AUTH_REQUIRED");
    };

    await expect(syncPending(api)).resolves.toEqual({
      attempts: { sent: 0, remaining: 1 },
      idleEvents: { sent: 0, remaining: 1 }
    });

    expect(calls).toEqual(["attempt:unauthorized"]);
    await expect(getQueueCounts()).resolves.toEqual({ attempts: 1, idleEvents: 1 });
    await expect(getDeviceState()).resolves.toBe("ready");
  });

  it("does not refresh stars after an idle-event auth failure", async () => {
    const calls: string[] = [];
    await queueAttempt(attempt);
    await queueIdleEvent(idleEvent);
    const api = successfulApi(calls);
    api.sendIdleEvent = async () => {
      calls.push("idle:unauthorized");
      throw new ApiError(401, "AUTH_REQUIRED");
    };

    await expect(syncPending(api)).resolves.toEqual({
      attempts: { sent: 1, remaining: 0 },
      idleEvents: { sent: 0, remaining: 1 }
    });

    expect(calls).toEqual([
      `attempt:${attempt.clientAttemptId}`,
      "idle:unauthorized"
    ]);
  });

  it("marks device action required without deleting queues when the device is revoked", async () => {
    await queueAttempt(attempt);
    await queueIdleEvent(idleEvent);
    const api = successfulApi();
    api.saveAttempt = async () => {
      throw new ApiError(403, "DEVICE_REVOKED");
    };

    await expect(syncPending(api)).resolves.toEqual({
      attempts: { sent: 0, remaining: 1 },
      idleEvents: { sent: 0, remaining: 1 }
    });

    await expect(getQueueCounts()).resolves.toEqual({ attempts: 1, idleEvents: 1 });
    await expect(getDeviceState()).resolves.toBe("device-action-required");
  });

  it.each([
    ["network", new TypeError("offline")],
    ["server", new ApiError(503, "SERVICE_UNAVAILABLE")]
  ])("retries a queued attempt after a %s failure", async (_label, failure) => {
    await queueAttempt(attempt);
    const failingApi = successfulApi();
    failingApi.saveAttempt = async () => {
      throw failure;
    };

    await expect(syncPending(failingApi)).resolves.toEqual({
      attempts: { sent: 0, remaining: 1 },
      idleEvents: { sent: 0, remaining: 0 }
    });
    await expect(syncPending(successfulApi())).resolves.toEqual({
      attempts: { sent: 1, remaining: 0 },
      idleEvents: { sent: 0, remaining: 0 }
    });
  });
});
