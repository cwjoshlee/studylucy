import type Database from "better-sqlite3";
import {
  LearningItemPayloadSchema,
  type AttemptInput,
  type AttemptReceipt,
  type LearningItemPayload
} from "../../shared/learning";

export type ActiveLearningItem = {
  id: string;
  version: number;
  payload: LearningItemPayload;
};

export type ProgressAttempt = {
  itemId: string;
  studyDate: string;
  readingPass: boolean;
  mathPass: boolean | null;
  missedTokens: string[];
};

type AttemptRow = {
  id: string;
  readingPass: number;
  mathPass: number | null;
};

function receiptFromRow(row: AttemptRow, duplicate: boolean): AttemptReceipt {
  const readingPass = row.readingPass === 1;
  const mathPass = row.mathPass === null ? null : row.mathPass === 1;
  return {
    id: row.id,
    duplicate,
    readingPass,
    mathPass,
    completed: readingPass && (mathPass ?? true)
  };
}

export class LearningRepository {
  constructor(private db: Database.Database) {}

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

  listCompletedItemIds(userId: string, studyDate: string): string[] {
    return (this.db.prepare(`
      SELECT DISTINCT a.item_id AS itemId
      FROM attempts AS a
      JOIN content_items AS ci ON ci.id = a.item_id
      WHERE a.user_id = ?
        AND a.study_date = ?
        AND a.reading_pass = 1
        AND (a.math_pass IS NULL OR a.math_pass = 1)
        AND ci.status = 'published'
        AND ci.active_version = a.content_version
      ORDER BY a.item_id
    `).all(userId, studyDate) as Array<{ itemId: string }>)
      .map((row) => row.itemId);
  }

  saveAttempt(input: AttemptInput & {
    id: string;
    userId: string;
    createdAt: string;
  }): AttemptReceipt | null {
    return this.db.transaction(() => {
      const existing = this.db.prepare(`
        SELECT id, reading_pass AS readingPass, math_pass AS mathPass
        FROM attempts
        WHERE client_attempt_id = ?
      `).get(input.clientAttemptId) as AttemptRow | undefined;
      if (existing !== undefined) {
        return receiptFromRow(existing, true);
      }

      const content = this.db.prepare(`
        SELECT ci.active_version AS activeVersion,
               cv.payload_json AS payloadJson
        FROM content_items AS ci
        JOIN content_versions AS cv
          ON cv.item_id = ci.id AND cv.version = ci.active_version
        WHERE ci.id = ? AND ci.status = 'published'
      `).get(input.itemId) as
        | { activeVersion: number; payloadJson: string }
        | undefined;
      if (
        content === undefined ||
        content.activeVersion !== input.contentVersion
      ) {
        return null;
      }

      const payload = LearningItemPayloadSchema.parse(
        JSON.parse(content.payloadJson)
      );
      const readingPass =
        input.readingScore >= 85 && input.missedTokens.length === 0;
      const mathPass = payload.kind === "math-story"
        ? input.mathAnswer !== null && input.mathAnswer === payload.answer
        : null;

      this.db.prepare(`
        INSERT INTO attempts (
          id, client_attempt_id, user_id, item_id, content_version,
          study_date, reading_score, reading_pass, missed_tokens_json,
          math_answer_json, math_pass, duration_ms, difficulty_feedback,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        input.id,
        input.clientAttemptId,
        input.userId,
        input.itemId,
        input.contentVersion,
        input.studyDate,
        input.readingScore,
        readingPass ? 1 : 0,
        JSON.stringify(input.missedTokens),
        input.mathAnswer === null ? null : JSON.stringify(input.mathAnswer),
        mathPass === null ? null : mathPass ? 1 : 0,
        input.durationMs,
        input.difficultyFeedback,
        input.createdAt
      );

      return receiptFromRow({
        id: input.id,
        readingPass: readingPass ? 1 : 0,
        mathPass: mathPass === null ? null : mathPass ? 1 : 0
      }, false);
    })();
  }

  listProgressAttempts(from: string, to: string): ProgressAttempt[] {
    const rows = this.db.prepare(`
      SELECT a.item_id AS itemId,
             a.study_date AS studyDate,
             a.reading_pass AS readingPass,
             a.math_pass AS mathPass,
             a.missed_tokens_json AS missedTokensJson
      FROM attempts AS a
      JOIN users AS u ON u.id = a.user_id
      WHERE u.role = 'student' AND a.study_date BETWEEN ? AND ?
      ORDER BY a.created_at DESC, a.id DESC
    `).all(from, to) as Array<{
      itemId: string;
      studyDate: string;
      readingPass: number;
      mathPass: number | null;
      missedTokensJson: string;
    }>;

    return rows.map((row) => ({
      itemId: row.itemId,
      studyDate: row.studyDate,
      readingPass: row.readingPass === 1,
      mathPass: row.mathPass === null ? null : row.mathPass === 1,
      missedTokens: JSON.parse(row.missedTokensJson) as string[]
    }));
  }
}
