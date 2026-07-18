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

async function studentLogin(client: TestClient): Promise<void> {
  const response = await client.request("POST", "/api/auth/student/login", {
    pin: "2580"
  });
  expect(response.statusCode).toBe(200);
}

async function today(client: TestClient): Promise<TodayPlan> {
  const response = await client.request("GET", "/api/student/today");
  expect(response.statusCode).toBe(200);
  return response.json() as TodayPlan;
}

function passingAttempt(
  plan: TodayPlan,
  item: TodayPlan["items"][number],
  id: string,
  occurredAt = "2026-07-15T03:05:00.000Z"
) {
  return {
    clientAttemptId: id,
    planId: plan.planId,
    itemId: item.id,
    contentVersion: item.version,
    studyDate: plan.date,
    occurredAt,
    readingScore: 100,
    missedTokens: [],
    mathAnswer: item.payload.kind === "math-story" ? item.payload.answer : null,
    dictationText: item.payload.kind === "korean-dictation"
      ? item.payload.answerText
      : undefined,
    durationMs: 12_000,
    difficultyFeedback: null
  };
}

function attemptEvent(payload: ReturnType<typeof passingAttempt>, sequence: number) {
  return { kind: "attempt" as const, deviceSequence: sequence, legacy: false, payload };
}

describe("predeployment authority integration", () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = await createTestHarness();
  });

  afterEach(async () => {
    await harness.close();
  });

  it("preserves stale A work, waives idle, recovers after revoke, and leaves B authoritative", async () => {
    const guardian = harness.client();
    expect((await guardian.request("POST", "/api/auth/setup", {
      ...FAMILY,
      setupSecret: harness.config.setupSecret
    })).statusCode).toBe(201);
    expect((await guardian.request("POST", "/api/auth/guardian/login", {
      password: FAMILY.password
    })).statusCode).toBe(204);

    const registeredA = await guardian.request(
      "POST",
      "/api/guardian/devices/current",
      { name: "Galaxy Tab A", deviceType: "tablet" }
    );
    expect(registeredA.statusCode).toBe(201);
    const deviceA = registeredA.json() as { publicId: string };
    const tokenA = guardian.cookie("sua_device")!;

    guardian.setCookie("sua_device", "new-browser-for-device-b");
    const registeredB = await guardian.request(
      "POST",
      "/api/guardian/devices/current",
      { name: "Galaxy Tab B", deviceType: "tablet" }
    );
    expect(registeredB.statusCode).toBe(201);
    const tokenB = guardian.cookie("sua_device")!;
    expect((await guardian.request("PUT", "/api/auth/student-pin", {
      pin: "2580"
    })).statusCode).toBe(204);

    const a = harness.client();
    const b = harness.client();
    a.setCookie("sua_device", tokenA);
    b.setCookie("sua_device", tokenB);
    await studentLogin(a);
    await studentLogin(b);
    const planA = await today(a);
    const planB = await today(b);
    expect(planA.planId).not.toBe(planB.planId);
    expect(planA.offlineEpoch).not.toBe(planB.offlineEpoch);

    const requiredA = planA.requiredItemIds.map((id) =>
      planA.items.find((item) => item.id === id)!
    );
    const requiredB = planB.requiredItemIds.map((id) =>
      planB.items.find((item) => item.id === id)!
    );
    expect(requiredA).toHaveLength(6);
    expect(requiredB.map((item) => item.id)).toEqual(
      requiredA.map((item) => item.id)
    );

    const aItem = requiredA[0]!;
    const bFirstItem = requiredB[1]!;
    const preservedSourceItem = requiredA[2]!;
    const bContinuationItem = requiredB[3]!;
    const preservedSourceAttempt = passingAttempt(
      planA,
      preservedSourceItem,
      "attempt-device-a-preserved-0001",
      "2026-07-15T03:05:00.000Z"
    );
    const learningSession = await a.request(
      "POST",
      "/api/student/learning-sessions",
      { planId: planA.planId, itemId: aItem.id, contentVersion: aItem.version }
    );
    expect(learningSession.statusCode).toBe(201);
    const learningSessionId = learningSession.json().learningSessionId as string;

    const bAttempt = await b.request(
      "POST",
      "/api/student/attempts",
      passingAttempt(planB, bFirstItem, "attempt-device-b-first-0001")
    );
    expect(bAttempt.statusCode).toBe(201);
    expect(bAttempt.json()).toMatchObject({
      completed: true,
      activityCursor: 1,
      starAward: { awarded: true, amount: 1, balance: 1 }
    });
    const bAfterFirst = await today(b);
    expect(bAfterFirst).toMatchObject({
      planId: planB.planId,
      offlineEpoch: planB.offlineEpoch,
      activityCursor: 1,
      completedItemIds: [bFirstItem.id],
      stars: {
        balance: 1,
        earnedToday: 1,
        deductedToday: 0,
        lastReason: "필수 학습을 완료했어요"
      }
    });

    harness.advanceTime(5 * 60 * 1_000);
    const staleBatch = {
      clientBatchId: "batch-device-a-stale-0001",
      planId: planA.planId,
      offlineEpoch: planA.offlineEpoch,
      startCursor: planA.activityCursor,
      events: [{
        kind: "idle" as const,
        deviceSequence: 1,
        legacy: false,
        payload: {
          clientIdleEventId: "idle-device-a-stale-0001",
          learningSessionId,
          planId: planA.planId,
          itemId: aItem.id,
          contentVersion: aItem.version,
          studyDate: planA.date,
          idleStartedAt: "2026-07-15T03:00:00.000Z",
          occurredAt: "2026-07-15T03:05:00.000Z"
        }
      }, attemptEvent(
        passingAttempt(planA, aItem, "attempt-device-a-stale-0001", "2026-07-15T03:06:00.000Z"),
        2
      )]
    };
    const stale = await a.request(
      "POST",
      "/api/student/offline-batches",
      staleBatch
    );
    expect(stale.statusCode).toBe(200);
    expect(stale.json()).toMatchObject({
      orderConflict: true,
      receipts: [
        { status: "ORDER_CONFLICT_WAIVED", code: null },
        { status: "APPLIED" }
      ]
    });
    expect(harness.db.prepare(`
      SELECT delta, reason_text AS reasonText
      FROM star_events WHERE idle_event_id = ?
    `).get("idle-device-a-stale-0001")).toEqual({
      delta: 0,
      reasonText: "오프라인 순서 충돌로 차감하지 않았어요"
    });

    const revoked = await guardian.request(
      "POST",
      `/api/guardian/devices/${deviceA.publicId}/revoke`
    );
    expect(revoked.statusCode).toBe(200);
    const revokedStudent = await a.request("GET", "/api/student/stars");
    expect(revokedStudent.statusCode).toBe(403);
    expect(revokedStudent.json()).toEqual({ code: "DEVICE_REVOKED" });
    const revokedLearning = await a.request(
      "POST",
      "/api/student/learning-sessions",
      { planId: planA.planId, itemId: aItem.id, contentVersion: aItem.version }
    );
    expect(revokedLearning.statusCode).toBe(403);
    expect(revokedLearning.json()).toEqual({ code: "DEVICE_REVOKED" });

    guardian.setCookie("sua_device", tokenA);
    const replacement = await guardian.request(
      "POST",
      "/api/guardian/devices/current",
      { name: "Galaxy Tab A 재등록", deviceType: "tablet" }
    );
    expect(replacement.statusCode).toBe(201);
    const replacementToken = guardian.cookie("sua_device")!;
    a.setCookie("sua_device", replacementToken);
    await studentLogin(a);
    const currentA = await today(a);

    const directOldInput = {
      clientBatchId: "batch-device-a-direct-old-0001",
      planId: planA.planId,
      offlineEpoch: planA.offlineEpoch,
      startCursor: planA.activityCursor,
      events: [attemptEvent(preservedSourceAttempt, 3)]
    };
    expect(directOldInput.events[0]!.payload).toEqual(preservedSourceAttempt);
    const directOld = await a.request(
      "POST",
      "/api/student/offline-batches",
      directOldInput
    );
    expect(directOld.statusCode).toBe(409);
    expect(directOld.json()).toEqual({ code: "PLAN_NOT_ISSUED" });

    const recoveryResponse = await a.request(
      "POST",
      "/api/student/recovery-plans",
      { sourcePlanId: planA.planId }
    );
    expect(recoveryResponse.statusCode).toBe(200);
    const recovery = recoveryResponse.json() as TodayPlan;
    const repeatedRecovery = await a.request(
      "POST",
      "/api/student/recovery-plans",
      { sourcePlanId: planA.planId }
    );
    expect(repeatedRecovery.json()).toEqual(recovery);

    const recoveredItem = recovery.items.find((item) =>
      item.id === preservedSourceItem.id
    )!;
    const reboundPreservedAttempt = {
      ...preservedSourceAttempt,
      planId: recovery.planId
    };
    expect({
      ...reboundPreservedAttempt,
      planId: preservedSourceAttempt.planId
    }).toEqual(preservedSourceAttempt);
    const recoveryBatch = {
      clientBatchId: "batch-device-a-recovery-0001",
      planId: recovery.planId,
      offlineEpoch: recovery.offlineEpoch,
      startCursor: recovery.activityCursor,
      events: [{
        kind: "idle" as const,
        deviceSequence: 4,
        legacy: true,
        payload: {
          clientIdleEventId: "idle-device-a-recovery-0001",
          itemId: recoveredItem.id,
          studyDate: recovery.date,
          idleStartedAt: "2026-07-15T03:00:00.000Z",
          occurredAt: "2026-07-15T03:05:00.000Z"
        }
      }, attemptEvent(reboundPreservedAttempt, 5)]
    };
    expect(recoveryBatch.events[1]!.payload).toEqual({
      ...preservedSourceAttempt,
      planId: recovery.planId
    });
    const recovered = await a.request(
      "POST",
      "/api/student/offline-batches",
      recoveryBatch
    );
    expect(recovered.statusCode).toBe(200);
    expect(recovered.json()).toMatchObject({
      activityCursor: 5,
      stars: {
        balance: 5,
        earnedToday: 5,
        deductedToday: 0,
        lastReason: "도전 단계를 모두 맞혔어요"
      },
      processedPlan: { planId: recovery.planId, planKind: "recovery" },
      currentDailyPlan: { planId: currentA.planId },
      receipts: [
        {
          status: "ORDER_CONFLICT_WAIVED",
          idle: { outcome: "order-conflict-waived" }
        },
        {
          clientId: preservedSourceAttempt.clientAttemptId,
          status: "APPLIED",
          attempt: { completed: true, starAward: { amount: 1, balance: 5 } }
        }
      ]
    });
    expect(harness.db.prepare(`
      SELECT client_attempt_id AS clientAttemptId,
             item_id AS itemId,
             content_version AS contentVersion,
             study_date AS studyDate,
             occurred_at AS occurredAt,
             reading_score AS readingScore,
             missed_tokens_json AS missedTokensJson,
             math_answer_json AS mathAnswerJson,
             duration_ms AS durationMs,
             difficulty_feedback AS difficultyFeedback,
             issued_plan_id AS issuedPlanId
      FROM attempts WHERE client_attempt_id = ?
    `).get(preservedSourceAttempt.clientAttemptId)).toEqual({
      clientAttemptId: preservedSourceAttempt.clientAttemptId,
      itemId: preservedSourceAttempt.itemId,
      contentVersion: preservedSourceAttempt.contentVersion,
      studyDate: preservedSourceAttempt.studyDate,
      occurredAt: preservedSourceAttempt.occurredAt,
      readingScore: preservedSourceAttempt.readingScore,
      missedTokensJson: JSON.stringify(preservedSourceAttempt.missedTokens),
      mathAnswerJson: preservedSourceAttempt.mathAnswer === null
        ? null
        : JSON.stringify(preservedSourceAttempt.mathAnswer),
      durationMs: preservedSourceAttempt.durationMs,
      difficultyFeedback: preservedSourceAttempt.difficultyFeedback,
      issuedPlanId: recovery.planId
    });
    const repeatedBatch = await a.request(
      "POST",
      "/api/student/offline-batches",
      recoveryBatch
    );
    expect(repeatedBatch.statusCode).toBe(200);
    expect(repeatedBatch.json()).toMatchObject({ duplicate: true });
    expect(repeatedBatch.json().receipts).toEqual(recovered.json().receipts);

    const bStillCurrent = await today(b);
    const completedBeforeContinuation = planB.items
      .filter((item) => new Set([
        bFirstItem.id,
        aItem.id,
        preservedSourceItem.id
      ]).has(item.id))
      .map((item) => item.id);
    expect(bStillCurrent).toMatchObject({
      planId: planB.planId,
      offlineEpoch: planB.offlineEpoch,
      activityCursor: 5,
      completedItemIds: completedBeforeContinuation,
      stars: {
        balance: 5,
        earnedToday: 5,
        deductedToday: 0,
        lastReason: "도전 단계를 모두 맞혔어요"
      }
    });
    expect(bStillCurrent.activityCursor).toBe(recovered.json().activityCursor);
    expect(bStillCurrent.stars).toEqual(recovered.json().stars);
    expect(harness.db.prepare(`
      SELECT COUNT(*) AS count
      FROM star_events
      WHERE reason_code = 'IDLE_TIMEOUT' OR delta < 0
    `).get()).toEqual({ count: 0 });

    const continuation = await b.request(
      "POST",
      "/api/student/attempts",
      passingAttempt(
        planB,
        bContinuationItem,
        "attempt-device-b-continuation-0001",
        "2026-07-15T03:05:00.000Z"
      )
    );
    expect(continuation.statusCode).toBe(201);
    expect(continuation.json()).toMatchObject({
      completed: true,
      activityCursor: 6,
      starAward: { awarded: true, amount: 1, balance: 6 }
    });
    const bAfterContinuation = await today(b);
    expect(bAfterContinuation).toMatchObject({
      planId: planB.planId,
      offlineEpoch: planB.offlineEpoch,
      activityCursor: 6,
      completedItemIds: [...completedBeforeContinuation, bContinuationItem.id],
      stars: {
        balance: 6,
        earnedToday: 6,
        deductedToday: 0,
        lastReason: "필수 학습을 완료했어요"
      }
    });
  });

  it("projects only stable redacted rejection summaries for guardians", async () => {
    const guardian = harness.client();
    expect((await guardian.request("POST", "/api/auth/setup", {
      ...FAMILY,
      setupSecret: harness.config.setupSecret
    })).statusCode).toBe(201);
    expect((await guardian.request("POST", "/api/auth/guardian/login", {
      password: FAMILY.password
    })).statusCode).toBe(204);
    const registration = await guardian.request(
      "POST",
      "/api/guardian/devices/current",
      { name: "거절 조회 태블릿", deviceType: "tablet" }
    );
    const deviceToken = guardian.cookie("sua_device")!;
    expect((await guardian.request("PUT", "/api/auth/student-pin", {
      pin: "2580"
    })).statusCode).toBe(204);
    const student = harness.client();
    student.setCookie("sua_device", deviceToken);
    await studentLogin(student);
    const plan = await today(student);
    const studentId = (harness.db.prepare(
      "SELECT id FROM users WHERE role = 'student'"
    ).get() as { id: string }).id;
    const deviceId = (harness.db.prepare(`
      SELECT id FROM trusted_devices WHERE public_id = ?
    `).get(registration.json().publicId) as { id: string }).id;
    harness.db.prepare(`
      INSERT INTO offline_batches (
        client_batch_id, request_fingerprint, student_id,
        original_device_id, submitting_device_id, plan_id, offline_epoch,
        start_cursor, end_cursor, outcome, response_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 2, 'rejected', '{}', ?)
    `).run(
      "batch-rejection-projection-0001",
      "fingerprint",
      studentId,
      deviceId,
      deviceId,
      plan.planId,
      plan.offlineEpoch,
      "2026-07-15T03:10:00.000Z"
    );
    const insert = harness.db.prepare(`
      INSERT INTO offline_activity_receipts (
        student_id, client_event_id, client_batch_id, study_date,
        item_id, kind, status, code, receipt_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'rejected', ?, ?, ?)
    `);
    for (const [id, itemId, kind, code] of [
      ["rejection-b", plan.items[1]!.id, "attempt", "PLAN_SUBMISSION_EXPIRED"],
      ["rejection-a", plan.items[0]!.id, "idle", "PLAN_NOT_ISSUED"]
    ] as const) {
      insert.run(
        studentId,
        id,
        "batch-rejection-projection-0001",
        plan.date,
        itemId,
        kind,
        code,
        JSON.stringify({
          receipt_json: "must-not-cross",
          answer: 15,
          missedTokens: ["비밀 표현"],
          transcript: "전체 음성 전사",
          sessionId: "learning-session-secret",
          token: "opaque-token-secret"
        }),
        "2026-07-15T03:10:00.000Z"
      );
    }
    insert.run(
      studentId,
      "waiver-not-rejection",
      "batch-rejection-projection-0001",
      plan.date,
      plan.items[2]!.id,
      "idle",
      "ORDER_CONFLICT_WAIVED",
      "{}",
      "2026-07-15T03:11:00.000Z"
    );
    harness.db.prepare(`
      UPDATE offline_activity_receipts
      SET status = 'order_conflict_waived'
      WHERE client_event_id = 'waiver-not-rejection'
    `).run();

    const anonymous = await harness.client().request(
      "GET",
      "/api/guardian/offline-rejections"
    );
    expect(anonymous.statusCode).toBe(401);
    const studentDenied = await student.request(
      "GET",
      "/api/guardian/offline-rejections"
    );
    expect(studentDenied.statusCode).toBe(403);

    for (const limit of ["0", "101", "1.5", "abc"]) {
      const invalid = await guardian.request(
        "GET",
        `/api/guardian/offline-rejections?limit=${limit}`
      );
      expect(invalid.statusCode).toBe(400);
      expect(invalid.json()).toEqual({ code: "INVALID_REQUEST" });
    }

    const response = await guardian.request(
      "GET",
      "/api/guardian/offline-rejections?limit=100"
    );
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      rejections: [{
        id: "rejection-b",
        studyDate: plan.date,
        itemId: plan.items[1]!.id,
        itemTitle: plan.items[1]!.payload.title,
        kind: "attempt",
        code: "PLAN_SUBMISSION_EXPIRED",
        createdAt: "2026-07-15T03:10:00.000Z"
      }, {
        id: "rejection-a",
        studyDate: plan.date,
        itemId: plan.items[0]!.id,
        itemTitle: plan.items[0]!.payload.title,
        kind: "idle",
        code: "PLAN_NOT_ISSUED",
        createdAt: "2026-07-15T03:10:00.000Z"
      }]
    });
    expect(JSON.stringify(response.json())).not.toMatch(
      /receipt_json|answer|missedTokens|비밀 표현|transcript|session|opaque-token/i
    );
    const one = await guardian.request(
      "GET",
      "/api/guardian/offline-rejections?limit=1"
    );
    expect(one.json().rejections).toHaveLength(1);
    expect(one.json().rejections[0].id).toBe("rejection-b");
  });

  it("keeps one complete batch idempotent across KST midnight and the yesterday cutoff", async () => {
    const client = harness.client();
    expect((await client.request("POST", "/api/auth/setup", {
      ...FAMILY,
      setupSecret: harness.config.setupSecret
    })).statusCode).toBe(201);
    expect((await client.request("POST", "/api/auth/guardian/login", {
      password: FAMILY.password
    })).statusCode).toBe(204);
    expect((await client.request("POST", "/api/guardian/devices/current", {
      name: "KST 경계 태블릿", deviceType: "tablet"
    })).statusCode).toBe(201);
    expect((await client.request("PUT", "/api/auth/student-pin", {
      pin: "2580"
    })).statusCode).toBe(204);
    expect((await client.request("POST", "/api/auth/logout")).statusCode)
      .toBe(204);
    await studentLogin(client);

    const yesterday = await today(client);
    const completeBatch = {
      clientBatchId: "batch-kst-boundary-complete-0001",
      planId: yesterday.planId,
      offlineEpoch: yesterday.offlineEpoch,
      startCursor: yesterday.activityCursor,
      events: [attemptEvent(passingAttempt(
        yesterday,
        yesterday.items[0]!,
        "attempt-kst-boundary-complete-0001"
      ), 1)]
    };

    harness.advanceTime(11 * 60 * 60 * 1_000 + 59 * 60 * 1_000 + 59 * 1_000);
    expect((await client.request(
      "POST",
      "/api/student/offline-batches",
      completeBatch
    )).statusCode).toBe(200);
    harness.advanceTime(1_000);
    const midnightBlocked = await client.request(
      "POST",
      "/api/student/offline-batches",
      completeBatch
    );
    expect(midnightBlocked.statusCode).toBe(409);
    expect(midnightBlocked.json()).toEqual({ code: "CURRENT_DAILY_PLAN_REQUIRED" });

    const current = await today(client);
    expect(current.date).not.toBe(yesterday.date);
    const accepted = await client.request(
      "POST",
      "/api/student/offline-batches",
      completeBatch
    );
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json()).toMatchObject({
      duplicate: true,
      processedPlan: { planId: yesterday.planId },
      currentDailyPlan: { planId: current.planId }
    });
    const canonicalReceipts = accepted.json().receipts;

    harness.advanceTime(24 * 60 * 60 * 1_000 - 1);
    const atCutoff = await client.request(
      "POST",
      "/api/student/offline-batches",
      completeBatch
    );
    expect(atCutoff.statusCode).toBe(200);
    expect(atCutoff.json()).toMatchObject({ duplicate: true });
    expect(atCutoff.json().receipts).toEqual(canonicalReceipts);

    harness.advanceTime(1);
    expect((await client.request(
      "POST",
      "/api/student/offline-batches",
      completeBatch
    )).json()).toEqual({ code: "CURRENT_DAILY_PLAN_REQUIRED" });
    await today(client);
    const afterCutoffRetry = await client.request(
      "POST",
      "/api/student/offline-batches",
      completeBatch
    );
    expect(afterCutoffRetry.statusCode).toBe(200);
    expect(afterCutoffRetry.json()).toMatchObject({ duplicate: true });
    expect(afterCutoffRetry.json().receipts).toEqual(canonicalReceipts);

    const newExpiredBatch = {
      ...completeBatch,
      clientBatchId: "batch-kst-boundary-expired-0002",
      events: [attemptEvent(passingAttempt(
        yesterday,
        yesterday.items[1]!,
        "attempt-kst-boundary-expired-0002"
      ), 2)]
    };
    const expired = await client.request(
      "POST",
      "/api/student/offline-batches",
      newExpiredBatch
    );
    expect(expired.statusCode).toBe(200);
    expect(expired.json()).toMatchObject({
      duplicate: false,
      receipts: [{ status: "REJECTED", code: "PLAN_SUBMISSION_EXPIRED" }]
    });
  });
});
