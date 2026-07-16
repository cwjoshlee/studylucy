import { z } from "zod";

const STUDY_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function isRealCalendarDate(value: string): boolean {
  const match = STUDY_DATE_PATTERN.exec(value);
  if (match === null) {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const roundTrip = new Date(0);
  roundTrip.setUTCHours(0, 0, 0, 0);
  roundTrip.setUTCFullYear(year, month - 1, day);
  return roundTrip.getUTCFullYear() === year
    && roundTrip.getUTCMonth() === month - 1
    && roundTrip.getUTCDate() === day;
}

export const StudyDateSchema = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(isRealCalendarDate);

export function kstStudyDate(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export function kstDayBounds(dateString: string): {
  start: string;
  end: string;
} {
  const studyDate = StudyDateSchema.parse(dateString);
  const [year, month, day] = studyDate.split("-").map(Number) as [number, number, number];
  const localMidnight = new Date(0);
  localMidnight.setUTCHours(0, 0, 0, 0);
  localMidnight.setUTCFullYear(year, month - 1, day);
  const start = new Date(localMidnight.getTime() - 9 * 60 * 60 * 1_000);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1_000);
  return { start: start.toISOString(), end: end.toISOString() };
}
