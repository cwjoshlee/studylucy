import type Database from "better-sqlite3";
import type { CurrentUser, TrustedDeviceView } from "../../shared/auth";

type UserRecord = CurrentUser & {
  credentialHash: string | null;
};

export type TrustedDeviceRecord = {
  id: string;
  name: string;
  publicId: string;
  status: "active" | "revoked";
};

export type RequestAuthContext = {
  user: CurrentUser | null;
  trustedDeviceId: string | null;
  deviceStatus: "missing" | "unknown" | "active" | "revoked";
  sessionStatus: "missing" | "invalid" | "valid";
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
    publicId?: string;
    name: string;
    tokenHash: string;
    createdAt: string;
  }): void {
    this.db.prepare(`
      INSERT INTO trusted_devices (
        id, public_id, name, token_hash, created_at
      ) VALUES (?, ?, ?, ?, ?)
    `).run(
      input.id,
      input.publicId ?? null,
      input.name,
      input.tokenHash,
      input.createdAt
    );
  }

  findTrustedDevice(tokenHash: string): TrustedDeviceRecord | null {
    const row = this.db.prepare(`
      SELECT id, name, public_id AS publicId,
             CASE WHEN revoked_at IS NULL THEN 'active' ELSE 'revoked' END AS status
      FROM trusted_devices
      WHERE token_hash = ?
    `).get(tokenHash) as TrustedDeviceRecord | undefined;
    return row ?? null;
  }

  listTrustedDevices(currentTrustedDeviceId: string | null): TrustedDeviceView[] {
    const rows = this.db.prepare(`
      SELECT public_id AS publicId, name, created_at AS createdAt,
             last_used_at AS lastUsedAt,
             CASE WHEN revoked_at IS NULL THEN 'active' ELSE 'revoked' END AS status,
             id
      FROM trusted_devices
      ORDER BY created_at, public_id
    `).all() as Array<Omit<TrustedDeviceView, "current"> & { id: string }>;
    return rows.map(({ id, ...device }) => ({
      ...device,
      current: id === currentTrustedDeviceId
    }));
  }

  findTrustedDeviceView(
    id: string,
    currentTrustedDeviceId: string | null
  ): TrustedDeviceView | null {
    const row = this.db.prepare(`
      SELECT public_id AS publicId, name, created_at AS createdAt,
             last_used_at AS lastUsedAt,
             CASE WHEN revoked_at IS NULL THEN 'active' ELSE 'revoked' END AS status
      FROM trusted_devices
      WHERE id = ?
    `).get(id) as Omit<TrustedDeviceView, "current"> | undefined;
    return row === undefined
      ? null
      : { ...row, current: id === currentTrustedDeviceId };
  }

  touchTrustedDevice(id: string, now: Date): void {
    const cutoff = new Date(now.getTime() - 5 * 60 * 1_000).toISOString();
    this.db.prepare(`
      UPDATE trusted_devices
      SET last_used_at = ?
      WHERE id = ?
        AND revoked_at IS NULL
        AND (last_used_at IS NULL OR last_used_at <= ?)
    `).run(now.toISOString(), id, cutoff);
  }

  revokeTrustedDevice(
    publicId: string,
    currentTrustedDeviceId: string | null,
    revokedAt: string
  ): TrustedDeviceView | null {
    const revoke = this.db.transaction(() => {
      const device = this.db.prepare(`
        SELECT id FROM trusted_devices WHERE public_id = ?
      `).get(publicId) as { id: string } | undefined;
      if (device === undefined) return null;

      this.db.prepare(`
        UPDATE trusted_devices
        SET revoked_at = COALESCE(revoked_at, ?)
        WHERE id = ?
      `).run(revokedAt, device.id);
      this.db.prepare(`
        DELETE FROM sessions
        WHERE trusted_device_id = ?
          AND user_id IN (SELECT id FROM users WHERE role = 'student')
      `).run(device.id);
      if (this.tableExists("issued_learning_sessions")) {
        this.db.prepare(`
          UPDATE issued_learning_sessions
          SET revoked_at = COALESCE(revoked_at, ?)
          WHERE trusted_device_id = ?
        `).run(revokedAt, device.id);
      }
      return this.findTrustedDeviceView(device.id, currentTrustedDeviceId);
    });
    return revoke.immediate();
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

  findRequestAuthContext(
    sessionTokenHash: string | null,
    deviceTokenHash: string | null,
    now: string
  ): RequestAuthContext {
    const device = deviceTokenHash === null
      ? null
      : this.findTrustedDevice(deviceTokenHash);
    const trustedDeviceId = device?.id ?? null;
    const deviceStatus = deviceTokenHash === null
      ? "missing"
      : device?.status ?? "unknown";
    if (sessionTokenHash === null) {
      return {
        user: null,
        trustedDeviceId,
        deviceStatus,
        sessionStatus: "missing"
      };
    }

    const row = this.db.prepare(`
      SELECT u.id, u.role, u.display_name AS displayName,
             s.trusted_device_id AS sessionTrustedDeviceId
      FROM sessions AS s
      JOIN users AS u ON u.id = s.user_id
      WHERE s.token_hash = ?
        AND s.expires_at > ?
      LIMIT 1
    `).get(sessionTokenHash, now) as (
      CurrentUser & { sessionTrustedDeviceId: string | null }
    ) | undefined;
    if (row === undefined) {
      return {
        user: null,
        trustedDeviceId,
        deviceStatus,
        sessionStatus: "invalid"
      };
    }
    const user = (
      row.role === "guardian" || (
        deviceStatus === "active" &&
        row.sessionTrustedDeviceId === trustedDeviceId
      )
    )
      ? { id: row.id, role: row.role, displayName: row.displayName }
      : null;
    return { user, trustedDeviceId, deviceStatus, sessionStatus: "valid" };
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

  private tableExists(name: string): boolean {
    return this.db.prepare(`
      SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?
    `).get(name) !== undefined;
  }
}
