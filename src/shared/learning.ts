import { z } from "zod";
import {
  IdleEventInputSchema,
  IdleEventResultSchema,
  StudentStarSummarySchema,
  type StudentStarSummary
} from "./stars";
import { StudyDateSchema } from "./study-date";
import { LearningDelightSchema } from "./companions";

const BaseItem = z.object({
  id: z.string().min(1),
  subject: z.enum(["korean", "math"]),
  unit: z.string().min(1),
  title: z.string().min(1),
  level: z.string().min(1),
  readLabel: z.string().min(1),
  text: z.string().min(1),
  hint: z.string(),
  tokens: z.array(z.string().min(1)).min(1),
  delight: LearningDelightSchema.optional()
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

export const LearningSessionRequestSchema = z.object({
  planId: z.string().min(1),
  itemId: z.string().min(1),
  contentVersion: z.number().int().positive()
});

export type LearningSessionRequest = z.infer<
  typeof LearningSessionRequestSchema
>;

export type LearningSessionReceipt = {
  learningSessionId: string;
  activeUntil: string;
  submitUntil: string;
};

export const TodayPlanSchema = z.object({
  planId: z.string().min(1),
  planKind: z.enum(["daily", "recovery"]),
  recoverySourcePlanId: z.string().nullable(),
  date: StudyDateSchema,
  submitUntil: z.string().datetime({ offset: true }),
  offlineEpoch: z.number().int().positive(),
  activityCursor: z.number().int().nonnegative(),
  studentDisplayName: z.string().min(1),
  completedItemIds: z.array(z.string().min(1)),
  requiredItemIds: z.array(z.string().min(1)),
  stars: StudentStarSummarySchema,
  items: z.array(z.object({
    id: z.string().min(1),
    version: z.number().int().positive(),
    payload: LearningItemPayloadSchema
  }))
});

export type TodayPlan = z.infer<typeof TodayPlanSchema>;

export type GuardianProgress = {
  completedItems: number;
  totalAttempts: number;
  readingPassRate: number;
  mathPassRate: number;
  recentReviewTokens: Array<{ token: string; count: number }>;
};

export const GuardianOfflineRejectionSchema = z.object({
  id: z.string().min(1),
  studyDate: StudyDateSchema,
  itemId: z.string().min(1),
  itemTitle: z.string().min(1),
  kind: z.enum(["attempt", "idle"]),
  code: z.string().min(1),
  createdAt: z.string().datetime({ offset: true })
}).strict();

export type GuardianOfflineRejection = z.infer<
  typeof GuardianOfflineRejectionSchema
>;

export const GuardianOfflineRejectionsSchema = z.object({
  rejections: z.array(GuardianOfflineRejectionSchema)
}).strict();

export type GuardianOfflineRejections = z.infer<
  typeof GuardianOfflineRejectionsSchema
>;

export const StarAwardReceiptSchema = z.object({
  awarded: z.boolean(),
  amount: z.number().int().nonnegative(),
  balance: z.number().int().nonnegative(),
  eventId: z.string().nullable()
});

export type StarAwardReceipt = z.infer<typeof StarAwardReceiptSchema>;

export const AttemptReceiptSchema = z.object({
  id: z.string().min(1),
  duplicate: z.boolean(),
  readingPass: z.boolean(),
  mathPass: z.boolean().nullable(),
  completed: z.boolean(),
  starAward: StarAwardReceiptSchema,
  activityCursor: z.number().int().nonnegative()
});

export type AttemptReceipt = z.infer<typeof AttemptReceiptSchema>;

export const RecoveryPlanRequestSchema = z.object({
  sourcePlanId: z.string().min(1)
}).strict();

export type RecoveryPlanRequest = z.infer<typeof RecoveryPlanRequestSchema>;

export const LegacyAttemptInputSchema = AttemptInputSchema.omit({
  planId: true,
  occurredAt: true
}).strict();

export type LegacyAttemptInput = z.infer<typeof LegacyAttemptInputSchema>;

export const LegacyIdleEventInputSchema = IdleEventInputSchema.omit({
  learningSessionId: true,
  planId: true,
  contentVersion: true
}).strict();

export type LegacyIdleEventInput = z.infer<typeof LegacyIdleEventInputSchema>;

const DeviceSequenceSchema = z.number().int().nonnegative();

export const ActivityEventSchema = z.union([
  z.object({
    kind: z.literal("attempt"),
    deviceSequence: DeviceSequenceSchema,
    legacy: z.literal(false),
    payload: AttemptInputSchema
  }),
  z.object({
    kind: z.literal("attempt"),
    deviceSequence: DeviceSequenceSchema,
    legacy: z.literal(true),
    payload: LegacyAttemptInputSchema
  }),
  z.object({
    kind: z.literal("idle"),
    deviceSequence: DeviceSequenceSchema,
    legacy: z.literal(false),
    payload: IdleEventInputSchema
  }),
  z.object({
    kind: z.literal("idle"),
    deviceSequence: DeviceSequenceSchema,
    legacy: z.literal(true),
    payload: LegacyIdleEventInputSchema
  })
]);

export type ActivityEvent = z.infer<typeof ActivityEventSchema>;

export const OfflineBatchInputSchema = z.object({
  clientBatchId: z.string().min(12).max(80),
  planId: z.string().min(1),
  offlineEpoch: z.number().int().positive(),
  startCursor: z.number().int().nonnegative(),
  events: z.array(ActivityEventSchema).min(1).max(100)
}).strict();

export type OfflineBatchInput = z.infer<typeof OfflineBatchInputSchema>;

export const ActivityReceiptSchema = z.object({
  clientId: z.string().min(1),
  kind: z.enum(["attempt", "idle"]),
  status: z.enum([
    "APPLIED",
    "DUPLICATE",
    "REJECTED",
    "ORDER_CONFLICT_WAIVED"
  ]),
  code: z.string().nullable(),
  attempt: AttemptReceiptSchema.nullable(),
  idle: IdleEventResultSchema.nullable()
});

export type ActivityReceipt = z.infer<typeof ActivityReceiptSchema>;

export const OfflineBatchReceiptSchema = z.object({
  clientBatchId: z.string().min(1),
  duplicate: z.boolean(),
  orderConflict: z.boolean(),
  batchEndCursor: z.number().int().nonnegative(),
  activityCursor: z.number().int().nonnegative(),
  receipts: z.array(ActivityReceiptSchema),
  processedPlan: TodayPlanSchema,
  currentDailyPlan: TodayPlanSchema,
  stars: StudentStarSummarySchema
});

export type OfflineBatchReceipt = z.infer<typeof OfflineBatchReceiptSchema>;

export type SyncResult = { sent: number; remaining: number };
