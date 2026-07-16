import { z } from "zod";

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
