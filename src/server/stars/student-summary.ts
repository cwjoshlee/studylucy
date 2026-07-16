import type Database from "better-sqlite3";
import type { StudentStarSummary } from "../../shared/stars";

export const CHILD_SAFE_GUARDIAN_REASON_TEXT =
  "보호자가 별을 확인했어요.";

export function getStudentStarSummary(
  db: Database.Database,
  studentId: string,
  studyDate: string
): StudentStarSummary {
  const balance = db.prepare(`
    SELECT balance FROM student_star_balances WHERE student_id = ?
  `).get(studentId) as { balance: number } | undefined;
  const totals = db.prepare(`
    SELECT COALESCE(SUM(CASE WHEN delta > 0 THEN delta ELSE 0 END), 0)
             AS earnedToday,
           COALESCE(SUM(CASE WHEN delta < 0 THEN -delta ELSE 0 END), 0)
             AS deductedToday
    FROM star_events WHERE student_id = ? AND study_date = ?
  `).get(studentId, studyDate) as {
    earnedToday: number;
    deductedToday: number;
  };
  const latest = db.prepare(`
    SELECT reason_text AS reasonText, actor_type AS actorType
    FROM star_events
    WHERE student_id = ?
    ORDER BY rowid DESC
    LIMIT 1
  `).get(studentId) as {
    reasonText: string;
    actorType: "system" | "guardian";
  } | undefined;

  return {
    balance: balance?.balance ?? 0,
    earnedToday: totals.earnedToday,
    deductedToday: totals.deductedToday,
    lastReason: latest === undefined
      ? null
      : latest.actorType === "guardian"
        ? CHILD_SAFE_GUARDIAN_REASON_TEXT
        : latest.reasonText
  };
}
