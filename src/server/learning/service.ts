import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type {
  AttemptInput,
  AttemptReceipt,
  GuardianProgress,
  TodayPlan
} from "../../shared/learning";
import { getStudentStarSummary } from "../stars/student-summary";
import {
  IssuedPlanError,
  IssuedPlanRepository
} from "./issued-plan-repository";
import { LearningRepository } from "./repository";

export class LearningError extends Error {
  readonly statusCode: 400 | 409;

  constructor(readonly code:
    | "PLAN_NOT_ISSUED"
    | "PLAN_SUBMISSION_EXPIRED"
    | "CONTENT_VERSION_CONFLICT"
    | "INVALID_REQUEST"
  ) {
    super(code);
    this.statusCode = code === "INVALID_REQUEST" ? 400 : 409;
  }
}

export type LearningServiceDeps = {
  db: Database.Database;
  now: () => Date;
};

export class LearningService {
  private repository: LearningRepository;
  private issuedPlans: IssuedPlanRepository;

  constructor(private deps: LearningServiceDeps) {
    this.repository = new LearningRepository(deps.db);
    this.issuedPlans = new IssuedPlanRepository(deps.db, deps.now);
  }

  getTodayPlan(userId: string, trustedDeviceId: string): TodayPlan {
    const issued = this.issuedPlans.issueToday(userId, trustedDeviceId);
    return {
      planId: issued.id,
      planKind: issued.planKind,
      recoverySourcePlanId: issued.recoverySourcePlanId,
      date: issued.studyDate,
      submitUntil: issued.submitUntil,
      offlineEpoch: issued.offlineEpoch,
      activityCursor: issued.activityCursor,
      studentDisplayName: issued.studentDisplayName,
      completedItemIds: this.repository.listCompletedItemIds(userId, issued.id),
      requiredItemIds: issued.items
        .filter((item) => item.isRequired)
        .map((item) => item.id),
      stars: getStudentStarSummary(this.deps.db, userId, issued.studyDate),
      items: issued.items.map(({ id, version, payload }) => ({
        id,
        version,
        payload
      }))
    };
  }

  findDuplicateAttempt(
    userId: string,
    clientAttemptId: string
  ): AttemptReceipt | null {
    return this.repository.findDuplicateAttempt(userId, clientAttemptId);
  }

  saveAttempt(
    userId: string,
    trustedDeviceId: string,
    input: AttemptInput
  ): AttemptReceipt {
    const receivedAt = this.deps.now();
    try {
      const duplicate = this.repository.findDuplicateAttemptForIssuedPlan(
        userId,
        trustedDeviceId,
        input.planId,
        input.clientAttemptId
      );
      if (duplicate !== null) return duplicate;
      const snapshot = this.issuedPlans.validateAttempt(
        userId,
        trustedDeviceId,
        input,
        receivedAt
      );
      return this.repository.saveAttempt({
        ...input,
        id: randomUUID(),
        userId,
        createdAt: receivedAt.toISOString(),
        snapshot
      });
    } catch (error) {
      if (error instanceof IssuedPlanError) {
        throw new LearningError(error.code);
      }
      throw error;
    }
  }

  getGuardianProgress(from: string, to: string): GuardianProgress {
    const attempts = this.repository.listProgressAttempts(from, to);
    const mathAttempts = attempts.filter((attempt) => attempt.mathPass !== null);
    const tokenCounts = new Map<string, number>();
    for (const attempt of attempts) {
      for (const token of attempt.missedTokens) {
        tokenCounts.set(token, (tokenCounts.get(token) ?? 0) + 1);
      }
    }
    const completedItems = new Set(
      attempts
        .filter(
          (attempt) => attempt.readingPass && (attempt.mathPass ?? true)
        )
        .map((attempt) => `${attempt.studyDate}\0${attempt.itemId}`)
    ).size;

    return {
      completedItems,
      totalAttempts: attempts.length,
      readingPassRate: attempts.length === 0
        ? 0
        : Math.round(
            attempts.filter((attempt) => attempt.readingPass).length * 100 /
              attempts.length
          ),
      mathPassRate: mathAttempts.length === 0
        ? 0
        : Math.round(
            mathAttempts.filter((attempt) => attempt.mathPass).length * 100 /
              mathAttempts.length
          ),
      recentReviewTokens: [...tokenCounts]
        .map(([token, count]) => ({ token, count }))
        .sort((left, right) =>
          right.count - left.count || left.token.localeCompare(right.token, "ko")
        )
        .slice(0, 8)
    };
  }
}
