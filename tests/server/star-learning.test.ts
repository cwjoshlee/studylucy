import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDailyItems } from "../../src/shared/daily-order";
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
  expect(
    (
      await student.request("POST", "/api/auth/setup", {
        ...FAMILY,
        setupSecret: harness.config.setupSecret
      })
    ).statusCode
  ).toBe(201);
  expect(
    (
      await student.request("POST", "/api/auth/guardian/login", {
        password: FAMILY.password
      })
    ).statusCode
  ).toBe(204);
  expect(
    (
      await student.request("POST", "/api/auth/devices", {
        name: "수아 갤럭시 탭"
      })
    ).statusCode
  ).toBe(201);
  expect(
    (
      await student.request("PUT", "/api/auth/student-pin", {
        pin: "2580"
      })
    ).statusCode
  ).toBe(204);
  expect(
    (await student.request("POST", "/api/auth/logout")).statusCode
  ).toBe(204);
  expect(
    (
      await student.request("POST", "/api/auth/student/login", {
        pin: "2580"
      })
    ).statusCode
  ).toBe(204);
}

async function loginStudentOnNewDevice(
  harness: Harness,
  student: TestClient,
  name: string
): Promise<void> {
  expect(
    (
      await student.request("POST", "/api/auth/guardian/login", {
        password: FAMILY.password
      })
    ).statusCode
  ).toBe(204);
  expect(
    (
      await student.request("POST", "/api/auth/devices", { name })
    ).statusCode
  ).toBe(201);
  expect(
    (await student.request("POST", "/api/auth/logout")).statusCode
  ).toBe(204);
  expect(
    (
      await student.request("POST", "/api/auth/student/login", {
        pin: "2580"
      })
    ).statusCode
  ).toBe(204);
}

function expectedRequiredIds(studyDate: string): string[] {
  const counts = { korean: 0, math: 0 };
  return getDailyItems(INITIAL_ITEMS, studyDate)
    .filter((item) => {
      if (counts[item.subject] >= 2) {
        return false;
      }
      counts[item.subject] += 1;
      return true;
    })
    .map((item) => item.id);
}

function passingAttempt(
  item: {
    id: string;
    version: number;
    payload: { kind: string; answer?: number };
  },
  clientAttemptId: string,
  studyDate: string
) {
  return {
    clientAttemptId,
    itemId: item.id,
    contentVersion: item.version,
    studyDate,
    readingScore: 100,
    missedTokens: [],
    mathAnswer: item.payload.kind === "math-story"
      ? item.payload.answer
      : null,
    durationMs: 12_000,
    difficultyFeedback: null
  };
}

describe("required learning star awards", () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = await createTestHarness();
  });

  afterEach(async () => {
    await harness.close();
  });

  it("materializes a stable default plan with two Korean and two math items", async () => {
    const student = harness.client();
    await authenticateStudent(harness, student);

    const first = await student.request(
      "GET",
      "/api/student/today?date=2026-07-16"
    );
    const second = await student.request(
      "GET",
      "/api/student/today?date=2026-07-16"
    );

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(first.json().requiredItemIds).toEqual(
      expectedRequiredIds("2026-07-16")
    );
    expect(second.json().requiredItemIds).toEqual(
      first.json().requiredItemIds
    );
    const requiredSubjects = first.json().requiredItemIds.map(
      (itemId: string) => first.json().items.find(
        (item: { id: string }) => item.id === itemId
      ).payload.subject
    );
    expect(requiredSubjects.filter((subject: string) => subject === "korean"))
      .toHaveLength(2);
    expect(requiredSubjects.filter((subject: string) => subject === "math"))
      .toHaveLength(2);
    expect(first.json().stars).toEqual({
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
  });

  it("awards a required item once and persists stable receipts for retries", async () => {
    const student = harness.client();
    await authenticateStudent(harness, student);
    const plan = await student.request(
      "GET",
      "/api/student/today?date=2026-07-16"
    );
    const item = plan.json().items.find(
      (candidate: { id: string }) =>
        candidate.id === plan.json().requiredItemIds[0]
    );
    const input = passingAttempt(
      item,
      "client-required-attempt-01",
      "2026-07-16"
    );

    const first = await student.request(
      "POST",
      "/api/student/attempts",
      input
    );
    expect(first.statusCode).toBe(201);
    expect(first.json().starAward).toMatchObject({
      awarded: true,
      amount: 1,
      balance: 1,
      eventId: expect.any(String)
    });

    const studentId = (harness.db.prepare(`
      SELECT id FROM users WHERE role = 'student'
    `).get() as { id: string }).id;
    new StarRepository(harness.db).apply({
      studentId,
      delta: 5,
      reason: "GUARDIAN_BONUS",
      reasonText: "나중에 받은 보호자 보너스",
      studyDate: "2026-07-16",
      actorType: "guardian",
      sourceKey: "guardian:receipt-stability",
      createdAt: "2026-07-16T04:00:00.000Z"
    });

    const invalidDuplicate = await student.request(
      "POST",
      "/api/student/attempts",
      {
        ...input,
        itemId: "missing-item",
        contentVersion: 999,
        readingScore: 101,
        missedTokens: ["재전송 값은 무시"]
      }
    );
    expect(invalidDuplicate.statusCode).toBe(200);
    expect(invalidDuplicate.json()).toEqual({
      ...first.json(),
      duplicate: true
    });

    const fresh = await student.request(
      "POST",
      "/api/student/attempts",
      {
        ...input,
        clientAttemptId: "client-required-attempt-02"
      }
    );
    expect(fresh.statusCode).toBe(201);
    expect(fresh.json().starAward).toEqual({
      awarded: false,
      amount: 0,
      balance: 6,
      eventId: first.json().starAward.eventId
    });
    expect(harness.db.prepare(`
      SELECT COUNT(*) AS count
      FROM star_events
      WHERE reason_code = 'REQUIRED_ITEM_COMPLETED'
    `).get()).toEqual({ count: 1 });
  });

  it("materializes requirements before a direct attempt and shares balance across devices", async () => {
    const firstDevice = harness.client();
    await authenticateStudent(harness, firstDevice);
    const studyDate = "2026-07-17";
    const requiredItemId = expectedRequiredIds(studyDate)[0]!;
    const payload = INITIAL_ITEMS.find((item) => item.id === requiredItemId)!;

    const response = await firstDevice.request(
      "POST",
      "/api/student/attempts",
      passingAttempt(
        { id: payload.id, version: 1, payload },
        "client-direct-required-01",
        studyDate
      )
    );
    expect(response.statusCode).toBe(201);
    expect(response.json().starAward).toMatchObject({
      awarded: true,
      amount: 1,
      balance: 1,
      eventId: expect.any(String)
    });
    expect(harness.db.prepare(`
      SELECT COUNT(*) AS count FROM daily_requirements WHERE study_date = ?
    `).get(studyDate)).toEqual({ count: 4 });

    const secondDevice = harness.client();
    await loginStudentOnNewDevice(harness, secondDevice, "수아 두 번째 태블릿");
    const secondPlan = await secondDevice.request(
      "GET",
      `/api/student/today?date=${studyDate}`
    );
    expect(secondPlan.statusCode).toBe(200);
    expect(secondPlan.json().requiredItemIds).toEqual(
      expectedRequiredIds(studyDate)
    );
    expect(secondPlan.json().stars).toEqual({
      balance: 1,
      earnedToday: 1,
      deductedToday: 0,
      lastReason: "필수 학습을 완료했어요"
    });
  });

  it("awards zero for failed required and passing optional attempts", async () => {
    const student = harness.client();
    await authenticateStudent(harness, student);
    const studyDate = "2026-07-18";
    const plan = await student.request(
      "GET",
      `/api/student/today?date=${studyDate}`
    );
    const requiredItem = plan.json().items.find(
      (item: { id: string }) => item.id === plan.json().requiredItemIds[0]
    );
    const optionalItem = plan.json().items.find(
      (item: { id: string }) => !plan.json().requiredItemIds.includes(item.id)
    );

    const failed = await student.request(
      "POST",
      "/api/student/attempts",
      {
        ...passingAttempt(
          requiredItem,
          "client-failed-required-01",
          studyDate
        ),
        readingScore: 0
      }
    );
    expect(failed.statusCode).toBe(201);
    expect(failed.json().starAward).toEqual({
      awarded: false,
      amount: 0,
      balance: 0,
      eventId: null
    });

    const optional = await student.request(
      "POST",
      "/api/student/attempts",
      passingAttempt(optionalItem, "client-optional-01", studyDate)
    );
    expect(optional.statusCode).toBe(201);
    expect(optional.json().completed).toBe(true);
    expect(optional.json().starAward).toEqual({
      awarded: false,
      amount: 0,
      balance: 0,
      eventId: null
    });

    const laterPassingRequired = await student.request(
      "POST",
      "/api/student/attempts",
      passingAttempt(
        requiredItem,
        "client-passing-required-after-fail-01",
        studyDate
      )
    );
    expect(laterPassingRequired.json().starAward).toMatchObject({
      awarded: true,
      amount: 1,
      balance: 1,
      eventId: expect.any(String)
    });
    expect(harness.db.prepare(`
      SELECT COUNT(*) AS count FROM star_events
    `).get()).toEqual({ count: 1 });
  });

  it("materializes no required items on a rest day", async () => {
    const student = harness.client();
    await authenticateStudent(harness, student);
    const studyDate = "2026-07-19";
    const studentId = (harness.db.prepare(`
      SELECT id FROM users WHERE role = 'student'
    `).get() as { id: string }).id;
    harness.db.prepare(`
      INSERT INTO daily_plan_settings (
        student_id, study_date, korean_target, math_target,
        is_rest_day, updated_at
      ) VALUES (?, ?, 2, 2, 1, ?)
    `).run(studentId, studyDate, "2026-07-18T21:00:00.000Z");

    const plan = await student.request(
      "GET",
      `/api/student/today?date=${studyDate}`
    );
    expect(plan.statusCode).toBe(200);
    expect(plan.json().requiredItemIds).toEqual([]);
    expect(harness.db.prepare(`
      SELECT COUNT(*) AS count FROM daily_requirements WHERE study_date = ?
    `).get(studyDate)).toEqual({ count: 0 });

    const attempt = await student.request(
      "POST",
      "/api/student/attempts",
      passingAttempt(
        plan.json().items[0],
        "client-rest-day-optional-01",
        studyDate
      )
    );
    expect(attempt.json().starAward).toEqual({
      awarded: false,
      amount: 0,
      balance: 0,
      eventId: null
    });
  });

  it("rolls back both the attempt and first award when receipt persistence fails", async () => {
    const student = harness.client();
    await authenticateStudent(harness, student);
    const studyDate = "2026-07-20";
    const plan = await student.request(
      "GET",
      `/api/student/today?date=${studyDate}`
    );
    const requiredItem = plan.json().items.find(
      (item: { id: string }) => item.id === plan.json().requiredItemIds[0]
    );
    const input = passingAttempt(
      requiredItem,
      "client-atomic-required-01",
      studyDate
    );
    harness.db.exec(`
      CREATE TRIGGER fail_attempt_star_receipt
      BEFORE INSERT ON attempt_star_receipts
      BEGIN
        SELECT RAISE(ABORT, 'FORCED_RECEIPT_FAILURE');
      END;
    `);

    const failed = await student.request(
      "POST",
      "/api/student/attempts",
      input
    );
    expect(failed.statusCode).toBe(500);
    expect(harness.db.prepare(`
      SELECT COUNT(*) AS count FROM attempts
    `).get()).toEqual({ count: 0 });
    expect(harness.db.prepare(`
      SELECT COUNT(*) AS count FROM star_events
    `).get()).toEqual({ count: 0 });
    expect(harness.db.prepare(`
      SELECT COUNT(*) AS count FROM student_star_balances
    `).get()).toEqual({ count: 0 });

    harness.db.exec("DROP TRIGGER fail_attempt_star_receipt");
    const retry = await student.request(
      "POST",
      "/api/student/attempts",
      input
    );
    expect(retry.statusCode).toBe(201);
    expect(retry.json().starAward).toMatchObject({
      awarded: true,
      amount: 1,
      balance: 1,
      eventId: expect.any(String)
    });
  });
});
