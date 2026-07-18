import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { createBackup, rotateBackups, type BackupRun } from "./backup/service";
import { parseConfig } from "./config";
import { openDatabase } from "./db/client";
import { migrate } from "./db/migrate";

type BackupCliOptions = {
  env?: NodeJS.ProcessEnv;
  now?: Date;
  write?: (line: string) => void;
};

function recordRotationFailure(
  db: ReturnType<typeof openDatabase>,
  finishedAt: string
): BackupRun {
  const failure: BackupRun = {
    status: "failure",
    filename: null,
    finishedAt,
    errorCode: "BACKUP_ROTATION_FAILED"
  };
  db.prepare(`
    INSERT INTO backup_runs (id, status, path, error_code, created_at)
    VALUES (?, 'failure', NULL, ?, ?)
  `).run(randomUUID(), failure.errorCode, failure.finishedAt);
  return failure;
}

export async function runBackupCli(
  options: BackupCliOptions = {}
): Promise<BackupRun> {
  if (options.env === undefined && existsSync(".env")) {
    loadEnvFile(".env");
  }
  const config = parseConfig(options.env ?? process.env);
  const db = openDatabase(config.databasePath);
  try {
    migrate(db);
    let result = await createBackup(
      db,
      config.backupDir,
      options.now ?? new Date(),
      config.timeZone
    );
    if (result.status === "success") {
      try {
        await rotateBackups(config.backupDir);
      } catch {
        result = recordRotationFailure(db, result.finishedAt);
      }
    }
    (options.write ?? ((line) => process.stdout.write(line)))(
      `${JSON.stringify(result)}\n`
    );
    return result;
  } finally {
    db.close();
  }
}

const entry = process.argv[1];
if (entry !== undefined && fileURLToPath(import.meta.url) === resolve(entry)) {
  void runBackupCli().then((result) => {
    if (result.status === "failure") {
      process.exitCode = 1;
    }
  }).catch(() => {
    process.stdout.write(`${JSON.stringify({
      status: "failure",
      filename: null,
      finishedAt: new Date().toISOString(),
      errorCode: "BACKUP_CLI_FAILED"
    })}\n`);
    process.exitCode = 1;
  });
}
