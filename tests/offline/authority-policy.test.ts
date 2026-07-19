import "fake-indexeddb/auto";
import { deleteDB } from "idb";
import { beforeEach, describe, expect, it } from "vitest";
import type { AttemptInput, TodayPlan } from "../../src/shared/learning";
import type { IdleEventInput, StudentStarSummary } from "../../src/shared/stars";
import * as offlineDb from "../../src/client/offline/db";

const attempt: AttemptInput = {
  clientAttemptId: "authority-attempt-0001",
  planId: "plan-authority-1",
  itemId: "ko-01",
  contentVersion: 1,
  studyDate: "2026-07-16",
  occurredAt: "2026-07-16T01:05:00.000Z",
  readingScore: 100,
  missedTokens: [],
  mathAnswer: null,
  durationMs: 30_000,
  difficultyFeedback: null
};

const idleEvent: IdleEventInput = {
  clientIdleEventId: "authority-idle-event-0001",
  learningSessionId: "authority-learning-session-0001",
  planId: "plan-authority-1",
  itemId: "ko-01",
  contentVersion: 1,
  studyDate: "2026-07-16",
  idleStartedAt: "2026-07-16T01:00:00.000Z",
  occurredAt: "2026-07-16T01:05:00.000Z"
};

const stars: StudentStarSummary = {
  balance: 7,
  earnedToday: 2,
  deductedToday: 1,
  lastReason: "확정 별"
};

const plan: TodayPlan = {
  planId: "plan-authority-1",
  planKind: "daily",
  recoverySourcePlanId: null,
  date: "2026-07-16",
  submitUntil: "2026-07-17T14:59:59.999Z",
  offlineEpoch: 1,
  activityCursor: 0,
  studentDisplayName: "수아",
  completedItemIds: [],
  requiredItemIds: ["ko-01"],
  stars,
  items: [{
    id: "ko-01",
    version: 1,
    step: "current",
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

type AuthorityDb = typeof offlineDb & {
  clearCurrentV1Authority(code: string): Promise<void>;
};

async function seedAuthorityAndReplayData(): Promise<void> {
  await offlineDb.markStudentAuthenticated();
  await offlineDb.cacheTodayPlan(plan);
  await offlineDb.storeConfirmedStars(stars);
  await offlineDb.queueAttempt(attempt);
  await offlineDb.queueIdleEvent(idleEvent);
}

async function expectAuthorityClearedAndReplayPreserved(): Promise<void> {
  await expect(offlineDb.loadCachedTodayPlan(plan.date)).resolves.toBeUndefined();
  await expect(offlineDb.getConfirmedStars()).resolves.toBeUndefined();
}

describe("centralized offline authority policy", () => {
  beforeEach(async () => {
    await deleteDB(offlineDb.OFFLINE_DB_NAME);
  });

  it.each(["DEVICE_REVOKED", "DEVICE_NOT_TRUSTED"])(
    "clears cached authority, preserves replay data, and requires device action for %s",
    async (code) => {
      await seedAuthorityAndReplayData();

      await (offlineDb as AuthorityDb).clearCurrentV1Authority(code);

      await expectAuthorityClearedAndReplayPreserved();
      await expect(offlineDb.getDeviceState())
        .resolves.toBe("device-action-required");
      await expect(offlineDb.listActivities()).rejects.toMatchObject({
        code: "DEVICE_ACTION_REQUIRED"
      });
      await offlineDb.markStudentAuthenticated();
      await expect(offlineDb.listActivities()).resolves.toEqual([
        expect.objectContaining({
          clientId: attempt.clientAttemptId,
          sourcePlanId: plan.planId,
          requiresRecovery: true
        }),
        expect.objectContaining({
          clientId: idleEvent.clientIdleEventId,
          sourcePlanId: plan.planId,
          requiresRecovery: true
        })
      ]);
    }
  );

  it("clears cached authority, preserves the journal, and blocks reads for AUTH_REQUIRED", async () => {
    await seedAuthorityAndReplayData();

    await (offlineDb as AuthorityDb).clearCurrentV1Authority("AUTH_REQUIRED");

    await expectAuthorityClearedAndReplayPreserved();
    await expect(offlineDb.getDeviceState()).resolves.toBe("auth-required");
    await expect(offlineDb.listActivities()).rejects.toMatchObject({
      code: "AUTH_REQUIRED"
    });
    await offlineDb.markStudentAuthenticated();
    await expect(offlineDb.listActivities()).resolves.toHaveLength(2);
  });

  it.each([
    "PLAN_NOT_ISSUED",
    "PLAN_SUBMISSION_EXPIRED",
    "INVALID_REQUEST",
    "ROLE_FORBIDDEN"
  ])(
    "clears direct student authority and preserves the blocked journal for %s",
    async (code) => {
      await seedAuthorityAndReplayData();

      await (offlineDb as AuthorityDb).clearCurrentV1Authority(code);

      await expectAuthorityClearedAndReplayPreserved();
      await expect(offlineDb.getDeviceState()).resolves.toBe("auth-required");
      await expect(offlineDb.listActivities()).rejects.toMatchObject({
        code: "AUTH_REQUIRED"
      });
      await offlineDb.markStudentAuthenticated();
      await expect(offlineDb.listActivities()).resolves.toHaveLength(2);
    }
  );
});
