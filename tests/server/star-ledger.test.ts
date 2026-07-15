import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase } from "../../src/server/db/client";
import { migrate } from "../../src/server/db/migrate";
import { seedInitialContent } from "../../src/server/db/seed";
import { StarRepository } from "../../src/server/stars/repository";
import { StarReasonSchema } from "../../src/shared/stars";

const STUDENT_ID = "student-1";
const GUARDIAN_ID = "guardian-1";
const STUDY_DATE = "2026-07-16";
const CREATED_AT = "2026-07-16T03:00:00.000Z";

describe("append-only star ledger", () => {
  let db: Database.Database;
  let repository: StarRepository;

  beforeEach(() => {
    db = openDatabase(":memory:");
    migrate(db);
    seedInitialContent(db);
    db.prepare(`
      INSERT INTO users (id, role, display_name, created_at)
      VALUES (?, 'guardian', '보호자', ?), (?, 'student', '수아', ?)
    `).run(GUARDIAN_ID, CREATED_AT, STUDENT_ID, CREATED_AT);
    repository = new StarRepository(db);
  });

  afterEach(() => db.close());

  it("exposes the exact supported star reasons", () => {
    expect(StarReasonSchema.options).toEqual([
      "REQUIRED_ITEM_COMPLETED",
      "IDLE_TIMEOUT",
      "MISSED_DAILY_PLAN",
      "GUARDIAN_BONUS",
      "GUARDIAN_ADJUSTMENT",
      "REWARD_REDEMPTION",
      "REVERSAL",
      "NO_BALANCE_AUDIT"
    ]);
  });

  it("returns the original event when the same source is applied twice", () => {
    const input = {
      studentId: STUDENT_ID,
      delta: 1,
      reason: "REQUIRED_ITEM_COMPLETED" as const,
      reasonText: "필수 학습을 완료했어요",
      studyDate: STUDY_DATE,
      itemId: "ko-01",
      actorType: "system" as const,
      sourceKey: `required:${STUDENT_ID}:${STUDY_DATE}:ko-01`,
      createdAt: CREATED_AT
    };

    const first = repository.apply(input);
    const duplicate = repository.apply(input);

    expect(first).toMatchObject({
      duplicate: false,
      event: {
        delta: 1,
        balanceAfter: 1,
        reason: "REQUIRED_ITEM_COMPLETED",
        itemId: "ko-01",
        reversesEventId: null
      }
    });
    expect(duplicate).toEqual({ event: first.event, duplicate: true });
    expect(
      db.prepare("SELECT COUNT(*) AS count FROM star_events").get()
    ).toEqual({ count: 1 });
    expect(
      db.prepare(`
        SELECT balance
        FROM student_star_balances
        WHERE student_id = ?
      `).get(STUDENT_ID)
    ).toEqual({ balance: 1 });
  });

  it("clamps deductions at zero and records later requests as audits", () => {
    repository.apply({
      studentId: STUDENT_ID,
      delta: 1,
      reason: "GUARDIAN_BONUS",
      reasonText: "시작 별",
      studyDate: STUDY_DATE,
      actorType: "guardian",
      actorUserId: GUARDIAN_ID,
      sourceKey: "guardian:guardian-1:starting-star",
      createdAt: CREATED_AT
    });

    const clamped = repository.apply({
      studentId: STUDENT_ID,
      delta: -2,
      reason: "IDLE_TIMEOUT",
      reasonText: "5분 동안 활동이 없었어요",
      studyDate: STUDY_DATE,
      itemId: "ko-01",
      actorType: "system",
      sourceKey: "idle:student-1:idle-event-0001",
      createdAt: "2026-07-16T03:05:00.000Z"
    });
    const noBalance = repository.apply({
      studentId: STUDENT_ID,
      delta: -1,
      reason: "IDLE_TIMEOUT",
      reasonText: "5분 동안 활동이 없었어요",
      studyDate: STUDY_DATE,
      itemId: "ko-01",
      actorType: "system",
      sourceKey: "idle:student-1:idle-event-0002",
      createdAt: "2026-07-16T03:10:00.000Z"
    });

    expect(clamped).toMatchObject({
      duplicate: false,
      event: { delta: -1, balanceAfter: 0, reason: "IDLE_TIMEOUT" }
    });
    expect(noBalance).toMatchObject({
      duplicate: false,
      event: { delta: 0, balanceAfter: 0, reason: "NO_BALANCE_AUDIT" }
    });
    expect(
      db.prepare(`
        SELECT b.balance, SUM(e.delta) AS ledgerTotal
        FROM student_star_balances AS b
        JOIN star_events AS e ON e.student_id = b.student_id
        WHERE b.student_id = ?
        GROUP BY b.student_id
      `).get(STUDENT_ID)
    ).toEqual({ balance: 0, ledgerTotal: 0 });
  });

  it("reverses an event once by appending a linked opposite event", () => {
    const earned = repository.apply({
      studentId: STUDENT_ID,
      delta: 1,
      reason: "REQUIRED_ITEM_COMPLETED",
      reasonText: "필수 학습을 완료했어요",
      studyDate: STUDY_DATE,
      itemId: "ko-01",
      actorType: "system",
      sourceKey: `required:${STUDENT_ID}:${STUDY_DATE}:ko-01`,
      createdAt: CREATED_AT
    });

    const reversed = repository.reverse(
      earned.event.id,
      GUARDIAN_ID,
      "잘못 지급된 별",
      new Date("2026-07-16T04:00:00.000Z")
    );

    expect(reversed).toMatchObject({
      duplicate: false,
      event: {
        delta: -1,
        balanceAfter: 0,
        reason: "REVERSAL",
        reasonText: "잘못 지급된 별",
        actorType: "guardian",
        reversesEventId: earned.event.id,
        createdAt: "2026-07-16T04:00:00.000Z"
      }
    });
    expect(() =>
      repository.reverse(
        earned.event.id,
        GUARDIAN_ID,
        "다시 취소",
        new Date("2026-07-16T05:00:00.000Z")
      )
    ).toThrowError("EVENT_ALREADY_REVERSED");
    expect(
      db.prepare("SELECT COUNT(*) AS count FROM star_events").get()
    ).toEqual({ count: 2 });
    expect(
      db.prepare(`
        SELECT delta, reason_code AS reason, reverses_event_id AS reversesEventId
        FROM star_events
        ORDER BY created_at
      `).all()
    ).toEqual([
      {
        delta: 1,
        reason: "REQUIRED_ITEM_COMPLETED",
        reversesEventId: null
      },
      { delta: -1, reason: "REVERSAL", reversesEventId: earned.event.id }
    ]);
  });
});
