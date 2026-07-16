import "fake-indexeddb/auto";
import { deleteDB, openDB } from "idb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AttemptInput, TodayPlan } from "../../src/shared/learning";
import type { IdleEventInput } from "../../src/shared/stars";
import {
  OFFLINE_DB_NAME,
  OFFLINE_DB_VERSION,
  cacheIssuedPlan,
  clearOfflineAuthority,
  getConfirmedStars,
  getDeviceState,
  getQueueCounts,
  listActivities,
  listLegacyActivities,
  listRejectedActivities,
  loadCachedTodayPlan,
  loadOfflineStudentSession,
  markStudentAuthenticated,
  queueAttempt,
  queueIdleEvent,
  reconcileLegacyActivities,
  storeOfflineLease
} from "../../src/client/offline/db";

const stars = {
  balance: 7,
  earnedToday: 2,
  deductedToday: 1,
  lastReason: "확정 별"
};

const plan: TodayPlan = {
  planId: "plan-migration-1",
  planKind: "daily",
  recoverySourcePlanId: null,
  date: "2026-07-16",
  submitUntil: "2026-07-17T14:59:59.999Z",
  offlineEpoch: 4,
  activityCursor: 9,
  studentDisplayName: "수아",
  completedItemIds: [],
  requiredItemIds: ["ko-01"],
  stars,
  items: [{
    id: "ko-01",
    version: 2,
    payload: {
      id: "ko-01",
      kind: "korean-reading",
      subject: "korean",
      unit: "동화 읽기",
      title: "작은 씨앗",
      level: "1단계",
      readLabel: "읽어 보기",
      text: "작은 씨앗이 자라요.",
      hint: "천천히 읽어요.",
      tokens: ["작은 씨앗", "자라요"]
    }
  }]
};

const attempt: AttemptInput = {
  clientAttemptId: "migration-attempt-0001",
  planId: plan.planId,
  itemId: "ko-01",
  contentVersion: 2,
  studyDate: plan.date,
  occurredAt: "2026-07-16T01:05:00.000Z",
  readingScore: 88,
  missedTokens: ["자라요"],
  mathAnswer: null,
  durationMs: 30_000,
  difficultyFeedback: "thinking"
};

const idle: IdleEventInput = {
  clientIdleEventId: "migration-idle-0001",
  learningSessionId: "server-learning-session-secret-0001",
  planId: plan.planId,
  itemId: "ko-01",
  contentVersion: 2,
  studyDate: plan.date,
  idleStartedAt: "2026-07-16T01:00:00.000Z",
  occurredAt: "2026-07-16T01:05:00.000Z"
};

async function seedVersionOne(): Promise<void> {
  const database = await openDB(OFFLINE_DB_NAME, 1, {
    upgrade(db) {
      db.createObjectStore("todayPlans", { keyPath: "date" });
      db.createObjectStore("attemptQueue", { keyPath: "clientAttemptId" });
      db.createObjectStore("idleEventQueue", { keyPath: "clientIdleEventId" });
      db.createObjectStore("meta", { keyPath: "key" });
    }
  });
  const transaction = database.transaction(
    ["todayPlans", "attemptQueue", "idleEventQueue", "meta"],
    "readwrite"
  );
  await Promise.all([
    transaction.objectStore("todayPlans").put(plan),
    transaction.objectStore("attemptQueue").put(attempt),
    transaction.objectStore("idleEventQueue").put(idle),
    transaction.objectStore("meta").put({ key: "confirmed-stars", value: stars }),
    transaction.objectStore("meta").put({ key: "device-state", value: "ready" })
  ]);
  await transaction.done;
  database.close();
}

describe("IndexedDB v2 authority journal migration", () => {
  beforeEach(async () => {
    vi.useRealTimers();
    await deleteDB(OFFLINE_DB_NAME);
  });

  it("atomically quarantines v1 attempts and idles without inventing authority or retaining a learning-session ID", async () => {
    await seedVersionOne();

    const migrated = await listLegacyActivities();

    expect(OFFLINE_DB_VERSION).toBe(2);
    expect(migrated).toEqual([
      {
        clientId: attempt.clientAttemptId,
        kind: "attempt",
        payload: {
          clientAttemptId: attempt.clientAttemptId,
          itemId: attempt.itemId,
          contentVersion: attempt.contentVersion,
          studyDate: attempt.studyDate,
          readingScore: attempt.readingScore,
          missedTokens: attempt.missedTokens,
          mathAnswer: attempt.mathAnswer,
          durationMs: attempt.durationMs,
          difficultyFeedback: attempt.difficultyFeedback
        }
      },
      {
        clientId: idle.clientIdleEventId,
        kind: "idle",
        payload: {
          clientIdleEventId: idle.clientIdleEventId,
          itemId: idle.itemId,
          studyDate: idle.studyDate,
          idleStartedAt: idle.idleStartedAt,
          occurredAt: idle.occurredAt
        }
      }
    ]);
    expect(JSON.stringify(migrated)).not.toContain("server-learning-session-secret");
    expect(JSON.stringify(migrated)).not.toContain("offlineEpoch");
    expect(JSON.stringify(migrated)).not.toContain("baseCursor");
    expect(JSON.stringify(migrated[0])).not.toContain(attempt.occurredAt);
    await expect(listActivities()).resolves.toEqual([]);

    const raw = await openDB(OFFLINE_DB_NAME, OFFLINE_DB_VERSION);
    expect(Array.from(raw.objectStoreNames)).toEqual(expect.arrayContaining([
      "activityQueue",
      "legacyActivities",
      "rejectedActivities",
      "pendingBatches",
      "todayPlans",
      "meta"
    ]));
    expect(await raw.count("attemptQueue")).toBe(0);
    expect(await raw.count("idleEventQueue")).toBe(0);
    expect((await raw.getAll("meta")).map((entry: { key: string }) => entry.key).sort())
      .toEqual([
        "acknowledged-cursors",
        "confirmed-stars",
        "device-state",
        "next-device-sequence"
      ]);
    raw.close();
  });

  it("materializes IDs, times, and one transactional device sequence from validated payloads", async () => {
    await markStudentAuthenticated();
    await cacheIssuedPlan(plan, stars);

    await queueAttempt({
      ...attempt,
      clientId: "competing-client-id",
      deviceSequence: 99,
      occurredAtIndex: "2099-01-01T00:00:00.000Z"
    } as AttemptInput);
    await queueIdleEvent(idle);

    const activities = await listActivities();
    expect(activities).toHaveLength(2);
    expect(activities[0]).toMatchObject({
      clientId: attempt.clientAttemptId,
      occurredAt: attempt.occurredAt,
      deviceSequence: 0,
      planId: plan.planId,
      offlineEpoch: plan.offlineEpoch,
      baseCursor: plan.activityCursor
    });
    expect(activities[1]).toMatchObject({
      clientId: idle.clientIdleEventId,
      occurredAt: idle.occurredAt,
      deviceSequence: 1,
      event: { kind: "idle", legacy: true }
    });
    expect(JSON.stringify(activities[1])).not.toContain(idle.learningSessionId);
    await expect(getQueueCounts()).resolves.toEqual({
      activities: 2,
      provisionalAttempts: 1,
      rejected: 0
    });
  });

  it("clears only cached authority and blocks every journal read or write until student PIN authentication", async () => {
    await markStudentAuthenticated();
    await cacheIssuedPlan(plan, stars);
    await storeOfflineLease({
      offlineAccessUntil: "2026-07-16T14:59:59.999Z",
      user: { id: "student-1", role: "student", displayName: "수아" }
    });
    await queueAttempt(attempt);

    await clearOfflineAuthority("auth-required");

    await expect(loadCachedTodayPlan(plan.date)).resolves.toBeUndefined();
    await expect(getConfirmedStars()).resolves.toBeUndefined();
    await expect(getDeviceState()).resolves.toBe("auth-required");
    await expect(listActivities()).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
    await expect(getQueueCounts()).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
    await expect(queueAttempt(attempt)).rejects.toMatchObject({ code: "AUTH_REQUIRED" });

    await markStudentAuthenticated();
    await expect(listActivities()).resolves.toHaveLength(1);
  });

  it("loads an offline student only for an unexpired lease, ready state, and same current KST issued daily plan", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-07-16T02:00:00.000Z"));
    await markStudentAuthenticated();
    await cacheIssuedPlan(plan, stars);
    await storeOfflineLease({
      offlineAccessUntil: "2026-07-16T14:59:59.999Z",
      user: { id: "student-1", role: "student", displayName: "수아" }
    });

    await expect(loadOfflineStudentSession()).resolves.toEqual({
      user: { id: "student-1", role: "student", displayName: "수아" },
      plan,
      stars
    });

    vi.setSystemTime(new Date("2026-07-16T15:00:00.000Z"));
    await expect(loadOfflineStudentSession()).resolves.toBeUndefined();
  });

  it("reconciles matching v1 records only after a current issued plan without fabricating attempt time or idle session authority", async () => {
    await seedVersionOne();
    await listLegacyActivities();
    await cacheIssuedPlan(plan, stars);

    await reconcileLegacyActivities(plan, "2026-07-16T02:00:00.000Z");

    await expect(listLegacyActivities()).resolves.toEqual([]);
    const reconciled = await listActivities();
    expect(reconciled).toEqual([
      expect.objectContaining({
        clientId: idle.clientIdleEventId,
        occurredAt: idle.occurredAt,
        planId: plan.planId,
        event: {
          kind: "idle",
          legacy: true,
          payload: expect.objectContaining({
            clientIdleEventId: idle.clientIdleEventId,
            itemId: idle.itemId
          })
        }
      }),
      expect.objectContaining({
        clientId: attempt.clientAttemptId,
        occurredAt: "2026-07-16T02:00:00.000Z",
        planId: plan.planId,
        event: {
          kind: "attempt",
          legacy: true,
          payload: expect.objectContaining({
            clientAttemptId: attempt.clientAttemptId,
            readingScore: attempt.readingScore,
            missedTokens: attempt.missedTokens
          })
        }
      })
    ]);
    expect(JSON.stringify(reconciled)).not.toContain(idle.learningSessionId);
    expect(JSON.stringify(reconciled[1]!.event)).not.toContain("occurredAt");
  });

  it("keeps prior-date legacy raw data local under LEGACY_AUTHORITY_UNAVAILABLE", async () => {
    await seedVersionOne();
    await listLegacyActivities();
    const current = { ...plan, date: "2026-07-17" };
    await cacheIssuedPlan(current, stars);

    await reconcileLegacyActivities(current, "2026-07-17T02:00:00.000Z");

    await expect(listActivities()).resolves.toEqual([]);
    const rejected = await listRejectedActivities();
    expect(rejected).toHaveLength(2);
    expect(rejected.every((entry) => entry.code === "LEGACY_AUTHORITY_UNAVAILABLE"))
      .toBe(true);
    expect(JSON.stringify(rejected)).toContain("자라요");
    expect(JSON.stringify(rejected)).not.toContain(idle.learningSessionId);
  });
});
