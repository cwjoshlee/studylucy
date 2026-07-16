import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { missedPlanCutoff } from "./kst";
import { kstStudyDate } from "./kst";
import { DailyPlanService } from "./daily-plan";

type MissingRequirementRow = {
  studentId: string;
  itemId: string;
};

export function generateMissedPlanCandidates(
  db: Database.Database,
  targetDate: string,
  now: Date
): number {
  if (now.getTime() < missedPlanCutoff(targetDate).getTime()) {
    return 0;
  }
  return db.transaction(() => {
    const dailyPlan = new DailyPlanService(db, () => now);
    const students = db.prepare(`
      SELECT id FROM users WHERE role = 'student' ORDER BY created_at, id
    `).all() as Array<{ id: string }>;
    for (const student of students) {
      dailyPlan.ensure(student.id, targetDate);
    }
    const counts = new Map(
      (db.prepare(`
        SELECT student_id AS studentId, COUNT(*) AS count
        FROM pending_star_adjustments
        WHERE study_date = ?
        GROUP BY student_id
      `).all(targetDate) as Array<{ studentId: string; count: number }>)
        .map((row) => [row.studentId, row.count])
    );
    const missing = db.prepare(`
      SELECT dr.student_id AS studentId, dr.item_id AS itemId
      FROM daily_requirements AS dr
      WHERE dr.study_date = ?
        AND NOT EXISTS (
          SELECT 1 FROM star_events AS se
          WHERE se.student_id = dr.student_id
            AND se.study_date = dr.study_date
            AND se.item_id = dr.item_id
            AND se.reason_code = 'REQUIRED_ITEM_COMPLETED'
        )
        AND NOT EXISTS (
          SELECT 1 FROM pending_star_adjustments AS psa
          WHERE psa.student_id = dr.student_id
            AND psa.study_date = dr.study_date
            AND psa.item_id = dr.item_id
        )
      ORDER BY dr.student_id, dr.sort_order, dr.item_id
    `).all(targetDate) as MissingRequirementRow[];
    const insert = db.prepare(`
      INSERT OR IGNORE INTO pending_star_adjustments (
        id, student_id, study_date, item_id, requested_stars,
        status, created_at
      ) VALUES (?, ?, ?, ?, 1, 'pending', ?)
    `);
    let created = 0;
    for (const row of missing) {
      const count = counts.get(row.studentId) ?? 0;
      if (count >= 2) {
        continue;
      }
      const result = insert.run(
        randomUUID(),
        row.studentId,
        targetDate,
        row.itemId,
        now.toISOString()
      );
      if (result.changes === 1) {
        created += 1;
        counts.set(row.studentId, count + 1);
      }
    }
    return created;
  }).immediate();
}

function addCalendarDays(studyDate: string, days: number): string {
  const [year, month, day] = studyDate.split("-").map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day! + days));
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0")
  ].join("-");
}

export function getMaintenanceStudyDates(now: Date): string[] {
  const today = kstStudyDate(now);
  const dates: string[] = [];
  for (let daysAgo = 1; daysAgo <= 7; daysAgo += 1) {
    const studyDate = addCalendarDays(today, -daysAgo);
    if (missedPlanCutoff(studyDate).getTime() <= now.getTime()) {
      dates.push(studyDate);
    }
  }
  return dates;
}

export type MaintenanceResult = {
  processedDates: string[];
  candidatesCreated: number;
};

export function runMissedPlanCatchUp(
  db: Database.Database,
  now: Date
): MaintenanceResult {
  const processedDates = getMaintenanceStudyDates(now);
  let candidatesCreated = 0;
  for (const studyDate of processedDates) {
    candidatesCreated += generateMissedPlanCandidates(db, studyDate, now);
  }
  return { processedDates, candidatesCreated };
}
