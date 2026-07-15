import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { CurrentUser } from "../../shared/auth";
import type { AppConfig } from "../config";
import { hashPassword, verifyPassword } from "./password";
import { AuthRepository, type TrustedDevice } from "./repository";
import { hashOpaqueToken, matchesSetupSecret } from "./token";

type AuthErrorCode =
  | "AUTH_INVALID"
  | "AUTH_LOCKED"
  | "DEVICE_NOT_TRUSTED"
  | "SETUP_ALREADY_COMPLETED"
  | "SETUP_SECRET_INVALID";

export class AuthError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: AuthErrorCode
  ) {
    super(code);
  }
}

export type AuthServiceDeps = {
  config: AppConfig;
  db: Database.Database;
  now: () => Date;
  randomToken: () => string;
};

export class AuthService {
  private repository: AuthRepository;

  constructor(private deps: AuthServiceDeps) {
    this.repository = new AuthRepository(deps.db);
  }

  async bootstrapGuardian(input: {
    setupSecret: string;
    guardianName: string;
    password: string;
    studentName: string;
  }): Promise<void> {
    if (!matchesSetupSecret(input.setupSecret, this.deps.config.setupSecret)) {
      throw new AuthError(403, "SETUP_SECRET_INVALID");
    }

    const guardianCredentialHash = await hashPassword(input.password);
    const created = this.repository.bootstrapFamily({
      guardianId: randomUUID(),
      guardianName: input.guardianName,
      guardianCredentialHash,
      studentId: randomUUID(),
      studentName: input.studentName,
      createdAt: this.deps.now().toISOString()
    });
    if (!created) {
      throw new AuthError(409, "SETUP_ALREADY_COMPLETED");
    }
  }

  async loginGuardian(password: string, remoteAddress: string): Promise<string> {
    const failureKey = `guardian:${remoteAddress}`;
    const now = this.deps.now();
    if (this.repository.isLocked(failureKey, now)) {
      throw new AuthError(429, "AUTH_LOCKED");
    }

    const guardian = this.repository.findUserByRole("guardian");
    const valid =
      guardian !== null && guardian.credentialHash !== null
        ? await verifyPassword(guardian.credentialHash, password)
        : false;
    if (!valid || guardian === null) {
      const locked = this.repository.recordFailure(failureKey, now);
      throw new AuthError(
        locked ? 429 : 401,
        locked ? "AUTH_LOCKED" : "AUTH_INVALID"
      );
    }

    this.repository.clearFailures(failureKey);
    return this.createSession(guardian.id, null, now);
  }

  registerDevice(name: string): string {
    const rawToken = this.deps.randomToken();
    this.repository.createTrustedDevice({
      id: randomUUID(),
      name,
      tokenHash: hashOpaqueToken(rawToken, this.deps.config.sessionPepper),
      createdAt: this.deps.now().toISOString()
    });
    return rawToken;
  }

  async setStudentPin(pin: string): Promise<void> {
    const student = this.repository.findUserByRole("student");
    if (student === null) {
      throw new AuthError(401, "AUTH_INVALID");
    }
    this.repository.updateCredential(student.id, await hashPassword(pin));
  }

  async loginStudent(
    pin: string,
    rawDeviceToken: string | undefined
  ): Promise<string> {
    const device = this.findDevice(rawDeviceToken);
    const failureKey = `student:${device.id}`;
    const now = this.deps.now();
    if (this.repository.isLocked(failureKey, now)) {
      throw new AuthError(429, "AUTH_LOCKED");
    }

    const student = this.repository.findUserByRole("student");
    const valid =
      student !== null && student.credentialHash !== null
        ? await verifyPassword(student.credentialHash, pin)
        : false;
    if (!valid || student === null) {
      const locked = this.repository.recordFailure(failureKey, now);
      throw new AuthError(
        locked ? 429 : 401,
        locked ? "AUTH_LOCKED" : "AUTH_INVALID"
      );
    }

    this.repository.clearFailures(failureKey);
    return this.createSession(student.id, device.id, now);
  }

  logout(rawSessionToken: string | undefined): void {
    if (rawSessionToken === undefined) {
      return;
    }
    this.repository.deleteSession(
      hashOpaqueToken(rawSessionToken, this.deps.config.sessionPepper)
    );
  }

  getCurrentUser(
    rawSessionToken: string | undefined,
    rawDeviceToken: string | undefined
  ): CurrentUser | null {
    if (rawSessionToken === undefined) {
      return null;
    }
    return this.repository.findCurrentUser(
      hashOpaqueToken(rawSessionToken, this.deps.config.sessionPepper),
      rawDeviceToken === undefined
        ? null
        : hashOpaqueToken(rawDeviceToken, this.deps.config.sessionPepper),
      this.deps.now().toISOString()
    );
  }

  private findDevice(rawDeviceToken: string | undefined): TrustedDevice {
    const device =
      rawDeviceToken === undefined
        ? null
        : this.repository.findTrustedDevice(
            hashOpaqueToken(rawDeviceToken, this.deps.config.sessionPepper)
          );
    if (device === null) {
      throw new AuthError(403, "DEVICE_NOT_TRUSTED");
    }
    return device;
  }

  private createSession(
    userId: string,
    trustedDeviceId: string | null,
    now: Date
  ): string {
    const rawToken = this.deps.randomToken();
    this.repository.createSession({
      id: randomUUID(),
      tokenHash: hashOpaqueToken(rawToken, this.deps.config.sessionPepper),
      userId,
      trustedDeviceId,
      expiresAt: new Date(
        now.getTime() + this.deps.config.sessionDays * 86_400 * 1_000
      ).toISOString(),
      createdAt: now.toISOString()
    });
    return rawToken;
  }
}
