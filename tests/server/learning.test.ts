import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LearningRepository } from "../../src/server/learning/repository";
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

const KOREAN_ATTEMPT = {
  clientAttemptId: "client-attempt-0001",
  itemId: "ko-01",
  contentVersion: 1,
  studyDate: "2026-07-15",
  readingScore: 100,
  missedTokens: [],
  mathAnswer: null,
  durationMs: 12_000,
  difficultyFeedback: null
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
      await student.request("POST", "/api/guardian/devices/current", {
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
  const studentLogin = await student.request(
    "POST",
    "/api/auth/student/login",
    { pin: "2580" }
  );
  expect(studentLogin.statusCode).toBe(200);
  expect(studentLogin.json()).toEqual({
    offlineAccessUntil: "2026-07-15T14:59:59.999Z"
  });
}

async function loginGuardian(guardian: TestClient): Promise<void> {
  expect(
    (
      await guardian.request("POST", "/api/auth/guardian/login", {
        password: FAMILY.password
      })
    ).statusCode
  ).toBe(204);
}

describe("learning API", () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = await createTestHarness();
  });

  afterEach(async () => {
    await harness.close();
  });

  it("returns a stable daily plan and saves one idempotent attempt", async () => {
    const student = harness.client();
    await authenticateStudent(harness, student);

    const firstPlan = await student.request(
      "GET",
      "/api/student/today?date=2026-07-15"
    );
    const secondPlan = await student.request(
      "GET",
      "/api/student/today?date=2026-07-15"
    );
    expect(firstPlan.statusCode).toBe(200);
    expect(secondPlan.statusCode).toBe(200);
    expect(secondPlan.json().items.map((item: { id: string }) => item.id))
      .toEqual(firstPlan.json().items.map((item: { id: string }) => item.id));
    expect(firstPlan.json()).toMatchObject({
      date: "2026-07-15",
      completedItemIds: []
    });

    const firstSave = await student.request(
      "POST",
      "/api/student/attempts",
      KOREAN_ATTEMPT
    );
    expect(firstSave.statusCode).toBe(201);
    expect(firstSave.json()).toMatchObject({
      duplicate: false,
      readingPass: true,
      mathPass: null,
      completed: true
    });

    const duplicateSave = await student.request(
      "POST",
      "/api/student/attempts",
      {
        ...KOREAN_ATTEMPT,
        itemId: "math-01",
        contentVersion: 999,
        readingScore: 101,
        missedTokens: ["재전송 값은 무시"],
        mathAnswer: 999,
        readingPass: false,
        mathPass: false
      }
    );
    expect(duplicateSave.statusCode).toBe(200);
    expect(duplicateSave.json()).toMatchObject({
      id: firstSave.json().id,
      duplicate: true,
      readingPass: true,
      mathPass: null,
      completed: true
    });
    expect(
      new LearningRepository(harness.db).findDuplicateAttempt(
        "different-student",
        KOREAN_ATTEMPT.clientAttemptId
      )
    ).toBeNull();

    const completedPlan = await student.request(
      "GET",
      "/api/student/today?date=2026-07-15"
    );
    expect(completedPlan.json().completedItemIds).toEqual(["ko-01"]);

    harness.db.prepare(`
      UPDATE content_items
      SET status = 'archived'
      WHERE id = 'ko-01'
    `).run();
    const activePlan = await student.request(
      "GET",
      "/api/student/today?date=2026-07-15"
    );
    expect(activePlan.json().completedItemIds).toEqual([]);
    expect(
      activePlan.json().items.some((item: { id: string }) => item.id === "ko-01")
    ).toBe(false);

    const forbidden = await student.request(
      "GET",
      "/api/guardian/progress?from=2026-07-15&to=2026-07-15"
    );
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.json()).toEqual({ code: "ROLE_FORBIDDEN" });

    const stale = await student.request("POST", "/api/student/attempts", {
      ...KOREAN_ATTEMPT,
      clientAttemptId: "client-attempt-0002",
      contentVersion: 999
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toEqual({ code: "CONTENT_VERSION_CONFLICT" });

    const guardian = harness.client();
    await loginGuardian(guardian);
    const progress = await guardian.request(
      "GET",
      "/api/guardian/progress?from=2026-07-15&to=2026-07-15"
    );
    expect(progress.statusCode).toBe(200);
    expect(progress.json()).toEqual({
      completedItems: 1,
      totalAttempts: 1,
      readingPassRate: 100,
      mathPassRate: 0,
      recentReviewTokens: []
    });
  });

  it("returns only published active content and enforces route roles", async () => {
    harness.db.prepare(`
      UPDATE content_items
      SET status = 'archived'
      WHERE id = 'ko-02'
    `).run();

    const anonymous = harness.client();
    expect(
      (
        await anonymous.request(
          "GET",
          "/api/student/today?date=2026-07-15"
        )
      ).statusCode
    ).toBe(401);

    const student = harness.client();
    await authenticateStudent(harness, student);
    const plan = await student.request(
      "GET",
      "/api/student/today?date=2026-07-15"
    );
    expect(plan.statusCode).toBe(200);
    expect(plan.json().items).toHaveLength(19);
    expect(
      plan.json().items.some((item: { id: string }) => item.id === "ko-02")
    ).toBe(false);
    for (const item of plan.json().items) {
      expect(item).toMatchObject({
        id: item.payload.id,
        version: 1
      });
    }

    const guardian = harness.client();
    await loginGuardian(guardian);
    expect(
      (
        await guardian.request(
          "GET",
          "/api/student/today?date=2026-07-15"
        )
      ).statusCode
    ).toBe(403);
    expect(
      (
        await guardian.request(
          "POST",
          "/api/student/attempts",
          KOREAN_ATTEMPT
        )
      ).statusCode
    ).toBe(403);

    const anonymousProgress = await harness.client().request(
      "GET",
      "/api/guardian/progress?from=2026-07-15&to=2026-07-15"
    );
    expect(anonymousProgress.statusCode).toBe(401);
  });

  it("grades reading and math from stored content instead of client PASS claims", async () => {
    const student = harness.client();
    await authenticateStudent(harness, student);

    const wrongMath = await student.request(
      "POST",
      "/api/student/attempts",
      {
        ...KOREAN_ATTEMPT,
        clientAttemptId: "client-attempt-math-01",
        itemId: "math-01",
        mathAnswer: 999,
        readingPass: true,
        mathPass: true,
        transcript: "this must never be stored"
      }
    );
    expect(wrongMath.statusCode).toBe(201);
    expect(wrongMath.json()).toMatchObject({
      duplicate: false,
      readingPass: true,
      mathPass: false,
      completed: false
    });

    const missedReading = await student.request(
      "POST",
      "/api/student/attempts",
      {
        ...KOREAN_ATTEMPT,
        clientAttemptId: "client-attempt-math-02",
        itemId: "math-01",
        missedTokens: ["별빛 씨앗"],
        mathAnswer: 15,
        readingPass: true,
        mathPass: false
      }
    );
    expect(missedReading.statusCode).toBe(201);
    expect(missedReading.json()).toMatchObject({
      readingPass: false,
      mathPass: true,
      completed: false
    });

    const stored = harness.db.prepare(`
      SELECT reading_pass AS readingPass, math_pass AS mathPass
      FROM attempts
      WHERE client_attempt_id = ?
    `).get("client-attempt-math-01");
    expect(stored).toEqual({ readingPass: 1, mathPass: 0 });
    expect(
      harness.db.prepare("PRAGMA table_info(attempts)").all()
        .map((column) => (column as { name: string }).name)
    ).not.toContain("transcript");
  });

  it("aggregates stored pass fields and missed-token counts within the date range", async () => {
    const student = harness.client();
    await authenticateStudent(harness, student);

    const attempts = [
      KOREAN_ATTEMPT,
      {
        ...KOREAN_ATTEMPT,
        clientAttemptId: "client-attempt-agg-retry"
      },
      {
        ...KOREAN_ATTEMPT,
        clientAttemptId: "client-attempt-agg-02",
        itemId: "math-01",
        mathAnswer: 15
      },
      {
        ...KOREAN_ATTEMPT,
        clientAttemptId: "client-attempt-agg-03",
        itemId: "math-02",
        readingScore: 80,
        missedTokens: ["반딧불", "모두"],
        mathAnswer: 0
      },
      {
        ...KOREAN_ATTEMPT,
        clientAttemptId: "client-attempt-agg-04",
        itemId: "math-03",
        missedTokens: ["반딧불"],
        mathAnswer: 16
      },
      {
        ...KOREAN_ATTEMPT,
        clientAttemptId: "client-attempt-outside",
        itemId: "ko-02",
        studyDate: "2026-07-14"
      }
    ];
    for (const attempt of attempts) {
      expect(
        (
          await student.request(
            "POST",
            "/api/student/attempts",
            attempt
          )
        ).statusCode
      ).toBe(201);
    }

    const guardian = harness.client();
    await loginGuardian(guardian);
    const response = await guardian.request(
      "GET",
      "/api/guardian/progress?from=2026-07-15&to=2026-07-15"
    );
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      completedItems: 2,
      totalAttempts: 5,
      readingPassRate: 60,
      mathPassRate: 67,
      recentReviewTokens: [
        { token: "반딧불", count: 2 },
        { token: "모두", count: 1 }
      ]
    });
    expect(JSON.stringify(response.json())).not.toContain("transcript");
  });

  it("rejects invalid learning dates and attempt bodies", async () => {
    const student = harness.client();
    await authenticateStudent(harness, student);

    const invalidToday = await student.request(
      "GET",
      "/api/student/today?date=07-15-2026"
    );
    expect(invalidToday.statusCode).toBe(400);
    expect(invalidToday.json()).toEqual({ code: "INVALID_REQUEST" });

    const invalidAttempt = await student.request(
      "POST",
      "/api/student/attempts",
      { ...KOREAN_ATTEMPT, readingScore: 101 }
    );
    expect(invalidAttempt.statusCode).toBe(400);
    expect(invalidAttempt.json()).toEqual({ code: "INVALID_REQUEST" });

    const guardian = harness.client();
    await loginGuardian(guardian);
    const reversedRange = await guardian.request(
      "GET",
      "/api/guardian/progress?from=2026-07-16&to=2026-07-15"
    );
    expect(reversedRange.statusCode).toBe(400);
    expect(reversedRange.json()).toEqual({ code: "INVALID_REQUEST" });
  });
});
