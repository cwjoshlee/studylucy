import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDailyItems } from "../../src/shared/daily-order";
import { openDatabase } from "../../src/server/db/client";
import { migrate } from "../../src/server/db/migrate";
import { initialMigration } from "../../src/server/db/migrations/001-initial";
import {
  INITIAL_ITEMS,
  seedInitialContent
} from "../../src/server/db/seed";
import { StarRepository } from "../../src/server/stars/repository";
import { StarService } from "../../src/server/stars/service";
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
const CHILD_SAFE_GUARDIAN_REASON = "보호자가 별을 확인했어요.";

async function authenticateFamily(harness: Harness): Promise<{
  guardian: TestClient;
  student: TestClient;
  studentId: string;
}> {
  const guardian = harness.client();
  const student = harness.client();
  expect((await guardian.request("POST", "/api/auth/setup", {
    ...FAMILY,
    setupSecret: harness.config.setupSecret
  })).statusCode).toBe(201);
  expect((await guardian.request("POST", "/api/auth/guardian/login", {
    password: FAMILY.password
  })).statusCode).toBe(204);
  expect((await guardian.request("POST", "/api/auth/devices", {
    name: "수아 갤럭시 탭"
  })).statusCode).toBe(201);
  expect((await guardian.request("PUT", "/api/auth/student-pin", {
    pin: "2580"
  })).statusCode).toBe(204);
  student.setCookie("sua_device", guardian.cookie("sua_device")!);
  expect((await student.request("POST", "/api/auth/student/login", {
    pin: "2580"
  })).statusCode).toBe(204);
  const studentId = (harness.db.prepare(
    "SELECT id FROM users WHERE role = 'student'"
  ).get() as { id: string }).id;
  return { guardian, student, studentId };
}

function idleEvent(
  clientIdleEventId: string,
  overrides: Record<string, unknown> = {}
) {
  return {
    clientIdleEventId,
    learningSessionId: "learning-session-0001",
    itemId: "ko-01",
    studyDate: "2026-07-15",
    idleStartedAt: "2026-07-15T02:55:00.000Z",
    occurredAt: "2026-07-15T03:00:00.000Z",
    ...overrides
  };
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

describe("idle deductions and missed-plan maintenance", () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = await createTestHarness();
  });

  afterEach(async () => {
    await harness.close();
  });

  it("rejects 4:59 and applies a gentle deduction at exactly 5:00", async () => {
    const { student, studentId } = await authenticateFamily(harness);
    new StarRepository(harness.db).apply({
      studentId,
      delta: 3,
      reason: "GUARDIAN_BONUS",
      reasonText: "시작 별",
      studyDate: "2026-07-15",
      actorType: "guardian",
      sourceKey: "guardian:test:idle-starting-balance",
      createdAt: "2026-07-15T02:50:00.000Z"
    });

    const tooSoon = await student.request(
      "POST",
      "/api/student/idle-events",
      idleEvent("idle-event-0001", {
        idleStartedAt: "2026-07-15T02:55:01.000Z"
      })
    );
    expect(tooSoon.statusCode).toBe(400);
    expect(tooSoon.json()).toEqual({ code: "INVALID_REQUEST" });

    const applied = await student.request(
      "POST",
      "/api/student/idle-events",
      idleEvent("idle-event-0002")
    );
    expect(applied.statusCode).toBe(201);
    expect(applied.json()).toMatchObject({
      id: "idle-event-0002",
      outcome: "applied",
      starEventId: expect.any(String),
      duplicate: false
    });
    expect(harness.db.prepare(`
      SELECT requested_delta AS requestedDelta, delta, balance_after AS balanceAfter,
             reason_code AS reason, reason_text AS reasonText
      FROM star_events WHERE id = ?
    `).get(applied.json().starEventId)).toMatchObject({
      requestedDelta: -1,
      delta: -1,
      balanceAfter: 2,
      reason: "IDLE_TIMEOUT",
      reasonText: expect.stringContaining("5분")
    });
  });

  it("returns a stored idle result for a changed invalid retry and caps the third fresh event", async () => {
    const { student, studentId } = await authenticateFamily(harness);
    new StarRepository(harness.db).apply({
      studentId,
      delta: 3,
      reason: "GUARDIAN_BONUS",
      reasonText: "시작 별",
      studyDate: "2026-07-15",
      actorType: "guardian",
      sourceKey: "guardian:test:idle-cap-balance",
      createdAt: "2026-07-15T02:50:00.000Z"
    });

    const first = await student.request(
      "POST",
      "/api/student/idle-events",
      idleEvent("idle-event-1001")
    );
    const retry = await student.request(
      "POST",
      "/api/student/idle-events",
      { clientIdleEventId: "idle-event-1001", occurredAt: "invalid" }
    );
    const second = await student.request(
      "POST",
      "/api/student/idle-events",
      idleEvent("idle-event-1002")
    );
    const capped = await student.request(
      "POST",
      "/api/student/idle-events",
      idleEvent("idle-event-1003")
    );

    expect(first.statusCode).toBe(201);
    expect(retry.statusCode).toBe(200);
    expect(retry.json()).toEqual({ ...first.json(), duplicate: true });
    expect(second.json()).toMatchObject({ outcome: "applied" });
    expect(capped.statusCode).toBe(201);
    expect(capped.json()).toMatchObject({
      id: "idle-event-1003",
      outcome: "capped",
      starEventId: null,
      duplicate: false
    });
    expect(harness.db.prepare(`
      SELECT outcome, COUNT(*) AS count FROM idle_events GROUP BY outcome
    `).all()).toEqual([
      { outcome: "applied", count: 2 },
      { outcome: "capped", count: 1 }
    ]);
    expect(harness.db.prepare(`
      SELECT COUNT(*) AS count FROM star_events WHERE reason_code = 'IDLE_TIMEOUT'
    `).get()).toEqual({ count: 2 });
  });

  it("validates idle ordering, future time, KST date, and published content", async () => {
    const { student } = await authenticateFamily(harness);
    const invalidInputs = [
      idleEvent("idle-invalid-0001", {
        idleStartedAt: "2026-07-15T03:01:00.000Z"
      }),
      idleEvent("idle-invalid-0002", {
        idleStartedAt: "2026-07-15T03:00:01.000Z",
        occurredAt: "2026-07-15T03:05:01.000Z"
      }),
      idleEvent("idle-invalid-0003", { studyDate: "2026-07-14" }),
      idleEvent("idle-invalid-0004", { itemId: "missing-item" })
    ];
    harness.db.prepare(
      "UPDATE content_items SET status = 'archived' WHERE id = 'ko-02'"
    ).run();
    invalidInputs.push(idleEvent("idle-invalid-0005", { itemId: "ko-02" }));

    for (const input of invalidInputs) {
      const response = await student.request(
        "POST",
        "/api/student/idle-events",
        input
      );
      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ code: "INVALID_REQUEST" });
    }
    expect(harness.db.prepare(
      "SELECT COUNT(*) AS count FROM idle_events"
    ).get()).toEqual({ count: 0 });
  });

  it("counts zero-balance audits toward the two-event daily cap", async () => {
    const { student } = await authenticateFamily(harness);
    const first = await student.request(
      "POST",
      "/api/student/idle-events",
      idleEvent("idle-no-balance-0001")
    );
    const second = await student.request(
      "POST",
      "/api/student/idle-events",
      idleEvent("idle-no-balance-0002")
    );
    const capped = await student.request(
      "POST",
      "/api/student/idle-events",
      idleEvent("idle-no-balance-0003")
    );

    expect(first.json()).toMatchObject({ outcome: "no-balance" });
    expect(second.json()).toMatchObject({ outcome: "no-balance" });
    expect(capped.json()).toMatchObject({ outcome: "capped" });
    expect(harness.db.prepare(`
      SELECT COUNT(*) AS count FROM star_events
      WHERE reason_code = 'NO_BALANCE_AUDIT' AND reason_text LIKE '%5분%'
    `).get()).toEqual({ count: 2 });
  });

  it("creates two ordered missed-plan candidates only after the KST cutoff and is idempotent", async () => {
    const { student, studentId } = await authenticateFamily(harness);
    expect((await student.request(
      "GET",
      "/api/student/today?date=2026-07-14"
    )).statusCode).toBe(200);
    const { generateMissedPlanCandidates } = await import(
      "../../src/server/stars/maintenance"
    );

    expect(generateMissedPlanCandidates(
      harness.db,
      "2026-07-14",
      new Date("2026-07-14T20:59:59.999Z")
    )).toBe(0);
    expect(generateMissedPlanCandidates(
      harness.db,
      "2026-07-14",
      new Date("2026-07-14T21:00:00.000Z")
    )).toBe(2);
    expect(generateMissedPlanCandidates(
      harness.db,
      "2026-07-14",
      new Date("2026-07-15T03:00:00.000Z")
    )).toBe(0);

    const expected = harness.db.prepare(`
      SELECT item_id AS itemId
      FROM daily_requirements
      WHERE student_id = ? AND study_date = ?
      ORDER BY sort_order, item_id
      LIMIT 2
    `).all(studentId, "2026-07-14") as Array<{ itemId: string }>;
    expect(harness.db.prepare(`
      SELECT item_id AS itemId, requested_stars AS requestedStars, status
      FROM pending_star_adjustments
      WHERE student_id = ? AND study_date = ?
      ORDER BY created_at, rowid
    `).all(studentId, "2026-07-14")).toEqual(
      expected.map(({ itemId }) => ({
        itemId,
        requestedStars: 1,
        status: "pending"
      }))
    );
  });

  it("materializes the default plan before generating candidates for an unopened date", async () => {
    const { studentId } = await authenticateFamily(harness);
    const { generateMissedPlanCandidates } = await import(
      "../../src/server/stars/maintenance"
    );

    expect(harness.db.prepare(`
      SELECT COUNT(*) AS count FROM daily_requirements
      WHERE student_id = ? AND study_date = '2026-07-14'
    `).get(studentId)).toEqual({ count: 0 });
    expect(generateMissedPlanCandidates(
      harness.db,
      "2026-07-14",
      new Date("2026-07-15T03:00:00.000Z")
    )).toBe(2);
    expect(harness.db.prepare(`
      SELECT COUNT(*) AS count FROM daily_requirements
      WHERE student_id = ? AND study_date = '2026-07-14'
    `).get(studentId)).toEqual({ count: 4 });
    expect(harness.db.prepare(`
      SELECT COUNT(*) AS count FROM pending_star_adjustments
      WHERE student_id = ? AND study_date = '2026-07-14'
    `).get(studentId)).toEqual({ count: 2 });
  });

  it("excludes a legacy passing attempt without changing its zero receipt", async () => {
    const legacyDb = openDatabase(":memory:");
    try {
      legacyDb.pragma("foreign_keys = ON");
      initialMigration.up(legacyDb);
      legacyDb.prepare(`
        INSERT INTO schema_migrations (version, applied_at) VALUES (1, ?)
      `).run("2026-07-15T00:00:00.000Z");
      seedInitialContent(legacyDb);
      legacyDb.prepare(`
        INSERT INTO users (id, role, display_name, created_at)
        VALUES ('legacy-student', 'student', '수아', ?)
      `).run("2026-07-15T00:00:00.000Z");

      const studyDate = "2026-07-14";
      const requiredIds = expectedRequiredIds(studyDate);
      const byId = new Map(INITIAL_ITEMS.map((item) => [item.id, item]));
      const passingId = requiredIds.find((candidate) => {
        const firstTwoRemaining = requiredIds
          .filter((itemId) => itemId !== candidate)
          .slice(0, 2)
          .map((itemId) => byId.get(itemId)!.subject);
        return new Set(firstTwoRemaining).size === 2;
      })!;
      const missingIds = requiredIds.filter((itemId) => itemId !== passingId);
      const insertAttempt = legacyDb.prepare(`
        INSERT INTO attempts (
          id, client_attempt_id, user_id, item_id, content_version,
          study_date, reading_score, reading_pass, missed_tokens_json,
          math_answer_json, math_pass, duration_ms, difficulty_feedback,
          created_at
        ) VALUES (?, ?, 'legacy-student', ?, 1, ?, ?, ?, '[]', ?, ?, 12000, NULL, ?)
      `);
      for (const itemId of requiredIds) {
        const item = byId.get(itemId)!;
        const isPassing = itemId === passingId;
        const readingPass = isPassing || item.subject === "math";
        const mathPass = item.subject === "math" ? (isPassing ? 1 : 0) : null;
        insertAttempt.run(
          `legacy-attempt-${itemId}`,
          `legacy-client-${itemId}`,
          itemId,
          studyDate,
          readingPass ? 100 : 0,
          readingPass ? 1 : 0,
          mathPass === null ? null : JSON.stringify(mathPass),
          mathPass,
          "2026-07-14T03:00:00.000Z"
        );
      }

      migrate(legacyDb);
      const { generateMissedPlanCandidates } = await import(
        "../../src/server/stars/maintenance"
      );
      expect(generateMissedPlanCandidates(
        legacyDb,
        studyDate,
        new Date("2026-07-15T03:00:00.000Z")
      )).toBe(2);

      expect(legacyDb.prepare(`
        SELECT item_id AS itemId
        FROM pending_star_adjustments
        WHERE student_id = 'legacy-student' AND study_date = ?
        ORDER BY created_at, rowid
      `).all(studyDate)).toEqual(
        missingIds.slice(0, 2).map((itemId) => ({ itemId }))
      );
      expect(new Set(
        (legacyDb.prepare(`
          SELECT a.reading_pass AS readingPass, a.math_pass AS mathPass
          FROM pending_star_adjustments AS psa
          JOIN attempts AS a
            ON a.user_id = psa.student_id
           AND a.study_date = psa.study_date
           AND a.item_id = psa.item_id
          ORDER BY psa.created_at, psa.rowid
        `).all() as Array<{ readingPass: number; mathPass: number | null }>)
          .map((row) => `${row.readingPass}:${row.mathPass}`)
      )).toEqual(new Set(["0:null", "1:0"]));
      expect(legacyDb.prepare(`
        SELECT awarded, amount, balance, event_id AS eventId
        FROM attempt_star_receipts
        WHERE attempt_id = ?
      `).get(`legacy-attempt-${passingId}`)).toEqual({
        awarded: 0,
        amount: 0,
        balance: 0,
        eventId: null
      });
      expect(legacyDb.prepare(`
        SELECT COUNT(*) AS count FROM star_events
      `).get()).toEqual({ count: 0 });
      expect(generateMissedPlanCandidates(
        legacyDb,
        studyDate,
        new Date("2026-07-15T03:00:00.000Z")
      )).toBe(0);
    } finally {
      legacyDb.close();
    }
  });

  it("approves one candidate idempotently and waives another without a ledger event", async () => {
    const { guardian, student, studentId } = await authenticateFamily(harness);
    await student.request("GET", "/api/student/today?date=2026-07-14");
    const { generateMissedPlanCandidates } = await import(
      "../../src/server/stars/maintenance"
    );
    generateMissedPlanCandidates(
      harness.db,
      "2026-07-14",
      new Date("2026-07-15T03:00:00.000Z")
    );
    new StarRepository(harness.db).apply({
      studentId,
      delta: 2,
      reason: "GUARDIAN_BONUS",
      reasonText: "시작 별",
      studyDate: "2026-07-15",
      actorType: "guardian",
      sourceKey: "guardian:test:approval-balance",
      createdAt: "2026-07-15T02:00:00.000Z"
    });

    const listed = await guardian.request(
      "GET",
      "/api/guardian/star-adjustments"
    );
    expect(listed.statusCode).toBe(200);
    expect(listed.json().adjustments).toHaveLength(2);
    const [approveTarget, waiveTarget] = listed.json().adjustments;

    const tooMany = await guardian.request(
      "POST",
      `/api/guardian/star-adjustments/${approveTarget.id}/approve`,
      { approvedStars: 2, note: "요청보다 큰 승인" }
    );
    expect(tooMany.statusCode).toBe(400);

    const approved = await guardian.request(
      "POST",
      `/api/guardian/star-adjustments/${approveTarget.id}/approve`,
      { approvedStars: 1, note: "1개만 승인" }
    );
    const duplicate = await guardian.request(
      "POST",
      `/api/guardian/star-adjustments/${approveTarget.id}/approve`,
      { approvedStars: 0, note: "재전송의 다른 본문" }
    );
    expect(approved.statusCode).toBe(200);
    expect(approved.json()).toMatchObject({
      status: "approved",
      approvedStars: 1,
      appliedStars: 1,
      starEventId: expect.any(String),
      duplicate: false
    });
    expect(duplicate.json()).toEqual({ ...approved.json(), duplicate: true });

    expect((await guardian.request(
      "POST",
      `/api/guardian/star-adjustments/${waiveTarget.id}/waive`,
      { note: "" }
    )).statusCode).toBe(400);
    const waived = await guardian.request(
      "POST",
      `/api/guardian/star-adjustments/${waiveTarget.id}/waive`,
      { note: "오늘은 충분히 노력했어요" }
    );
    expect(waived.statusCode).toBe(200);
    expect(waived.json()).toMatchObject({
      status: "waived",
      starEventId: null,
      duplicate: false
    });
    expect(harness.db.prepare(`
      SELECT COUNT(*) AS count FROM star_events
      WHERE reason_code = 'MISSED_DAILY_PLAN'
    `).get()).toEqual({ count: 1 });
  });

  it("supports idempotent guardian manual changes and partial and zero-actual reversals", async () => {
    const { guardian } = await authenticateFamily(harness);
    const bonus = await guardian.request(
      "POST",
      "/api/guardian/stars/manual",
      {
        delta: 3,
        reason: "약속을 잘 지켰어요",
        clientCommandId: "guardian-command-0001"
      }
    );
    const bonusRetry = await guardian.request(
      "POST",
      "/api/guardian/stars/manual",
      {
        delta: -99,
        reason: "재전송 본문은 무시되어야 해요",
        clientCommandId: "guardian-command-0001"
      }
    );
    expect(bonus.statusCode).toBe(201);
    expect(bonus.json().event).toMatchObject({
      requestedDelta: 3,
      delta: 3,
      reason: "GUARDIAN_BONUS"
    });
    expect(bonusRetry.statusCode).toBe(200);
    expect(bonusRetry.json()).toEqual({ ...bonus.json(), duplicate: true });

    const adjustment = await guardian.request(
      "POST",
      "/api/guardian/stars/manual",
      {
        delta: -1,
        reason: "보호자 조정",
        clientCommandId: "guardian-command-0002"
      }
    );
    expect(adjustment.json().event.reason).toBe("GUARDIAN_ADJUSTMENT");

    const reversed = await guardian.request(
      "POST",
      `/api/guardian/stars/${bonus.json().event.id}/reverse`,
      { note: "보너스 취소" }
    );
    expect(reversed.statusCode).toBe(201);
    expect(reversed.json().event).toMatchObject({
      requestedDelta: -3,
      delta: -2,
      balanceAfter: 0,
      reason: "REVERSAL",
      reversesEventId: bonus.json().event.id
    });
    expect((await guardian.request(
      "POST",
      `/api/guardian/stars/${bonus.json().event.id}/reverse`,
      { note: "두 번째 취소" }
    )).statusCode).toBe(409);

    const noBalance = await guardian.request(
      "POST",
      "/api/guardian/stars/manual",
      {
        delta: -1,
        reason: "0에서 조정",
        clientCommandId: "guardian-command-0003"
      }
    );
    expect(noBalance.json().event).toMatchObject({
      delta: 0,
      reason: "NO_BALANCE_AUDIT"
    });
    const zeroReversal = await guardian.request(
      "POST",
      `/api/guardian/stars/${noBalance.json().event.id}/reverse`,
      { note: "0으로 적용된 조정도 취소 기록" }
    );
    expect(zeroReversal.json().event).toMatchObject({
      requestedDelta: 0,
      delta: 0,
      reason: "REVERSAL",
      reversesEventId: noBalance.json().event.id
    });
    expect((await guardian.request(
      "POST",
      `/api/guardian/stars/${adjustment.json().event.id}/reverse`,
      { note: "" }
    )).statusCode).toBe(400);
  });

  it("gets and atomically replaces deterministic daily plans until the first required completion", async () => {
    const { guardian, studentId } = await authenticateFamily(harness);
    const initial = await guardian.request(
      "GET",
      "/api/guardian/daily-plans/2026-07-16"
    );
    expect(initial.statusCode).toBe(200);
    expect(initial.json()).toMatchObject({
      studyDate: "2026-07-16",
      koreanTarget: 2,
      mathTarget: 2,
      isRestDay: false
    });
    expect(initial.json().requiredItemIds).toHaveLength(4);

    const updated = await guardian.request(
      "PUT",
      "/api/guardian/daily-plans/2026-07-16",
      { koreanTarget: 1, mathTarget: 3, isRestDay: false }
    );
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({
      studyDate: "2026-07-16",
      koreanTarget: 1,
      mathTarget: 3,
      isRestDay: false
    });
    expect(updated.json().requiredItemIds).toHaveLength(4);
    expect((await guardian.request(
      "GET",
      "/api/guardian/daily-plans/2026-07-16"
    )).json()).toEqual(updated.json());
    expect((await guardian.request(
      "PUT",
      "/api/guardian/daily-plans/2026-07-16",
      { koreanTarget: 11, mathTarget: 0, isRestDay: false }
    )).statusCode).toBe(400);

    new StarRepository(harness.db).apply({
      studentId,
      delta: 1,
      reason: "REQUIRED_ITEM_COMPLETED",
      reasonText: "필수 학습을 완료했어요",
      studyDate: "2026-07-16",
      itemId: updated.json().requiredItemIds[0],
      actorType: "system",
      sourceKey: "required:test:plan-lock",
      createdAt: "2026-07-16T03:00:00.000Z"
    });
    const locked = await guardian.request(
      "PUT",
      "/api/guardian/daily-plans/2026-07-16",
      { koreanTarget: 0, mathTarget: 0, isRestDay: true }
    );
    expect(locked.statusCode).toBe(409);
    expect(locked.json()).toEqual({ code: "PLAN_LOCKED" });
    expect((await guardian.request(
      "GET",
      "/api/guardian/daily-plans/2026-07-16"
    )).json()).toEqual(updated.json());
  });

  it("rejects an impossible guardian plan GET without materializing it", async () => {
    const { guardian } = await authenticateFamily(harness);
    const response = await guardian.request(
      "GET",
      "/api/guardian/daily-plans/2027-02-31"
    );

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ code: "INVALID_REQUEST" });
    expect(harness.db.prepare(`
      SELECT COUNT(*) AS count FROM daily_plan_settings
      WHERE study_date = '2027-02-31'
    `).get()).toEqual({ count: 0 });
    expect(harness.db.prepare(`
      SELECT COUNT(*) AS count FROM daily_requirements
      WHERE study_date = '2027-02-31'
    `).get()).toEqual({ count: 0 });
  });

  it("rejects an impossible guardian plan PUT without persisting it", async () => {
    const { guardian } = await authenticateFamily(harness);
    const response = await guardian.request(
      "PUT",
      "/api/guardian/daily-plans/2027-02-31",
      { koreanTarget: 1, mathTarget: 1, isRestDay: false }
    );

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ code: "INVALID_REQUEST" });
    expect(harness.db.prepare(`
      SELECT COUNT(*) AS count FROM daily_plan_settings
      WHERE study_date = '2027-02-31'
    `).get()).toEqual({ count: 0 });
    expect(harness.db.prepare(`
      SELECT COUNT(*) AS count FROM daily_requirements
      WHERE study_date = '2027-02-31'
    `).get()).toEqual({ count: 0 });
  });

  it("rejects impossible guardian ledger date filters", async () => {
    const { guardian } = await authenticateFamily(harness);
    const [invalidFrom, invalidTo] = await Promise.all([
      guardian.request("GET", "/api/guardian/stars?from=2027-02-31"),
      guardian.request("GET", "/api/guardian/stars?to=2027-02-31")
    ]);

    expect([invalidFrom.statusCode, invalidTo.statusCode]).toEqual([400, 400]);
    expect(invalidFrom.json()).toEqual({ code: "INVALID_REQUEST" });
    expect(invalidTo.json()).toEqual({ code: "INVALID_REQUEST" });
  });

  it("defends guardian plan and ledger services from impossible dates", async () => {
    await authenticateFamily(harness);
    const service = new StarService({
      db: harness.db,
      now: () => new Date("2026-07-15T03:00:00.000Z")
    });
    const calls = [
      () => service.getGuardianPlan("2027-02-31"),
      () => service.updateGuardianPlan(
        "2027-02-31",
        { koreanTarget: 1, mathTarget: 1, isRestDay: false },
        "guardian-service-test"
      ),
      () => service.getGuardianStars({
        limit: 100,
        cursor: null,
        from: "2027-02-31",
        to: null,
        direction: "all",
        reason: null
      })
    ];

    expect(calls.map((call) => {
      try {
        call();
        return null;
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    })).toEqual([
      "INVALID_REQUEST",
      "INVALID_REQUEST",
      "INVALID_REQUEST"
    ]);
    expect(harness.db.prepare(`
      SELECT COUNT(*) AS count FROM daily_plan_settings
      WHERE study_date = '2027-02-31'
    `).get()).toEqual({ count: 0 });
    expect(harness.db.prepare(`
      SELECT COUNT(*) AS count FROM daily_requirements
      WHERE study_date = '2027-02-31'
    `).get()).toEqual({ count: 0 });
  });

  it("keeps student stars safe, paginates the guardian ledger, and role-protects every route", async () => {
    const { guardian, student } = await authenticateFamily(harness);
    for (let index = 1; index <= 3; index += 1) {
      expect((await guardian.request(
        "POST",
        "/api/guardian/stars/manual",
        {
          delta: index,
          reason: `보호자 보너스 ${index}`,
          clientCommandId: `guardian-view-command-000${index}`
        }
      )).statusCode).toBe(201);
    }

    const studentView = await student.request("GET", "/api/student/stars");
    expect(studentView.statusCode).toBe(200);
    expect(studentView.json()).toEqual({
      balance: 6,
      earnedToday: 6,
      deductedToday: 0,
      lastReason: CHILD_SAFE_GUARDIAN_REASON
    });
    expect(studentView.json()).not.toHaveProperty("events");

    const filtered = await guardian.request(
      "GET",
      "/api/guardian/stars?from=2026-07-15&to=2026-07-15&direction=earned&reason=GUARDIAN_BONUS&limit=100"
    );
    expect(filtered.statusCode).toBe(200);
    expect(filtered.json().events).toHaveLength(3);
    expect((await guardian.request(
      "GET",
      "/api/guardian/stars?from=2026-07-16&to=2026-07-16"
    )).json().events).toEqual([]);
    expect((await guardian.request(
      "GET",
      "/api/guardian/stars?direction=deducted"
    )).json().events).toEqual([]);
    expect((await guardian.request(
      "GET",
      "/api/guardian/stars?limit=101"
    )).statusCode).toBe(400);

    const firstPage = await guardian.request(
      "GET",
      "/api/guardian/stars?limit=2"
    );
    expect(firstPage.statusCode).toBe(200);
    expect(firstPage.json().summary).toEqual(studentView.json());
    expect(firstPage.json().events).toHaveLength(2);
    expect(firstPage.json().events[0]).toMatchObject({
      requestedDelta: 3,
      actorType: "guardian",
      reasonText: "보호자 보너스 3"
    });
    expect(firstPage.json().nextCursor).toEqual(expect.any(String));
    const secondPage = await guardian.request(
      "GET",
      `/api/guardian/stars?limit=2&cursor=${firstPage.json().nextCursor}`
    );
    expect(secondPage.json().events).toHaveLength(1);
    expect(secondPage.json().nextCursor).toBeNull();

    expect((await harness.client().request(
      "GET",
      "/api/student/stars"
    )).statusCode).toBe(401);
    expect((await guardian.request(
      "GET",
      "/api/student/stars"
    )).statusCode).toBe(403);

    const guardianRoutes: Array<{
      method: "GET" | "POST" | "PUT";
      url: string;
      payload?: Record<string, unknown>;
    }> = [
      { method: "GET", url: "/api/guardian/stars" },
      { method: "GET", url: "/api/guardian/star-adjustments" },
      { method: "POST", url: "/api/guardian/star-adjustments/fake/approve", payload: { approvedStars: 1 } },
      { method: "POST", url: "/api/guardian/star-adjustments/fake/waive", payload: { note: "면제" } },
      { method: "POST", url: "/api/guardian/stars/manual", payload: { delta: 1, reason: "보너스", clientCommandId: "role-command-0001" } },
      { method: "POST", url: "/api/guardian/stars/fake/reverse", payload: { note: "취소" } },
      { method: "GET", url: "/api/guardian/daily-plans/2026-07-16" },
      { method: "PUT", url: "/api/guardian/daily-plans/2026-07-16", payload: { koreanTarget: 2, mathTarget: 2, isRestDay: false } }
    ];
    for (const route of guardianRoutes) {
      expect((await student.request(
        route.method,
        route.url,
        route.payload
      )).statusCode).toBe(403);
    }
  });

  it("redacts guardian-authored notes from both student star summaries", async () => {
    const { guardian, student } = await authenticateFamily(harness);
    const assertStudentViewsAreSafe = async (privateNote: string) => {
      const stars = await student.request("GET", "/api/student/stars");
      const today = await student.request(
        "GET",
        "/api/student/today?date=2026-07-15"
      );
      expect(stars.statusCode).toBe(200);
      expect(today.statusCode).toBe(200);
      expect(stars.json().lastReason).toBe(CHILD_SAFE_GUARDIAN_REASON);
      expect(today.json().stars.lastReason).toBe(CHILD_SAFE_GUARDIAN_REASON);
      expect(JSON.stringify(stars.json())).not.toContain(privateNote);
      expect(JSON.stringify(today.json())).not.toContain(privateNote);
    };

    const manualNote = "PRIVATE-GUARDIAN-MANUAL-NOTE";
    const manual = await guardian.request(
      "POST",
      "/api/guardian/stars/manual",
      {
        delta: 1,
        reason: manualNote,
        clientCommandId: "guardian-private-command-0001"
      }
    );
    expect(manual.statusCode).toBe(201);
    await assertStudentViewsAreSafe(manualNote);

    const reversalNote = "PRIVATE-GUARDIAN-REVERSAL-NOTE";
    const reversal = await guardian.request(
      "POST",
      `/api/guardian/stars/${manual.json().event.id}/reverse`,
      { note: reversalNote }
    );
    expect(reversal.statusCode).toBe(201);
    await assertStudentViewsAreSafe(reversalNote);

    const noBalanceNote = "PRIVATE-GUARDIAN-NO-BALANCE-NOTE";
    const noBalance = await guardian.request(
      "POST",
      "/api/guardian/stars/manual",
      {
        delta: -1,
        reason: noBalanceNote,
        clientCommandId: "guardian-private-command-0002"
      }
    );
    expect(noBalance.statusCode).toBe(201);
    expect(noBalance.json().event.reason).toBe("NO_BALANCE_AUDIT");
    await assertStudentViewsAreSafe(noBalanceNote);

    const ledger = await guardian.request("GET", "/api/guardian/stars");
    expect(ledger.statusCode).toBe(200);
    expect(ledger.json().events.map(
      (event: { reasonText: string }) => event.reasonText
    )).toEqual([noBalanceNote, reversalNote, manualNote]);
  });

  it("writes a zero-balance approval audit and rolls back approval when processing fails", async () => {
    const { guardian, student } = await authenticateFamily(harness);
    await student.request("GET", "/api/student/today?date=2026-07-14");
    const { generateMissedPlanCandidates } = await import(
      "../../src/server/stars/maintenance"
    );
    generateMissedPlanCandidates(
      harness.db,
      "2026-07-14",
      new Date("2026-07-15T03:00:00.000Z")
    );
    const adjustments = (await guardian.request(
      "GET",
      "/api/guardian/star-adjustments"
    )).json().adjustments;

    const noBalance = await guardian.request(
      "POST",
      `/api/guardian/star-adjustments/${adjustments[0].id}/approve`,
      { approvedStars: 1, note: "0일 때도 감사 기록" }
    );
    expect(noBalance.json()).toMatchObject({
      approvedStars: 1,
      appliedStars: 0,
      starEventId: expect.any(String)
    });
    expect(harness.db.prepare(`
      SELECT requested_delta AS requestedDelta, delta, reason_code AS reason
      FROM star_events WHERE id = ?
    `).get(noBalance.json().starEventId)).toEqual({
      requestedDelta: -1,
      delta: 0,
      reason: "NO_BALANCE_AUDIT"
    });

    harness.db.exec(`
      CREATE TRIGGER fail_pending_approval
      BEFORE UPDATE ON pending_star_adjustments
      WHEN NEW.status = 'approved'
      BEGIN
        SELECT RAISE(ABORT, 'FORCED_APPROVAL_FAILURE');
      END;
    `);
    const failed = await guardian.request(
      "POST",
      `/api/guardian/star-adjustments/${adjustments[1].id}/approve`,
      { approvedStars: 1, note: "롤백되어야 함" }
    );
    expect(failed.statusCode).toBe(500);
    expect(harness.db.prepare(`
      SELECT status, star_event_id AS starEventId
      FROM pending_star_adjustments WHERE id = ?
    `).get(adjustments[1].id)).toEqual({
      status: "pending",
      starEventId: null
    });
    expect(harness.db.prepare(`
      SELECT COUNT(*) AS count FROM star_events
      WHERE pending_adjustment_id = ?
    `).get(adjustments[1].id)).toEqual({ count: 0 });
  });

  it("rolls back both settings and requirements when daily plan replacement fails", async () => {
    const { guardian } = await authenticateFamily(harness);
    const before = (await guardian.request(
      "GET",
      "/api/guardian/daily-plans/2026-07-16"
    )).json();
    harness.db.exec(`
      CREATE TRIGGER fail_requirement_insert
      BEFORE INSERT ON daily_requirements
      BEGIN
        SELECT RAISE(ABORT, 'FORCED_REQUIREMENT_FAILURE');
      END;
    `);

    const failed = await guardian.request(
      "PUT",
      "/api/guardian/daily-plans/2026-07-16",
      { koreanTarget: 1, mathTarget: 1, isRestDay: false }
    );
    expect(failed.statusCode).toBe(500);
    harness.db.exec("DROP TRIGGER fail_requirement_insert");
    expect((await guardian.request(
      "GET",
      "/api/guardian/daily-plans/2026-07-16"
    )).json()).toEqual(before);
  });

  it("locks every past daily plan even when no required item was completed", async () => {
    const { guardian } = await authenticateFamily(harness);
    const before = (await guardian.request(
      "GET",
      "/api/guardian/daily-plans/2026-07-14"
    )).json();
    const locked = await guardian.request(
      "PUT",
      "/api/guardian/daily-plans/2026-07-14",
      { koreanTarget: 0, mathTarget: 0, isRestDay: true }
    );
    expect(locked.statusCode).toBe(409);
    expect(locked.json()).toEqual({ code: "PLAN_LOCKED" });
    expect((await guardian.request(
      "GET",
      "/api/guardian/daily-plans/2026-07-14"
    )).json()).toEqual(before);
  });

  it("selects only the previous seven KST dates whose following-day 06:00 cutoff passed", async () => {
    const { getMaintenanceStudyDates } = await import(
      "../../src/server/stars/maintenance"
    );
    expect(getMaintenanceStudyDates(
      new Date("2026-07-15T20:59:59.999Z")
    )).toEqual([
      "2026-07-14",
      "2026-07-13",
      "2026-07-12",
      "2026-07-11",
      "2026-07-10",
      "2026-07-09"
    ]);
    expect(getMaintenanceStudyDates(
      new Date("2026-07-15T21:00:00.000Z")
    )).toEqual([
      "2026-07-15",
      "2026-07-14",
      "2026-07-13",
      "2026-07-12",
      "2026-07-11",
      "2026-07-10",
      "2026-07-09"
    ]);
  });
});
