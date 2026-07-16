import Database from "better-sqlite3";
import type BetterSqlite3 from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";

const MANAGED_BACKUP_PATTERN =
  /^sua-learning-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.sqlite$/;

export type BackupRun = {
  status: "success" | "failure";
  filename: string | null;
  finishedAt: string;
  errorCode: string | null;
};

type BackupPhase =
  | "directory"
  | "backup"
  | "integrity"
  | "finalize"
  | "weekly"
  | "metadata";

const BACKUP_ERROR_CODES: Record<BackupPhase, string> = {
  directory: "BACKUP_DIRECTORY_FAILED",
  backup: "BACKUP_COPY_FAILED",
  integrity: "BACKUP_INTEGRITY_FAILED",
  finalize: "BACKUP_FINALIZE_FAILED",
  weekly: "BACKUP_WEEKLY_COPY_FAILED",
  metadata: "BACKUP_METADATA_FAILED"
};

function backupFilename(now: Date): string {
  const timestamp = now.toISOString().replaceAll(":", "-").replaceAll(".", "-");
  return `sua-learning-${timestamp}.sqlite`;
}

function isSunday(now: Date, timeZone: string): boolean {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short"
  }).format(now) === "Sun";
}

function recordRun(
  db: BetterSqlite3.Database,
  run: BackupRun
): void {
  db.prepare(`
    INSERT INTO backup_runs (id, status, path, error_code, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    randomUUID(),
    run.status,
    run.filename,
    run.errorCode,
    run.finishedAt
  );
}

function verifyIntegrity(path: string): void {
  const copy = new Database(path, { readonly: true, fileMustExist: true });
  try {
    const result = copy.pragma("integrity_check", { simple: true });
    if (result !== "ok") {
      throw new Error("BACKUP_INTEGRITY_FAILED");
    }
  } finally {
    copy.close();
  }
}

async function removeSidecars(path: string): Promise<void> {
  await Promise.all([
    rm(`${path}-shm`, { force: true }),
    rm(`${path}-wal`, { force: true })
  ]);
}

async function rotateDirectory(path: string, keep: number): Promise<void> {
  await mkdir(path, { recursive: true });
  const expired = (await readdir(path))
    .filter((filename) => MANAGED_BACKUP_PATTERN.test(filename))
    .sort((left, right) => right.localeCompare(left))
    .slice(keep);
  await Promise.all(expired.map((filename) =>
    rm(join(path, filename), { force: true })
  ));
}

export async function rotateBackups(
  backupDir: string,
  dailyKeep = 14,
  weeklyKeep = 8
): Promise<void> {
  await Promise.all([
    rotateDirectory(join(backupDir, "daily"), dailyKeep),
    rotateDirectory(join(backupDir, "weekly"), weeklyKeep)
  ]);
}

export async function createBackup(
  db: BetterSqlite3.Database,
  backupDir: string,
  now: Date,
  timeZone = "Asia/Seoul"
): Promise<BackupRun> {
  const finishedAt = now.toISOString();
  const filename = backupFilename(now);
  const dailyDir = join(backupDir, "daily");
  const weeklyDir = join(backupDir, "weekly");
  const finalPath = join(dailyDir, filename);
  const temporaryPath = join(dailyDir, `.${filename}.${randomUUID()}.tmp`);
  const weeklyPath = join(weeklyDir, filename);
  const weeklyTemporaryPath = join(
    weeklyDir,
    `.${filename}.${randomUUID()}.tmp`
  );
  let phase: BackupPhase = "directory";

  try {
    await mkdir(dailyDir, { recursive: true });
    phase = "backup";
    await db.backup(temporaryPath);
    phase = "integrity";
    verifyIntegrity(temporaryPath);
    await removeSidecars(temporaryPath);
    phase = "finalize";
    await rename(temporaryPath, finalPath);
    if (isSunday(now, timeZone)) {
      phase = "weekly";
      await mkdir(weeklyDir, { recursive: true });
      await copyFile(finalPath, weeklyTemporaryPath);
      await rename(weeklyTemporaryPath, weeklyPath);
    }
    const run: BackupRun = {
      status: "success",
      filename,
      finishedAt,
      errorCode: null
    };
    phase = "metadata";
    recordRun(db, run);
    return run;
  } catch {
    await Promise.all([
      rm(temporaryPath, { force: true }),
      rm(weeklyTemporaryPath, { force: true }),
      removeSidecars(temporaryPath)
    ]).catch(() => undefined);
    const run: BackupRun = {
      status: "failure",
      filename: null,
      finishedAt,
      errorCode: BACKUP_ERROR_CODES[phase]
    };
    recordRun(db, run);
    return run;
  }
}
