import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { INITIAL_CONTENT_VERSION } from "../../src/server/db/seed";
import { LearningRepository } from "../../src/server/learning/repository";
import {
  isCalculationItem,
  type TodayPlan
} from "../../src/shared/learning";
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

async function getToday(student: TestClient): Promise<TodayPlan> {
  const response = await student.request("GET", "/api/student/today");
  expect(response.statusCode).toBe(200);
  return response.json() as TodayPlan;
}

async function createLearningSession(
  student: TestClient,
  plan: TodayPlan,
  item: TodayPlan["items"][number]
) {
  return student.request("POST", "/api/student/learning-sessions", {
    planId: plan.planId,
    itemId: item.id,
    contentVersion: item.version
  });
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

  it("preserves issued steps in online and recovery plan views", async () => {
    const firstDevice = harness.client();
    await authenticateStudent(harness, firstDevice);
    const sourcePlan = await getToday(firstDevice);
    const item = sourcePlan.items[0]!;
    harness.db.prepare(`
      UPDATE issued_plan_items SET step = 'foundation'
      WHERE plan_id = ? AND item_id = ?
    `).run(sourcePlan.planId, item.id);

    const online = await getToday(firstDevice);
    expect(online.items.find((candidate) => candidate.id === item.id)?.step)
      .toBe("foundation");

    const recoveryDevice = harness.client();
    await loginStudentOnNewDevice(recoveryDevice, "수아 복구 태블릿");
    harness.db.prepare(`
      UPDATE trusted_devices SET revoked_at = ?
      WHERE id = (SELECT trusted_device_id FROM issued_daily_plans WHERE id = ?)
    `).run("2026-07-15T03:01:00.000Z", sourcePlan.planId);

    const recovery = await recoveryDevice.request(
      "POST",
      "/api/student/recovery-plans",
      { sourcePlanId: sourcePlan.planId }
    );
    expect(recovery.statusCode).toBe(200);
    expect(recovery.json().items.find((candidate: { id: string }) =>
      candidate.id === item.id
    )?.step).toBe("foundation");
    expect(harness.db.prepare(`
      SELECT step FROM issued_plan_items
      WHERE plan_id = ? AND item_id = ?
    `).get(recovery.json().planId, item.id)).toEqual({ step: "foundation" });
  });

  it("completes a wrong challenge, unlocks from server completion, and awards one perfect bonus", async () => {
    const student = harness.client();
    await authenticateStudent(harness, student);
    harness.db.prepare(`
      INSERT INTO daily_step_settings (
        student_id, study_date, subject, difficulty, challenge_bonus_stars
      ) VALUES (?, '2026-07-15', 'math', 3, 4)
      ON CONFLICT(student_id, study_date, subject) DO UPDATE SET
        difficulty = excluded.difficulty,
        challenge_bonus_stars = excluded.challenge_bonus_stars
    `).run((harness.db.prepare(`
      SELECT id FROM users WHERE role = 'student'
    `).get() as { id: string }).id);
    const plan = await getToday(student);
    const challenge = plan.items.find((item) =>
      item.payload.subject === "math" && item.step === "challenge"
    )!;

    const wrong = await student.request("POST", "/api/student/attempts", {
      ...passingAttempt(plan, challenge, "attempt-wrong-challenge-0001"),
      mathAnswer: challenge.payload.kind === "math-story"
        ? challenge.payload.answer + 1
        : -1
    });
    expect(wrong.statusCode).toBe(201);
    expect(wrong.json()).toMatchObject({
      completed: true,
      mathPass: false,
      starAward: { awarded: true, amount: 1 },
      challengeBonus: { eligible: false, awarded: false, amount: 0 }
    });
    expect((await getToday(student)).completedItemIds).toContain(challenge.id);

    const correctInput = passingAttempt(
      plan,
      challenge,
      "attempt-perfect-challenge-0001"
    );
    const perfect = await student.request(
      "POST",
      "/api/student/attempts",
      correctInput
    );
    expect(perfect.statusCode).toBe(201);
    expect(perfect.json().challengeBonus).toEqual({
      eligible: true,
      awarded: true,
      amount: 4
    });
    const duplicate = await student.request(
      "POST",
      "/api/student/attempts",
      correctInput
    );
    expect(duplicate.statusCode).toBe(200);
    expect(duplicate.json()).toEqual({
      ...perfect.json(),
      duplicate: true
    });
    const wrongDuplicate = await student.request(
      "POST",
      "/api/student/attempts",
      {
        ...passingAttempt(plan, challenge, "attempt-wrong-challenge-0001"),
        mathAnswer: challenge.payload.kind === "math-story"
          ? challenge.payload.answer + 1
          : -1
      }
    );
    expect(wrongDuplicate.statusCode).toBe(200);
    expect(wrongDuplicate.json()).toEqual({
      ...wrong.json(),
      duplicate: true,
      activityCursor: perfect.json().activityCursor
    });
    expect(harness.db.prepare(`
      SELECT COUNT(*) AS count FROM star_events
      WHERE reason_code = 'CHALLENGE_PERFECT'
    `).get()).toEqual({ count: 1 });
  });

  it("persists normalized dictation completion without storing the typed text", async () => {
    const student = harness.client();
    await authenticateStudent(harness, student);
    const plan = await getToday(student);
    const item = plan.items.find((candidate) =>
      candidate.payload.subject === "korean"
    )!;
    harness.db.prepare(`
      UPDATE content_versions SET payload_json = ?
      WHERE item_id = ? AND version = ?
    `).run(JSON.stringify({
      id: item.id,
      kind: "korean-dictation",
      subject: "korean",
      unit: "받아쓰기",
      title: "바람이 분다",
      level: "1단계",
      readLabel: "들어 보기",
      text: "바람이 분다",
      hint: "천천히 적어요.",
      tokens: ["바람이", "분다"],
      promptText: "바람이 분다",
      answerText: "바람이 분다",
      mode: "sentence"
    }), item.id, item.version);
    const typedText = "바람   이\n분다";

    const response = await student.request("POST", "/api/student/attempts", {
      ...passingAttempt(plan, item, "attempt-dictation-normalized-0001"),
      dictationText: typedText
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      dictationPass: true,
      completed: true
    });
    expect(harness.db.prepare(`
      SELECT completed, dictation_pass AS dictationPass FROM attempts
      WHERE client_attempt_id = ?
    `).get("attempt-dictation-normalized-0001")).toEqual({
      completed: 1,
      dictationPass: 1
    });
    expect(JSON.stringify(harness.db.prepare(`
      SELECT * FROM attempts WHERE client_attempt_id = ?
    `).get("attempt-dictation-normalized-0001"))).not.toContain(typedText);
    const equivalent = await student.request("POST", "/api/student/attempts", {
      ...passingAttempt(plan, item, "attempt-dictation-normalized-0001"),
      dictationText: "바람이 분다"
    });
    expect(equivalent.statusCode).toBe(200);
    expect(equivalent.json()).toEqual({
      ...response.json(),
      duplicate: true
    });
    const changedOutcome = await student.request(
      "POST",
      "/api/student/attempts",
      {
        ...passingAttempt(plan, item, "attempt-dictation-normalized-0001"),
        dictationText: "바람이 온다"
      }
    );
    expect(changedOutcome.statusCode).toBe(400);
    expect(changedOutcome.json()).toEqual({ code: "INVALID_REQUEST" });
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

  it("issues opaque learning sessions bound to the authenticated student, device, plan, item, and version", async () => {
    const student = harness.client();
    await authenticateStudent(harness, student);
    const plan = await getToday(student);
    const item = plan.items[0]!;

    const first = await createLearningSession(student, plan, item);
    const second = await createLearningSession(student, plan, item);

    expect(first.statusCode).toBe(201);
    expect(first.json()).toEqual({
      learningSessionId: expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
      ),
      activeUntil: "2026-07-15T09:00:00.000Z",
      submitUntil: plan.submitUntil
    });
    expect(second.statusCode).toBe(201);
    expect(second.json().learningSessionId)
      .not.toBe(first.json().learningSessionId);

    const studentId = (harness.db.prepare(`
      SELECT id FROM users WHERE role = 'student'
    `).get() as { id: string }).id;
    const trustedDeviceId = (harness.db.prepare(`
      SELECT trusted_device_id AS trustedDeviceId
      FROM issued_daily_plans WHERE id = ?
    `).get(plan.planId) as { trustedDeviceId: string }).trustedDeviceId;
    expect(harness.db.prepare(`
      SELECT id, plan_id AS planId, student_id AS studentId,
             trusted_device_id AS trustedDeviceId, item_id AS itemId,
             content_version AS contentVersion, study_date AS studyDate,
             issued_at AS issuedAt, active_until AS activeUntil,
             submit_until AS submitUntil, revoked_at AS revokedAt
      FROM issued_learning_sessions
      ORDER BY issued_at, id
    `).all()).toEqual([
      first.json().learningSessionId,
      second.json().learningSessionId
    ].sort().map((id) => ({
      id,
      planId: plan.planId,
      studentId,
      trustedDeviceId,
      itemId: item.id,
      contentVersion: item.version,
      studyDate: plan.date,
      issuedAt: "2026-07-15T03:00:00.000Z",
      activeUntil: "2026-07-15T09:00:00.000Z",
      submitUntil: plan.submitUntil,
      revokedAt: null
    })));
  });

  it("caps a late-issued learning session at the issued plan submit deadline", async () => {
    const student = harness.client();
    await authenticateStudent(harness, student);
    const plan = await getToday(student);
    harness.advanceTime(35 * 60 * 60 * 1_000 + 55 * 60 * 1_000);

    const response = await createLearningSession(student, plan, plan.items[0]!);

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      activeUntil: plan.submitUntil,
      submitUntil: plan.submitUntil
    });
  });

  it("rejects learning-session issuance for foreign devices, wrong items or versions, expired plans, and revoked authority", async () => {
    const firstDevice = harness.client();
    await authenticateStudent(harness, firstDevice);
    const plan = await getToday(firstDevice);
    const item = plan.items[0]!;
    const secondDevice = harness.client();
    await loginStudentOnNewDevice(secondDevice, "수아 두 번째 태블릿");

    const cases = [
      [
        secondDevice,
        { planId: plan.planId, itemId: item.id, contentVersion: item.version },
        "PLAN_NOT_ISSUED"
      ],
      [
        firstDevice,
        { planId: plan.planId, itemId: "missing-item", contentVersion: 1 },
        "PLAN_NOT_ISSUED"
      ],
      [
        firstDevice,
        { planId: plan.planId, itemId: item.id, contentVersion: item.version + 1 },
        "CONTENT_VERSION_CONFLICT"
      ]
    ] as const;
    for (const [client, body, code] of cases) {
      const response = await client.request(
        "POST",
        "/api/student/learning-sessions",
        body
      );
      expect(response.statusCode).toBe(409);
      expect(response.json()).toEqual({ code });
    }

    harness.advanceTime(36 * 60 * 60 * 1_000 + 1);
    const expired = await createLearningSession(firstDevice, plan, item);
    expect(expired.statusCode).toBe(409);
    expect(expired.json()).toEqual({ code: "PLAN_SUBMISSION_EXPIRED" });

    harness.db.prepare(`
      UPDATE trusted_devices SET revoked_at = ?
      WHERE id = (
        SELECT trusted_device_id FROM issued_daily_plans WHERE id = ?
      )
    `).run("2026-07-16T15:00:00.002Z", plan.planId);
    const revoked = await createLearningSession(firstDevice, plan, item);
    expect(revoked.statusCode).toBe(403);
    expect(revoked.json()).toEqual({ code: "DEVICE_REVOKED" });
    expect(harness.db.prepare(`
      SELECT COUNT(*) AS count FROM issued_learning_sessions
    `).get()).toEqual({ count: 0 });
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
    expect(lateDuplicate.json().id).toBe(accepted.json().id);

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

  it("rejects a client attempt id reused by another otherwise-valid device plan", async () => {
    const firstDevice = harness.client();
    await authenticateStudent(harness, firstDevice);
    const firstPlan = await getToday(firstDevice);
    const firstItem = firstPlan.items[0]!;
    const clientAttemptId = "attempt-cross-plan-reuse-0001";
    const accepted = await firstDevice.request(
      "POST",
      "/api/student/attempts",
      passingAttempt(firstPlan, firstItem, clientAttemptId)
    );
    expect(accepted.statusCode).toBe(201);

    const before = harness.db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM attempts) AS attempts,
        (SELECT COUNT(*) FROM star_events) AS starEvents,
        (SELECT current_cursor FROM student_activity_cursors) AS activityCursor
    `).get();
    const secondDevice = harness.client();
    await loginStudentOnNewDevice(secondDevice, "수아 두 번째 태블릿");
    const secondPlan = await getToday(secondDevice);
    const secondItem = secondPlan.items.find((item) => item.id === firstItem.id)!;
    const rejected = await secondDevice.request(
      "POST",
      "/api/student/attempts",
      passingAttempt(secondPlan, secondItem, clientAttemptId)
    );

    expect(rejected.statusCode).toBe(400);
    expect(rejected.json()).toEqual({ code: "INVALID_REQUEST" });
    expect(rejected.json()).not.toHaveProperty("id", accepted.json().id);
    expect(harness.db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM attempts) AS attempts,
        (SELECT COUNT(*) FROM star_events) AS starEvents,
        (SELECT current_cursor FROM student_activity_cursors) AS activityCursor
    `).get()).toEqual(before);
  });

  it("rejects same-plan attempt id reuse when any canonical input field changes", async () => {
    const student = harness.client();
    await authenticateStudent(harness, student);
    const plan = await getToday(student);
    const item = plan.items.find(({ payload }) => payload.subject === "math")!;
    const otherItem = plan.items.find(({ id }) => id !== item.id)!;
    const clientAttemptId = "attempt-changed-body-reuse-0001";
    const canonical = passingAttempt(plan, item, clientAttemptId);
    const accepted = await student.request(
      "POST",
      "/api/student/attempts",
      canonical
    );
    expect(accepted.statusCode).toBe(201);

    const changedInputs = [
      { ...canonical, itemId: otherItem.id, contentVersion: otherItem.version },
      { ...canonical, contentVersion: item.version + 1 },
      { ...canonical, studyDate: "2026-07-14" },
      { ...canonical, occurredAt: "2026-07-15T03:06:00.000Z" },
      { ...canonical, readingScore: 99 },
      { ...canonical, missedTokens: ["바뀐 토큰"] },
      { ...canonical, mathAnswer: null },
      { ...canonical, durationMs: 12_001 },
      { ...canonical, difficultyFeedback: "hard" }
    ];
    for (const changed of changedInputs) {
      const rejected = await student.request(
        "POST",
        "/api/student/attempts",
        changed
      );
      expect(rejected.statusCode).toBe(400);
      expect(rejected.json()).toEqual({ code: "INVALID_REQUEST" });
    }
    expect(harness.db.prepare("SELECT COUNT(*) AS count FROM attempts").get())
      .toEqual({ count: 1 });
    expect(harness.db.prepare(`
      SELECT current_cursor AS currentCursor FROM student_activity_cursors
    `).get()).toEqual({ currentCursor: 1 });
  });

  it("enforces canonical binding in the transactional duplicate fallback", async () => {
    const student = harness.client();
    await authenticateStudent(harness, student);
    const plan = await getToday(student);
    const item = plan.items[0]!;
    const input = passingAttempt(
      plan,
      item,
      "attempt-transaction-race-0001"
    );
    const accepted = await student.request(
      "POST",
      "/api/student/attempts",
      input
    );
    expect(accepted.statusCode).toBe(201);

    const studentId = (harness.db.prepare(`
      SELECT id FROM users WHERE role = 'student'
    `).get() as { id: string }).id;
    const trustedDeviceId = (harness.db.prepare(`
      SELECT trusted_device_id AS trustedDeviceId
      FROM issued_daily_plans WHERE id = ?
    `).get(plan.planId) as { trustedDeviceId: string }).trustedDeviceId;
    const repository = new LearningRepository(harness.db);
    const transactionInput = {
      ...input,
      id: "attempt-transaction-race-fallback",
      userId: studentId,
      trustedDeviceId,
      createdAt: "2026-07-15T03:05:01.000Z",
      snapshot: {
        issuedPlanId: plan.planId,
        studyDate: plan.date,
        contentVersion: item.version,
        payload: item.payload,
        isRequired: plan.requiredItemIds.includes(item.id),
        step: item.step
      }
    };
    const exactRetry = repository.saveAttemptInTransaction(transactionInput);
    expect(exactRetry).toMatchObject({
      inserted: false,
      receipt: { id: accepted.json().id, duplicate: true }
    });

    let mismatch: unknown;
    try {
      repository.saveAttemptInTransaction({
        ...transactionInput,
        missedTokens: ["경합 중 바뀐 토큰"]
      });
    } catch (error) {
      mismatch = error;
    }
    expect(mismatch).toMatchObject({ code: "INVALID_REQUEST" });
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
    const issuedMath = plan.items.find(
      (item) => item.payload.subject === "math"
    )!;
    expect(issuedMath.payload.kind).toBe("math-story");
    expect(isCalculationItem(issuedMath.payload)).toBe(true);

    const nextContentVersion = INITIAL_CONTENT_VERSION + 1;
    const publishedNextVersion = {
      ...issuedMath.payload,
      title: "바뀐 수학 문제",
      text: "정답이 완전히 달라진 새 문제예요.",
      ...(issuedMath.payload.kind === "math-story"
        ? { answer: 999 }
        : {})
    };
    harness.db.prepare(`
      INSERT INTO content_versions (item_id, version, payload_json, created_at)
      VALUES (?, ?, ?, ?)
    `).run(
      issuedMath.id,
      nextContentVersion,
      JSON.stringify(publishedNextVersion),
      "2026-07-15T03:02:00.000Z"
    );
    harness.db.prepare(`
      UPDATE content_items SET active_version = ? WHERE id = ?
    `).run(nextContentVersion, issuedMath.id);

    const response = await student.request(
      "POST",
      "/api/student/attempts",
      passingAttempt(plan, issuedMath, "attempt-issued-current-0001")
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
    `).get("attempt-issued-current-0001")).toEqual({
      contentVersion: INITIAL_CONTENT_VERSION,
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
    const math = plan.items.find((item) =>
      item.payload.subject === "math" && item.step !== "challenge"
    )!;

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
      readingPassRate: 0,
      mathPassRate: 0,
      recentReviewTokens: []
    });
  });

  it("lets a correct calculation complete once without reading credit or Korean review-token effects", async () => {
    const student = harness.client();
    await authenticateStudent(harness, student);
    const plan = await getToday(student);
    const calculation = plan.items.find(
      (item) => isCalculationItem(item.payload)
    )!;
    const korean = plan.items.find((item) => item.payload.subject === "korean")!;
    expect(calculation).toBeDefined();

    const correct = await student.request("POST", "/api/student/attempts", {
      ...passingAttempt(plan, calculation, "attempt-calculation-correct-0001"),
      readingScore: 0,
      missedTokens: ["계산은 읽기 점수가 아니에요"]
    });
    expect(correct.statusCode).toBe(201);
    expect(correct.json()).toMatchObject({
      readingPass: true,
      mathPass: true,
      completed: true,
      starAward: { awarded: true, amount: 1 }
    });
    const duplicate = await student.request("POST", "/api/student/attempts", {
      ...passingAttempt(plan, calculation, "attempt-calculation-correct-0001"),
      readingScore: 0,
      missedTokens: ["계산은 읽기 점수가 아니에요"]
    });
    expect(duplicate.statusCode).toBe(200);
    expect(duplicate.json()).toMatchObject({
      duplicate: true,
      completed: true,
      starAward: { awarded: true, amount: 1 }
    });

    const wrong = await student.request("POST", "/api/student/attempts", {
      ...passingAttempt(plan, plan.items.find((item) =>
        item.payload.subject === "math" && item.step === "current"
      )!, "attempt-calculation-wrong-0001"),
      readingScore: 0,
      missedTokens: ["계산은 읽기 점수가 아니에요"],
      mathAnswer: -1
    });
    expect(wrong.statusCode).toBe(201);
    expect(wrong.json()).toMatchObject({
      readingPass: true,
      mathPass: false,
      completed: false,
      starAward: { awarded: false, amount: 0 }
    });

    expect((await student.request("POST", "/api/student/attempts",
      passingAttempt(plan, korean, "attempt-korean-progress-0001")
    )).statusCode).toBe(201);
    const guardian = harness.client();
    expect((await guardian.request("POST", "/api/auth/guardian/login", {
      password: FAMILY.password
    })).statusCode).toBe(204);
    const progress = await guardian.request(
      "GET",
      "/api/guardian/progress?from=2026-07-15&to=2026-07-15"
    );
    expect(progress.json()).toEqual({
      completedItems: 2,
      totalAttempts: 3,
      readingPassRate: 100,
      mathPassRate: 50,
      recentReviewTokens: []
    });
  });
});
