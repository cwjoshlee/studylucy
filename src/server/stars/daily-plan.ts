import type Database from "better-sqlite3";
import {
  LearningItemPayloadSchema,
  type LearningItemPayload,
  type LearningStep
} from "../../shared/learning";
import type { StudentStarSummary } from "../../shared/stars";
import type {
  DailyPlanInput,
  GuardianDailyPlan,
  SubjectStepSettings
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

type StepSettingsRow = {
  subject: "korean" | "math";
  difficulty: number;
  challengeBonusStars: number;
};

type PublishedItem = {
  id: string;
  payload: LearningItemPayload;
};

const SUBJECTS = ["korean", "math"] as const;
const STEPS = ["foundation", "current", "challenge"] as const;

function targetLevel(difficulty: number, step: LearningStep): number {
  const offset = step === "foundation" ? -1 : step === "challenge" ? 1 : 0;
  return Math.max(1, Math.min(5, difficulty + offset));
}

function numericLevel(payload: LearningItemPayload): number {
  const match = /\d+/u.exec(payload.level);
  return match === null ? 3 : Number(match[0]);
}

function learningKey(payload: LearningItemPayload): string {
  return payload.kind === "korean-dictation"
    ? `${payload.unit}\0${payload.mode}`
    : payload.unit;
}

function stepAffinity(payload: LearningItemPayload, step: LearningStep): number {
  if (payload.subject !== "korean") return 0;
  if (step === "challenge") {
    return payload.kind === "korean-dictation" && payload.mode === "sentence"
      ? 0
      : 1;
  }
  if (payload.kind === "korean-dictation" && payload.mode === "word") return 0;
  return payload.kind === "korean-reading" ? 1 : 2;
}

function stableDateRank(value: string): number {
  let hash = 2_166_136_261;
  for (const character of value) {
    hash ^= character.codePointAt(0)!;
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

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

    const insertStepSettings = this.db.prepare(`
      INSERT INTO daily_step_settings (
        student_id, study_date, subject, difficulty, challenge_bonus_stars
      ) VALUES (?, ?, ?, 3, 2)
      ON CONFLICT(student_id, study_date, subject) DO NOTHING
    `);
    for (const subject of SUBJECTS) {
      insertStepSettings.run(studentId, studyDate, subject);
    }

    const settings = this.getSettings(studentId, studyDate);
    const existing = this.listRequirementIds(studentId, studyDate);
    if (existing.length === 0 && settings.isRestDay === 0) {
      const items = this.listPublishedItems();
      const subjectSettings = this.getSubjectSettings(studentId, studyDate);
      const excludedIds = new Set<string>();
      let sortOrder = 0;
      const insert = this.db.prepare(`
        INSERT OR IGNORE INTO daily_requirements (
          student_id, study_date, item_id, subject, step,
          sort_order, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      for (const subject of SUBJECTS) {
        const weakKeys = this.recentWeakKeys(studentId, subject);
        for (const step of STEPS) {
          const item = this.chooseItem({
            items,
            subject,
            step,
            difficulty: subjectSettings[subject].difficulty,
            weakKeys,
            studyDate,
            excludedIds
          });
          insert.run(
            studentId,
            studyDate,
            item.id,
            subject,
            step,
            sortOrder,
            createdAt
          );
          excludedIds.add(item.id);
          sortOrder += 1;
        }
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
      subjectSettings: this.getSubjectSettings(studentId, studyDate),
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
      if (input.subjectSettings !== undefined) {
        const upsertStepSettings = this.db.prepare(`
          INSERT INTO daily_step_settings (
            student_id, study_date, subject, difficulty,
            challenge_bonus_stars
          ) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(student_id, study_date, subject) DO UPDATE SET
            difficulty = excluded.difficulty,
            challenge_bonus_stars = excluded.challenge_bonus_stars
        `);
        for (const subject of SUBJECTS) {
          const subjectInput = input.subjectSettings[subject];
          upsertStepSettings.run(
            studentId,
            studyDate,
            subject,
            subjectInput.difficulty,
            subjectInput.challengeBonusStars
          );
        }
      }
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

  private getSubjectSettings(
    studentId: string,
    studyDate: string
  ): Record<"korean" | "math", SubjectStepSettings> {
    const rows = this.db.prepare(`
      SELECT subject, difficulty,
             challenge_bonus_stars AS challengeBonusStars
      FROM daily_step_settings
      WHERE student_id = ? AND study_date = ?
    `).all(studentId, studyDate) as StepSettingsRow[];
    const bySubject = new Map(rows.map((row) => [row.subject, row]));
    const korean = bySubject.get("korean");
    const math = bySubject.get("math");
    if (korean === undefined || math === undefined) {
      throw new Error("DAILY_STEP_SETTINGS_MISSING");
    }
    return {
      korean: {
        difficulty: korean.difficulty,
        challengeBonusStars: korean.challengeBonusStars
      },
      math: {
        difficulty: math.difficulty,
        challengeBonusStars: math.challengeBonusStars
      }
    };
  }

  private listPublishedItems(): PublishedItem[] {
    const rows = this.db.prepare(`
      SELECT ci.id, cv.payload_json AS payloadJson
      FROM content_items AS ci
      JOIN content_versions AS cv
        ON cv.item_id = ci.id AND cv.version = ci.active_version
      WHERE ci.status = 'published'
      ORDER BY ci.id
    `).all() as Array<{ id: string; payloadJson: string }>;
    return rows.map((row) => ({
      id: row.id,
      payload: LearningItemPayloadSchema.parse(JSON.parse(row.payloadJson))
    }));
  }

  private recentWeakKeys(
    studentId: string,
    subject: "korean" | "math"
  ): string[] {
    const rows = this.db.prepare(`
      SELECT cv.payload_json AS payloadJson
      FROM attempts AS a
      JOIN content_items AS ci ON ci.id = a.item_id
      JOIN content_versions AS cv
        ON cv.item_id = a.item_id AND cv.version = a.content_version
      WHERE a.user_id = ? AND ci.subject = ?
        AND (
          a.dictation_pass = 0 OR a.math_pass = 0 OR
          (a.dictation_pass IS NULL AND a.math_pass IS NULL
            AND a.reading_pass = 0)
        )
      ORDER BY a.created_at DESC, a.id DESC
      LIMIT 20
    `).all(studentId, subject) as Array<{ payloadJson: string }>;
    return [...new Set(rows.map((row) => learningKey(
      LearningItemPayloadSchema.parse(JSON.parse(row.payloadJson))
    )))];
  }

  private chooseItem(input: {
    items: PublishedItem[];
    subject: "korean" | "math";
    step: LearningStep;
    difficulty: number;
    weakKeys: string[];
    studyDate: string;
    excludedIds: Set<string>;
  }): PublishedItem {
    const target = targetLevel(input.difficulty, input.step);
    const weakIndex = new Map(input.weakKeys.map((key, index) => [key, index]));
    const candidates = input.items
      .filter((item) =>
        item.payload.subject === input.subject &&
        !input.excludedIds.has(item.id)
      )
      .sort((left, right) => {
        const distance = Math.abs(numericLevel(left.payload) - target) -
          Math.abs(numericLevel(right.payload) - target);
        if (distance !== 0) return distance;
        const weak = (weakIndex.get(learningKey(left.payload)) ?? 1_000) -
          (weakIndex.get(learningKey(right.payload)) ?? 1_000);
        if (weak !== 0) return weak;
        const affinity = stepAffinity(left.payload, input.step) -
          stepAffinity(right.payload, input.step);
        if (affinity !== 0) return affinity;
        const shuffled = stableDateRank(
          `${input.studyDate}:${input.subject}:${input.step}:${left.id}`
        ) - stableDateRank(
          `${input.studyDate}:${input.subject}:${input.step}:${right.id}`
        );
        return shuffled || left.id.localeCompare(right.id);
      });
    const selected = candidates[0];
    if (selected === undefined) {
      throw new Error(`DAILY_STEP_ITEM_MISSING:${input.subject}:${input.step}`);
    }
    return selected;
  }
}
