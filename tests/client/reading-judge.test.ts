import { describe, expect, it } from "vitest";
import type { LearningItemPayload } from "../../src/shared/learning";
import {
  READING_PASS_SCORE,
  judgeReading
} from "../../src/client/learning/reading-judge";

const koreanItem: LearningItemPayload = {
  id: "ko-reading-01",
  subject: "korean",
  unit: "동화 읽기",
  title: "바람과 꽃",
  level: "1단계",
  readLabel: "소리 내어 읽기",
  text: "바람이 불자 작은 꽃이 고개를 들고, 밝은 해를 바라보았어요.",
  hint: "천천히 읽어 봐요.",
  tokens: ["바람", "작은 꽃", "고개", "밝은 해", "바라보았어요"],
  kind: "korean-reading"
};

describe("judgeReading", () => {
  it("passes an exact Korean reading", () => {
    expect(judgeReading(koreanItem, koreanItem.text)).toEqual({
      score: 100,
      passed: true,
      missedTokens: []
    });
  });

  it("normalizes punctuation and spacing before scoring", () => {
    const transcript = "  바람이 불자!  작은 꽃이 고개를 들고 밝은 해를 바라보았어요? ";

    expect(judgeReading(koreanItem, transcript)).toEqual({
      score: 100,
      passed: true,
      missedTokens: []
    });
  });

  it("fails when a required token is missing even above the score threshold", () => {
    const result = judgeReading(
      koreanItem,
      koreanItem.text.replace("바람이 ", "")
    );

    expect(result.score).toBeGreaterThanOrEqual(READING_PASS_SCORE);
    expect(result.passed).toBe(false);
    expect(result.missedTokens).toContain("바람");
  });

  it("requires a score of at least 85 even when every required token is heard", () => {
    const target: LearningItemPayload = {
      ...koreanItem,
      text: "바람 꽃 가나 다라 마바 사아 자차 타카 파하",
      tokens: ["바람", "꽃"]
    };

    const nearEnough = judgeReading(target, "바람 꽃 가나 다라 마바 사아 자차 타카");
    const tooDifferent = judgeReading(target, "바람 꽃 가나 다라");

    expect(nearEnough.score).toBeGreaterThanOrEqual(READING_PASS_SCORE);
    expect(nearEnough.passed).toBe(true);
    expect(tooDifferent.score).toBeLessThan(READING_PASS_SCORE);
    expect(tooDifferent.passed).toBe(false);
  });
});
