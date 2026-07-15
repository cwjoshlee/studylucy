import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { getDailyItems } from "../../shared/daily-order";
import type {
  AttemptInput,
  AttemptReceipt,
  GuardianProgress,
  TodayPlan
} from "../../shared/learning";
import { LearningRepository } from "./repository";

export class LearningError extends Error {
  constructor(
    readonly statusCode: 409,
    readonly code: "CONTENT_VERSION_CONFLICT"
  ) {
    super(code);
  }
}

export type LearningServiceDeps = {
  db: Database.Database;
  now: () => Date;
};

export class LearningService {
  private repository: LearningRepository;

  constructor(private deps: LearningServiceDeps) {
    this.repository = new LearningRepository(deps.db);
  }

  getTodayPlan(userId: string, date: string): TodayPlan {
    return {
      date,
      completedItemIds: this.repository.listCompletedItemIds(userId, date),
      items: getDailyItems(this.repository.listActiveItems(), date)
    };
  }

  findDuplicateAttempt(
    userId: string,
    clientAttemptId: string
  ): AttemptReceipt | null {
    return this.repository.findDuplicateAttempt(userId, clientAttemptId);
  }

  saveAttempt(userId: string, input: AttemptInput): AttemptReceipt {
    const receipt = this.repository.saveAttempt({
      ...input,
      id: randomUUID(),
      userId,
      createdAt: this.deps.now().toISOString()
    });
    if (receipt === null) {
      throw new LearningError(409, "CONTENT_VERSION_CONFLICT");
    }
    return receipt;
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
