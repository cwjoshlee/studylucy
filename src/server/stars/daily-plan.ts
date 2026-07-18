import type Database from "better-sqlite3";
import { getDailyItems } from "../../shared/daily-order";
import { LearningItemPayloadSchema } from "../../shared/learning";
import type { StudentStarSummary } from "../../shared/stars";
import type {
  DailyPlanInput,
  GuardianDailyPlan
} from "../../shared/stars";
import { kstStudyDate } from "./kst";
import { getStudentStarSummary } from "./student-summary";

export type RequiredPlan = {
  requiredItemIds: string[];
  stars: StudentStarSummary;
};

type DailyPlanSettingsRow = {
  koreanTarget: number;
  mathTarget: number;
  isRestDay: number;
};

type RequirementRow = {
  itemId: string;
};

export class DailyPlanService {
  constructor(
    private db: Database.Database,
    private now: () => Date
  ) {}

  ensure(studentId: string, studyDate: string): RequiredPlan {
    return this.db.transaction(() =>
      this.ensureInTransaction(studentId, studyDate)
    ).immediate();
  }

  ensureInTransaction(studentId: string, studyDate: string): RequiredPlan {
    const createdAt = this.now().toISOString();
    this.db.prepare(`
        INSERT INTO daily_plan_settings (
          student_id, study_date, korean_target, math_target,
          is_rest_day, updated_by, updated_at
        ) VALUES (?, ?, 2, 2, 0, NULL, ?)
        ON CONFLICT(student_id, study_date) DO NOTHING
    `).run(studentId, studyDate, createdAt);

    const settings = this.db.prepare(`
        SELECT korean_target AS koreanTarget,
               math_target AS mathTarget,
               is_rest_day AS isRestDay
        FROM daily_plan_settings
        WHERE student_id = ? AND study_date = ?
    `).get(studentId, studyDate) as DailyPlanSettingsRow;

    const existing = this.listRequirementIds(studentId, studyDate);
    if (existing.length === 0 && settings.isRestDay === 0) {
      const rows = this.db.prepare(`
          SELECT ci.id, cv.payload_json AS payloadJson
          FROM content_items AS ci
          JOIN content_versions AS cv
            ON cv.item_id = ci.id AND cv.version = ci.active_version
          WHERE ci.status = 'published'
          ORDER BY ci.id
      `).all() as Array<{ id: string; payloadJson: string }>;
      const items = rows.map((row) => ({
        id: row.id,
        subject: LearningItemPayloadSchema.parse(
          JSON.parse(row.payloadJson)
        ).subject
      }));
      const remaining = {
        korean: settings.koreanTarget,
        math: settings.mathTarget
      };
      let sortOrder = 0;
      const insert = this.db.prepare(`
          INSERT OR IGNORE INTO daily_requirements (
            student_id, study_date, item_id, subject, sort_order, created_at
          ) VALUES (?, ?, ?, ?, ?, ?)
      `);
      for (const item of getDailyItems(items, studyDate)) {
        if (remaining[item.subject] <= 0) {
          continue;
        }
        insert.run(
          studentId,
          studyDate,
          item.id,
          item.subject,
          sortOrder,
          createdAt
        );
        remaining[item.subject] -= 1;
        sortOrder += 1;
      }
    }

    return {
      requiredItemIds: this.listRequirementIds(studentId, studyDate),
      stars: getStudentStarSummary(this.db, studentId, studyDate)
    };
  }

  getGuardianPlan(studentId: string, studyDate: string): GuardianDailyPlan {
    const plan = this.ensure(studentId, studyDate);
    const settings = this.getSettings(studentId, studyDate);
    return {
      studyDate,
      koreanTarget: settings.koreanTarget,
      mathTarget: settings.mathTarget,
      isRestDay: settings.isRestDay === 1,
      requiredItemIds: plan.requiredItemIds
    };
  }

  updateGuardianPlan(
    studentId: string,
    studyDate: string,
    input: DailyPlanInput,
    guardianId: string
  ): GuardianDailyPlan {
    return this.db.transaction(() => {
      if (studyDate < kstStudyDate(this.now())) {
        throw new Error("PLAN_LOCKED");
      }
      const locked = this.db.prepare(`
        SELECT 1 FROM star_events
        WHERE student_id = ? AND study_date = ?
          AND reason_code = 'REQUIRED_ITEM_COMPLETED'
        LIMIT 1
      `).get(studentId, studyDate);
      if (locked !== undefined) {
        throw new Error("PLAN_LOCKED");
      }
      const updatedAt = this.now().toISOString();
      this.db.prepare(`
        INSERT INTO daily_plan_settings (
          student_id, study_date, korean_target, math_target,
          is_rest_day, updated_by, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(student_id, study_date) DO UPDATE SET
          korean_target = excluded.korean_target,
          math_target = excluded.math_target,
          is_rest_day = excluded.is_rest_day,
          updated_by = excluded.updated_by,
          updated_at = excluded.updated_at
      `).run(
        studentId,
        studyDate,
        input.koreanTarget,
        input.mathTarget,
        input.isRestDay ? 1 : 0,
        guardianId,
        updatedAt
      );
      this.db.prepare(`
        DELETE FROM daily_requirements
        WHERE student_id = ? AND study_date = ?
      `).run(studentId, studyDate);
      return this.getGuardianPlan(studentId, studyDate);
    }).immediate();
  }

  private getSettings(
    studentId: string,
    studyDate: string
  ): DailyPlanSettingsRow {
    return this.db.prepare(`
      SELECT korean_target AS koreanTarget,
             math_target AS mathTarget,
             is_rest_day AS isRestDay
      FROM daily_plan_settings
      WHERE student_id = ? AND study_date = ?
    `).get(studentId, studyDate) as DailyPlanSettingsRow;
  }

  private listRequirementIds(studentId: string, studyDate: string): string[] {
    return (this.db.prepare(`
      SELECT item_id AS itemId
      FROM daily_requirements
      WHERE student_id = ? AND study_date = ?
      ORDER BY sort_order, item_id
    `).all(studentId, studyDate) as RequirementRow[])
      .map((row) => row.itemId);
  }

}
