import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createBackup,
  rotateBackups
} from "../../src/server/backup/service";
import { runBackupCli } from "../../src/server/backup-cli";
import { openDatabase } from "../../src/server/db/client";
import { migrate } from "../../src/server/db/migrate";
import { seedInitialContent } from "../../src/server/db/seed";
import { createTestHarness } from "../helpers/app";

const CREATED_AT = "2026-07-19T03:00:00.000Z";
const STUDENT_ID = "student-backup";
const GUARDIAN_ID = "guardian-backup";

function populateBackupFixture(db: Database.Database): void {
  migrate(db);
  seedInitialContent(db);
  db.prepare(`
    INSERT INTO users (id, role, display_name, created_at)
    VALUES (?, 'guardian', '보호자', ?), (?, 'student', '수아', ?)
  `).run(GUARDIAN_ID, CREATED_AT, STUDENT_ID, CREATED_AT);
  db.prepare(`
    INSERT INTO daily_plan_settings (
      student_id, study_date, korean_target, math_target, is_rest_day,
      updated_by, updated_at
    ) VALUES (?, '2026-07-19', 3, 2, 0, ?, ?)
  `).run(STUDENT_ID, GUARDIAN_ID, CREATED_AT);
  db.prepare(`
    INSERT INTO daily_requirements (
      student_id, study_date, item_id, subject, sort_order, created_at
    ) VALUES (?, '2026-07-19', 'ko-01', 'korean', 1, ?)
  `).run(STUDENT_ID, CREATED_AT);
  db.prepare(`
    INSERT INTO attempts (
      id, client_attempt_id, user_id, item_id, content_version, study_date,
      reading_score, reading_pass, missed_tokens_json, math_answer_json,
      math_pass, duration_ms, difficulty_feedback, created_at
    ) VALUES (?, ?, ?, 'ko-01', 1, '2026-07-19', 91, 1, '[]', NULL,
      NULL, 42000, 'thinking', ?)
  `).run("attempt-backup", "client-attempt-backup", STUDENT_ID, CREATED_AT);
  db.prepare(`
    INSERT INTO student_star_balances (student_id, balance, updated_at)
    VALUES (?, 3, ?)
  `).run(STUDENT_ID, CREATED_AT);
  db.prepare(`
    INSERT INTO star_events (
      id, student_id, requested_delta, delta, balance_after, reason_code,
      reason_text, study_date, actor_type, actor_user_id, source_key, created_at
    ) VALUES (?, ?, 3, 3, 3, 'GUARDIAN_BONUS', '백업 검증 별', '2026-07-19',
      'guardian', ?, 'backup-fixture-event', ?)
  `).run("star-event-backup", STUDENT_ID, GUARDIAN_ID, CREATED_AT);
  db.prepare(`
    INSERT INTO pending_star_adjustments (
      id, student_id, study_date, item_id, requested_stars, status, created_at
    ) VALUES (?, ?, '2026-07-19', 'ko-02', 2, 'pending', ?)
  `).run("pending-backup", STUDENT_ID, CREATED_AT);
}

describe("consistent SQLite backup", () => {
  let directory: string;
  let db: Database.Database;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "sua-backup-test-"));
    db = openDatabase(join(directory, "source.sqlite"));
    populateBackupFixture(db);
  });

  afterEach(() => {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it("creates an integrity-checked daily copy containing learning and star state", async () => {
    const backupDir = join(directory, "backups");

    const result = await createBackup(
      db,
      backupDir,
      new Date(CREATED_AT)
    );

    expect(result).toEqual({
      status: "success",
      filename: "sua-learning-2026-07-19T03-00-00-000Z.sqlite",
      finishedAt: CREATED_AT,
      errorCode: null
    });
    const dailyPath = join(backupDir, "daily", result.filename!);
    expect(existsSync(dailyPath)).toBe(true);
    expect(readdirSync(join(backupDir, "daily"))).toEqual([result.filename]);

    const copy = openDatabase(dailyPath);
    try {
      expect(copy.pragma("integrity_check")).toEqual([
        { integrity_check: "ok" }
      ]);
      expect(copy.prepare("SELECT COUNT(*) AS count FROM attempts").get())
        .toEqual({ count: 1 });
      expect(copy.prepare(
        "SELECT student_id, balance FROM student_star_balances"
      ).get()).toEqual({ student_id: STUDENT_ID, balance: 3 });
      expect(copy.prepare(
        "SELECT id, delta, balance_after FROM star_events"
      ).get()).toEqual({ id: "star-event-backup", delta: 3, balance_after: 3 });
      expect(copy.prepare(
        "SELECT id, requested_stars, status FROM pending_star_adjustments"
      ).get()).toEqual({
        id: "pending-backup",
        requested_stars: 2,
        status: "pending"
      });
      expect(copy.prepare(`
        SELECT student_id, study_date, korean_target, math_target,
          is_rest_day, updated_by
        FROM daily_plan_settings
      `).get()).toEqual({
        student_id: STUDENT_ID,
        study_date: "2026-07-19",
        korean_target: 3,
        math_target: 2,
        is_rest_day: 0,
        updated_by: GUARDIAN_ID
      });
      expect(copy.prepare(`
        SELECT student_id, study_date, item_id, subject, sort_order
        FROM daily_requirements
      `).get()).toEqual({
        student_id: STUDENT_ID,
        study_date: "2026-07-19",
        item_id: "ko-01",
        subject: "korean",
        sort_order: 1
      });

      const eventBefore = copy.prepare(
        "SELECT id, reason_text FROM star_events WHERE id = ?"
      ).get("star-event-backup");
      expect(() => copy.prepare(
        "UPDATE star_events SET reason_text = 'tampered' WHERE id = ?"
      ).run("star-event-backup")).toThrowError(/STAR_EVENTS_APPEND_ONLY/);
      expect(() => copy.prepare(
        "DELETE FROM star_events WHERE id = ?"
      ).run("star-event-backup")).toThrowError(/STAR_EVENTS_APPEND_ONLY/);
      expect(copy.prepare(
        "SELECT id, reason_text FROM star_events WHERE id = ?"
      ).get("star-event-backup")).toEqual(eventBefore);

      expect(() => copy.prepare(`
        UPDATE student_star_balances
        SET balance = -1
        WHERE student_id = ?
      `).run(STUDENT_ID)).toThrowError(/CHECK constraint failed/);
      expect(copy.prepare(`
        SELECT balance
        FROM student_star_balances
        WHERE student_id = ?
      `).get(STUDENT_ID)).toEqual({ balance: 3 });
    } finally {
      copy.close();
    }
  });

  it("copies the verified Sunday backup into the weekly set", async () => {
    const backupDir = join(directory, "backups");

    const result = await createBackup(
      db,
      backupDir,
      new Date(CREATED_AT)
    );

    const dailyPath = join(backupDir, "daily", result.filename!);
    const weeklyPath = join(backupDir, "weekly", result.filename!);
    expect(existsSync(weeklyPath)).toBe(true);
    expect(readFileSync(weeklyPath)).toEqual(readFileSync(dailyPath));
  });

  it("retains the newest 14 daily and 8 weekly managed backups", async () => {
    const backupDir = join(directory, "backups");
    const dailyDir = join(backupDir, "daily");
    const weeklyDir = join(backupDir, "weekly");
    mkdirSync(dailyDir, { recursive: true });
    mkdirSync(weeklyDir, { recursive: true });
    const name = (day: number) =>
      `sua-learning-2026-06-${String(day).padStart(2, "0")}T03-00-00-000Z.sqlite`;
    for (let day = 1; day <= 16; day += 1) {
      writeFileSync(join(dailyDir, name(day)), `daily-${day}`);
    }
    for (let day = 1; day <= 10; day += 1) {
      writeFileSync(join(weeklyDir, name(day)), `weekly-${day}`);
    }
    writeFileSync(join(dailyDir, "README.txt"), "keep me");
    writeFileSync(join(weeklyDir, "notes.txt"), "keep me too");

    await rotateBackups(backupDir);

    const daily = readdirSync(dailyDir).sort();
    const weekly = readdirSync(weeklyDir).sort();
    expect(daily).toEqual([
      "README.txt",
      ...Array.from({ length: 14 }, (_, index) => name(index + 3))
    ]);
    expect(weekly).toEqual([
      "notes.txt",
      ...Array.from({ length: 8 }, (_, index) => name(index + 3))
    ]);
  });

  it("excludes impossible, malformed, and partial filenames from retention", async () => {
    const backupDir = join(directory, "backups");
    const dailyDir = join(backupDir, "daily");
    const weeklyDir = join(backupDir, "weekly");
    mkdirSync(dailyDir, { recursive: true });
    mkdirSync(weeklyDir, { recursive: true });
    const name = (day: number) =>
      `sua-learning-2026-06-${String(day).padStart(2, "0")}T03-00-00-000Z.sqlite`;
    const excluded = [
      "sua-learning-2026-02-30T03-00-00-000Z.sqlite",
      "sua-learning-2026-06-17T03-00.sqlite",
      "sua-learning-2026-06-17T03-00-00-000Z.sqlite.part",
      "sua-learning-9999-99-99T99-99-99-999Z.sqlite"
    ];
    for (let day = 1; day <= 16; day += 1) {
      writeFileSync(join(dailyDir, name(day)), `daily-${day}`);
    }
    for (let day = 1; day <= 10; day += 1) {
      writeFileSync(join(weeklyDir, name(day)), `weekly-${day}`);
    }
    for (const filename of excluded) {
      writeFileSync(join(dailyDir, filename), "excluded daily");
      writeFileSync(join(weeklyDir, filename), "excluded weekly");
    }

    await rotateBackups(backupDir);

    expect(readdirSync(dailyDir).sort()).toEqual([
      ...excluded,
      ...Array.from({ length: 14 }, (_, index) => name(index + 3))
    ].sort());
    expect(readdirSync(weeklyDir).sort()).toEqual([
      ...excluded,
      ...Array.from({ length: 8 }, (_, index) => name(index + 3))
    ].sort());
  });

  it("records a path failure using only a normalized error code", async () => {
    const blockerPath = join(directory, "regular-file");
    writeFileSync(blockerPath, "not a directory");

    const result = await createBackup(
      db,
      join(blockerPath, "backups"),
      new Date(CREATED_AT)
    );

    expect(result).toEqual({
      status: "failure",
      filename: null,
      finishedAt: CREATED_AT,
      errorCode: "BACKUP_DIRECTORY_FAILED"
    });
    const stored = db.prepare(`
      SELECT status, path, error_code, created_at
      FROM backup_runs
      ORDER BY rowid DESC
      LIMIT 1
    `).get();
    expect(stored).toEqual({
      status: "failure",
      path: null,
      error_code: "BACKUP_DIRECTORY_FAILED",
      created_at: CREATED_AT
    });
    expect(JSON.stringify({ result, stored })).toMatch(
      /^\{[\s\S]*"errorCode":"[A-Z_]+"[\s\S]*\}$/
    );
    expect(JSON.stringify({ result, stored })).not.toContain(directory);
    expect(JSON.stringify({ result, stored })).not.toMatch(
      /\/Users\/|\/home\/|\\Users\\|regular-file/
    );
  });
});

describe("guardian backup status", () => {
  let harness: Awaited<ReturnType<typeof createTestHarness>>;

  beforeEach(async () => {
    harness = await createTestHarness();
  });

  afterEach(async () => {
    await harness.close();
  });

  async function loggedInGuardian() {
    const guardian = harness.client();
    expect((await guardian.request("POST", "/api/auth/setup", {
      setupSecret: harness.config.setupSecret,
      guardianName: "보호자",
      password: "correct horse battery staple",
      studentName: "수아"
    })).statusCode).toBe(201);
    expect((await guardian.request("POST", "/api/auth/guardian/login", {
      password: "correct horse battery staple"
    })).statusCode).toBe(204);
    return guardian;
  }

  it("rejects unauthenticated and student requests", async () => {
    const anonymous = await harness.client().request(
      "GET",
      "/api/guardian/backup-status"
    );
    expect(anonymous.statusCode).toBe(401);
    expect(anonymous.json()).toEqual({ code: "AUTH_REQUIRED" });

    const student = harness.client();
    expect((await student.request("POST", "/api/auth/setup", {
      setupSecret: harness.config.setupSecret,
      guardianName: "보호자",
      password: "correct horse battery staple",
      studentName: "수아"
    })).statusCode).toBe(201);
    expect((await student.request("POST", "/api/auth/guardian/login", {
      password: "correct horse battery staple"
    })).statusCode).toBe(204);
    expect((await student.request("POST", "/api/guardian/devices/current", {
      name: "수아 태블릿", deviceType: "tablet"
    })).statusCode).toBe(201);
    expect((await student.request("PUT", "/api/auth/student-pin", {
      pin: "2580"
    })).statusCode).toBe(204);
    expect((await student.request("POST", "/api/auth/logout")).statusCode)
      .toBe(204);
    const studentLogin = await student.request(
      "POST",
      "/api/auth/student/login",
      { pin: "2580" }
    );
    expect(studentLogin.statusCode).toBe(200);
    expect(studentLogin.json()).toEqual({
      offlineAccessUntil: "2026-07-15T14:59:59.999Z"
    });

    const forbidden = await student.request(
      "GET",
      "/api/guardian/backup-status"
    );
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.json()).toEqual({ code: "ROLE_FORBIDDEN" });
  });

  it("returns only the never-run state when no backup was attempted", async () => {
    const guardian = await loggedInGuardian();

    const response = await guardian.request(
      "GET",
      "/api/guardian/backup-status"
    );

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "never-run" });
  });

  it("returns the latest success with a display-safe filename only", async () => {
    const guardian = await loggedInGuardian();
    harness.db.prepare(`
      INSERT INTO backup_runs (id, status, path, error_code, created_at)
      VALUES (?, 'failure', ?, ?, ?), (?, 'success', ?, NULL, ?)
    `).run(
      "internal-old-run-id",
      "/Users/private/old.sqlite",
      "raw error with token secret-value",
      "2026-07-18T03:00:00.000Z",
      "internal-latest-run-id",
      "/Users/private/backups/daily/sua-learning-2026-07-19T03-00-00-000Z.sqlite",
      CREATED_AT
    );

    const response = await guardian.request(
      "GET",
      "/api/guardian/backup-status"
    );

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: "success",
      finishedAt: CREATED_AT,
      filename: "sua-learning-2026-07-19T03-00-00-000Z.sqlite"
    });
    expect(response.body).not.toMatch(
      /\/Users\/|private|internal-|raw error|secret-value|token/
    );
  });

  it("omits filenames and raw diagnostics from the latest failure", async () => {
    const guardian = await loggedInGuardian();
    harness.db.prepare(`
      INSERT INTO backup_runs (id, status, path, error_code, created_at)
      VALUES (?, 'failure', ?, ?, ?)
    `).run(
      "internal-failure-run-id",
      "/Users/private/PIN-2580.sqlite",
      "EACCES /Users/private token=raw-secret",
      CREATED_AT
    );

    const response = await guardian.request(
      "GET",
      "/api/guardian/backup-status"
    );

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: "failure",
      finishedAt: CREATED_AT
    });
    expect(response.body).not.toMatch(
      /\/Users\/|private|internal-|EACCES|PIN|2580|token|raw-secret|error/i
    );
  });

  it("ignores poisoned timestamps and resolves the latest canonical status", async () => {
    const guardian = await loggedInGuardian();
    harness.db.prepare(`
      INSERT INTO backup_runs (id, status, path, error_code, created_at)
      VALUES
        (?, 'failure', NULL, 'BACKUP_COPY_FAILED', ?),
        (?, 'success', ?, NULL, ?),
        (?, 'failure', ?, ?, ?),
        (?, 'failure', NULL, 'BACKUP_COPY_FAILED', ?)
    `).run(
      "valid-older",
      "2026-07-18T03:00:00.000Z",
      "valid-latest",
      "/private/backups/sua-learning-2026-07-19T03-00-00-000Z.sqlite",
      CREATED_AT,
      "poisoned-path-timestamp",
      "/Users/private/PIN-2580.sqlite",
      "raw token=secret-value",
      "zzzz /Users/private token=secret-value PIN=2580",
      "poisoned-impossible-timestamp",
      "9999-99-99T99:99:99.999Z"
    );

    const response = await guardian.request(
      "GET",
      "/api/guardian/backup-status"
    );

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: "success",
      finishedAt: CREATED_AT,
      filename: "sua-learning-2026-07-19T03-00-00-000Z.sqlite"
    });
    expect(response.body).not.toMatch(
      /\/Users\/|PIN|2580|token|secret-value|9999-99|poisoned/
    );
  });

  it("returns never-run when every stored timestamp is noncanonical", async () => {
    const guardian = await loggedInGuardian();
    harness.db.prepare(`
      INSERT INTO backup_runs (id, status, path, error_code, created_at)
      VALUES
        ('invalid-impossible', 'failure', NULL, 'BACKUP_COPY_FAILED',
          '2026-02-30T03:00:00.000Z'),
        ('invalid-partial', 'success', 'sua-learning-2026-07-19T03-00-00-000Z.sqlite',
          NULL, '2026-07-19T03:00:00Z')
    `).run();

    const response = await guardian.request(
      "GET",
      "/api/guardian/backup-status"
    );

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "never-run" });
  });

  it("omits a noncanonical backup filename from an otherwise valid success", async () => {
    const guardian = await loggedInGuardian();
    harness.db.prepare(`
      INSERT INTO backup_runs (id, status, path, error_code, created_at)
      VALUES ('invalid-filename', 'success', ?, NULL, ?)
    `).run(
      "/private/sua-learning-9999-99-99T99-99-99-999Z.sqlite",
      CREATED_AT
    );

    const response = await guardian.request(
      "GET",
      "/api/guardian/backup-status"
    );

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: "success",
      finishedAt: CREATED_AT
    });
  });
});

describe("backup CLI", () => {
  let directory: string;

  function cliEnv(
    databasePath: string,
    backupDir: string
  ): NodeJS.ProcessEnv {
    return {
      NODE_ENV: "test",
      HOST: "127.0.0.1",
      PORT: "8787",
      DATABASE_PATH: databasePath,
      BACKUP_DIR: backupDir,
      APP_ORIGIN: "https://sua.example.test",
      SETUP_SECRET: "s".repeat(32),
      SESSION_PEPPER: "p".repeat(32),
      SESSION_DAYS: "14",
      TIME_ZONE: "Asia/Seoul"
    };
  }

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "sua-backup-cli-test-"));
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it("backs up a configured temporary database and prints one safe JSON line", async () => {
    const databasePath = join(directory, "source.sqlite");
    const backupDir = join(directory, "backups");
    const source = openDatabase(databasePath);
    populateBackupFixture(source);
    source.close();
    const output: string[] = [];

    const result = await runBackupCli({
      env: cliEnv(databasePath, backupDir),
      now: new Date(CREATED_AT),
      write: (line) => output.push(line)
    });

    expect(result.status).toBe("success");
    expect(output).toEqual([`${JSON.stringify(result)}\n`]);
    expect(output[0]).not.toContain(directory);
    expect(readdirSync(join(backupDir, "daily"))).toEqual([result.filename]);
    expect(readdirSync(join(backupDir, "weekly"))).toEqual([result.filename]);
  });

  it("records and prints a normalized rotation failure", async () => {
    const databasePath = join(directory, "source.sqlite");
    const backupDir = join(directory, "backups");
    const source = openDatabase(databasePath);
    populateBackupFixture(source);
    source.close();
    mkdirSync(backupDir, { recursive: true });
    writeFileSync(join(backupDir, "weekly"), "blocks weekly directory");
    const output: string[] = [];
    const finishedAt = "2026-07-20T03:00:00.000Z";

    const result = await runBackupCli({
      env: cliEnv(databasePath, backupDir),
      now: new Date(finishedAt),
      write: (line) => output.push(line)
    });

    expect(result).toEqual({
      status: "failure",
      filename: null,
      finishedAt,
      errorCode: "BACKUP_ROTATION_FAILED"
    });
    expect(output).toEqual([`${JSON.stringify(result)}\n`]);
    expect(output[0]).not.toContain(directory);
    const verified = openDatabase(databasePath);
    try {
      expect(verified.prepare(`
        SELECT status, path, error_code, created_at
        FROM backup_runs
        ORDER BY created_at DESC, rowid DESC
        LIMIT 1
      `).get()).toEqual({
        status: "failure",
        path: null,
        error_code: "BACKUP_ROTATION_FAILED",
        created_at: finishedAt
      });
    } finally {
      verified.close();
    }
  });
});
