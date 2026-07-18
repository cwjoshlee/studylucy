const STUDY_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isValidStudyDate(value: string): boolean {
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

export function kstStudyDate(value: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function missedPlanCutoff(studyDate: string): Date {
  const match = STUDY_DATE_PATTERN.exec(studyDate);
  if (match === null || !isValidStudyDate(studyDate)) {
    throw new Error("INVALID_STUDY_DATE");
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const cutoff = new Date(0);
  cutoff.setUTCHours(21, 0, 0, 0);
  cutoff.setUTCFullYear(year, month - 1, day);
  return cutoff;
}
