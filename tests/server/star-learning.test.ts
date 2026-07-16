import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDailyItems } from "../../src/shared/daily-order";
import type { TodayPlan } from "../../src/shared/learning";
import { INITIAL_ITEMS } from "../../src/server/db/seed";
import { StarRepository } from "../../src/server/stars/repository";
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

async function getToday(student: TestClient): Promise<TodayPlan> {
  const response = await student.request("GET", "/api/student/today");
  expect(response.statusCode).toBe(200);
  return response.json() as TodayPlan;
}

function expectedRequiredIds(studyDate: string): string[] {
  const counts = { korean: 0, math: 0 };
  return getDailyItems(INITIAL_ITEMS, studyDate)
    .filter((item) => {
      if (counts[item.subject] >= 2) return false;
      counts[item.subject] += 1;
      return true;
    })
    .map((item) => item.id);
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

describe("issued-plan required learning star awards", () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = await createTestHarness();
  });

  afterEach(async () => {
    await harness.close();
  });

  it("snapshots a stable default requirement set into the issued plan", async () => {
    const student = harness.client();
    await authenticateStudent(harness, student);

    const first = await getToday(student);
    const second = await getToday(student);
    expect(first.requiredItemIds).toEqual(expectedRequiredIds("2026-07-15"));
    expect(second.requiredItemIds).toEqual(first.requiredItemIds);
    expect(second.items).toEqual(first.items);
    expect(first.stars).toEqual({
      balance: 0,
      earnedToday: 0,
      deductedToday: 0,
      lastReason: null
    });
    expect(harness.db.prepare(`
      SELECT korean_target AS koreanTarget,
             math_target AS mathTarget,
             is_rest_day AS isRestDay
      FROM daily_plan_settings
    `).get()).toEqual({ koreanTarget: 2, mathTarget: 2, isRestDay: 0 });
    expect(harness.db.prepare(`
      SELECT item_id AS itemId, is_required AS isRequired
      FROM issued_plan_items
      WHERE plan_id = ?
      ORDER BY sort_order
    `).all(first.planId).filter((row) => (
      row as { isRequired: number }
    ).isRequired === 1)).toEqual(
      first.requiredItemIds.map((itemId) => ({ itemId, isRequired: 1 }))
    );
  });

  it("awards one required-item source and keeps retry receipts idempotent", async () => {
    const student = harness.client();
    await authenticateStudent(harness, student);
    const plan = await getToday(student);
    const item = plan.items.find(
      (candidate) => candidate.id === plan.requiredItemIds[0]
    )!;
    const input = passingAttempt(plan, item, "attempt-required-0001");

    const first = await student.request("POST", "/api/student/attempts", input);
    expect(first.statusCode).toBe(201);
    expect(first.json()).toMatchObject({
      duplicate: false,
      activityCursor: 1,
      starAward: {
        awarded: true,
        amount: 1,
        balance: 1,
        eventId: expect.any(String)
      }
    });
    const duplicate = await student.request(
      "POST",
      "/api/student/attempts",
      input
    );
    expect(duplicate.statusCode).toBe(200);
    expect(duplicate.json()).toEqual({
      ...first.json(),
      duplicate: true
    });

    const secondAttempt = await student.request(
      "POST",
      "/api/student/attempts",
      passingAttempt(plan, item, "attempt-required-0002")
    );
    expect(secondAttempt.statusCode).toBe(201);
    expect(secondAttempt.json().starAward).toEqual({
      awarded: false,
      amount: 0,
      balance: 1,
      eventId: first.json().starAward.eventId
    });
    expect(harness.db.prepare(`
      SELECT source_key AS sourceKey FROM star_events
      WHERE reason_code = 'REQUIRED_ITEM_COMPLETED'
    `).all()).toEqual([{
      sourceKey: `required:${studentId(harness)}:${plan.date}:${item.id}`
    }]);
  });

  it("uses required=true from issuance even after the mutable requirement is deleted", async () => {
    const student = harness.client();
    await authenticateStudent(harness, student);
    const plan = await getToday(student);
    const item = plan.items.find(
      (candidate) => candidate.id === plan.requiredItemIds[0]
    )!;
    harness.db.prepare(`
      DELETE FROM daily_requirements
      WHERE student_id = ? AND study_date = ? AND item_id = ?
    `).run(studentId(harness), plan.date, item.id);

    const response = await student.request(
      "POST",
      "/api/student/attempts",
      passingAttempt(plan, item, "attempt-required-snapshot-0001")
    );
    expect(response.statusCode).toBe(201);
    expect(response.json().starAward).toMatchObject({
      awarded: true,
      amount: 1,
      balance: 1,
      eventId: expect.any(String)
    });
    expect(harness.db.prepare(`
      SELECT COUNT(*) AS count FROM star_events
      WHERE reason_code = 'REQUIRED_ITEM_COMPLETED'
    `).get()).toEqual({ count: 1 });
  });

  it("uses required=false from issuance even after a mutable requirement is added", async () => {
    const student = harness.client();
    await authenticateStudent(harness, student);
    const plan = await getToday(student);
    const item = plan.items.find(
      (candidate) => !plan.requiredItemIds.includes(candidate.id)
    )!;
    harness.db.prepare(`
      INSERT INTO daily_requirements (
        student_id, study_date, item_id, subject, sort_order, created_at
      ) VALUES (?, ?, ?, ?, 99, ?)
    `).run(
      studentId(harness),
      plan.date,
      item.id,
      item.payload.subject,
      "2026-07-15T03:03:00.000Z"
    );

    const response = await student.request(
      "POST",
      "/api/student/attempts",
      passingAttempt(plan, item, "attempt-optional-snapshot-0001")
    );
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      completed: true,
      starAward: {
        awarded: false,
        amount: 0,
        balance: 0,
        eventId: null
      }
    });
    expect(harness.db.prepare("SELECT COUNT(*) AS count FROM star_events").get())
      .toEqual({ count: 0 });
  });

  it("awards zero for failed required and passing optional snapshot items", async () => {
    const student = harness.client();
    await authenticateStudent(harness, student);
    const plan = await getToday(student);
    const required = plan.items.find(
      (candidate) => candidate.id === plan.requiredItemIds[0]
    )!;
    const optional = plan.items.find(
      (candidate) => !plan.requiredItemIds.includes(candidate.id)
    )!;

    const failed = await student.request("POST", "/api/student/attempts", {
      ...passingAttempt(plan, required, "attempt-failed-required-0001"),
      readingScore: 0
    });
    expect(failed.statusCode).toBe(201);
    expect(failed.json().starAward).toEqual({
      awarded: false,
      amount: 0,
      balance: 0,
      eventId: null
    });

    const optionalResult = await student.request(
      "POST",
      "/api/student/attempts",
      passingAttempt(plan, optional, "attempt-optional-0001")
    );
    expect(optionalResult.statusCode).toBe(201);
    expect(optionalResult.json().starAward).toEqual({
      awarded: false,
      amount: 0,
      balance: 0,
      eventId: null
    });

    const laterPass = await student.request(
      "POST",
      "/api/student/attempts",
      passingAttempt(plan, required, "attempt-required-after-fail-0001")
    );
    expect(laterPass.json().starAward).toMatchObject({
      awarded: true,
      amount: 1,
      balance: 1,
      eventId: expect.any(String)
    });
  });

  it("snapshots no required items on a server-current rest day", async () => {
    const student = harness.client();
    await authenticateStudent(harness, student);
    harness.db.prepare(`
      INSERT INTO daily_plan_settings (
        student_id, study_date, korean_target, math_target,
        is_rest_day, updated_at
      ) VALUES (?, '2026-07-15', 2, 2, 1, ?)
    `).run(studentId(harness), "2026-07-14T21:00:00.000Z");

    const plan = await getToday(student);
    expect(plan.requiredItemIds).toEqual([]);
    expect(harness.db.prepare(`
      SELECT COUNT(*) AS count FROM issued_plan_items WHERE is_required = 1
    `).get()).toEqual({ count: 0 });
    const attempt = await student.request(
      "POST",
      "/api/student/attempts",
      passingAttempt(plan, plan.items[0]!, "attempt-rest-day-0001")
    );
    expect(attempt.json().starAward).toEqual({
      awarded: false,
      amount: 0,
      balance: 0,
      eventId: null
    });
  });

  it("rolls back attempt, star, receipt, and cursor when receipt persistence fails", async () => {
    const student = harness.client();
    await authenticateStudent(harness, student);
    const plan = await getToday(student);
    const required = plan.items.find(
      (candidate) => candidate.id === plan.requiredItemIds[0]
    )!;
    const input = passingAttempt(plan, required, "attempt-atomic-0001");
    harness.db.exec(`
      CREATE TRIGGER fail_attempt_star_receipt
      BEFORE INSERT ON attempt_star_receipts
      BEGIN
        SELECT RAISE(ABORT, 'FORCED_RECEIPT_FAILURE');
      END;
    `);

    const failed = await student.request("POST", "/api/student/attempts", input);
    expect(failed.statusCode).toBe(500);
    expect(harness.db.prepare("SELECT COUNT(*) AS count FROM attempts").get())
      .toEqual({ count: 0 });
    expect(harness.db.prepare("SELECT COUNT(*) AS count FROM star_events").get())
      .toEqual({ count: 0 });
    expect(harness.db.prepare(`
      SELECT current_cursor AS currentCursor FROM student_activity_cursors
    `).get()).toEqual({ currentCursor: 0 });

    harness.db.exec("DROP TRIGGER fail_attempt_star_receipt");
    const retry = await student.request("POST", "/api/student/attempts", input);
    expect(retry.statusCode).toBe(201);
    expect(retry.json()).toMatchObject({
      activityCursor: 1,
      starAward: {
        awarded: true,
        amount: 1,
        balance: 1,
        eventId: expect.any(String)
      }
    });
  });

  it("reports a later authoritative balance in a new required attempt receipt", async () => {
    const student = harness.client();
    await authenticateStudent(harness, student);
    const plan = await getToday(student);
    const required = plan.items.find(
      (candidate) => candidate.id === plan.requiredItemIds[0]
    )!;
    const first = await student.request(
      "POST",
      "/api/student/attempts",
      passingAttempt(plan, required, "attempt-balance-first-0001")
    );
    new StarRepository(harness.db).apply({
      studentId: studentId(harness),
      delta: 5,
      reason: "GUARDIAN_BONUS",
      reasonText: "나중에 받은 보호자 보너스",
      studyDate: plan.date,
      actorType: "guardian",
      sourceKey: "guardian:receipt-stability",
      createdAt: "2026-07-15T04:00:00.000Z"
    });
    const second = await student.request(
      "POST",
      "/api/student/attempts",
      passingAttempt(plan, required, "attempt-balance-second-0001")
    );
    expect(second.json().starAward).toEqual({
      awarded: false,
      amount: 0,
      balance: 6,
      eventId: first.json().starAward.eventId
    });
  });
});

function studentId(harness: Harness): string {
  return (harness.db.prepare(`
    SELECT id FROM users WHERE role = 'student'
  `).get() as { id: string }).id;
}
