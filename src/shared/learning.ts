import { z } from "zod";
import type { StudentStarSummary } from "./stars";
import { StudyDateSchema } from "./study-date";

const BaseItem = z.object({
  id: z.string().min(1),
  subject: z.enum(["korean", "math"]),
  unit: z.string().min(1),
  title: z.string().min(1),
  level: z.string().min(1),
  readLabel: z.string().min(1),
  text: z.string().min(1),
  hint: z.string(),
  tokens: z.array(z.string().min(1)).min(1)
});

export const LearningItemPayloadSchema = z.discriminatedUnion("kind", [
  BaseItem.extend({ kind: z.literal("korean-reading") }),
  BaseItem.extend({
    kind: z.literal("math-story"),
    question: z.string().min(1),
    answer: z.number().int(),
    unitLabel: z.string(),
    checkHint: z.string().min(1)
  })
]);

export type LearningItemPayload = z.infer<typeof LearningItemPayloadSchema>;

export const AttemptInputSchema = z.object({
  clientAttemptId: z.string().min(12).max(80),
  planId: z.string().min(1),
  itemId: z.string().min(1),
  contentVersion: z.number().int().positive(),
  studyDate: StudyDateSchema,
  occurredAt: z.string().datetime({ offset: true }),
  readingScore: z.number().int().min(0).max(100),
  missedTokens: z.array(z.string().min(1)).max(20),
  mathAnswer: z.number().int().nullable(),
  durationMs: z.number().int().min(0).max(3_600_000),
  difficultyFeedback: z.enum(["easy", "thinking", "hard"]).nullable()
});

export type AttemptInput = z.infer<typeof AttemptInputSchema>;

export type TodayPlan = {
  planId: string;
  planKind: "daily" | "recovery";
  recoverySourcePlanId: string | null;
  date: string;
  submitUntil: string;
  offlineEpoch: number;
  activityCursor: number;
  studentDisplayName: string;
  completedItemIds: string[];
  requiredItemIds: string[];
  stars: StudentStarSummary;
  items: Array<{
    id: string;
    version: number;
    payload: LearningItemPayload;
  }>;
};

export type GuardianProgress = {
  completedItems: number;
  totalAttempts: number;
  readingPassRate: number;
  mathPassRate: number;
  recentReviewTokens: Array<{ token: string; count: number }>;
};

export type StarAwardReceipt = {
  awarded: boolean;
  amount: number;
  balance: number;
  eventId: string | null;
};

export type AttemptReceipt = {
  id: string;
  duplicate: boolean;
  readingPass: boolean;
  mathPass: boolean | null;
  completed: boolean;
  starAward: StarAwardReceipt;
  activityCursor: number;
};

export type SyncResult = { sent: number; remaining: number };
