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
