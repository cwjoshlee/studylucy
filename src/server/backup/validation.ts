const CANONICAL_TIMESTAMP_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{3})Z$/;

const BACKUP_FILENAME_PATTERN =
  /^sua-learning-(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z\.sqlite$/;

export function canonicalTimestamp(value: string): string | null {
  if (!CANONICAL_TIMESTAMP_PATTERN.test(value)) {
    return null;
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString() === value ? value : null;
}

export function isCanonicalBackupFilename(filename: string): boolean {
  const match = BACKUP_FILENAME_PATTERN.exec(filename);
  if (match === null) {
    return false;
  }
  const [, year, month, day, hour, minute, second, millisecond] = match;
  return canonicalTimestamp(
    `${year}-${month}-${day}T${hour}:${minute}:${second}.${millisecond}Z`
  ) !== null;
}
