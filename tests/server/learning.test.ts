import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LearningRepository } from "../../src/server/learning/repository";
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
    name: "수아 갤럭시 탭"
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

async function loginStudentOnNewDevice(
  student: TestClient,
  name: string
): Promise<void> {
  expect((await student.request("POST", "/api/auth/guardian/login", {
    password: FAMILY.password
  })).statusCode).toBe(204);
  expect((await student.request("POST", "/api/guardian/devices/current", {
    name
  })).statusCode).toBe(201);
  expect((await student.request("POST", "/api/auth/logout")).statusCode)
    .toBe(204);
  expect((await student.request("POST", "/api/auth/student/login", {
    pin: "2580"
  })).statusCode).toBe(200);
}

function passingAttempt(
  plan: TodayPlan,
  item: TodayPlan["items"][number],
  clientAttemptId: string,
  overrides: Record<string, unknown> = {}
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
    durationMs: 12_000,
    difficultyFeedback: null,
    ...overrides
  };
}

async function getToday(student: TestClient): Promise<TodayPlan> {
  const response = await student.request("GET", "/api/student/today");
  expect(response.statusCode).toBe(200);
  return response.json() as TodayPlan;
}

describe("authoritative learning API", () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = await createTestHarness();
  });

  afterEach(async () => {
    await harness.close();
  });

  it("issues only the server-current KST plan idempotently per active device", async () => {
    const firstDevice = harness.client();
    await authenticateStudent(harness, firstDevice);

    const first = await getToday(firstDevice);
    const repeated = await getToday(firstDevice);
    expect(first).toMatchObject({
      planId: expect.any(String),
      planKind: "daily",
      recoverySourcePlanId: null,
      date: "2026-07-15",
      submitUntil: "2026-07-16T14:59:59.999Z",
      offlineEpoch: 1,
      activityCursor: 0,
      studentDisplayName: "수아",
      completedItemIds: []
    });
    expect(repeated).toEqual(first);

    const secondDevice = harness.client();
    await loginStudentOnNewDevice(secondDevice, "수아 두 번째 태블릿");
    const second = await getToday(secondDevice);
    expect(second.planId).not.toBe(first.planId);
    expect(second.offlineEpoch).toBe(2);
    expect(second.activityCursor).toBe(0);
    expect(second.date).toBe(first.date);
    expect(second.submitUntil).toBe(first.submitUntil);
    expect(second.items).toEqual(first.items);
    expect(second.requiredItemIds).toEqual(first.requiredItemIds);

    expect(harness.db.prepare(`
      SELECT id, offline_epoch AS offlineEpoch, start_cursor AS startCursor
      FROM issued_daily_plans
      ORDER BY offline_epoch
    `).all()).toEqual([
      { id: first.planId, offlineEpoch: 1, startCursor: 0 },
      { id: second.planId, offlineEpoch: 2, startCursor: 0 }
    ]);
    expect(harness.db.prepare(`
      SELECT next_epoch AS nextEpoch, current_cursor AS currentCursor
      FROM student_activity_cursors
    `).get()).toEqual({ nextEpoch: 3, currentCursor: 0 });
  });

  it("rejects every legacy date query before materializing an arbitrary daily plan", async () => {
    const student = harness.client();
    await authenticateStudent(harness, student);

    for (const url of [
      "/api/student/today?date=2026-07-14",
      "/api/student/today?date=",
      "/api/student/today?other=2026-07-15"
    ]) {
      const response = await student.request("GET", url);
      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ code: "INVALID_REQUEST" });
    }
    expect(harness.db.prepare(`
      SELECT COUNT(*) AS count FROM daily_plan_settings
    `).get()).toEqual({ count: 0 });
    expect(harness.db.prepare(`
      SELECT COUNT(*) AS count FROM issued_daily_plans
    `).get()).toEqual({ count: 0 });
  });

  it("cannot issue a plan when the student device is no longer active", async () => {
    const student = harness.client();
    await authenticateStudent(harness, student);
    harness.db.prepare(`
      UPDATE trusted_devices SET revoked_at = ?
    `).run("2026-07-15T03:01:00.000Z");

    const response = await student.request("GET", "/api/student/today");
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ code: "DEVICE_REVOKED" });
    expect(harness.db.prepare(`
      SELECT COUNT(*) AS count FROM issued_daily_plans
    `).get()).toEqual({ count: 0 });
  });

  it("requires final plan and occurrence authority fields before any write", async () => {
    const student = harness.client();
    await authenticateStudent(harness, student);
    const plan = await getToday(student);
    const item = plan.items[0]!;

    for (const body of [
      { ...passingAttempt(plan, item, "attempt-missing-plan-0001"), planId: undefined },
      { ...passingAttempt(plan, item, "attempt-missing-time-0001"), occurredAt: undefined }
    ]) {
      const response = await student.request("POST", "/api/student/attempts", body);
      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ code: "INVALID_REQUEST" });
    }
    expect(harness.db.prepare("SELECT COUNT(*) AS count FROM attempts").get())
      .toEqual({ count: 0 });
    expect(harness.db.prepare("SELECT COUNT(*) AS count FROM star_events").get())
      .toEqual({ count: 0 });
  });

  it("rejects foreign device, item, version, study-day, and occurrence authority without mutation", async () => {
    const firstDevice = harness.client();
    await authenticateStudent(harness, firstDevice);
    const plan = await getToday(firstDevice);
    const item = plan.items[0]!;

    const secondDevice = harness.client();
    await loginStudentOnNewDevice(secondDevice, "수아 두 번째 태블릿");
    const wrongDevice = await secondDevice.request(
      "POST",
      "/api/student/attempts",
      passingAttempt(plan, item, "attempt-wrong-device-0001")
    );
    expect(wrongDevice.statusCode).toBe(409);
    expect(wrongDevice.json()).toEqual({ code: "PLAN_NOT_ISSUED" });

    const cases = [
      [
        passingAttempt(plan, item, "attempt-wrong-item-0001", {
          itemId: "missing-item"
        }),
        "PLAN_NOT_ISSUED"
      ],
      [
        passingAttempt(plan, item, "attempt-wrong-version-0001", {
          contentVersion: item.version + 1
        }),
        "CONTENT_VERSION_CONFLICT"
      ],
      [
        passingAttempt(plan, item, "attempt-wrong-study-date-0001", {
          studyDate: "2026-07-14"
        }),
        "INVALID_REQUEST"
      ],
      [
        passingAttempt(plan, item, "attempt-wrong-occurred-at-0001", {
          occurredAt: "2026-07-14T14:59:59.999Z"
        }),
        "INVALID_REQUEST"
      ]
    ] as const;
    for (const [body, code] of cases) {
      const response = await firstDevice.request(
        "POST",
        "/api/student/attempts",
        body
      );
      expect(response.statusCode).toBe(code === "INVALID_REQUEST" ? 400 : 409);
      expect(response.json()).toEqual({ code });
    }

    expect(harness.db.prepare("SELECT COUNT(*) AS count FROM attempts").get())
      .toEqual({ count: 0 });
    expect(harness.db.prepare("SELECT COUNT(*) AS count FROM star_events").get())
      .toEqual({ count: 0 });
    expect(harness.db.prepare(`
      SELECT current_cursor AS currentCursor FROM student_activity_cursors
    `).get()).toEqual({ currentCursor: 0 });
  });

  it("accepts yesterday's issued plan until its deadline and rejects it after expiry", async () => {
    const student = harness.client();
    await authenticateStudent(harness, student);
    const plan = await getToday(student);
    const firstItem = plan.items[0]!;
    const secondItem = plan.items[1]!;

    harness.advanceTime(24 * 60 * 60 * 1_000);
    const accepted = await student.request(
      "POST",
      "/api/student/attempts",
      passingAttempt(plan, firstItem, "attempt-yesterday-valid-0001")
    );
    expect(accepted.statusCode).toBe(201);
    expect(accepted.json()).toMatchObject({
      duplicate: false,
      completed: true,
      activityCursor: 1
    });

    harness.advanceTime(12 * 60 * 60 * 1_000 + 1);
    const lateDuplicate = await student.request(
      "POST",
      "/api/student/attempts",
      passingAttempt(plan, firstItem, "attempt-yesterday-valid-0001")
    );
    expect(lateDuplicate.statusCode).toBe(200);
    expect(lateDuplicate.json()).toEqual({
      ...accepted.json(),
      duplicate: true
    });

    const expired = await student.request(
      "POST",
      "/api/student/attempts",
      passingAttempt(plan, secondItem, "attempt-yesterday-expired-0001")
    );
    expect(expired.statusCode).toBe(409);
    expect(expired.json()).toEqual({ code: "PLAN_SUBMISSION_EXPIRED" });
    expect(harness.db.prepare("SELECT COUNT(*) AS count FROM attempts").get())
      .toEqual({ count: 1 });
    expect(harness.db.prepare(`
      SELECT current_cursor AS currentCursor FROM student_activity_cursors
    `).get()).toEqual({ currentCursor: 1 });
  });

  it("grades and re-renders from the immutable issued content version", async () => {
    const student = harness.client();
    await authenticateStudent(harness, student);
    const plan = await getToday(student);
    const issuedMath = plan.items.find((item) => item.id === "math-01")!;
    expect(issuedMath.payload.kind).toBe("math-story");

    const publishedV2 = {
      ...issuedMath.payload,
      title: "바뀐 수학 문제",
      text: "정답이 완전히 달라진 새 문제예요.",
      ...(issuedMath.payload.kind === "math-story" ? { answer: 999 } : {})
    };
    harness.db.prepare(`
      INSERT INTO content_versions (item_id, version, payload_json, created_at)
      VALUES (?, 2, ?, ?)
    `).run(
      issuedMath.id,
      JSON.stringify(publishedV2),
      "2026-07-15T03:02:00.000Z"
    );
    harness.db.prepare(`
      UPDATE content_items SET active_version = 2 WHERE id = ?
    `).run(issuedMath.id);

    const response = await student.request(
      "POST",
      "/api/student/attempts",
      passingAttempt(plan, issuedMath, "attempt-issued-v1-0001")
    );
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      mathPass: true,
      completed: true,
      activityCursor: 1
    });
    expect(harness.db.prepare(`
      SELECT content_version AS contentVersion, issued_plan_id AS planId,
             occurred_at AS occurredAt
      FROM attempts WHERE client_attempt_id = ?
    `).get("attempt-issued-v1-0001")).toEqual({
      contentVersion: 1,
      planId: plan.planId,
      occurredAt: "2026-07-15T03:05:00.000Z"
    });

    const repeated = await getToday(student);
    expect(repeated.planId).toBe(plan.planId);
    expect(repeated.items.find((item) => item.id === issuedMath.id))
      .toEqual(issuedMath);
    expect(repeated.completedItemIds).toContain(issuedMath.id);
  });

  it("matches completion by same student/date/item/version across issued plans", async () => {
    const firstDevice = harness.client();
    await authenticateStudent(harness, firstDevice);
    const firstPlan = await getToday(firstDevice);

    const secondDevice = harness.client();
    await loginStudentOnNewDevice(secondDevice, "수아 두 번째 태블릿");
    const secondPlan = await getToday(secondDevice);
    const item = secondPlan.items[0]!;
    const saved = await secondDevice.request(
      "POST",
      "/api/student/attempts",
      passingAttempt(secondPlan, item, "attempt-second-device-0001")
    );
    expect(saved.statusCode).toBe(201);

    const refreshedFirst = await getToday(firstDevice);
    expect(refreshedFirst.planId).toBe(firstPlan.planId);
    expect(refreshedFirst.completedItemIds).toContain(item.id);
  });

  it("advances the online cursor only for new attempts and returns the current cursor on duplicates", async () => {
    const firstDevice = harness.client();
    await authenticateStudent(harness, firstDevice);
    const firstPlan = await getToday(firstDevice);
    const firstInput = passingAttempt(
      firstPlan,
      firstPlan.items[0]!,
      "attempt-cursor-first-0001"
    );

    const first = await firstDevice.request(
      "POST",
      "/api/student/attempts",
      firstInput
    );
    expect(first.statusCode).toBe(201);
    expect(first.json().activityCursor).toBe(1);
    const duplicate = await firstDevice.request(
      "POST",
      "/api/student/attempts",
      firstInput
    );
    expect(duplicate.statusCode).toBe(200);
    expect(duplicate.json()).toEqual({
      ...first.json(),
      duplicate: true,
      activityCursor: 1
    });

    const secondDevice = harness.client();
    await loginStudentOnNewDevice(secondDevice, "수아 두 번째 태블릿");
    const secondPlan = await getToday(secondDevice);
    const second = await secondDevice.request(
      "POST",
      "/api/student/attempts",
      passingAttempt(
        secondPlan,
        secondPlan.items[1]!,
        "attempt-cursor-second-0001"
      )
    );
    expect(second.json().activityCursor).toBe(2);

    const laterDuplicate = await firstDevice.request(
      "POST",
      "/api/student/attempts",
      firstInput
    );
    expect(laterDuplicate.statusCode).toBe(200);
    expect(laterDuplicate.json()).toMatchObject({
      duplicate: true,
      activityCursor: 2
    });
    const refreshed = await getToday(firstDevice);
    expect(refreshed.activityCursor).toBe(2);
    expect(harness.db.prepare(`
      SELECT start_cursor AS startCursor
      FROM issued_daily_plans WHERE id = ?
    `).get(firstPlan.planId)).toEqual({ startCursor: 0 });
  });

  it("keeps guardian progress projection and avoids storing client pass or transcript claims", async () => {
    const student = harness.client();
    await authenticateStudent(harness, student);
    const plan = await getToday(student);
    const math = plan.items.find((item) => item.id === "math-01")!;

    const response = await student.request("POST", "/api/student/attempts", {
      ...passingAttempt(plan, math, "attempt-server-graded-0001"),
      mathAnswer: 999,
      readingPass: true,
      mathPass: true,
      transcript: "this must never be stored"
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      readingPass: true,
      mathPass: false,
      completed: false
    });
    expect(
      new LearningRepository(harness.db).findDuplicateAttempt(
        "different-student",
        "attempt-server-graded-0001"
      )
    ).toBeNull();
    expect(
      harness.db.prepare("PRAGMA table_info(attempts)").all()
        .map((column) => (column as { name: string }).name)
    ).not.toContain("transcript");

    const guardian = harness.client();
    expect((await guardian.request("POST", "/api/auth/guardian/login", {
      password: FAMILY.password
    })).statusCode).toBe(204);
    const progress = await guardian.request(
      "GET",
      "/api/guardian/progress?from=2026-07-15&to=2026-07-15"
    );
    expect(progress.statusCode).toBe(200);
    expect(progress.json()).toEqual({
      completedItems: 0,
      totalAttempts: 1,
      readingPassRate: 100,
      mathPassRate: 0,
      recentReviewTokens: []
    });
  });
});
