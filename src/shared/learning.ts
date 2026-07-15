import { z } from "zod";

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
  itemId: z.string().min(1),
  contentVersion: z.number().int().positive(),
  studyDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  readingScore: z.number().int().min(0).max(100),
  missedTokens: z.array(z.string().min(1)).max(20),
  mathAnswer: z.number().int().nullable(),
  durationMs: z.number().int().min(0).max(3_600_000),
  difficultyFeedback: z.enum(["easy", "thinking", "hard"]).nullable()
});

export type AttemptInput = z.infer<typeof AttemptInputSchema>;

export type TodayPlan = {
  date: string;
  completedItemIds: string[];
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

export type AttemptReceipt = {
  id: string;
  duplicate: boolean;
  readingPass: boolean;
  mathPass: boolean | null;
  completed: boolean;
};

export type SyncResult = { sent: number; remaining: number };
