import { z } from "zod";
import {
  IdleEventInputSchema,
  IdleEventResultSchema,
  StudentStarSummarySchema,
  type StudentStarSummary
} from "./stars";
import { StudyDateSchema } from "./study-date";
import { LearningDelightSchema } from "./companions";

export type ChanaPingEvent =
  | "lesson-open" | "speech-start" | "speech-finish" | "correct"
  | "retry" | "thinking" | "idle-confirm" | "idle-paused" | "next";

export type AiCoachProvider = "gemini" | "openai";
export type AiCoachSettingsView = {
  enabled: boolean;
  provider: AiCoachProvider;
  model: string;
  monthlyBudgetWon: number;
  monthSpentWon: number;
  hasApiKey: boolean;
};
export const CoachMessageRequestSchema = z.object({
  event: z.enum(["lesson-open", "speech-start", "speech-finish", "correct", "retry", "thinking", "idle-confirm", "idle-paused", "next"]),
  subject: z.enum(["korean", "math"]),
  retryCount: z.number().int().min(0).max(20),
  hintStage: z.enum(["none", "first", "step"])
}).strict();
export type CoachMessageRequest = z.infer<typeof CoachMessageRequestSchema>;
export type CoachMessageResponse = { message: string; source: "llm" | "local" };

const BaseItemSchema = z.object({
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

const CalculationOperandSchema = z.number().int().min(0).max(99);
export const CalculationExtensionSchema = z.object({
  operands: z.union([
    z.tuple([CalculationOperandSchema, CalculationOperandSchema]),
    z.tuple([CalculationOperandSchema, CalculationOperandSchema, CalculationOperandSchema])
  ]),
  operators: z.union([
    z.tuple([z.literal("+")]),
    z.tuple([z.literal("-")]),
    z.tuple([z.literal("+"), z.literal("+")]),
    z.tuple([z.literal("+"), z.literal("-")]),
    z.tuple([z.literal("-"), z.literal("+")]),
    z.tuple([z.literal("-"), z.literal("-")])
  ]),
  layout: z.enum(["horizontal", "vertical"])
}).strict();

type BaseItem = z.infer<typeof BaseItemSchema>;

export const LearningStepSchema = z.enum(["foundation", "current", "challenge"]);
export type LearningStep = z.infer<typeof LearningStepSchema>;

export type AiProviderSettingsView = {
  provider: "gemini" | "openai";
  enabled: boolean;
  model: string;
  hasApiKey: boolean;
};

export const KoreanDictationItemSchema = BaseItemSchema.extend({
  kind: z.literal("korean-dictation"),
  promptText: z.string().min(1),
  answerText: z.string().min(1),
  mode: z.enum(["word", "sentence"])
});
export type KoreanDictationItem = BaseItem & {
  kind: "korean-dictation";
  promptText: string;
  answerText: string;
  mode: "word" | "sentence";
};

const MathStoryItemSchema = BaseItemSchema.extend({
  kind: z.literal("math-story"),
  question: z.string().min(1),
  answer: z.number().int(),
  unitLabel: z.string(),
  checkHint: z.string().min(1),
  calculation: CalculationExtensionSchema.optional()
}).superRefine((payload, context) => {
  const calculation = payload.calculation;
  if (calculation === undefined) return;
  if (payload.subject !== "math") {
    context.addIssue({
      code: "custom",
      path: ["subject"],
      message: "CALCULATION_REQUIRES_MATH_SUBJECT"
    });
  }
  if (!["받아올림과 받아내림", "세 수의 혼합 계산"].includes(payload.unit)) {
    context.addIssue({
      code: "custom",
      path: ["unit"],
      message: "CALCULATION_UNIT_INVALID"
    });
  }
  if (calculation.operators.length !== calculation.operands.length - 1) {
    context.addIssue({
      code: "custom",
      path: ["calculation", "operators"],
      message: "CALCULATION_OPERATOR_LENGTH_MISMATCH"
    });
    return;
  }
  if (calculation.layout === "vertical" && calculation.operands.length !== 2) {
    context.addIssue({
      code: "custom",
      path: ["calculation", "layout"],
      message: "CALCULATION_VERTICAL_REQUIRES_TWO_OPERANDS"
    });
    return;
  }
  let result = calculation.operands[0];
  for (let index = 0; index < calculation.operators.length; index += 1) {
    const operand = calculation.operands[index + 1]!;
    result = calculation.operators[index] === "+"
      ? result + operand
      : result - operand;
    if (result < 0 || result > 99) {
      context.addIssue({
        code: "custom",
        path: ["calculation", "operands", index + 1],
        message: result < 0
          ? "CALCULATION_NEGATIVE_INTERMEDIATE"
          : "CALCULATION_INTERMEDIATE_ABOVE_KEYPAD_MAX"
      });
      return;
    }
  }
  if (payload.answer < 0 || payload.answer > 99) {
    context.addIssue({
      code: "custom",
      path: ["answer"],
      message: "CALCULATION_ANSWER_OUT_OF_KEYPAD_RANGE"
    });
  }
  if (result !== payload.answer) {
    context.addIssue({
      code: "custom",
      path: ["answer"],
      message: "CALCULATION_ANSWER_MISMATCH"
    });
  }
});

export const LearningItemPayloadSchema = z.discriminatedUnion("kind", [
  BaseItemSchema.extend({ kind: z.literal("korean-reading") }),
  KoreanDictationItemSchema,
  MathStoryItemSchema
]);

export type LearningItemPayload = z.infer<typeof LearningItemPayloadSchema>;
export type PlanItem = {
  id: string;
  version: number;
  step: LearningStep;
  payload: LearningItemPayload;
};
export type CalculationItem = Extract<LearningItemPayload, { kind: "math-story" }> & {
  calculation: z.infer<typeof CalculationExtensionSchema>;
};

export function isCalculationItem(payload: LearningItemPayload): payload is CalculationItem {
  return payload.kind === "math-story" && payload.calculation !== undefined;
}

export function evaluateAttemptCompletion(
  payload: LearningItemPayload,
  input: Pick<AttemptInput, "readingScore" | "missedTokens" | "mathAnswer">
): Pick<AttemptReceipt, "readingPass" | "mathPass" | "completed"> {
  const isCalculation = isCalculationItem(payload);
  const readingPass = isCalculation
    ? true
    : input.readingScore >= 85 && input.missedTokens.length === 0;
  const mathPass = payload.kind === "math-story" || isCalculation
    ? input.mathAnswer !== null && input.mathAnswer === payload.answer
    : null;
  return {
    readingPass,
    mathPass,
    completed: isCalculation ? mathPass === true : readingPass && (mathPass ?? true)
  };
}

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
  dictationText: z.string().optional(),
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
    step: LearningStepSchema.default("current"),
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
