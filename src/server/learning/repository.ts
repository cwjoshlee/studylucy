import type Database from "better-sqlite3";
import {
  evaluateAttemptCompletion,
  LearningItemPayloadSchema,
  type AttemptInput,
  type AttemptReceipt,
  type LearningItemPayload,
  type StarAwardReceipt
} from "../../shared/learning";
import { StarRepository } from "../stars/repository";
import type { ValidatedAttemptSnapshot } from "./issued-plan-repository";

export type ActiveLearningItem = {
  id: string;
  version: number;
  payload: LearningItemPayload;
};

export type ProgressAttempt = {
  itemId: string;
  studyDate: string;
  subject: "korean" | "math";
  readingPass: boolean;
  mathPass: boolean | null;
  completed: boolean;
  missedTokens: string[];
};

type AttemptRow = {
  id: string;
  readingPass: number;
  mathPass: number | null;
  dictationPass: number | null;
  completed: number;
  starAwarded: number;
  starAmount: number;
  starBalance: number;
  starEventId: string | null;
};

type CanonicalAttemptRow = AttemptRow & {
  userId: string;
  trustedDeviceId: string | null;
  planId: string | null;
  itemId: string;
  contentVersion: number;
  studyDate: string;
  occurredAt: string | null;
  readingScore: number;
  missedTokensJson: string;
  mathAnswerJson: string | null;
  durationMs: number;
  difficultyFeedback: AttemptInput["difficultyFeedback"];
};

type AttemptReceiptCore = Omit<AttemptReceipt, "activityCursor">;

export type AttemptSaveResult = {
  receipt: AttemptReceiptCore;
  inserted: boolean;
};

export class AttemptIdempotencyError extends Error {
  readonly code = "INVALID_REQUEST";

  constructor() {
    super("INVALID_REQUEST");
  }
}

export type AttemptWriteInput = AttemptInput & {
  id: string;
  userId: string;
  trustedDeviceId: string;
  createdAt: string;
  snapshot: ValidatedAttemptSnapshot;
};

function receiptFromRow(
  row: AttemptRow,
  duplicate: boolean
): AttemptReceiptCore {
  const readingPass = row.readingPass === 1;
  const mathPass = row.mathPass === null ? null : row.mathPass === 1;
  const dictationPass = row.dictationPass === null
    ? null
    : row.dictationPass === 1;
  return {
    id: row.id,
    duplicate,
    readingPass,
    mathPass,
    dictationPass,
    completed: row.completed === 1,
    starAward: {
      awarded: row.starAwarded === 1,
      amount: row.starAmount,
      balance: row.starBalance,
      eventId: row.starEventId
    }
  };
}

export class LearningRepository {
  private stars: StarRepository;

  constructor(private db: Database.Database) {
    this.stars = new StarRepository(db);
  }

  findDuplicateAttempt(
    userId: string,
    clientAttemptId: string
  ): AttemptReceipt | null {
    const receipt = this.findDuplicateAttemptCore(userId, clientAttemptId);
    return receipt === null
      ? null
      : { ...receipt, activityCursor: this.getActivityCursor(userId) };
  }

  findDuplicateAttemptForIssuedPlan(
    userId: string,
    trustedDeviceId: string,
    input: AttemptInput
  ): AttemptReceipt | null {
    const receipt = this.findCanonicalDuplicateCore(
      userId,
      trustedDeviceId,
      input
    );
    return receipt === null
      ? null
      : { ...receipt, activityCursor: this.getActivityCursor(userId) };
  }

  private findCanonicalDuplicateCore(
    userId: string,
    trustedDeviceId: string,
    input: AttemptInput
  ): AttemptReceiptCore | null {
    const row = this.db.prepare(`
      SELECT a.id,
             a.user_id AS userId,
             a.issued_plan_id AS planId,
             p.trusted_device_id AS trustedDeviceId,
             a.item_id AS itemId,
             a.content_version AS contentVersion,
             a.study_date AS studyDate,
             a.occurred_at AS occurredAt,
             a.reading_score AS readingScore,
             a.missed_tokens_json AS missedTokensJson,
             a.math_answer_json AS mathAnswerJson,
             a.duration_ms AS durationMs,
             a.difficulty_feedback AS difficultyFeedback,
             a.reading_pass AS readingPass,
             a.math_pass AS mathPass,
             a.dictation_pass AS dictationPass,
             a.completed AS completed,
             r.awarded AS starAwarded,
             r.amount AS starAmount,
             r.balance AS starBalance,
             r.event_id AS starEventId
      FROM attempts AS a
      JOIN attempt_star_receipts AS r ON r.attempt_id = a.id
      LEFT JOIN issued_daily_plans AS p ON p.id = a.issued_plan_id
      WHERE a.client_attempt_id = ?
    `).get(input.clientAttemptId) as CanonicalAttemptRow | undefined;
    if (row === undefined) return null;
    const mathAnswerJson = input.mathAnswer === null
      ? null
      : JSON.stringify(input.mathAnswer);
    const matches =
      row.userId === userId &&
      row.trustedDeviceId === trustedDeviceId &&
      row.planId === input.planId &&
      row.itemId === input.itemId &&
      row.contentVersion === input.contentVersion &&
      row.studyDate === input.studyDate &&
      row.occurredAt === input.occurredAt &&
      row.readingScore === input.readingScore &&
      row.missedTokensJson === JSON.stringify(input.missedTokens) &&
      row.mathAnswerJson === mathAnswerJson &&
      row.durationMs === input.durationMs &&
      row.difficultyFeedback === input.difficultyFeedback;
    if (!matches) throw new AttemptIdempotencyError();
    return receiptFromRow(row, true);
  }

  private findDuplicateAttemptCore(
    userId: string,
    clientAttemptId: string
  ): AttemptReceiptCore | null {
    const row = this.db.prepare(`
      SELECT a.id,
             a.reading_pass AS readingPass,
             a.math_pass AS mathPass,
             a.dictation_pass AS dictationPass,
             a.completed AS completed,
             r.awarded AS starAwarded,
             r.amount AS starAmount,
             r.balance AS starBalance,
             r.event_id AS starEventId
      FROM attempts AS a
      JOIN attempt_star_receipts AS r ON r.attempt_id = a.id
      WHERE a.client_attempt_id = ? AND a.user_id = ?
    `).get(clientAttemptId, userId) as AttemptRow | undefined;
    return row === undefined ? null : receiptFromRow(row, true);
  }

  listActiveItems(): ActiveLearningItem[] {
    const rows = this.db.prepare(`
      SELECT ci.id, ci.active_version AS version, cv.payload_json AS payloadJson
      FROM content_items AS ci
      JOIN content_versions AS cv
        ON cv.item_id = ci.id AND cv.version = ci.active_version
      WHERE ci.status = 'published'
      ORDER BY ci.id
    `).all() as Array<{ id: string; version: number; payloadJson: string }>;

    return rows.map((row) => ({
      id: row.id,
      version: row.version,
      payload: LearningItemPayloadSchema.parse(JSON.parse(row.payloadJson))
    }));
  }

  listCompletedItemIds(userId: string, requestedPlanId: string): string[] {
    return (this.db.prepare(`
      SELECT ipi.item_id AS itemId
      FROM issued_plan_items AS ipi
      JOIN issued_daily_plans AS requested ON requested.id = ipi.plan_id
      WHERE ipi.plan_id = ?
        AND EXISTS (
          SELECT 1
          FROM attempts AS a
          WHERE a.user_id = ?
            AND a.study_date = requested.study_date
            AND a.item_id = ipi.item_id
            AND a.content_version = ipi.content_version
            AND a.completed = 1
        )
      ORDER BY ipi.sort_order, ipi.item_id
    `).all(requestedPlanId, userId) as Array<{ itemId: string }>)
      .map((row) => row.itemId);
  }

  saveAttempt(input: AttemptWriteInput): AttemptReceipt {
    return this.db.transaction(() => {
      const result = this.saveAttemptInTransaction(input);
      if (result.inserted) {
        const updated = this.db.prepare(`
          UPDATE student_activity_cursors
          SET current_cursor = current_cursor + 1, updated_at = ?
          WHERE student_id = ?
        `).run(input.createdAt, input.userId);
        if (updated.changes !== 1) {
          throw new Error("STUDENT_ACTIVITY_CURSOR_MISSING");
        }
      }
      return {
        ...result.receipt,
        activityCursor: this.getActivityCursor(input.userId)
      };
    }).immediate();
  }

  saveAttemptInTransaction(input: AttemptWriteInput): AttemptSaveResult {
    const existing = this.findCanonicalDuplicateCore(
      input.userId,
      input.trustedDeviceId,
      input
    );
    if (existing !== null) {
      return { receipt: existing, inserted: false };
    }

    const payload = input.snapshot.payload;
    const { readingPass, mathPass, dictationPass, completed } = evaluateAttemptCompletion(
      payload,
      input
    );

    this.db.prepare(`
        INSERT INTO attempts (
          id, client_attempt_id, user_id, item_id, content_version,
          study_date, reading_score, reading_pass, missed_tokens_json,
          math_answer_json, math_pass, completed, dictation_pass,
          duration_ms, difficulty_feedback,
          created_at, issued_plan_id, occurred_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        input.id,
        input.clientAttemptId,
        input.userId,
        input.itemId,
        input.snapshot.contentVersion,
        input.snapshot.studyDate,
        input.readingScore,
        readingPass ? 1 : 0,
        JSON.stringify(input.missedTokens),
        input.mathAnswer === null ? null : JSON.stringify(input.mathAnswer),
        mathPass === null ? null : mathPass ? 1 : 0,
        completed ? 1 : 0,
        dictationPass === null ? null : dictationPass ? 1 : 0,
        input.durationMs,
        input.difficultyFeedback,
        input.createdAt,
        input.snapshot.issuedPlanId,
        input.occurredAt
    );

    const starAward = this.createStarAwardReceipt({
      studentId: input.userId,
      studyDate: input.snapshot.studyDate,
      itemId: input.itemId,
      attemptId: input.id,
      completed,
      isRequired: input.snapshot.isRequired,
      createdAt: input.createdAt
    });
    this.db.prepare(`
        INSERT INTO attempt_star_receipts (
          attempt_id, awarded, amount, balance, event_id
        ) VALUES (?, ?, ?, ?, ?)
    `).run(
        input.id,
        starAward.awarded ? 1 : 0,
        starAward.amount,
        starAward.balance,
        starAward.eventId
    );

    return {
      receipt: receiptFromRow({
        id: input.id,
        readingPass: readingPass ? 1 : 0,
        mathPass: mathPass === null ? null : mathPass ? 1 : 0,
        dictationPass: dictationPass === null ? null : dictationPass ? 1 : 0,
        completed: completed ? 1 : 0,
        starAwarded: starAward.awarded ? 1 : 0,
        starAmount: starAward.amount,
        starBalance: starAward.balance,
        starEventId: starAward.eventId
      }, false),
      inserted: true
    };
  }

  private createStarAwardReceipt(input: {
    studentId: string;
    studyDate: string;
    itemId: string;
    attemptId: string;
    completed: boolean;
    isRequired: boolean;
    createdAt: string;
  }): StarAwardReceipt {
    if (!input.completed || !input.isRequired) {
      return {
        awarded: false,
        amount: 0,
        balance: this.getStarBalance(input.studentId),
        eventId: null
      };
    }

    const applied = this.stars.applyInTransaction({
      studentId: input.studentId,
      delta: 1,
      reason: "REQUIRED_ITEM_COMPLETED",
      reasonText: "필수 학습을 완료했어요",
      studyDate: input.studyDate,
      itemId: input.itemId,
      attemptId: input.attemptId,
      actorType: "system",
      sourceKey:
        `required:${input.studentId}:${input.studyDate}:${input.itemId}`,
      createdAt: input.createdAt
    });
    return {
      awarded: !applied.duplicate,
      amount: applied.duplicate ? 0 : 1,
      balance: this.getStarBalance(input.studentId),
      eventId: applied.event.id
    };
  }

  private getStarBalance(studentId: string): number {
    const row = this.db.prepare(`
      SELECT balance
      FROM student_star_balances
      WHERE student_id = ?
    `).get(studentId) as { balance: number } | undefined;
    return row?.balance ?? 0;
  }

  private getActivityCursor(studentId: string): number {
    const row = this.db.prepare(`
      SELECT current_cursor AS currentCursor
      FROM student_activity_cursors
      WHERE student_id = ?
    `).get(studentId) as { currentCursor: number } | undefined;
    return row?.currentCursor ?? 0;
  }

  listProgressAttempts(from: string, to: string): ProgressAttempt[] {
    const rows = this.db.prepare(`
      SELECT a.item_id AS itemId,
             a.study_date AS studyDate,
             ci.subject AS subject,
             a.reading_pass AS readingPass,
             a.math_pass AS mathPass,
             a.completed AS completed,
             a.missed_tokens_json AS missedTokensJson
      FROM attempts AS a
      JOIN users AS u ON u.id = a.user_id
      JOIN content_items AS ci ON ci.id = a.item_id
      WHERE u.role = 'student' AND a.study_date BETWEEN ? AND ?
      ORDER BY a.created_at DESC, a.id DESC
    `).all(from, to) as Array<{
      itemId: string;
      studyDate: string;
      subject: "korean" | "math";
      readingPass: number;
      mathPass: number | null;
      completed: number;
      missedTokensJson: string;
    }>;

    return rows.map((row) => ({
      itemId: row.itemId,
      studyDate: row.studyDate,
      subject: row.subject,
      readingPass: row.readingPass === 1,
      mathPass: row.mathPass === null ? null : row.mathPass === 1,
      completed: row.completed === 1,
      missedTokens: JSON.parse(row.missedTokensJson) as string[]
    }));
  }
}
