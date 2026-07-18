import { z } from "zod";

export const CompanionIdSchema = z.enum([
  "lumi", "toto", "momo", "bongbong"
]);

export type CompanionId = z.infer<typeof CompanionIdSchema>;

const KoreanChildCueSchema = z.string()
  .trim()
  .min(1)
  .max(120)
  .regex(/[가-힣]/, "KOREAN_TEXT_REQUIRED")
  .regex(/^[^A-Za-z\r\n]+$/, "LATIN_OR_NEWLINE_FORBIDDEN")
  .superRefine((value, context) => {
    const sentenceCount = value.split(/[.!?]+/u)
      .map((part) => part.trim())
      .filter(Boolean)
      .length;
    if (sentenceCount > 2) {
      context.addIssue({
        code: "custom",
        message: "AT_MOST_TWO_SENTENCES"
      });
    }
  });

export const LearningDelightSchema = z.object({
  companion: CompanionIdSchema,
  mishap: KoreanChildCueSchema,
  openingCue: KoreanChildCueSchema,
  celebrationCue: KoreanChildCueSchema
}).strict();

export type LearningDelight = z.infer<typeof LearningDelightSchema>;
