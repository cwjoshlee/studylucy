import type Database from "better-sqlite3";
import type { CurrentUser } from "../../shared/auth";

type UserRecord = CurrentUser & {
  credentialHash: string | null;
};

export type TrustedDevice = {
  id: string;
  name: string;
};

type AuthFailureRecord = {
  failureCount: number;
  lockedUntil: string | null;
  updatedAt: string;
};

const FAILURE_WINDOW_MS = 10 * 60 * 1_000;
const LOCK_DURATION_MS = 15 * 60 * 1_000;

export class AuthRepository {
  constructor(private db: Database.Database) {}

  isSetupComplete(): boolean {
    const row = this.db.prepare(`
      SELECT
        SUM(CASE WHEN role = 'guardian' THEN 1 ELSE 0 END) AS guardians,
        SUM(CASE WHEN role = 'student' THEN 1 ELSE 0 END) AS students
      FROM users
    `).get() as { guardians: number; students: number };
    return row.guardians === 1 && row.students === 1;
  }

  bootstrapFamily(input: {
    guardianId: string;
    guardianName: string;
    guardianCredentialHash: string;
    studentId: string;
    studentName: string;
    createdAt: string;
  }): boolean {
    return this.db.transaction(() => {
      const existing = this.db.prepare("SELECT 1 FROM users LIMIT 1").get();
      if (existing !== undefined) {
        return false;
      }

      const insert = this.db.prepare(`
        INSERT INTO users (id, role, display_name, credential_hash, created_at)
        VALUES (?, ?, ?, ?, ?)
      `);
      insert.run(
        input.guardianId,
        "guardian",
        input.guardianName,
        input.guardianCredentialHash,
        input.createdAt
      );
      insert.run(
        input.studentId,
        "student",
        input.studentName,
        null,
        input.createdAt
      );
      return true;
    })();
  }

  findUserByRole(role: CurrentUser["role"]): UserRecord | null {
    const row = this.db.prepare(`
      SELECT id, role, display_name AS displayName,
             credential_hash AS credentialHash
      FROM users
      WHERE role = ?
      LIMIT 1
    `).get(role) as UserRecord | undefined;
    return row ?? null;
  }

  updateCredential(userId: string, credentialHash: string): void {
    this.db.prepare(`
      UPDATE users
      SET credential_hash = ?
      WHERE id = ?
    `).run(credentialHash, userId);
  }

  createTrustedDevice(input: {
    id: string;
    name: string;
    tokenHash: string;
    createdAt: string;
  }): void {
    this.db.prepare(`
      INSERT INTO trusted_devices (id, name, token_hash, created_at)
      VALUES (?, ?, ?, ?)
    `).run(input.id, input.name, input.tokenHash, input.createdAt);
  }

  findTrustedDevice(tokenHash: string): TrustedDevice | null {
    const row = this.db.prepare(`
      SELECT id, name
      FROM trusted_devices
      WHERE token_hash = ? AND revoked_at IS NULL
    `).get(tokenHash) as TrustedDevice | undefined;
    return row ?? null;
  }

  createSession(input: {
    id: string;
    tokenHash: string;
    userId: string;
    trustedDeviceId: string | null;
    expiresAt: string;
    createdAt: string;
  }): void {
    this.db.prepare(`
      INSERT INTO sessions (
        id, token_hash, user_id, trusted_device_id, expires_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      input.id,
      input.tokenHash,
      input.userId,
      input.trustedDeviceId,
      input.expiresAt,
      input.createdAt
    );
  }

  deleteSession(tokenHash: string): void {
    this.db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
  }

  findCurrentUser(
    sessionTokenHash: string,
    deviceTokenHash: string | null,
    now: string
  ): CurrentUser | null {
    const row = this.db.prepare(`
      SELECT u.id, u.role, u.display_name AS displayName
      FROM sessions AS s
      JOIN users AS u ON u.id = s.user_id
      LEFT JOIN trusted_devices AS d ON d.id = s.trusted_device_id
      WHERE s.token_hash = ?
        AND s.expires_at > ?
        AND (
          u.role = 'guardian'
          OR (
            u.role = 'student'
            AND d.revoked_at IS NULL
            AND d.token_hash = ?
          )
        )
      LIMIT 1
    `).get(
      sessionTokenHash,
      now,
      deviceTokenHash ?? ""
    ) as CurrentUser | undefined;
    return row ?? null;
  }

  isLocked(key: string, now: Date): boolean {
    const row = this.findFailure(key);
    return row !== null && row.lockedUntil !== null
      ? Date.parse(row.lockedUntil) > now.getTime()
      : false;
  }

  recordFailure(key: string, now: Date): boolean {
    return this.db.transaction(() => {
      const row = this.findFailure(key);
      if (
        row !== null &&
        row.lockedUntil !== null &&
        Date.parse(row.lockedUntil) > now.getTime()
      ) {
        return true;
      }

      const withinWindow =
        row !== null &&
        now.getTime() - Date.parse(row.updatedAt) <= FAILURE_WINDOW_MS;
      const failureCount = withinWindow ? row.failureCount + 1 : 1;
      const windowStartedAt = withinWindow ? row.updatedAt : now.toISOString();
      const lockedUntil =
        failureCount >= 5
          ? new Date(now.getTime() + LOCK_DURATION_MS).toISOString()
          : null;

      this.db.prepare(`
        INSERT INTO auth_failures (
          key, failure_count, locked_until, updated_at
        ) VALUES (?, ?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          failure_count = excluded.failure_count,
          locked_until = excluded.locked_until,
          updated_at = excluded.updated_at
      `).run(key, failureCount, lockedUntil, windowStartedAt);
      return lockedUntil !== null;
    })();
  }

  clearFailures(key: string): void {
    this.db.prepare("DELETE FROM auth_failures WHERE key = ?").run(key);
  }

  private findFailure(key: string): AuthFailureRecord | null {
    const row = this.db.prepare(`
      SELECT failure_count AS failureCount,
             locked_until AS lockedUntil,
             updated_at AS updatedAt
      FROM auth_failures
      WHERE key = ?
    `).get(key) as AuthFailureRecord | undefined;
    return row ?? null;
  }
}
