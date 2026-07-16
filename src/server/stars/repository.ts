import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import {
  StarReasonSchema,
  type AppliedStarResult,
  type StarEvent,
  type StarReason
} from "../../shared/stars";

export type ApplyStarInput = {
  studentId: string;
  delta: number;
  reason: StarReason;
  reasonText: string;
  studyDate: string;
  itemId?: string | null;
  attemptId?: string | null;
  idleEventId?: string | null;
  pendingAdjustmentId?: string | null;
  actorType: "system" | "guardian";
  actorUserId?: string | null;
  sourceKey: string;
  createdAt: string;
};

type StarEventRow = {
  id: string;
  requestedDelta: number;
  delta: number;
  balanceAfter: number;
  reason: string;
  reasonText: string;
  studyDate: string;
  itemId: string | null;
  actorType: "system" | "guardian";
  createdAt: string;
  reversesEventId: string | null;
};

type ReversibleEventRow = {
  studentId: string;
  delta: number;
  studyDate: string;
  itemId: string | null;
};

const STAR_EVENT_SELECT = `
  SELECT id,
         requested_delta AS requestedDelta,
         delta,
         balance_after AS balanceAfter,
         reason_code AS reason,
         reason_text AS reasonText,
         study_date AS studyDate,
         item_id AS itemId,
         actor_type AS actorType,
         created_at AS createdAt,
         reverses_event_id AS reversesEventId
  FROM star_events
`;

function eventFromRow(row: StarEventRow): StarEvent {
  return {
    ...row,
    reason: StarReasonSchema.parse(row.reason)
  };
}

export class StarRepository {
  constructor(private db: Database.Database) {}

  apply(input: ApplyStarInput): AppliedStarResult {
    if (input.sourceKey.startsWith("reversal:")) {
      throw new Error("SOURCE_KEY_RESERVED");
    }
    return this.db.transaction(() => this.applyInTransaction(input)).immediate();
  }

  findBySource(sourceKey: string): StarEvent | null {
    const row = this.db.prepare(`
      ${STAR_EVENT_SELECT}
      WHERE source_key = ?
    `).get(sourceKey) as StarEventRow | undefined;
    return row === undefined ? null : eventFromRow(row);
  }

  reverse(
    eventId: string,
    guardianId: string,
    note: string,
    now: Date
  ): AppliedStarResult {
    return this.db.transaction(() => {
      const original = this.db.prepare(`
        SELECT student_id AS studentId,
               delta,
               study_date AS studyDate,
               item_id AS itemId
        FROM star_events
        WHERE id = ?
      `).get(eventId) as ReversibleEventRow | undefined;
      if (original === undefined) {
        throw new Error("EVENT_NOT_FOUND");
      }

      const existingReversal = this.db.prepare(`
        ${STAR_EVENT_SELECT}
        WHERE reverses_event_id = ?
      `).get(eventId) as StarEventRow | undefined;
      if (existingReversal !== undefined) {
        return { event: eventFromRow(existingReversal), duplicate: true };
      }

      return this.applyInTransaction(
        {
          studentId: original.studentId,
          delta: -original.delta,
          reason: "REVERSAL",
          reasonText: note,
          studyDate: original.studyDate,
          itemId: original.itemId,
          actorType: "guardian",
          actorUserId: guardianId,
          sourceKey: `reversal:${eventId}`,
          createdAt: now.toISOString()
        },
        eventId
      );
    }).immediate();
  }

  private applyInTransaction(
    input: ApplyStarInput,
    reversesEventId: string | null = null
  ): AppliedStarResult {
    const existing = this.db.prepare(`
      ${STAR_EVENT_SELECT}
      WHERE source_key = ?
    `).get(input.sourceKey) as StarEventRow | undefined;
    if (existing !== undefined) {
      if (existing.reversesEventId !== reversesEventId) {
        throw new Error("SOURCE_KEY_CONFLICT");
      }
      return { event: eventFromRow(existing), duplicate: true };
    }

    this.db.prepare(`
      INSERT INTO student_star_balances (student_id, balance, updated_at)
      VALUES (?, 0, ?)
      ON CONFLICT(student_id) DO NOTHING
    `).run(input.studentId, input.createdAt);

    const balanceRow = this.db.prepare(`
      SELECT balance
      FROM student_star_balances
      WHERE student_id = ?
    `).get(input.studentId) as { balance: number };
    const delta = input.delta < 0
      ? Math.max(input.delta, -balanceRow.balance)
      : input.delta;
    const reason = reversesEventId === null && input.delta < 0 && delta === 0
      ? "NO_BALANCE_AUDIT"
      : input.reason;
    const balanceAfter = balanceRow.balance + delta;

    this.db.prepare(`
      UPDATE student_star_balances
      SET balance = ?, updated_at = ?
      WHERE student_id = ?
    `).run(balanceAfter, input.createdAt, input.studentId);

    const id = randomUUID();
    this.db.prepare(`
      INSERT INTO star_events (
        id, student_id, requested_delta, delta, balance_after,
        reason_code, reason_text,
        study_date, item_id, attempt_id, idle_event_id,
        pending_adjustment_id, actor_type, actor_user_id, source_key,
        reverses_event_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.studentId,
      input.delta,
      delta,
      balanceAfter,
      reason,
      input.reasonText,
      input.studyDate,
      input.itemId ?? null,
      input.attemptId ?? null,
      input.idleEventId ?? null,
      input.pendingAdjustmentId ?? null,
      input.actorType,
      input.actorUserId ?? null,
      input.sourceKey,
      reversesEventId,
      input.createdAt
    );

    const event = this.db.prepare(`
      ${STAR_EVENT_SELECT}
      WHERE id = ?
    `).get(id) as StarEventRow;
    return { event: eventFromRow(event), duplicate: false };
  }
}
