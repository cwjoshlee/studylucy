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
  "NO_BALANCE_AUDIT"
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

export type StudentStarSummary = {
  balance: number;
  earnedToday: number;
  deductedToday: number;
  lastReason: string | null;
};

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

export type IdleEventResult = {
  id: string;
  outcome: "applied" | "capped" | "no-balance";
  starEventId: string | null;
  duplicate: boolean;
  activityCursor: number;
};

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

export const DailyPlanInputSchema = z.object({
  koreanTarget: z.number().int().min(0).max(10),
  mathTarget: z.number().int().min(0).max(10),
  isRestDay: z.boolean()
});

export type ManualStarInput = z.infer<typeof ManualStarInputSchema>;
export type ApprovalInput = z.infer<typeof ApprovalInputSchema>;
export type DailyPlanInput = z.infer<typeof DailyPlanInputSchema>;

export type GuardianDailyPlan = DailyPlanInput & {
  studyDate: string;
  requiredItemIds: string[];
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
