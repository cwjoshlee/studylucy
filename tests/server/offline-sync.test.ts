import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { TodayPlan } from "../../src/shared/learning";
import {
  createTestHarness,
  type TestClient
} from "../helpers/app";

type Harness = Awaited<ReturnType<typeof createTestHarness>>;

const FAMILY = {
  guardianName: "보호자",
  password: "correct horse battery staple",
  studentName: "수아"
};

async function authenticateStudent(
  harness: Harness,
  student: TestClient
): Promise<void> {
  expect((await student.request("POST", "/api/auth/setup", {
    ...FAMILY,
    setupSecret: harness.config.setupSecret
  })).statusCode).toBe(201);
  expect((await student.request("POST", "/api/auth/guardian/login", {
    password: FAMILY.password
  })).statusCode).toBe(204);
  expect((await student.request("POST", "/api/guardian/devices/current", {
    name: "수아 갤럭시 탭", deviceType: "tablet"
  })).statusCode).toBe(201);
  expect((await student.request("PUT", "/api/auth/student-pin", {
    pin: "2580"
  })).statusCode).toBe(204);
  expect((await student.request("POST", "/api/auth/logout")).statusCode)
    .toBe(204);
  expect((await student.request("POST", "/api/auth/student/login", {
    pin: "2580"
  })).statusCode).toBe(200);
}

async function getToday(student: TestClient): Promise<TodayPlan> {
  const response = await student.request("GET", "/api/student/today");
  expect(response.statusCode).toBe(200);
  return response.json() as TodayPlan;
}

function passingAttempt(
  plan: TodayPlan,
  item: TodayPlan["items"][number],
  clientAttemptId: string
) {
  return {
    clientAttemptId,
    planId: plan.planId,
    itemId: item.id,
    contentVersion: item.version,
    studyDate: plan.date,
    occurredAt: "2026-07-15T03:05:00.000Z",
    readingScore: 100,
    missedTokens: [],
    mathAnswer: item.payload.kind === "math-story"
      ? item.payload.answer
      : null,
    dictationText: item.payload.kind === "korean-dictation"
      ? item.payload.answerText
      : undefined,
    durationMs: 12_000,
    difficultyFeedback: null
  };
}

describe("offline staged attempt authority", () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = await createTestHarness();
  });

  afterEach(async () => {
    await harness.close();
  });

  it("records STEP_LOCKED without inserting an attempt or star", async () => {
    const student = harness.client();
    await authenticateStudent(harness, student);
    const plan = await getToday(student);
    const locked = plan.items.filter((item) =>
      item.payload.subject === "math" && item.step !== "foundation"
    );
    const events = locked.map((item, index) => ({
      kind: "attempt" as const,
      deviceSequence: index + 1,
      legacy: false,
      payload: passingAttempt(
        plan,
        item,
        `attempt-offline-locked-${item.step}-0001`
      )
    }));

    const response = await student.request(
      "POST",
      "/api/student/offline-batches",
      {
        clientBatchId: "batch-offline-locked-stages-0001",
        planId: plan.planId,
        offlineEpoch: plan.offlineEpoch,
        startCursor: plan.activityCursor,
        events
      }
    );

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      batchEndCursor: 2,
      activityCursor: 2,
      receipts: [
        {
          clientId: "attempt-offline-locked-current-0001",
          kind: "attempt",
          status: "REJECTED",
          code: "STEP_LOCKED",
          attempt: null
        },
        {
          clientId: "attempt-offline-locked-challenge-0001",
          kind: "attempt",
          status: "REJECTED",
          code: "STEP_LOCKED",
          attempt: null
        }
      ],
      stars: { balance: 0 }
    });
    expect(harness.db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM attempts) AS attempts,
        (SELECT COUNT(*) FROM star_events) AS stars,
        (SELECT COUNT(*) FROM offline_batches) AS batches,
        (SELECT COUNT(*) FROM offline_activity_receipts
          WHERE status = 'rejected' AND code = 'STEP_LOCKED') AS rejections
    `).get()).toEqual({ attempts: 0, stars: 0, batches: 1, rejections: 2 });
  });

  it("rejects dictation before persisting an offline batch or activity", async () => {
    const student = harness.client();
    await authenticateStudent(harness, student);
    const plan = await getToday(student);
    const dictation = plan.items.find((item) =>
      item.payload.kind === "korean-dictation"
    )!;

    const response = await student.request(
      "POST",
      "/api/student/offline-batches",
      {
        clientBatchId: "batch-offline-dictation-0001",
        planId: plan.planId,
        offlineEpoch: plan.offlineEpoch,
        startCursor: plan.activityCursor,
        events: [{
          kind: "attempt",
          deviceSequence: 1,
          legacy: false,
          payload: passingAttempt(
            plan,
            dictation,
            "attempt-offline-dictation-0001"
          )
        }]
      }
    );

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ code: "DICTATION_ONLINE_ONLY" });
    expect(harness.db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM attempts) AS attempts,
        (SELECT COUNT(*) FROM offline_batches) AS batches,
        (SELECT COUNT(*) FROM offline_activity_receipts) AS activities,
        (SELECT current_cursor FROM student_activity_cursors) AS activityCursor
    `).get()).toEqual({
      attempts: 0,
      batches: 0,
      activities: 0,
      activityCursor: 0
    });
  });
});
