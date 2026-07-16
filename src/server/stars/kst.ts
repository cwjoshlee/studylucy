const STUDY_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

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
  if (match === null) {
    throw new Error("INVALID_STUDY_DATE");
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const midnight = new Date(Date.UTC(year, month - 1, day));
  if (kstStudyDate(new Date(midnight.getTime() - 9 * 60 * 60_000)) !== studyDate) {
    throw new Error("INVALID_STUDY_DATE");
  }
  return new Date(Date.UTC(year, month - 1, day, 21));
}
