import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type {
  StudentLoginResult,
  TrustedDeviceView
} from "../../shared/auth";
import { kstDayBounds, kstStudyDate } from "../../shared/study-date";
import type { AppConfig } from "../config";
import { hashPassword, verifyPassword } from "./password";
import {
  AuthRepository,
  type RequestAuthContext,
  type TrustedDeviceRecord
} from "./repository";
import { hashOpaqueToken, matchesSetupSecret } from "./token";

type AuthErrorCode =
  | "AUTH_INVALID"
  | "AUTH_LOCKED"
  | "DEVICE_NOT_TRUSTED"
  | "DEVICE_REVOKED"
  | "DEVICE_NOT_FOUND"
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

  isSetupComplete(): boolean {
    return this.repository.isSetupComplete();
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
    return this.createSession(guardian.id, null, now).token;
  }

  registerDevice(
    name: string,
    rawDeviceToken: string | undefined
  ): {
    device: TrustedDeviceView;
    rawToken: string | null;
    created: boolean;
  } {
    const current = this.resolveDevice(rawDeviceToken);
    if (current?.status === "active") {
      const device = this.repository.findTrustedDeviceView(current.id, current.id);
      if (device === null) throw new AuthError(404, "DEVICE_NOT_FOUND");
      return { device, rawToken: null, created: false };
    }

    const rawToken = this.deps.randomToken();
    const id = randomUUID();
    this.repository.createTrustedDevice({
      id,
      publicId: randomUUID(),
      name,
      tokenHash: hashOpaqueToken(rawToken, this.deps.config.sessionPepper),
      createdAt: this.deps.now().toISOString()
    });
    const device = this.repository.findTrustedDeviceView(id, id);
    if (device === null) throw new AuthError(404, "DEVICE_NOT_FOUND");
    return { device, rawToken, created: true };
  }

  listDevices(currentTrustedDeviceId: string | null): TrustedDeviceView[] {
    return this.repository.listTrustedDevices(currentTrustedDeviceId);
  }

  revokeDevice(
    publicId: string,
    currentTrustedDeviceId: string | null
  ): TrustedDeviceView {
    const device = this.repository.revokeTrustedDevice(
      publicId,
      currentTrustedDeviceId,
      this.deps.now().toISOString()
    );
    if (device === null) throw new AuthError(404, "DEVICE_NOT_FOUND");
    return device;
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
  ): Promise<{ token: string; result: StudentLoginResult }> {
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
    const session = this.createSession(student.id, device.id, now);
    const dayEnd = Date.parse(kstDayBounds(kstStudyDate(now)).end) - 1;
    return {
      token: session.token,
      result: {
        offlineAccessUntil: new Date(Math.min(
          dayEnd,
          Date.parse(session.expiresAt)
        )).toISOString()
      }
    };
  }

  endSession(rawSessionToken: string | undefined): void {
    if (rawSessionToken === undefined) {
      return;
    }
    this.repository.deleteSession(
      hashOpaqueToken(rawSessionToken, this.deps.config.sessionPepper)
    );
  }

  getRequestAuthContext(
    rawSessionToken: string | undefined,
    rawDeviceToken: string | undefined
  ): RequestAuthContext {
    const now = this.deps.now();
    const context = this.repository.findRequestAuthContext(
      rawSessionToken === undefined
        ? null
        : hashOpaqueToken(rawSessionToken, this.deps.config.sessionPepper),
      rawDeviceToken === undefined
        ? null
        : hashOpaqueToken(rawDeviceToken, this.deps.config.sessionPepper),
      now.toISOString()
    );
    if (
      context.user !== null &&
      context.trustedDeviceId !== null &&
      context.deviceStatus === "active"
    ) {
      this.repository.touchTrustedDevice(context.trustedDeviceId, now);
    }
    return context;
  }

  private resolveDevice(
    rawDeviceToken: string | undefined
  ): TrustedDeviceRecord | null {
    return rawDeviceToken === undefined
      ? null
      : this.repository.findTrustedDevice(
          hashOpaqueToken(rawDeviceToken, this.deps.config.sessionPepper)
        );
  }

  private findDevice(rawDeviceToken: string | undefined): TrustedDeviceRecord {
    const device = this.resolveDevice(rawDeviceToken);
    if (device === null) {
      throw new AuthError(403, "DEVICE_NOT_TRUSTED");
    }
    if (device.status === "revoked") {
      throw new AuthError(403, "DEVICE_REVOKED");
    }
    return device;
  }

  private createSession(
    userId: string,
    trustedDeviceId: string | null,
    now: Date
  ): { token: string; expiresAt: string } {
    const rawToken = this.deps.randomToken();
    const expiresAt = new Date(
      now.getTime() + this.deps.config.sessionDays * 86_400 * 1_000
    ).toISOString();
    this.repository.createSession({
      id: randomUUID(),
      tokenHash: hashOpaqueToken(rawToken, this.deps.config.sessionPepper),
      userId,
      trustedDeviceId,
      expiresAt,
      createdAt: now.toISOString()
    });
    return { token: rawToken, expiresAt };
  }
}
