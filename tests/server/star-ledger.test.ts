import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase } from "../../src/server/db/client";
import { migrate } from "../../src/server/db/migrate";
import { seedInitialContent } from "../../src/server/db/seed";
import {
  StarRepository,
  type ApplyStarInput
} from "../../src/server/stars/repository";
import { StarReasonSchema } from "../../src/shared/stars";

const STUDENT_ID = "student-1";
const GUARDIAN_ID = "guardian-1";
const STUDY_DATE = "2026-07-16";
const CREATED_AT = "2026-07-16T03:00:00.000Z";

const PUBLIC_APPLY_REVERSAL_FORGERY: ApplyStarInput = {
  studentId: STUDENT_ID,
  delta: -1,
  reason: "REVERSAL",
  reasonText: "public apply cannot forge a reversal",
  studyDate: STUDY_DATE,
  actorType: "guardian",
  actorUserId: GUARDIAN_ID,
  sourceKey: "forged:reversal",
  // @ts-expect-error Only StarRepository.reverse() may link a reversal.
  reversesEventId: "source-event",
  createdAt: CREATED_AT
};
void PUBLIC_APPLY_REVERSAL_FORGERY;

function insertDirectStarEvent(
  db: Database.Database,
  id: string,
  reason: "GUARDIAN_ADJUSTMENT" | "REVERSAL",
  reversesEventId: string | null
): void {
  db.prepare(`
    INSERT INTO star_events (
      id, student_id, requested_delta, delta, balance_after,
      reason_code, reason_text, study_date, actor_type, actor_user_id,
      source_key, reverses_event_id, created_at
    ) VALUES (?, ?, 0, 0, 0, ?, ?, ?, 'guardian', ?, ?, ?, ?)
  `).run(
    id,
    STUDENT_ID,
    reason,
    "direct SQL forgery",
    STUDY_DATE,
    GUARDIAN_ID,
    `direct:${id}`,
    reversesEventId,
    CREATED_AT
  );
}

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
        requestedDelta: 1,
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

  it("returns the same event for the same source across two connections", () => {
    const directory = mkdtempSync(join(tmpdir(), "star-ledger-"));
    const databasePath = join(directory, "stars.sqlite");
    const firstDb = openDatabase(databasePath);
    const secondDb = openDatabase(databasePath);

    try {
      migrate(firstDb);
      seedInitialContent(firstDb);
      firstDb.prepare(`
        INSERT INTO users (id, role, display_name, created_at)
        VALUES (?, 'guardian', '보호자', ?), (?, 'student', '수아', ?)
      `).run(GUARDIAN_ID, CREATED_AT, STUDENT_ID, CREATED_AT);
      migrate(secondDb);

      const input = {
        studentId: STUDENT_ID,
        delta: 1,
        reason: "REQUIRED_ITEM_COMPLETED" as const,
        reasonText: "필수 학습을 완료했어요",
        studyDate: STUDY_DATE,
        itemId: "ko-01",
        actorType: "system" as const,
        sourceKey: "required:student-1:cross-connection:ko-01",
        createdAt: CREATED_AT
      };
      const first = new StarRepository(firstDb).apply(input);
      const duplicate = new StarRepository(secondDb).apply(input);

      expect(duplicate).toEqual({ event: first.event, duplicate: true });
      expect(secondDb.prepare("SELECT COUNT(*) AS count FROM star_events").get())
        .toEqual({ count: 1 });
      expect(secondDb.prepare(`
        SELECT balance
        FROM student_star_balances
        WHERE student_id = ?
      `).get(STUDENT_ID)).toEqual({ balance: 1 });
    } finally {
      secondDb.close();
      firstDb.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("reserves reversal source keys for linked reversals", () => {
    const earned = repository.apply({
      studentId: STUDENT_ID,
      delta: 3,
      reason: "GUARDIAN_BONUS",
      reasonText: "취소할 별",
      studyDate: STUDY_DATE,
      actorType: "guardian",
      actorUserId: GUARDIAN_ID,
      sourceKey: "guardian:guardian-1:reserved-reversal-source",
      createdAt: CREATED_AT
    });

    expect(() =>
      repository.apply({
        studentId: STUDENT_ID,
        delta: 7,
        reason: "GUARDIAN_BONUS",
        reasonText: "예약된 키 선점 시도",
        studyDate: STUDY_DATE,
        actorType: "guardian",
        actorUserId: GUARDIAN_ID,
        sourceKey: `reversal:${earned.event.id}`,
        createdAt: "2026-07-16T03:30:00.000Z"
      })
    ).toThrowError("SOURCE_KEY_RESERVED");
    expect(db.prepare("SELECT COUNT(*) AS count FROM star_events").get())
      .toEqual({ count: 1 });
    expect(db.prepare(`
      SELECT balance
      FROM student_star_balances
      WHERE student_id = ?
    `).get(STUDENT_ID)).toEqual({ balance: 3 });

    const reversed = repository.reverse(
      earned.event.id,
      GUARDIAN_ID,
      "정상 취소",
      new Date("2026-07-16T04:00:00.000Z")
    );

    expect(reversed).toMatchObject({
      duplicate: false,
      event: {
        requestedDelta: -3,
        delta: -3,
        balanceAfter: 0,
        reason: "REVERSAL",
        reversesEventId: earned.event.id
      }
    });
    expect(db.prepare("SELECT COUNT(*) AS count FROM star_events").get())
      .toEqual({ count: 2 });
  });

  it("rejects an unrelated event already using a reversal source key", () => {
    const earned = repository.apply({
      studentId: STUDENT_ID,
      delta: 2,
      reason: "GUARDIAN_BONUS",
      reasonText: "취소할 별",
      studyDate: STUDY_DATE,
      actorType: "guardian",
      actorUserId: GUARDIAN_ID,
      sourceKey: "guardian:guardian-1:conflicting-reversal-source",
      createdAt: CREATED_AT
    });
    db.prepare(`
      INSERT INTO star_events (
        id, student_id, requested_delta, delta, balance_after,
        reason_code, reason_text, study_date, actor_type, actor_user_id,
        source_key, reverses_event_id, created_at
      ) VALUES (?, ?, 0, 0, 2, 'GUARDIAN_ADJUSTMENT', ?, ?, 'guardian', ?, ?, NULL, ?)
    `).run(
      "unrelated-reserved-source-event",
      STUDENT_ID,
      "직접 삽입된 충돌 이벤트",
      STUDY_DATE,
      GUARDIAN_ID,
      `reversal:${earned.event.id}`,
      "2026-07-16T03:30:00.000Z"
    );

    expect(() =>
      repository.reverse(
        earned.event.id,
        GUARDIAN_ID,
        "충돌 키로 취소",
        new Date("2026-07-16T04:00:00.000Z")
      )
    ).toThrowError("SOURCE_KEY_CONFLICT");
    expect(db.prepare("SELECT COUNT(*) AS count FROM star_events").get())
      .toEqual({ count: 2 });
    expect(db.prepare(`
      SELECT balance
      FROM student_star_balances
      WHERE student_id = ?
    `).get(STUDENT_ID)).toEqual({ balance: 2 });
  });

  it("rejects direct SQL updates and leaves the event unchanged", () => {
    const applied = repository.apply({
      studentId: STUDENT_ID,
      delta: 1,
      reason: "GUARDIAN_BONUS",
      reasonText: "수정하면 안 되는 별",
      studyDate: STUDY_DATE,
      actorType: "guardian",
      actorUserId: GUARDIAN_ID,
      sourceKey: "guardian:guardian-1:append-only-update",
      createdAt: CREATED_AT
    });
    const before = db.prepare("SELECT * FROM star_events WHERE id = ?")
      .get(applied.event.id);

    expect(() =>
      db.prepare("UPDATE star_events SET reason_text = ? WHERE id = ?")
        .run("조작된 사유", applied.event.id)
    ).toThrowError(/STAR_EVENTS_APPEND_ONLY/);
    expect(db.prepare("SELECT * FROM star_events WHERE id = ?")
      .get(applied.event.id)).toEqual(before);
  });

  it("rejects direct SQL deletes and leaves the event unchanged", () => {
    const applied = repository.apply({
      studentId: STUDENT_ID,
      delta: 1,
      reason: "GUARDIAN_BONUS",
      reasonText: "삭제하면 안 되는 별",
      studyDate: STUDY_DATE,
      actorType: "guardian",
      actorUserId: GUARDIAN_ID,
      sourceKey: "guardian:guardian-1:append-only-delete",
      createdAt: CREATED_AT
    });
    const before = db.prepare("SELECT * FROM star_events WHERE id = ?")
      .get(applied.event.id);

    expect(() =>
      db.prepare("DELETE FROM star_events WHERE id = ?").run(applied.event.id)
    ).toThrowError(/STAR_EVENTS_APPEND_ONLY/);
    expect(db.prepare("SELECT * FROM star_events WHERE id = ?")
      .get(applied.event.id)).toEqual(before);
  });

  it("rejects a direct SQL reversal link on a non-reversal event", () => {
    const original = repository.apply({
      studentId: STUDENT_ID,
      delta: 1,
      reason: "GUARDIAN_BONUS",
      reasonText: "원본 이벤트",
      studyDate: STUDY_DATE,
      actorType: "guardian",
      actorUserId: GUARDIAN_ID,
      sourceKey: "guardian:guardian-1:forged-pair-source",
      createdAt: CREATED_AT
    });

    expect(() =>
      insertDirectStarEvent(
        db,
        "forged-non-reversal-link",
        "GUARDIAN_ADJUSTMENT",
        original.event.id
      )
    ).toThrowError(/CHECK constraint failed/);
    expect(db.prepare("SELECT COUNT(*) AS count FROM star_events").get())
      .toEqual({ count: 1 });
  });

  it("rejects a direct SQL reversal event without a reversal link", () => {
    expect(() =>
      insertDirectStarEvent(db, "forged-reversal-without-link", "REVERSAL", null)
    ).toThrowError(/CHECK constraint failed/);
    expect(db.prepare("SELECT COUNT(*) AS count FROM star_events").get())
      .toEqual({ count: 0 });
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
      event: {
        requestedDelta: -2,
        delta: -1,
        balanceAfter: 0,
        reason: "IDLE_TIMEOUT"
      }
    });
    expect(noBalance).toMatchObject({
      duplicate: false,
      event: {
        requestedDelta: -1,
        delta: 0,
        balanceAfter: 0,
        reason: "NO_BALANCE_AUDIT"
      }
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

  it("rolls back the balance when the event insert fails", () => {
    repository.apply({
      studentId: STUDENT_ID,
      delta: 4,
      reason: "GUARDIAN_BONUS",
      reasonText: "롤백 기준 잔액",
      studyDate: STUDY_DATE,
      actorType: "guardian",
      actorUserId: GUARDIAN_ID,
      sourceKey: "guardian:guardian-1:rollback-baseline",
      createdAt: CREATED_AT
    });
    const beforeBalance = db.prepare(`
      SELECT balance, updated_at AS updatedAt
      FROM student_star_balances
      WHERE student_id = ?
    `).get(STUDENT_ID);
    const beforeCount = db.prepare("SELECT COUNT(*) AS count FROM star_events").get();

    expect(() =>
      repository.apply({
        studentId: STUDENT_ID,
        delta: 2,
        reason: "REQUIRED_ITEM_COMPLETED",
        reasonText: "존재하지 않는 콘텐츠",
        studyDate: STUDY_DATE,
        itemId: "missing-item",
        actorType: "system",
        sourceKey: "required:student-1:missing-item",
        createdAt: "2026-07-16T04:00:00.000Z"
      })
    ).toThrowError(/FOREIGN KEY constraint failed/);
    expect(db.prepare(`
      SELECT balance, updated_at AS updatedAt
      FROM student_star_balances
      WHERE student_id = ?
    `).get(STUDENT_ID)).toEqual(beforeBalance);
    expect(db.prepare("SELECT COUNT(*) AS count FROM star_events").get())
      .toEqual(beforeCount);
  });

  it("partially reverses an event once while logging requested and actual deltas", () => {
    const earned = repository.apply({
      studentId: STUDENT_ID,
      delta: 5,
      reason: "REQUIRED_ITEM_COMPLETED",
      reasonText: "필수 학습을 완료했어요",
      studyDate: STUDY_DATE,
      itemId: "ko-01",
      actorType: "system",
      sourceKey: `required:${STUDENT_ID}:${STUDY_DATE}:ko-01`,
      createdAt: CREATED_AT
    });
    repository.apply({
      studentId: STUDENT_ID,
      delta: -3,
      reason: "REWARD_REDEMPTION",
      reasonText: "보상으로 별을 사용했어요",
      studyDate: STUDY_DATE,
      actorType: "guardian",
      actorUserId: GUARDIAN_ID,
      sourceKey: "reward:student-1:partial-reversal-setup",
      createdAt: "2026-07-16T03:30:00.000Z"
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
        requestedDelta: -5,
        delta: -2,
        balanceAfter: 0,
        reason: "REVERSAL",
        reasonText: "잘못 지급된 별",
        actorType: "guardian",
        reversesEventId: earned.event.id,
        createdAt: "2026-07-16T04:00:00.000Z"
      }
    });
    const reversalRetry = repository.reverse(
      earned.event.id,
      GUARDIAN_ID,
      "다시 취소",
      new Date("2026-07-16T05:00:00.000Z")
    );
    expect(reversalRetry).toEqual({ ...reversed, duplicate: true });
    expect(
      db.prepare("SELECT COUNT(*) AS count FROM star_events").get()
    ).toEqual({ count: 3 });
    expect(
      db.prepare(`
        SELECT requested_delta AS requestedDelta,
               delta,
               reason_code AS reason,
               reverses_event_id AS reversesEventId
        FROM star_events
        ORDER BY created_at
      `).all()
    ).toEqual([
      {
        requestedDelta: 5,
        delta: 5,
        reason: "REQUIRED_ITEM_COMPLETED",
        reversesEventId: null
      },
      {
        requestedDelta: -3,
        delta: -3,
        reason: "REWARD_REDEMPTION",
        reversesEventId: null
      },
      {
        requestedDelta: -5,
        delta: -2,
        reason: "REVERSAL",
        reversesEventId: earned.event.id
      }
    ]);
  });

  it("records a zero-actual reversal as REVERSAL and consumes its link", () => {
    const earned = repository.apply({
      studentId: STUDENT_ID,
      delta: 2,
      reason: "GUARDIAN_BONUS",
      reasonText: "임시 보너스",
      studyDate: STUDY_DATE,
      actorType: "guardian",
      actorUserId: GUARDIAN_ID,
      sourceKey: "guardian:guardian-1:zero-reversal-source",
      createdAt: CREATED_AT
    });
    repository.apply({
      studentId: STUDENT_ID,
      delta: -2,
      reason: "REWARD_REDEMPTION",
      reasonText: "모두 사용",
      studyDate: STUDY_DATE,
      actorType: "guardian",
      actorUserId: GUARDIAN_ID,
      sourceKey: "reward:student-1:zero-reversal-setup",
      createdAt: "2026-07-16T03:30:00.000Z"
    });

    const reversed = repository.reverse(
      earned.event.id,
      GUARDIAN_ID,
      "잔액 없는 상태에서 취소",
      new Date("2026-07-16T04:00:00.000Z")
    );

    expect(reversed).toMatchObject({
      duplicate: false,
      event: {
        requestedDelta: -2,
        delta: 0,
        balanceAfter: 0,
        reason: "REVERSAL",
        reversesEventId: earned.event.id
      }
    });
    const reversalRetry = repository.reverse(
      earned.event.id,
      GUARDIAN_ID,
      "두 번째 취소",
      new Date("2026-07-16T05:00:00.000Z")
    );
    expect(reversalRetry).toEqual({ ...reversed, duplicate: true });
    expect(
      db.prepare("SELECT COUNT(*) AS count FROM star_events").get()
    ).toEqual({ count: 3 });
  });
});
