import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type {
  LearningSessionReceipt,
  LearningSessionRequest
} from "../../shared/learning";
import type { IdleEventInput } from "../../shared/stars";
import { IssuedPlanError } from "./issued-plan-repository";

export type LearningSessionErrorCode =
  | "LEARNING_SESSION_INVALID"
  | "LEARNING_SESSION_EXPIRED";

export class LearningSessionError extends Error {
  constructor(readonly code: LearningSessionErrorCode) {
    super(code);
  }
}

type IssuablePlanRow = {
  studyDate: string;
  submitUntil: string;
  contentVersion: number;
};

type LearningSessionRow = {
  planId: string;
  itemId: string;
  contentVersion: number;
  studyDate: string;
  issuedAt: string;
  activeUntil: string;
  submitUntil: string;
  planSubmitUntil: string;
  revokedAt: string | null;
};

export class LearningSessionRepository {
  constructor(private db: Database.Database) {}

  issue(
    studentId: string,
    trustedDeviceId: string,
    input: LearningSessionRequest,
    issuedAt: Date
  ): LearningSessionReceipt {
    return this.db.transaction(() => {
      const plan = this.findIssuablePlan(
        studentId,
        trustedDeviceId,
        input
      );
      if (plan === null) {
        throw new IssuedPlanError("PLAN_NOT_ISSUED");
      }
      if (plan.contentVersion !== input.contentVersion) {
        throw new IssuedPlanError("CONTENT_VERSION_CONFLICT");
      }
      const issuedAtMs = issuedAt.getTime();
      const submitUntilMs = Date.parse(plan.submitUntil);
      if (issuedAtMs > submitUntilMs) {
        throw new IssuedPlanError("PLAN_SUBMISSION_EXPIRED");
      }
      const activeUntil = new Date(Math.min(
        issuedAtMs + 6 * 60 * 60 * 1_000,
        submitUntilMs
      )).toISOString();
      const learningSessionId = randomUUID();
      this.db.prepare(`
        INSERT INTO issued_learning_sessions (
          id, plan_id, student_id, trusted_device_id, item_id,
          content_version, study_date, issued_at, active_until,
          submit_until, revoked_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
      `).run(
        learningSessionId,
        input.planId,
        studentId,
        trustedDeviceId,
        input.itemId,
        plan.contentVersion,
        plan.studyDate,
        issuedAt.toISOString(),
        activeUntil,
        plan.submitUntil
      );
      return {
        learningSessionId,
        activeUntil,
        submitUntil: plan.submitUntil
      };
    }).immediate();
  }

  validateIdle(
    studentId: string,
    trustedDeviceId: string,
    input: IdleEventInput,
    receivedAt: Date
  ): void {
    const session = this.db.prepare(`
      SELECT ils.plan_id AS planId, ils.item_id AS itemId,
             ils.content_version AS contentVersion,
             ils.study_date AS studyDate, ils.issued_at AS issuedAt,
             ils.active_until AS activeUntil,
             ils.submit_until AS submitUntil,
             ils.revoked_at AS revokedAt,
             idp.submit_until AS planSubmitUntil
      FROM issued_learning_sessions AS ils
      JOIN issued_daily_plans AS idp
        ON idp.id = ils.plan_id
       AND idp.student_id = ils.student_id
       AND idp.trusted_device_id = ils.trusted_device_id
      JOIN issued_plan_items AS ipi
        ON ipi.plan_id = ils.plan_id
       AND ipi.item_id = ils.item_id
       AND ipi.content_version = ils.content_version
      WHERE ils.id = ?
        AND ils.student_id = ?
        AND ils.trusted_device_id = ?
    `).get(
      input.learningSessionId,
      studentId,
      trustedDeviceId
    ) as LearningSessionRow | undefined;
    if (session === undefined || session.revokedAt !== null) {
      throw new LearningSessionError("LEARNING_SESSION_INVALID");
    }
    if (
      session.planId !== input.planId ||
      session.itemId !== input.itemId ||
      session.contentVersion !== input.contentVersion ||
      session.studyDate !== input.studyDate ||
      session.submitUntil !== session.planSubmitUntil
    ) {
      throw new LearningSessionError("LEARNING_SESSION_INVALID");
    }

    const receivedAtMs = receivedAt.getTime();
    const submitUntilMs = Date.parse(session.submitUntil);
    if (receivedAtMs > submitUntilMs) {
      throw new IssuedPlanError("PLAN_SUBMISSION_EXPIRED");
    }

    const issuedAtMs = Date.parse(session.issuedAt);
    const idleStartedAtMs = Date.parse(input.idleStartedAt);
    const occurredAtMs = Date.parse(input.occurredAt);
    if (
      !Number.isFinite(issuedAtMs) ||
      !Number.isFinite(idleStartedAtMs) ||
      !Number.isFinite(occurredAtMs) ||
      idleStartedAtMs < issuedAtMs ||
      occurredAtMs < idleStartedAtMs
    ) {
      throw new LearningSessionError("LEARNING_SESSION_INVALID");
    }

    const activeUntilMs = Math.min(
      Date.parse(session.activeUntil),
      issuedAtMs + 6 * 60 * 60 * 1_000,
      submitUntilMs
    );
    if (
      idleStartedAtMs > activeUntilMs ||
      occurredAtMs > activeUntilMs
    ) {
      throw new LearningSessionError("LEARNING_SESSION_EXPIRED");
    }
    if (occurredAtMs > receivedAtMs + 5 * 60 * 1_000) {
      throw new LearningSessionError("LEARNING_SESSION_INVALID");
    }
    if (occurredAtMs - idleStartedAtMs < 5 * 60 * 1_000) {
      throw new IssuedPlanError("INVALID_REQUEST");
    }
  }

  private findIssuablePlan(
    studentId: string,
    trustedDeviceId: string,
    input: LearningSessionRequest
  ): IssuablePlanRow | null {
    const plan = this.db.prepare(`
      SELECT idp.study_date AS studyDate,
             idp.submit_until AS submitUntil,
             ipi.content_version AS contentVersion
      FROM issued_daily_plans AS idp
      JOIN issued_plan_items AS ipi ON ipi.plan_id = idp.id
      WHERE idp.id = ?
        AND idp.student_id = ?
        AND idp.trusted_device_id = ?
        AND ipi.item_id = ?
    `).get(
      input.planId,
      studentId,
      trustedDeviceId,
      input.itemId
    ) as IssuablePlanRow | undefined;
    return plan ?? null;
  }
}
