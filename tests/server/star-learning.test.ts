import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isCalculationItem,
  type TodayPlan
} from "../../src/shared/learning";
import { DailyPlanService } from "../../src/server/stars/daily-plan";
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

async function loginStudentOnNewDevice(
  student: TestClient,
  name: string
): Promise<void> {
  expect((await student.request("POST", "/api/auth/guardian/login", {
    password: FAMILY.password
  })).statusCode).toBe(204);
  expect((await student.request("POST", "/api/guardian/devices/current", {
    name, deviceType: "tablet"
  })).statusCode).toBe(201);
  expect((await student.request("POST", "/api/auth/logout")).statusCode)
    .toBe(204);
  expect((await student.request("POST", "/api/auth/student/login", {
    pin: "2580"
  })).statusCode).toBe(200);
}

async function issueLearningSession(
  student: TestClient,
  plan: TodayPlan,
  item: TodayPlan["items"][number]
) {
  const response = await student.request(
    "POST",
    "/api/student/learning-sessions",
    {
      planId: plan.planId,
      itemId: item.id,
      contentVersion: item.version
    }
  );
  expect(response.statusCode).toBe(201);
  return response.json() as {
    learningSessionId: string;
    activeUntil: string;
    submitUntil: string;
  };
}

function boundIdleEvent(
  plan: TodayPlan,
  item: TodayPlan["items"][number],
  learningSessionId: string,
  clientIdleEventId: string,
  overrides: Record<string, unknown> = {}
) {
  return {
    clientIdleEventId,
    learningSessionId,
    planId: plan.planId,
    itemId: item.id,
    contentVersion: item.version,
    studyDate: plan.date,
    idleStartedAt: "2026-07-15T03:00:00.000Z",
    occurredAt: "2026-07-15T03:05:00.000Z",
    ...overrides
  };
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
    dictationText: item.payload.kind === "korean-dictation"
      ? item.payload.answerText
      : undefined,
    durationMs: 12_000,
    difficultyFeedback: null,
    ...overrides
  };
}

function failingAttempt(
  plan: TodayPlan,
  item: TodayPlan["items"][number],
  clientAttemptId: string
) {
  const input = passingAttempt(plan, item, clientAttemptId);
  if (item.payload.kind === "korean-dictation") {
    return { ...input, dictationText: "틀린 답" };
  }
  if (item.payload.kind === "math-story") {
    return { ...input, mathAnswer: item.payload.answer + 1 };
  }
  return { ...input, readingScore: 0, missedTokens: [item.payload.tokens[0]!] };
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
    expect(first.requiredItemIds).toEqual(first.items.map((item) => item.id));
    expect(first.requiredItemIds).toHaveLength(6);
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

  it("issues one authoritative foundation, current, and challenge item per subject", async () => {
    const student = harness.client();
    await authenticateStudent(harness, student);
    expect((await student.request("POST", "/api/auth/guardian/login", {
      password: FAMILY.password
    })).statusCode).toBe(204);
    const configured = await student.request(
      "PUT",
      "/api/guardian/daily-plans/2026-07-15",
      {
        koreanTarget: 2,
        mathTarget: 2,
        isRestDay: false,
        subjectSettings: {
          korean: { difficulty: 3, challengeBonusStars: 2 },
          math: { difficulty: 3, challengeBonusStars: 4 }
        }
      }
    );
    expect(configured.statusCode).toBe(200);
    expect(configured.json()).toMatchObject({
      subjectSettings: {
        korean: { difficulty: 3, challengeBonusStars: 2 },
        math: { difficulty: 3, challengeBonusStars: 4 }
      }
    });
    expect((await student.request("POST", "/api/auth/logout")).statusCode)
      .toBe(204);
    expect((await student.request("POST", "/api/auth/student/login", {
      pin: "2580"
    })).statusCode).toBe(200);

    const today = await getToday(student);
    expect(today.items).toHaveLength(6);
    expect(today.requiredItemIds).toEqual(today.items.map((item) => item.id));
    for (const subject of ["korean", "math"] as const) {
      expect(today.items.filter((item) => item.payload.subject === subject)
        .map((item) => item.step)).toEqual([
          "foundation", "current", "challenge"
        ]);
    }
    const korean = today.items.filter((item) =>
      item.payload.subject === "korean"
    );
    expect(korean.map((item) => item.payload.kind)).toEqual([
      "korean-dictation", "korean-dictation", "korean-dictation"
    ]);
    expect(korean.map((item) =>
      item.payload.kind === "korean-dictation" ? item.payload.mode : null
    )).toEqual(["word", "word", "sentence"]);
    expect(harness.db.prepare(`
      SELECT subject, step FROM daily_requirements
      ORDER BY sort_order
    `).all()).toEqual([
      { subject: "korean", step: "foundation" },
      { subject: "korean", step: "current" },
      { subject: "korean", step: "challenge" },
      { subject: "math", step: "foundation" },
      { subject: "math", step: "current" },
      { subject: "math", step: "challenge" }
    ]);
  });

  it("hard-filters difficulty-five Korean stages by dictation mode", async () => {
    const student = harness.client();
    await authenticateStudent(harness, student);
    const studentId = (harness.db.prepare(`
      SELECT id FROM users WHERE role = 'student'
    `).get() as { id: string }).id;
    harness.db.prepare(`
      INSERT INTO daily_step_settings (
        student_id, study_date, subject, difficulty, challenge_bonus_stars
      ) VALUES (?, '2026-07-15', 'korean', 5, 2)
    `).run(studentId);

    const today = await getToday(student);
    const korean = today.items.filter((item) =>
      item.payload.subject === "korean"
    );

    expect(korean.map((item) => [
      item.step,
      item.payload.kind,
      item.payload.kind === "korean-dictation" ? item.payload.mode : null
    ])).toEqual([
      ["foundation", "korean-dictation", "word"],
      ["current", "korean-dictation", "word"],
      ["challenge", "korean-dictation", "sentence"]
    ]);
  });

  it("fails with an explicit stage error when required Korean content is unavailable", async () => {
    const student = harness.client();
    await authenticateStudent(harness, student);
    const studentId = (harness.db.prepare(`
      SELECT id FROM users WHERE role = 'student'
    `).get() as { id: string }).id;
    harness.db.prepare(`
      UPDATE content_items
      SET status = 'archived'
      WHERE id IN (
        SELECT ci.id
        FROM content_items AS ci
        JOIN content_versions AS cv
          ON cv.item_id = ci.id AND cv.version = ci.active_version
        WHERE json_extract(cv.payload_json, '$.kind') = 'korean-dictation'
          AND json_extract(cv.payload_json, '$.mode') = 'sentence'
      )
    `).run();

    const dailyPlan = new DailyPlanService(
      harness.db,
      () => new Date("2026-07-15T03:00:00.000Z")
    );
    expect(() => dailyPlan.ensure(studentId, "2026-07-15"))
      .toThrow("DAILY_STEP_ITEM_MISSING:korean:challenge");
    expect(harness.db.prepare(`
      SELECT COUNT(*) AS count FROM daily_requirements
    `).get()).toEqual({ count: 0 });
  });

  it("never issues a guardian-authored multiplication story at difficulty five", async () => {
    const student = harness.client();
    await authenticateStudent(harness, student);
    const studentId = (harness.db.prepare(`
      SELECT id FROM users WHERE role = 'student'
    `).get() as { id: string }).id;
    const multiplication = {
      id: "guardian-multiplication-story",
      kind: "math-story",
      subject: "math",
      unit: "곱셈 이야기",
      title: "다섯 묶음",
      level: "5단계",
      readLabel: "문제 읽기",
      text: "사탕이 다섯 개씩 세 묶음 있어요.",
      hint: "같은 수를 여러 번 더해 보세요.",
      tokens: ["다섯 개씩", "세 묶음"],
      question: "사탕은 모두 몇 개인가요?",
      answer: 15,
      unitLabel: "개",
      checkHint: "5가 세 번 있어요."
    };
    harness.db.prepare(`
      INSERT INTO content_items (
        id, skill_id, subject, status, active_version, created_at
      ) VALUES (?, 'skill-math-story', 'math', 'published', 5, ?)
    `).run(multiplication.id, "2026-07-15T02:00:00.000Z");
    harness.db.prepare(`
      INSERT INTO content_versions (item_id, version, payload_json, created_at)
      VALUES (?, 5, ?, ?)
    `).run(
      multiplication.id,
      JSON.stringify(multiplication),
      "2026-07-15T02:00:00.000Z"
    );
    harness.db.prepare(`
      INSERT INTO daily_step_settings (
        student_id, study_date, subject, difficulty, challenge_bonus_stars
      ) VALUES (?, '2026-07-15', 'math', 5, 2)
    `).run(studentId);

    const today = await getToday(student);
    const math = today.items.filter((item) => item.payload.subject === "math");
    expect(math).toHaveLength(3);
    expect(math.every((item) => isCalculationItem(item.payload))).toBe(true);
    expect(math.map((item) => item.id)).not.toContain(multiplication.id);
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
    const item = plan.items[0]!;
    harness.db.prepare(`
      UPDATE issued_plan_items SET is_required = 0
      WHERE plan_id = ? AND item_id = ?
    `).run(plan.planId, item.id);

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
    const required = plan.items.find((item) => item.step === "foundation")!;
    const optional = plan.items.find((item) => item.step === "current")!;
    harness.db.prepare(`
      UPDATE issued_plan_items SET is_required = 0
      WHERE plan_id = ? AND item_id = ?
    `).run(plan.planId, optional.id);

    const failed = await student.request(
      "POST",
      "/api/student/attempts",
      failingAttempt(plan, required, "attempt-failed-required-0001")
    );
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
    expect(plan.items).toEqual([]);
    expect(harness.db.prepare(`
      SELECT COUNT(*) AS count FROM issued_plan_items WHERE is_required = 1
    `).get()).toEqual({ count: 0 });
    expect(harness.db.prepare(`
      SELECT COUNT(*) AS count FROM star_events
      WHERE reason_code = 'CHALLENGE_PERFECT'
    `).get()).toEqual({ count: 0 });
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

  it("deducts only for a bound issued session and advances the activity cursor only for a new exact idle event", async () => {
    const student = harness.client();
    await authenticateStudent(harness, student);
    const plan = await getToday(student);
    const item = plan.items[0]!;
    const session = await issueLearningSession(student, plan, item);
    new StarRepository(harness.db).apply({
      studentId: studentId(harness),
      delta: 3,
      reason: "GUARDIAN_BONUS",
      reasonText: "시작 별",
      studyDate: plan.date,
      actorType: "guardian",
      sourceKey: "guardian:bound-idle-start",
      createdAt: "2026-07-15T02:59:00.000Z"
    });
    harness.advanceTime(5 * 60 * 1_000);
    const input = boundIdleEvent(
      plan,
      item,
      session.learningSessionId,
      "idle-bound-exact-0001"
    );

    const first = await student.request(
      "POST",
      "/api/student/idle-events",
      input
    );
    expect(first.statusCode).toBe(201);
    expect(first.json()).toMatchObject({
      id: input.clientIdleEventId,
      outcome: "applied",
      duplicate: false,
      activityCursor: 1,
      starEventId: expect.any(String)
    });

    const attempt = await student.request(
      "POST",
      "/api/student/attempts",
      passingAttempt(plan, item, "attempt-after-idle-0001")
    );
    expect(attempt.statusCode).toBe(201);
    expect(attempt.json().activityCursor).toBe(2);

    const duplicate = await student.request(
      "POST",
      "/api/student/idle-events",
      input
    );
    expect(duplicate.statusCode).toBe(200);
    expect(duplicate.json()).toEqual({
      ...first.json(),
      duplicate: true,
      activityCursor: 2
    });
    const changedDuplicate = await student.request(
      "POST",
      "/api/student/idle-events",
      { ...input, occurredAt: "2026-07-15T03:05:01.000Z" }
    );
    expect(changedDuplicate.statusCode).toBe(400);
    expect(changedDuplicate.json()).toEqual({ code: "INVALID_REQUEST" });
    expect(harness.db.prepare(`
      SELECT current_cursor AS currentCursor FROM student_activity_cursors
    `).get()).toEqual({ currentCursor: 2 });

    harness.db.prepare(`
      UPDATE issued_learning_sessions SET revoked_at = ? WHERE id = ?
    `).run("2026-07-15T03:06:00.000Z", session.learningSessionId);
    const revokedDuplicate = await student.request(
      "POST",
      "/api/student/idle-events",
      input
    );
    expect(revokedDuplicate.statusCode).toBe(409);
    expect(revokedDuplicate.json()).toEqual({
      code: "LEARNING_SESSION_INVALID"
    });
    expect(harness.db.prepare(`
      SELECT current_cursor AS currentCursor FROM student_activity_cursors
    `).get()).toEqual({ currentCursor: 2 });
  });

  it("opens exactly one transaction for the complete bound idle deduction", async () => {
    const student = harness.client();
    await authenticateStudent(harness, student);
    const plan = await getToday(student);
    const item = plan.items[0]!;
    const session = await issueLearningSession(student, plan, item);
    harness.advanceTime(5 * 60 * 1_000);
    const transaction = vi.spyOn(harness.db, "transaction");

    const response = await student.request(
      "POST",
      "/api/student/idle-events",
      boundIdleEvent(
        plan,
        item,
        session.learningSessionId,
        "idle-single-transaction-0001"
      )
    );

    expect(response.statusCode).toBe(201);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(harness.db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM idle_events) AS idleEvents,
        (SELECT COUNT(*) FROM star_events) AS starEvents,
        (SELECT current_cursor FROM student_activity_cursors) AS activityCursor
    `).get()).toEqual({ idleEvents: 1, starEvents: 1, activityCursor: 1 });
  });

  it("accepts a disconnected online-issued idle event received later but within the plan deadline", async () => {
    const student = harness.client();
    await authenticateStudent(harness, student);
    const plan = await getToday(student);
    const item = plan.items[0]!;
    const session = await issueLearningSession(student, plan, item);
    harness.advanceTime(24 * 60 * 60 * 1_000);

    const response = await student.request(
      "POST",
      "/api/student/idle-events",
      boundIdleEvent(
        plan,
        item,
        session.learningSessionId,
        "idle-disconnected-valid-0001"
      )
    );

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      outcome: "no-balance",
      duplicate: false,
      activityCursor: 1
    });
  });

  it("appends a zero-floor audit without issuing a no-op balance update", async () => {
    const student = harness.client();
    await authenticateStudent(harness, student);
    const plan = await getToday(student);
    const item = plan.items[0]!;
    const session = await issueLearningSession(student, plan, item);
    harness.advanceTime(5 * 60 * 1_000);
    harness.db.exec(`
      CREATE TRIGGER reject_noop_star_balance_update
      BEFORE UPDATE ON student_star_balances
      BEGIN
        SELECT RAISE(ABORT, 'BALANCE_UPDATE_NOT_ALLOWED');
      END;
    `);

    const response = await student.request(
      "POST",
      "/api/student/idle-events",
      boundIdleEvent(
        plan,
        item,
        session.learningSessionId,
        "idle-zero-floor-audit-0001"
      )
    );

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      outcome: "no-balance",
      starEventId: expect.any(String)
    });
    expect(harness.db.prepare(`
      SELECT requested_delta AS requestedDelta, delta,
             balance_after AS balanceAfter, reason_code AS reason
      FROM star_events WHERE idle_event_id = ?
    `).get("idle-zero-floor-audit-0001")).toEqual({
      requestedDelta: -1,
      delta: 0,
      balanceAfter: 0,
      reason: "NO_BALANCE_AUDIT"
    });
  });

  it("rejects unknown, revoked, foreign, mismatched, pre-issue, over-six-hour, short, and post-deadline idle authority without mutation", async () => {
    const firstDevice = harness.client();
    await authenticateStudent(harness, firstDevice);
    const firstPlan = await getToday(firstDevice);
    const firstItem = firstPlan.items[0]!;
    const otherItem = firstPlan.items[1]!;
    const session = await issueLearningSession(firstDevice, firstPlan, firstItem);
    const secondDevice = harness.client();
    await loginStudentOnNewDevice(secondDevice, "수아 두 번째 태블릿");
    const secondPlan = await getToday(secondDevice);
    const before = harness.db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM idle_events) AS idleEvents,
        (SELECT COUNT(*) FROM star_events) AS starEvents,
        (SELECT current_cursor FROM student_activity_cursors) AS activityCursor
    `).get();

    const cases = [
      [firstDevice, boundIdleEvent(firstPlan, firstItem, "unknown-session-0001", "idle-unknown-0001"), "LEARNING_SESSION_INVALID"],
      [secondDevice, boundIdleEvent(firstPlan, firstItem, session.learningSessionId, "idle-wrong-device-0001"), "LEARNING_SESSION_INVALID"],
      [firstDevice, boundIdleEvent(firstPlan, firstItem, session.learningSessionId, "idle-wrong-plan-0001", { planId: secondPlan.planId }), "LEARNING_SESSION_INVALID"],
      [firstDevice, boundIdleEvent(firstPlan, firstItem, session.learningSessionId, "idle-wrong-item-0001", { itemId: otherItem.id }), "LEARNING_SESSION_INVALID"],
      [firstDevice, boundIdleEvent(firstPlan, firstItem, session.learningSessionId, "idle-wrong-version-0001", { contentVersion: firstItem.version + 1 }), "LEARNING_SESSION_INVALID"],
      [firstDevice, boundIdleEvent(firstPlan, firstItem, session.learningSessionId, "idle-wrong-date-0001", { studyDate: "2026-07-14" }), "LEARNING_SESSION_INVALID"],
      [firstDevice, boundIdleEvent(firstPlan, firstItem, session.learningSessionId, "idle-before-issue-0001", {
        idleStartedAt: "2026-07-15T02:59:00.000Z",
        occurredAt: "2026-07-15T03:04:00.000Z"
      }), "LEARNING_SESSION_INVALID"],
      [firstDevice, boundIdleEvent(firstPlan, firstItem, session.learningSessionId, "idle-over-six-hours-0001", {
        occurredAt: "2026-07-15T09:00:00.001Z"
      }), "LEARNING_SESSION_EXPIRED"],
      [firstDevice, boundIdleEvent(firstPlan, firstItem, session.learningSessionId, "idle-too-short-0001", {
        idleStartedAt: "2026-07-15T03:00:00.001Z"
      }), "INVALID_REQUEST"]
    ] as const;
    for (const [client, input, code] of cases) {
      const response = await client.request(
        "POST",
        "/api/student/idle-events",
        input
      );
      expect(response.statusCode).toBe(code === "INVALID_REQUEST" ? 400 : 409);
      expect(response.json()).toEqual({ code });
      expect(harness.db.prepare(`
        SELECT
          (SELECT COUNT(*) FROM idle_events) AS idleEvents,
          (SELECT COUNT(*) FROM star_events) AS starEvents,
          (SELECT current_cursor FROM student_activity_cursors) AS activityCursor
      `).get()).toEqual(before);
    }

    const guardianId = (harness.db.prepare(`
      SELECT id FROM users WHERE role = 'guardian'
    `).get() as { id: string }).id;
    harness.db.prepare(`
      UPDATE issued_learning_sessions SET student_id = ? WHERE id = ?
    `).run(guardianId, session.learningSessionId);
    const wrongStudent = await firstDevice.request(
      "POST",
      "/api/student/idle-events",
      boundIdleEvent(
        firstPlan,
        firstItem,
        session.learningSessionId,
        "idle-wrong-student-0001"
      )
    );
    expect(wrongStudent.statusCode).toBe(409);
    expect(wrongStudent.json()).toEqual({ code: "LEARNING_SESSION_INVALID" });
    harness.db.prepare(`
      UPDATE issued_learning_sessions SET student_id = ? WHERE id = ?
    `).run(studentId(harness), session.learningSessionId);

    harness.db.prepare(`
      UPDATE issued_learning_sessions SET revoked_at = ? WHERE id = ?
    `).run("2026-07-15T03:01:00.000Z", session.learningSessionId);
    const revoked = await firstDevice.request(
      "POST",
      "/api/student/idle-events",
      boundIdleEvent(
        firstPlan,
        firstItem,
        session.learningSessionId,
        "idle-revoked-session-0001"
      )
    );
    expect(revoked.statusCode).toBe(409);
    expect(revoked.json()).toEqual({ code: "LEARNING_SESSION_INVALID" });

    harness.db.prepare(`
      UPDATE issued_learning_sessions SET revoked_at = NULL WHERE id = ?
    `).run(session.learningSessionId);
    harness.advanceTime(36 * 60 * 60 * 1_000 + 1);
    const expiredPlan = await firstDevice.request(
      "POST",
      "/api/student/idle-events",
      boundIdleEvent(
        firstPlan,
        firstItem,
        session.learningSessionId,
        "idle-submit-expired-0001"
      )
    );
    expect(expiredPlan.statusCode).toBe(409);
    expect(expiredPlan.json()).toEqual({ code: "PLAN_SUBMISSION_EXPIRED" });
    expect(harness.db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM idle_events) AS idleEvents,
        (SELECT COUNT(*) FROM star_events) AS starEvents,
        (SELECT current_cursor FROM student_activity_cursors) AS activityCursor
    `).get()).toEqual(before);
  });

  it("rolls back the idle star event and cursor when idle persistence fails", async () => {
    const student = harness.client();
    await authenticateStudent(harness, student);
    const plan = await getToday(student);
    const item = plan.items[0]!;
    const session = await issueLearningSession(student, plan, item);
    harness.advanceTime(5 * 60 * 1_000);
    harness.db.exec(`
      CREATE TRIGGER fail_bound_idle_insert
      BEFORE INSERT ON idle_events
      BEGIN
        SELECT RAISE(ABORT, 'FORCED_IDLE_FAILURE');
      END;
    `);

    const failed = await student.request(
      "POST",
      "/api/student/idle-events",
      boundIdleEvent(
        plan,
        item,
        session.learningSessionId,
        "idle-atomic-failure-0001"
      )
    );

    expect(failed.statusCode).toBe(500);
    expect(harness.db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM idle_events) AS idleEvents,
        (SELECT COUNT(*) FROM star_events) AS starEvents,
        (SELECT current_cursor FROM student_activity_cursors) AS activityCursor
    `).get()).toEqual({ idleEvents: 0, starEvents: 0, activityCursor: 0 });
  });
});

function studentId(harness: Harness): string {
  return (harness.db.prepare(`
    SELECT id FROM users WHERE role = 'student'
  `).get() as { id: string }).id;
}
