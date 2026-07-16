import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  OfflineBatchInput,
  TodayPlan
} from "../../src/shared/learning";
import { kstDayBounds } from "../../src/shared/study-date";
import { OfflineBatchService } from "../../src/server/offline/service";
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

async function bootstrapStudent(
  harness: Harness,
  client: TestClient,
  deviceName = "수아 갤럭시 탭"
): Promise<{ publicId: string }> {
  expect((await client.request("POST", "/api/auth/setup", {
    ...FAMILY,
    setupSecret: harness.config.setupSecret
  })).statusCode).toBe(201);
  expect((await client.request("POST", "/api/auth/guardian/login", {
    password: FAMILY.password
  })).statusCode).toBe(204);
  const registration = await client.request(
    "POST",
    "/api/guardian/devices/current",
    { name: deviceName }
  );
  expect(registration.statusCode).toBe(201);
  expect((await client.request("PUT", "/api/auth/student-pin", {
    pin: "2580"
  })).statusCode).toBe(204);
  expect((await client.request("POST", "/api/auth/logout")).statusCode)
    .toBe(204);
  expect((await client.request("POST", "/api/auth/student/login", {
    pin: "2580"
  })).statusCode).toBe(200);
  return registration.json() as { publicId: string };
}

async function loginStudentOnNewDevice(
  client: TestClient,
  deviceName: string
): Promise<{ publicId: string }> {
  expect((await client.request("POST", "/api/auth/guardian/login", {
    password: FAMILY.password
  })).statusCode).toBe(204);
  const registration = await client.request(
    "POST",
    "/api/guardian/devices/current",
    { name: deviceName }
  );
  expect(registration.statusCode).toBe(201);
  expect((await client.request("POST", "/api/auth/logout")).statusCode)
    .toBe(204);
  expect((await client.request("POST", "/api/auth/student/login", {
    pin: "2580"
  })).statusCode).toBe(200);
  return registration.json() as { publicId: string };
}

async function getToday(client: TestClient): Promise<TodayPlan> {
  const response = await client.request("GET", "/api/student/today");
  expect(response.statusCode).toBe(200);
  return response.json() as TodayPlan;
}

async function issueLearningSession(
  client: TestClient,
  plan: TodayPlan,
  item: TodayPlan["items"][number]
): Promise<{ learningSessionId: string }> {
  const response = await client.request(
    "POST",
    "/api/student/learning-sessions",
    {
      planId: plan.planId,
      itemId: item.id,
      contentVersion: item.version
    }
  );
  expect(response.statusCode).toBe(201);
  return response.json() as { learningSessionId: string };
}

function passingAttempt(
  plan: TodayPlan,
  item: TodayPlan["items"][number],
  clientAttemptId: string,
  occurredAt = "2026-07-15T03:05:00.000Z",
  overrides: Record<string, unknown> = {}
) {
  return {
    clientAttemptId,
    planId: plan.planId,
    itemId: item.id,
    contentVersion: item.version,
    studyDate: plan.date,
    occurredAt,
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

function idlePayload(
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
    idleStartedAt: "2026-07-15T02:55:00.000Z",
    occurredAt: "2026-07-15T03:00:00.000Z",
    ...overrides
  };
}

function attemptEvent(
  payload: ReturnType<typeof passingAttempt>,
  deviceSequence: number,
  legacy = false
) {
  return { kind: "attempt", deviceSequence, legacy, payload };
}

function idleEvent(
  payload: ReturnType<typeof idlePayload> | Record<string, unknown>,
  deviceSequence: number,
  legacy = false
) {
  return { kind: "idle", deviceSequence, legacy, payload };
}

function batch(
  plan: TodayPlan,
  clientBatchId: string,
  events: unknown[],
  overrides: Record<string, unknown> = {}
) {
  return {
    clientBatchId,
    planId: plan.planId,
    offlineEpoch: plan.offlineEpoch,
    startCursor: plan.activityCursor,
    events,
    ...overrides
  };
}

function studentId(harness: Harness): string {
  return (harness.db.prepare(
    "SELECT id FROM users WHERE role = 'student'"
  ).get() as { id: string }).id;
}

function insertUnissuedPublishedItem(
  harness: Harness,
  template: TodayPlan["items"][number],
  itemId: string
): void {
  const skill = harness.db.prepare(`
    SELECT skill_id AS skillId FROM content_items WHERE id = ?
  `).get(template.id) as { skillId: string };
  harness.db.prepare(`
    INSERT INTO content_items (
      id, skill_id, subject, status, active_version, created_at
    ) VALUES (?, ?, ?, 'published', 1, '2026-07-15T03:01:00.000Z')
  `).run(itemId, skill.skillId, template.payload.subject);
  harness.db.prepare(`
    INSERT INTO content_versions (item_id, version, payload_json, created_at)
    VALUES (?, 1, ?, '2026-07-15T03:01:00.000Z')
  `).run(itemId, JSON.stringify({ ...template.payload, id: itemId }));
}

async function revokeDevice(
  harness: Harness,
  publicId: string
): Promise<void> {
  const guardian = harness.client();
  expect((await guardian.request("POST", "/api/auth/guardian/login", {
    password: FAMILY.password
  })).statusCode).toBe(204);
  expect((await guardian.request(
    "POST",
    `/api/guardian/devices/${publicId}/revoke`
  )).statusCode).toBe(200);
}

type MutationCounts = {
  attempts: number;
  idleEvents: number;
  starEvents: number;
  batches: number;
  receipts: number;
  activityCursor: number;
};

function mutationCounts(harness: Harness): MutationCounts {
  return harness.db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM attempts) AS attempts,
      (SELECT COUNT(*) FROM idle_events) AS idleEvents,
      (SELECT COUNT(*) FROM star_events) AS starEvents,
      (SELECT COUNT(*) FROM offline_batches) AS batches,
      (SELECT COUNT(*) FROM offline_activity_receipts) AS receipts,
      (SELECT COALESCE(MAX(current_cursor), 0) FROM student_activity_cursors)
        AS activityCursor
  `).get() as MutationCounts;
}

describe("ordered offline activity batches", () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = await createTestHarness();
  });

  afterEach(async () => {
    await harness.close();
  });

  it("derives authority from payloads, sorts a copied interleaved batch, audits the zero floor, then awards", async () => {
    const student = harness.client();
    await bootstrapStudent(harness, student);
    const plan = await getToday(student);
    const required = plan.items.find((item) =>
      plan.requiredItemIds.includes(item.id)
    )!;
    const session = await issueLearningSession(student, plan, required);
    harness.db.prepare(`
      UPDATE issued_learning_sessions
      SET issued_at = '2026-07-15T02:50:00.000Z',
          active_until = '2026-07-15T08:50:00.000Z'
      WHERE id = ?
    `).run(session.learningSessionId);
    harness.advanceTime(5 * 60 * 1_000);
    const idle = idlePayload(
      plan,
      required,
      session.learningSessionId,
      "idle-offline-order-0001"
    );
    const attempt = passingAttempt(
      plan,
      required,
      "attempt-offline-order-0001"
    );
    const inputEvents = [
      {
        ...attemptEvent(attempt, 20),
        clientId: "outer-client-id-must-be-ignored",
        occurredAt: "2099-01-01T00:00:00.000Z"
      },
      {
        ...idleEvent(idle, 10),
        clientId: "outer-idle-id-must-be-ignored",
        occurredAt: "2099-01-01T00:00:00.000Z"
      }
    ];
    const original = structuredClone(inputEvents);

    const response = await student.request(
      "POST",
      "/api/student/offline-batches",
      batch(plan, "batch-order-zero-floor-0001", inputEvents)
    );

    expect(response.statusCode).toBe(200);
    expect(inputEvents).toEqual(original);
    expect(response.json()).toMatchObject({
      duplicate: false,
      orderConflict: false,
      batchEndCursor: 2,
      activityCursor: 2,
      receipts: [
        {
          clientId: idle.clientIdleEventId,
          kind: "idle",
          status: "APPLIED",
          idle: { outcome: "no-balance" }
        },
        {
          clientId: attempt.clientAttemptId,
          kind: "attempt",
          status: "APPLIED",
          attempt: { completed: true }
        }
      ],
      stars: { balance: 1 },
      processedPlan: { planId: plan.planId, stars: { balance: 1 } },
      currentDailyPlan: { planId: plan.planId, stars: { balance: 1 } }
    });
    expect(harness.db.prepare(`
      SELECT requested_delta AS requestedDelta, delta,
             balance_after AS balanceAfter, reason_code AS reason
      FROM star_events ORDER BY rowid
    `).all()).toEqual([
      {
        requestedDelta: -1,
        delta: 0,
        balanceAfter: 0,
        reason: "NO_BALANCE_AUDIT"
      },
      {
        requestedDelta: 1,
        delta: 1,
        balanceAfter: 1,
        reason: "REQUIRED_ITEM_COMPLETED"
      }
    ]);
  });

  it("opens only the outer immediate transaction for a successful required offline attempt", async () => {
    const student = harness.client();
    await bootstrapStudent(harness, student);
    const plan = await getToday(student);
    const required = plan.items.find((item) =>
      plan.requiredItemIds.includes(item.id)
    )!;
    const transaction = vi.spyOn(harness.db, "transaction");

    const response = await student.request(
      "POST",
      "/api/student/offline-batches",
      batch(plan, "batch-single-transaction-0001", [
        attemptEvent(passingAttempt(
          plan,
          required,
          "attempt-single-transaction-0001"
        ), 1)
      ])
    );

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      receipts: [{ status: "APPLIED", attempt: { completed: true } }],
      stars: { balance: 1 }
    });
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it("uses one canonical batch receive time for every write inside the immediate transaction", async () => {
    const student = harness.client();
    await bootstrapStudent(harness, student);
    const plan = await getToday(student);
    const item = plan.items[0]!;
    const session = await issueLearningSession(student, plan, item);
    let clockCalls = 0;
    const service = new OfflineBatchService({
      db: harness.db,
      now: () => new Date(
        Date.parse("2026-07-15T03:05:00.000Z") + clockCalls++ * 1_000
      )
    });
    const deviceId = (harness.db.prepare(`
      SELECT id FROM trusted_devices WHERE revoked_at IS NULL
    `).get() as { id: string }).id;
    const idle = idlePayload(
      plan,
      item,
      session.learningSessionId,
      "idle-one-batch-clock-0001",
      {
        idleStartedAt: "2026-07-15T03:00:00.000Z",
        occurredAt: "2026-07-15T03:05:00.000Z"
      }
    );

    service.apply(studentId(harness), deviceId, batch(
      plan,
      "batch-one-receive-time-0001",
      [idleEvent(idle, 1)]
    ) as OfflineBatchInput);

    expect(clockCalls).toBe(1);
    expect(harness.db.prepare(`
      SELECT b.created_at AS batchCreatedAt,
             se.created_at AS starCreatedAt,
             ie.created_at AS idleCreatedAt
      FROM offline_batches AS b
      JOIN idle_events AS ie ON ie.id = ?
      JOIN star_events AS se ON se.id = ie.star_event_id
      WHERE b.client_batch_id = ?
    `).get(idle.clientIdleEventId, "batch-one-receive-time-0001"))
      .toEqual({
        batchCreatedAt: "2026-07-15T03:05:00.000Z",
        starCreatedAt: "2026-07-15T03:05:00.000Z",
        idleCreatedAt: "2026-07-15T03:05:00.000Z"
      });
  });

  it("uses timestamp, sequence, and derived ID ordering across items and enforces the daily idle cap", async () => {
    const student = harness.client();
    await bootstrapStudent(harness, student);
    const plan = await getToday(student);
    const [firstItem, secondItem] = plan.items;
    const firstSession = await issueLearningSession(student, plan, firstItem!);
    const secondSession = await issueLearningSession(student, plan, secondItem!);
    new StarRepository(harness.db).apply({
      studentId: studentId(harness),
      delta: 3,
      reason: "GUARDIAN_BONUS",
      reasonText: "시작 별",
      studyDate: plan.date,
      actorType: "guardian",
      sourceKey: "guardian:offline-cap-start",
      createdAt: "2026-07-15T02:59:00.000Z"
    });
    harness.advanceTime(5 * 60 * 1_000);
    const sameTime = {
      idleStartedAt: "2026-07-15T03:00:00.000Z",
      occurredAt: "2026-07-15T03:05:00.000Z"
    };
    const first = idlePayload(
      plan,
      firstItem!,
      firstSession.learningSessionId,
      "idle-equal-z-0001",
      sameTime
    );
    const second = idlePayload(
      plan,
      secondItem!,
      secondSession.learningSessionId,
      "idle-equal-a-0001",
      {
        idleStartedAt: "2026-07-15T12:00:00.000+09:00",
        occurredAt: "2026-07-15T12:05:00.000+09:00"
      }
    );
    const third = idlePayload(
      plan,
      firstItem!,
      firstSession.learningSessionId,
      "idle-equal-cap-0001",
      sameTime
    );

    const response = await student.request(
      "POST",
      "/api/student/offline-batches",
      batch(plan, "batch-equal-time-cap-0001", [
        idleEvent(third, 2),
        idleEvent(first, 1),
        idleEvent(second, 1)
      ])
    );

    expect(response.statusCode).toBe(200);
    expect(response.json().receipts.map((receipt: {
      clientId: string;
      idle: { outcome: string };
    }) => [receipt.clientId, receipt.idle.outcome])).toEqual([
      [second.clientIdleEventId, "applied"],
      [first.clientIdleEventId, "applied"],
      [third.clientIdleEventId, "capped"]
    ]);
    expect(response.json()).toMatchObject({
      batchEndCursor: 3,
      stars: { balance: 1 }
    });
  });

  it("rejects 101 events before writes and records a payload-plan mismatch as one rejected event", async () => {
    const student = harness.client();
    await bootstrapStudent(harness, student);
    const plan = await getToday(student);
    const item = plan.items[0]!;
    const tooMany = Array.from({ length: 101 }, (_, index) =>
      attemptEvent(passingAttempt(
        plan,
        item,
        `attempt-too-many-${String(index).padStart(4, "0")}`
      ), index)
    );
    const before = mutationCounts(harness);
    const rejected = await student.request(
      "POST",
      "/api/student/offline-batches",
      batch(plan, "batch-too-many-events-0001", tooMany)
    );
    expect(rejected.statusCode).toBe(400);
    expect(rejected.json()).toEqual({ code: "INVALID_REQUEST" });
    expect(mutationCounts(harness)).toEqual(before);

    const valid = passingAttempt(
      plan,
      item,
      "attempt-after-plan-mismatch-0001"
    );
    const mismatch = passingAttempt(
      plan,
      item,
      "attempt-plan-mismatch-0001",
      "2026-07-15T03:04:00.000Z",
      { planId: "another-plan" }
    );
    const mixed = await student.request(
      "POST",
      "/api/student/offline-batches",
      batch(plan, "batch-one-plan-mismatch-0001", [
        attemptEvent(valid, 2),
        attemptEvent(mismatch, 1)
      ])
    );
    expect(mixed.statusCode).toBe(200);
    expect(mixed.json().receipts).toMatchObject([
      {
        clientId: mismatch.clientAttemptId,
        status: "REJECTED",
        code: "PLAN_NOT_ISSUED",
        attempt: null
      },
      {
        clientId: valid.clientAttemptId,
        status: "APPLIED",
        code: null
      }
    ]);
    expect(mixed.json().batchEndCursor).toBe(2);
  });

  it("commits valid siblings while rejected receipts persist only authoritative plan metadata", async () => {
    const student = harness.client();
    await bootstrapStudent(harness, student);
    const plan = await getToday(student);
    const item = plan.items.find((candidate) =>
      plan.requiredItemIds.includes(candidate.id)
    )!;
    const unrelatedItemId = "unissued-existing-item";
    const unknownItemId = "unknown-sensitive-item";
    insertUnissuedPublishedItem(harness, item, unrelatedItemId);
    const valid = passingAttempt(
      plan,
      item,
      "attempt-valid-mixed-0001"
    );
    const unknown = passingAttempt(
      plan,
      item,
      "attempt-unknown-mixed-0001",
      "2026-07-15T03:05:00.000Z",
      {
        itemId: unknownItemId,
        mathAnswer: 424242,
        missedTokens: ["LEAKED_UNKNOWN_TOKEN"],
        transcript: "LEAKED_TRANSCRIPT",
        learningSessionId: "LEAKED_SESSION_ID",
        deviceId: "LEAKED_DEVICE_ID"
      }
    );
    const unrelated = passingAttempt(
      plan,
      item,
      "attempt-unrelated-mixed-0001",
      "2026-07-15T03:05:00.000Z",
      { itemId: unrelatedItemId, missedTokens: ["LEAKED_UNRELATED_TOKEN"] }
    );
    const wrongDate = passingAttempt(
      plan,
      item,
      "attempt-wrong-date-mixed-0001",
      "2026-07-15T03:05:00.000Z",
      { studyDate: "2026-07-14", missedTokens: ["LEAKED_DATE_TOKEN"] }
    );
    const wrongVersion = passingAttempt(
      plan,
      item,
      "attempt-wrong-version-mixed-0001",
      "2026-07-15T03:05:00.000Z",
      {
        contentVersion: item.version + 100,
        missedTokens: ["LEAKED_VERSION_TOKEN"]
      }
    );

    const response = await student.request(
      "POST",
      "/api/student/offline-batches",
      batch(plan, "batch-authoritative-metadata-0001", [
        attemptEvent(valid, 1),
        attemptEvent(unknown, 2),
        attemptEvent(unrelated, 3),
        attemptEvent(wrongDate, 4),
        attemptEvent(wrongVersion, 5)
      ])
    );

    expect(response.statusCode).toBe(200);
    expect(response.json().receipts).toMatchObject([
      { clientId: valid.clientAttemptId, status: "APPLIED", code: null },
      {
        clientId: unknown.clientAttemptId,
        status: "REJECTED",
        code: "PLAN_NOT_ISSUED"
      },
      {
        clientId: unrelated.clientAttemptId,
        status: "REJECTED",
        code: "PLAN_NOT_ISSUED"
      },
      {
        clientId: wrongDate.clientAttemptId,
        status: "REJECTED",
        code: "INVALID_REQUEST"
      },
      {
        clientId: wrongVersion.clientAttemptId,
        status: "REJECTED",
        code: "CONTENT_VERSION_CONFLICT"
      }
    ]);
    expect(mutationCounts(harness)).toMatchObject({
      attempts: 1,
      starEvents: 1,
      batches: 1,
      receipts: 5,
      activityCursor: 5
    });
    const rows = harness.db.prepare(`
      SELECT client_event_id AS clientEventId,
             study_date AS studyDate, item_id AS itemId,
             receipt_json AS receiptJson
      FROM offline_activity_receipts
      ORDER BY client_event_id
    `).all() as Array<{
      clientEventId: string;
      studyDate: string;
      itemId: string | null;
      receiptJson: string;
    }>;
    expect(rows.map(({ clientEventId, studyDate, itemId }) => ({
      clientEventId,
      studyDate,
      itemId
    }))).toEqual([
      {
        clientEventId: unknown.clientAttemptId,
        studyDate: plan.date,
        itemId: null
      },
      {
        clientEventId: unrelated.clientAttemptId,
        studyDate: plan.date,
        itemId: null
      },
      {
        clientEventId: valid.clientAttemptId,
        studyDate: plan.date,
        itemId: item.id
      },
      {
        clientEventId: wrongDate.clientAttemptId,
        studyDate: plan.date,
        itemId: item.id
      },
      {
        clientEventId: wrongVersion.clientAttemptId,
        studyDate: plan.date,
        itemId: null
      }
    ]);
    const storedReceiptJson = rows.map((row) => row.receiptJson).join("\n");
    for (const secret of [
      unknownItemId,
      unrelatedItemId,
      "424242",
      "LEAKED_UNKNOWN_TOKEN",
      "LEAKED_UNRELATED_TOKEN",
      "LEAKED_DATE_TOKEN",
      "LEAKED_VERSION_TOKEN",
      "LEAKED_TRANSCRIPT",
      "LEAKED_SESSION_ID",
      "LEAKED_DEVICE_ID"
    ]) {
      expect(storedReceiptJson).not.toContain(secret);
    }
  });

  it("uses receive time for a reconciled legacy attempt and makes a legacy idle waiver-only", async () => {
    const student = harness.client();
    await bootstrapStudent(harness, student);
    const plan = await getToday(student);
    const [attemptItem, idleItem] = plan.items;
    const legacyAttempt = passingAttempt(
      plan,
      attemptItem!,
      "attempt-legacy-reconciled-0001"
    );
    const { planId: _planId, occurredAt: _occurredAt, ...attemptPayload } =
      legacyAttempt;
    const legacyIdle = {
      clientIdleEventId: "idle-legacy-waiver-0001",
      itemId: idleItem!.id,
      studyDate: plan.date,
      idleStartedAt: "2026-07-15T02:55:00.000Z",
      occurredAt: "2026-07-15T03:00:00.000Z"
    };

    const response = await student.request(
      "POST",
      "/api/student/offline-batches",
      batch(plan, "batch-legacy-events-0001", [
        idleEvent(legacyIdle, 1, true),
        attemptEvent(attemptPayload as ReturnType<typeof passingAttempt>, 2, true)
      ])
    );

    expect(response.statusCode).toBe(200);
    expect(response.json().receipts).toMatchObject([
      {
        clientId: legacyIdle.clientIdleEventId,
        status: "ORDER_CONFLICT_WAIVED",
        idle: { outcome: "order-conflict-waived" }
      },
      {
        clientId: legacyAttempt.clientAttemptId,
        status: "APPLIED"
      }
    ]);
    expect(harness.db.prepare(`
      SELECT occurred_at AS occurredAt FROM attempts
      WHERE client_attempt_id = ?
    `).get(legacyAttempt.clientAttemptId)).toEqual({
      occurredAt: "2026-07-15T03:00:00.000Z"
    });
    expect(harness.db.prepare(`
      SELECT learning_session_id AS learningSessionId,
             occurred_at AS occurredAt, outcome
      FROM idle_events WHERE id = ?
    `).get(legacyIdle.clientIdleEventId)).toEqual({
      learningSessionId: null,
      occurredAt: legacyIdle.occurredAt,
      outcome: "order-conflict-waived"
    });
  });

  it("replays immutable batch facts but refreshes cursor, current daily plan, and stars without writes", async () => {
    const firstDevice = harness.client();
    await bootstrapStudent(harness, firstDevice);
    const firstPlan = await getToday(firstDevice);
    const firstRequired = firstPlan.items.find((item) =>
      firstPlan.requiredItemIds.includes(item.id)
    )!;
    const request = batch(firstPlan, "batch-lost-response-0001", [
      attemptEvent(passingAttempt(
        firstPlan,
        firstRequired,
        "attempt-lost-response-0001"
      ), 1)
    ]);
    const first = await firstDevice.request(
      "POST",
      "/api/student/offline-batches",
      request
    );
    expect(first.statusCode).toBe(200);

    const secondDevice = harness.client();
    await loginStudentOnNewDevice(secondDevice, "수아 두 번째 태블릿");
    const secondPlan = await getToday(secondDevice);
    const anotherRequired = secondPlan.items.find((item) =>
      secondPlan.requiredItemIds.includes(item.id) &&
      item.id !== firstRequired.id
    )!;
    const later = await secondDevice.request(
      "POST",
      "/api/student/attempts",
      passingAttempt(
        secondPlan,
        anotherRequired,
        "attempt-after-lost-response-0001",
        "2026-07-15T03:06:00.000Z"
      )
    );
    expect(later.statusCode).toBe(201);
    const beforeRetry = mutationCounts(harness);

    const retry = await firstDevice.request(
      "POST",
      "/api/student/offline-batches",
      request
    );

    expect(retry.statusCode).toBe(200);
    expect(retry.json()).toMatchObject({
      duplicate: true,
      activityCursor: 2,
      batchEndCursor: 1,
      stars: { balance: 2 },
      currentDailyPlan: { planId: firstPlan.planId, stars: { balance: 2 } }
    });
    expect(retry.json().receipts).toEqual(first.json().receipts);
    expect(retry.json().processedPlan).toEqual(first.json().processedPlan);
    expect(retry.json().batchEndCursor).toBe(first.json().batchEndCursor);
    expect(mutationCounts(harness)).toEqual(beforeRetry);
    const stored = JSON.parse((harness.db.prepare(`
      SELECT response_json AS responseJson FROM offline_batches
      WHERE client_batch_id = ?
    `).get(request.clientBatchId) as { responseJson: string }).responseJson);
    expect(stored).toMatchObject({
      receipts: first.json().receipts,
      processedPlan: first.json().processedPlan,
      batchEndCursor: 1
    });
    expect(stored).not.toHaveProperty("activityCursor");
    expect(stored).not.toHaveProperty("currentDailyPlan");
    expect(stored).not.toHaveProperty("stars");
  });

  it("rejects a reused batch ID with any changed canonical envelope and writes nothing", async () => {
    const student = harness.client();
    await bootstrapStudent(harness, student);
    const plan = await getToday(student);
    const item = plan.items[0]!;
    const event = attemptEvent(passingAttempt(
      plan,
      item,
      "attempt-batch-conflict-0001"
    ), 1);
    const original = batch(plan, "batch-fingerprint-conflict-0001", [event]);
    expect((await student.request(
      "POST",
      "/api/student/offline-batches",
      original
    )).statusCode).toBe(200);
    const before = mutationCounts(harness);

    for (const changed of [
      { ...original, offlineEpoch: original.offlineEpoch + 1 },
      { ...original, startCursor: original.startCursor + 1 },
      {
        ...original,
        events: [attemptEvent({
          ...event.payload,
          readingScore: 99
        }, 1)]
      }
    ]) {
      const response = await student.request(
        "POST",
        "/api/student/offline-batches",
        changed
      );
      expect(response.statusCode).toBe(409);
      expect(response.json()).toEqual({ code: "BATCH_ID_CONFLICT" });
      expect(mutationCounts(harness)).toEqual(before);
    }
  });

  it("returns DUPLICATE for an event already committed by another batch and does not advance the cursor", async () => {
    const student = harness.client();
    await bootstrapStudent(harness, student);
    const plan = await getToday(student);
    const event = attemptEvent(passingAttempt(
      plan,
      plan.items[0]!,
      "attempt-event-idempotent-0001"
    ), 1);
    const first = await student.request(
      "POST",
      "/api/student/offline-batches",
      batch(plan, "batch-event-original-0001", [event])
    );
    expect(first.statusCode).toBe(200);
    const second = await student.request(
      "POST",
      "/api/student/offline-batches",
      batch(plan, "batch-event-duplicate-0001", [event], { startCursor: 1 })
    );
    expect(second.statusCode).toBe(200);
    expect(second.json()).toMatchObject({
      batchEndCursor: 1,
      activityCursor: 1,
      receipts: [{
        clientId: event.payload.clientAttemptId,
        status: "DUPLICATE",
        attempt: { duplicate: true }
      }]
    });
  });

  it("advances once when the same exact client event appears twice inside one batch", async () => {
    const student = harness.client();
    await bootstrapStudent(harness, student);
    const plan = await getToday(student);
    const event = attemptEvent(passingAttempt(
      plan,
      plan.items[0]!,
      "attempt-duplicate-in-batch-0001"
    ), 1);

    const response = await student.request(
      "POST",
      "/api/student/offline-batches",
      batch(plan, "batch-duplicate-event-inside-0001", [event, event])
    );

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      batchEndCursor: 1,
      activityCursor: 1,
      receipts: [
        { status: "APPLIED", clientId: event.payload.clientAttemptId },
        { status: "DUPLICATE", clientId: event.payload.clientAttemptId }
      ]
    });
    expect(mutationCounts(harness)).toMatchObject({
      attempts: 1,
      batches: 1,
      receipts: 1,
      activityCursor: 1
    });
  });

  it("preserves attempts but waives valid idles when the batch start cursor is stale", async () => {
    const student = harness.client();
    await bootstrapStudent(harness, student);
    const plan = await getToday(student);
    const item = plan.items[0]!;
    const session = await issueLearningSession(student, plan, item);
    harness.advanceTime(5 * 60 * 1_000);
    const online = await student.request(
      "POST",
      "/api/student/attempts",
      passingAttempt(plan, plan.items[1]!, "attempt-cursor-ahead-0001")
    );
    expect(online.statusCode).toBe(201);
    new StarRepository(harness.db).apply({
      studentId: studentId(harness),
      delta: 2,
      reason: "GUARDIAN_BONUS",
      reasonText: "차감되면 안 되는 별",
      studyDate: plan.date,
      actorType: "guardian",
      sourceKey: "guardian:order-conflict-start",
      createdAt: "2026-07-15T03:04:30.000Z"
    });
    const idle = idlePayload(
      plan,
      item,
      session.learningSessionId,
      "idle-order-conflict-0001",
      {
        idleStartedAt: "2026-07-15T03:00:00.000Z",
        occurredAt: "2026-07-15T03:05:00.000Z"
      }
    );
    const attempt = passingAttempt(
      plan,
      item,
      "attempt-order-conflict-0001",
      "2026-07-15T03:06:00.000Z"
    );

    const response = await student.request(
      "POST",
      "/api/student/offline-batches",
      batch(plan, "batch-order-conflict-0001", [
        attemptEvent(attempt, 2),
        idleEvent(idle, 1)
      ])
    );

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      orderConflict: true,
      batchEndCursor: 3,
      activityCursor: 3,
      receipts: [
        {
          clientId: idle.clientIdleEventId,
          status: "ORDER_CONFLICT_WAIVED",
          idle: { outcome: "order-conflict-waived" }
        },
        {
          clientId: attempt.clientAttemptId,
          status: "APPLIED"
        }
      ],
      stars: { balance: 4 }
    });
    expect(harness.db.prepare(`
      SELECT requested_delta AS requestedDelta, delta,
             reason_code AS reason, reason_text AS reasonText
      FROM star_events WHERE idle_event_id = ?
    `).get(idle.clientIdleEventId)).toEqual({
      requestedDelta: -1,
      delta: 0,
      reason: "NO_BALANCE_AUDIT",
      reasonText: "오프라인 순서 충돌로 차감하지 않았어요"
    });
  });

  it("hard rejects foreign-device, unknown-plan, and mismatched-epoch batches without any write", async () => {
    const firstDevice = harness.client();
    await bootstrapStudent(harness, firstDevice);
    const firstPlan = await getToday(firstDevice);
    const secondDevice = harness.client();
    await loginStudentOnNewDevice(secondDevice, "수아 다른 태블릿");
    const secondPlan = await getToday(secondDevice);
    const event = attemptEvent(passingAttempt(
      secondPlan,
      secondPlan.items[0]!,
      "attempt-hard-rejection-0001"
    ), 1);
    const before = mutationCounts(harness);
    const cases = [
      batch(secondPlan, "batch-foreign-device-0001", [event]),
      {
        ...batch(firstPlan, "batch-unknown-plan-0001", [event]),
        planId: "unknown-plan-id"
      },
      {
        ...batch(firstPlan, "batch-wrong-epoch-0001", [event]),
        offlineEpoch: firstPlan.offlineEpoch + 999
      }
    ];
    for (const input of cases) {
      const response = await firstDevice.request(
        "POST",
        "/api/student/offline-batches",
        input
      );
      expect(response.statusCode).toBe(409);
      expect(["PLAN_NOT_ISSUED", "INVALID_REQUEST"])
        .toContain(response.json().code);
      expect(mutationCounts(harness)).toEqual(before);
    }
  });

  it("rolls back attempts, stars, cursors, event receipts, and the batch on an unexpected persistence error", async () => {
    const student = harness.client();
    await bootstrapStudent(harness, student);
    const plan = await getToday(student);
    harness.db.exec(`
      CREATE TRIGGER fail_offline_batch_insert
      BEFORE INSERT ON offline_batches
      BEGIN
        SELECT RAISE(ABORT, 'FORCED_OFFLINE_BATCH_FAILURE');
      END;
    `);
    const response = await student.request(
      "POST",
      "/api/student/offline-batches",
      batch(plan, "batch-forced-rollback-0001", [
        attemptEvent(passingAttempt(
          plan,
          plan.items.find((item) => plan.requiredItemIds.includes(item.id))!,
          "attempt-forced-rollback-0001"
        ), 1)
      ])
    );
    expect(response.statusCode).toBe(500);
    expect(mutationCounts(harness)).toEqual({
      attempts: 0,
      idleEvents: 0,
      starEvents: 0,
      batches: 0,
      receipts: 0,
      activityCursor: 0
    });
  });

  it("requires the server-current daily plan across KST midnight before writing and accepts the same reservation after refetch", async () => {
    const student = harness.client();
    await bootstrapStudent(harness, student);
    const yesterday = await getToday(student);
    const request = batch(yesterday, "batch-midnight-reservation-0001", [
      attemptEvent(passingAttempt(
        yesterday,
        yesterday.items[0]!,
        "attempt-midnight-reservation-0001"
      ), 1)
    ]);
    harness.advanceTime(11 * 60 * 60 * 1_000 + 59 * 60 * 1_000 + 59 * 1_000);
    expect(mutationCounts(harness).batches).toBe(0);
    harness.advanceTime(1_000);
    const blocked = await student.request(
      "POST",
      "/api/student/offline-batches",
      request
    );
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json()).toEqual({ code: "CURRENT_DAILY_PLAN_REQUIRED" });
    expect(mutationCounts(harness)).toMatchObject({
      attempts: 0,
      batches: 0,
      receipts: 0,
      activityCursor: 0
    });

    const today = await getToday(student);
    expect(today.date).not.toBe(yesterday.date);
    const applied = await student.request(
      "POST",
      "/api/student/offline-batches",
      request
    );
    expect(applied.statusCode).toBe(200);
    expect(applied.json()).toMatchObject({
      clientBatchId: request.clientBatchId,
      processedPlan: { planId: yesterday.planId, date: yesterday.date },
      currentDailyPlan: { planId: today.planId, date: today.date }
    });
  });

  it("stores a same-student expired plan as a terminal 200 rejection receipt", async () => {
    const student = harness.client();
    await bootstrapStudent(harness, student);
    const oldPlan = await getToday(student);
    const oldItem = oldPlan.items[0]!;
    const unrelatedItemId = "expired-unissued-existing-item";
    insertUnissuedPublishedItem(harness, oldItem, unrelatedItemId);
    const valid = passingAttempt(
      oldPlan,
      oldItem,
      "attempt-expired-terminal-0001"
    );
    const unknown = passingAttempt(
      oldPlan,
      oldItem,
      "attempt-expired-unknown-0001",
      "2026-07-15T03:05:00.000Z",
      { itemId: "expired-unknown-sensitive-item" }
    );
    const unrelated = passingAttempt(
      oldPlan,
      oldItem,
      "attempt-expired-unrelated-0001",
      "2026-07-15T03:05:00.000Z",
      { itemId: unrelatedItemId }
    );
    const wrongDate = passingAttempt(
      oldPlan,
      oldItem,
      "attempt-expired-wrong-date-0001",
      "2026-07-15T03:05:00.000Z",
      { studyDate: "2026-07-14" }
    );
    const wrongVersion = passingAttempt(
      oldPlan,
      oldItem,
      "attempt-expired-wrong-version-0001",
      "2026-07-15T03:05:00.000Z",
      { contentVersion: oldItem.version + 100 }
    );
    const request = batch(oldPlan, "batch-expired-terminal-0001", [
      attemptEvent(valid, 1),
      attemptEvent(unknown, 2),
      attemptEvent(unrelated, 3),
      attemptEvent(wrongDate, 4),
      attemptEvent(wrongVersion, 5)
    ]);
    harness.advanceTime(36 * 60 * 60 * 1_000 + 1);
    await getToday(student);

    const first = await student.request(
      "POST",
      "/api/student/offline-batches",
      request
    );
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({
      duplicate: false,
      batchEndCursor: 5,
      receipts: [valid, unknown, unrelated, wrongDate, wrongVersion].map(
        (attempt) => ({
          clientId: attempt.clientAttemptId,
          status: "REJECTED",
          code: "PLAN_SUBMISSION_EXPIRED",
          attempt: null,
          idle: null
        })
      )
    });
    const counts = mutationCounts(harness);
    expect(counts).toMatchObject({
      attempts: 0,
      idleEvents: 0,
      batches: 1,
      receipts: 5,
      activityCursor: 5
    });
    expect(harness.db.prepare(`
      SELECT client_event_id AS clientEventId,
             study_date AS studyDate, item_id AS itemId
      FROM offline_activity_receipts
      ORDER BY client_event_id
    `).all()).toEqual([
      {
        clientEventId: valid.clientAttemptId,
        studyDate: oldPlan.date,
        itemId: oldItem.id
      },
      {
        clientEventId: unknown.clientAttemptId,
        studyDate: oldPlan.date,
        itemId: null
      },
      {
        clientEventId: unrelated.clientAttemptId,
        studyDate: oldPlan.date,
        itemId: null
      },
      {
        clientEventId: wrongDate.clientAttemptId,
        studyDate: oldPlan.date,
        itemId: oldItem.id
      },
      {
        clientEventId: wrongVersion.clientAttemptId,
        studyDate: oldPlan.date,
        itemId: null
      }
    ]);
    const retry = await student.request(
      "POST",
      "/api/student/offline-batches",
      request
    );
    expect(retry.statusCode).toBe(200);
    expect(retry.json().receipts).toEqual(first.json().receipts);
    expect(retry.json().duplicate).toBe(true);
    expect(mutationCounts(harness)).toEqual(counts);
  });

  it("issues constrained idempotent recovery only after explicit source revocation and forces recovered idles to waiver", async () => {
    const sourceClient = harness.client();
    const sourceDevice = await bootstrapStudent(harness, sourceClient);
    const sourcePlan = await getToday(sourceClient);
    const currentClient = harness.client();
    await loginStudentOnNewDevice(currentClient, "수아 복구 태블릿");
    const currentDaily = await getToday(currentClient);

    const stillActive = await currentClient.request(
      "POST",
      "/api/student/recovery-plans",
      { sourcePlanId: sourcePlan.planId }
    );
    expect(stillActive.statusCode).toBe(409);
    expect(stillActive.json()).toEqual({ code: "SOURCE_DEVICE_STILL_ACTIVE" });
    expect(harness.db.prepare(`
      SELECT COUNT(*) AS count FROM issued_daily_plans
      WHERE plan_kind = 'recovery'
    `).get()).toEqual({ count: 0 });

    await revokeDevice(harness, sourceDevice.publicId);

    const issued = await currentClient.request(
      "POST",
      "/api/student/recovery-plans",
      { sourcePlanId: sourcePlan.planId }
    );
    expect(issued.statusCode).toBe(200);
    const recovery = issued.json() as TodayPlan;
    expect(recovery).toMatchObject({
      planKind: "recovery",
      recoverySourcePlanId: sourcePlan.planId,
      date: sourcePlan.date,
      submitUntil: sourcePlan.submitUntil,
      activityCursor: currentDaily.activityCursor,
      completedItemIds: []
    });
    expect(recovery.planId).not.toBe(sourcePlan.planId);
    expect(recovery.offlineEpoch).not.toBe(sourcePlan.offlineEpoch);
    expect(recovery.items).toEqual(sourcePlan.items);
    expect(recovery.requiredItemIds).toEqual(sourcePlan.requiredItemIds);
    expect(JSON.stringify(recovery)).not.toContain(sourceDevice.publicId);
    const duplicateIssue = await currentClient.request(
      "POST",
      "/api/student/recovery-plans",
      { sourcePlanId: sourcePlan.planId }
    );
    expect(duplicateIssue.statusCode).toBe(200);
    expect(duplicateIssue.json()).toEqual(recovery);

    const item = recovery.items[0]!;
    const recoveredAttempt = passingAttempt(
      recovery,
      item,
      "attempt-recovery-preserved-0001"
    );
    const recoveredIdle = {
      clientIdleEventId: "idle-recovery-waived-0001",
      itemId: item.id,
      studyDate: recovery.date,
      idleStartedAt: "2026-07-15T02:55:00.000Z",
      occurredAt: "2026-07-15T03:00:00.000Z"
    };
    const applied = await currentClient.request(
      "POST",
      "/api/student/offline-batches",
      batch(recovery, "batch-recovery-current-device-0001", [
        idleEvent(recoveredIdle, 1, true),
        attemptEvent(recoveredAttempt, 2)
      ])
    );
    expect(applied.statusCode).toBe(200);
    expect(applied.json()).toMatchObject({
      processedPlan: { planId: recovery.planId, planKind: "recovery" },
      currentDailyPlan: {
        planId: currentDaily.planId,
        planKind: "daily",
        completedItemIds: expect.arrayContaining([item.id])
      },
      receipts: [
        {
          clientId: recoveredIdle.clientIdleEventId,
          status: "ORDER_CONFLICT_WAIVED"
        },
        {
          clientId: recoveredAttempt.clientAttemptId,
          status: "APPLIED"
        }
      ]
    });
    expect((await getToday(currentClient)).completedItemIds).toContain(item.id);

    harness.advanceTime(36 * 60 * 60 * 1_000 + 1);
    const expiredRetry = await currentClient.request(
      "POST",
      "/api/student/recovery-plans",
      { sourcePlanId: sourcePlan.planId }
    );
    expect(expiredRetry.statusCode).toBe(409);
    expect(expiredRetry.json()).toEqual({ code: "PLAN_SUBMISSION_EXPIRED" });
    expect(harness.db.prepare(`
      SELECT COUNT(*) AS count FROM issued_daily_plans
      WHERE plan_kind = 'recovery' AND recovery_source_plan_id = ?
    `).get(sourcePlan.planId)).toEqual({ count: 1 });
  });

  it("keeps a same-date old-version recovery attempt historical without completing the newer daily item", async () => {
    const sourceClient = harness.client();
    const sourceDevice = await bootstrapStudent(harness, sourceClient);
    const sourcePlan = await getToday(sourceClient);
    const sourceItem = sourcePlan.items.find((item) =>
      sourcePlan.requiredItemIds.includes(item.id)
    )!;
    const newerVersion = sourceItem.version + 1;
    harness.db.prepare(`
      INSERT INTO content_versions (item_id, version, payload_json, created_at)
      VALUES (?, ?, ?, '2026-07-15T03:01:00.000Z')
    `).run(
      sourceItem.id,
      newerVersion,
      JSON.stringify({
        ...sourceItem.payload,
        title: `${sourceItem.payload.title} 새 버전`
      })
    );
    harness.db.prepare(`
      UPDATE content_items SET active_version = ? WHERE id = ?
    `).run(newerVersion, sourceItem.id);

    const currentClient = harness.client();
    await loginStudentOnNewDevice(currentClient, "수아 새 버전 태블릿");
    const currentDaily = await getToday(currentClient);
    expect(currentDaily.items.find((item) => item.id === sourceItem.id)?.version)
      .toBe(newerVersion);
    await revokeDevice(harness, sourceDevice.publicId);
    const recoveryResponse = await currentClient.request(
      "POST",
      "/api/student/recovery-plans",
      { sourcePlanId: sourcePlan.planId }
    );
    expect(recoveryResponse.statusCode).toBe(200);
    const recovery = recoveryResponse.json() as TodayPlan;
    expect(recovery.items.find((item) => item.id === sourceItem.id)?.version)
      .toBe(sourceItem.version);

    const applied = await currentClient.request(
      "POST",
      "/api/student/offline-batches",
      batch(recovery, "batch-recovery-old-version-0001", [
        attemptEvent(passingAttempt(
          recovery,
          recovery.items.find((item) => item.id === sourceItem.id)!,
          "attempt-recovery-old-version-0001"
        ), 1)
      ])
    );

    expect(applied.statusCode).toBe(200);
    expect(applied.json()).toMatchObject({
      receipts: [{ status: "APPLIED", attempt: { completed: true } }],
      processedPlan: {
        planId: recovery.planId,
        completedItemIds: expect.arrayContaining([sourceItem.id])
      },
      currentDailyPlan: {
        planId: currentDaily.planId,
        completedItemIds: []
      }
    });
    expect(harness.db.prepare(`
      SELECT content_version AS contentVersion,
             issued_plan_id AS issuedPlanId
      FROM attempts WHERE client_attempt_id = ?
    `).get("attempt-recovery-old-version-0001")).toEqual({
      contentVersion: sourceItem.version,
      issuedPlanId: recovery.planId
    });
    expect((await getToday(currentClient)).completedItemIds)
      .not.toContain(sourceItem.id);
  });

  it("returns yesterday recovery as processed while today's daily authority keeps independent completions and stars", async () => {
    const sourceClient = harness.client();
    const sourceDevice = await bootstrapStudent(harness, sourceClient);
    const sourcePlan = await getToday(sourceClient);
    const sourceRequired = sourcePlan.items.find((item) =>
      sourcePlan.requiredItemIds.includes(item.id)
    )!;

    harness.advanceTime(12 * 60 * 60 * 1_000);
    const currentClient = harness.client();
    await loginStudentOnNewDevice(currentClient, "수아 다음날 태블릿");
    const currentDaily = await getToday(currentClient);
    expect(currentDaily.date).not.toBe(sourcePlan.date);
    const currentRequired = currentDaily.items.find((item) =>
      currentDaily.requiredItemIds.includes(item.id) &&
      item.id !== sourceRequired.id
    )!;
    expect(currentRequired).toBeDefined();
    const currentOccurredAt = new Date(
      Date.parse(kstDayBounds(currentDaily.date).start) + 5 * 60 * 1_000
    ).toISOString();
    const currentApplied = await currentClient.request(
      "POST",
      "/api/student/offline-batches",
      batch(currentDaily, "batch-current-day-before-recovery-0001", [
        attemptEvent(passingAttempt(
          currentDaily,
          currentRequired,
          "attempt-current-day-before-recovery-0001",
          currentOccurredAt
        ), 1)
      ])
    );
    expect(currentApplied.statusCode).toBe(200);
    expect(currentApplied.json()).toMatchObject({
      currentDailyPlan: {
        planId: currentDaily.planId,
        completedItemIds: expect.arrayContaining([currentRequired.id]),
        stars: { balance: 1, earnedToday: 1 }
      }
    });

    await revokeDevice(harness, sourceDevice.publicId);
    const recoveryResponse = await currentClient.request(
      "POST",
      "/api/student/recovery-plans",
      { sourcePlanId: sourcePlan.planId }
    );
    expect(recoveryResponse.statusCode).toBe(200);
    const recovery = recoveryResponse.json() as TodayPlan;
    const recoveredRequired = recovery.items.find((item) =>
      item.id === sourceRequired.id
    )!;
    const recoveryApplied = await currentClient.request(
      "POST",
      "/api/student/offline-batches",
      batch(recovery, "batch-yesterday-recovery-0001", [
        attemptEvent(passingAttempt(
          recovery,
          recoveredRequired,
          "attempt-yesterday-recovery-0001"
        ), 2)
      ])
    );

    expect(recoveryApplied.statusCode).toBe(200);
    expect(recoveryApplied.json()).toMatchObject({
      processedPlan: {
        planId: recovery.planId,
        planKind: "recovery",
        date: sourcePlan.date,
        completedItemIds: expect.arrayContaining([sourceRequired.id]),
        stars: { balance: 2, earnedToday: 1 }
      },
      currentDailyPlan: {
        planId: currentDaily.planId,
        planKind: "daily",
        date: currentDaily.date,
        completedItemIds: expect.arrayContaining([currentRequired.id]),
        stars: { balance: 2, earnedToday: 1 }
      },
      stars: { balance: 2, earnedToday: 1 }
    });
    expect(recoveryApplied.json().currentDailyPlan.planId)
      .not.toBe(recovery.planId);
    expect(recoveryApplied.json().currentDailyPlan.completedItemIds)
      .not.toContain(sourceRequired.id);
    expect(recoveryApplied.json().processedPlan.completedItemIds)
      .not.toContain(currentRequired.id);
  });
});
