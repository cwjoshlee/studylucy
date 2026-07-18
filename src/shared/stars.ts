import { z } from "zod";
import { StudyDateSchema } from "./study-date";

export const StarReasonSchema = z.enum([
  "REQUIRED_ITEM_COMPLETED",
  "IDLE_TIMEOUT",
  "MISSED_DAILY_PLAN",
  "GUARDIAN_BONUS",
  "GUARDIAN_ADJUSTMENT",
  "REWARD_REDEMPTION",
  "REVERSAL",
  "NO_BALANCE_AUDIT",
  "CHALLENGE_PERFECT"
]);

export type StarReason = z.infer<typeof StarReasonSchema>;

export type StarEvent = {
  id: string;
  requestedDelta: number;
  delta: number;
  balanceAfter: number;
  reason: StarReason;
  reasonText: string;
  studyDate: string;
  itemId: string | null;
  actorType: "system" | "guardian";
  createdAt: string;
  reversesEventId: string | null;
};

export const StudentStarSummarySchema = z.object({
  balance: z.number().int().nonnegative(),
  earnedToday: z.number().int().nonnegative(),
  deductedToday: z.number().int().nonnegative(),
  lastReason: z.string().nullable()
});

export type StudentStarSummary = z.infer<typeof StudentStarSummarySchema>;

export type AppliedStarResult = {
  event: StarEvent;
  duplicate: boolean;
};

export const IdleEventInputSchema = z.object({
  clientIdleEventId: z.string().min(12).max(80),
  learningSessionId: z.string().min(12).max(80),
  planId: z.string().min(1),
  itemId: z.string().min(1),
  contentVersion: z.number().int().positive(),
  studyDate: StudyDateSchema,
  idleStartedAt: z.string().datetime({ offset: true }),
  occurredAt: z.string().datetime({ offset: true })
});

export type IdleEventInput = z.infer<typeof IdleEventInputSchema>;

export const IdleEventResultSchema = z.object({
  id: z.string().min(1),
  outcome: z.enum([
    "applied",
    "capped",
    "no-balance",
    "order-conflict-waived"
  ]),
  starEventId: z.string().nullable(),
  duplicate: z.boolean(),
  activityCursor: z.number().int().nonnegative()
});

export type IdleEventResult = z.infer<typeof IdleEventResultSchema>;

export const ManualStarInputSchema = z.object({
  delta: z.number().int().min(-100).max(100)
    .refine((value) => value !== 0),
  reason: z.string().trim().min(1).max(200),
  clientCommandId: z.string().min(12).max(80)
});

export const ApprovalInputSchema = z.object({
  approvedStars: z.number().int().min(0).max(2),
  note: z.string().trim().max(200).default("")
});

export const NoteInputSchema = z.object({
  note: z.string().trim().min(1).max(200)
});

export const SubjectStepSettingsSchema = z.object({
  difficulty: z.number().int().min(1).max(5),
  challengeBonusStars: z.number().int().min(0).max(5)
}).strict();

export type SubjectStepSettings = z.infer<typeof SubjectStepSettingsSchema>;

export const DailyPlanInputSchema = z.object({
  koreanTarget: z.number().int().min(0).max(10).default(2),
  mathTarget: z.number().int().min(0).max(10).default(2),
  isRestDay: z.boolean(),
  subjectSettings: z.object({
    korean: SubjectStepSettingsSchema,
    math: SubjectStepSettingsSchema
  }).strict().optional()
}).strict();

export type ManualStarInput = z.infer<typeof ManualStarInputSchema>;
export type ApprovalInput = z.infer<typeof ApprovalInputSchema>;
export type DailyPlanInput = z.infer<typeof DailyPlanInputSchema>;

export type GuardianDailyPlan = {
  studyDate: string;
  isRestDay: boolean;
  subjectSettings: Record<"korean" | "math", SubjectStepSettings>;
  requiredItemIds: string[];
  /** @deprecated Retained while older guardian clients migrate to subjectSettings. */
  koreanTarget: number;
  /** @deprecated Retained while older guardian clients migrate to subjectSettings. */
  mathTarget: number;
};

export type PendingStarAdjustment = {
  id: string;
  studyDate: string;
  itemId: string;
  requestedStars: number;
  approvedStars: number | null;
  appliedStars: number | null;
  status: "pending" | "approved" | "waived";
  note: string | null;
  starEventId: string | null;
  createdAt: string;
  processedAt: string | null;
};

export type ProcessedStarAdjustment = PendingStarAdjustment & {
  duplicate: boolean;
};

export type GuardianStarEvent = StarEvent & {
  isReversed: boolean;
};

export type GuardianStarLedger = {
  summary: StudentStarSummary;
  events: GuardianStarEvent[];
  nextCursor: string | null;
};
