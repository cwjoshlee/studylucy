// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ProblemBreakdown } from "../../src/client/learning/problem-breakdown-view";
import {
  extractNumberClues,
  mathScaffold,
  splitKoreanSentences
} from "../../src/client/learning/problem-breakdown";
import type { LearningItemPayload } from "../../src/shared/learning";

afterEach(cleanup);

const mathItem: Extract<LearningItemPayload, { kind: "math-story" }> = {
  id: "math-test",
  kind: "math-story",
  subject: "math",
  unit: "덧셈",
  title: "등불을 세어요",
  level: "2단계",
  readLabel: "수학 이야기를 읽어요",
  text: "파란 집에 노란 등불 13개가 있어요. 초록 등불 5개도 켰어요.",
  hint: "두 수를 먼저 찾아봐요.",
  tokens: ["파란 집", "노란 등불", "13개", "초록 등불", "5개", "모두"],
  question: "불이 켜진 등불은 모두 몇 개일까요?",
  answer: 18,
  unitLabel: "개",
  checkHint: "노란 등불 13개와 초록 등불 5개를 더해 봐요."
};

const koreanItem: Extract<LearningItemPayload, { kind: "korean-reading" }> = {
  id: "ko-test",
  kind: "korean-reading",
  subject: "korean",
  unit: "문장 읽기",
  title: "양말을 쓴 조개",
  level: "1단계",
  readLabel: "두 문장을 읽어요",
  text: "또또는 줄무늬 조개를 만났어요. 조개는 양말을 모자로 썼어요.",
  hint: "마침표에서 잠깐 쉬어요.",
  tokens: ["또또", "줄무늬 조개", "양말", "모자"]
};

describe("problem breakdown", () => {
  it("splits sentences, extracts repeated numbers and advances math help", () => {
    expect(splitKoreanSentences("첫 문장이에요. 둘째 문장인가요? 좋아요!"))
      .toEqual(["첫 문장이에요.", "둘째 문장인가요?", "좋아요!"]);
    expect(splitKoreanSentences("문장부호가 없어도 한 문장이에요"))
      .toEqual(["문장부호가 없어도 한 문장이에요"]);
    expect(extractNumberClues("13개와 5개, 다시 13개"))
      .toEqual(["13", "5", "13"]);
    expect(mathScaffold(mathItem, 1)).toBe(mathItem.checkHint);
    expect(mathScaffold(mathItem, 2))
      .toBe("두 수 13과 5를 찾아 표시해 봐요.");
    expect(mathScaffold(mathItem, 3))
      .toBe("어떤 계산을 할지 말해 봐요.");
    expect(mathScaffold(mathItem, 4))
      .toBe("말한 방법으로 차근차근 계산해 봐요.");
  });

  it("renders Korean sentence cards without changing the original story", () => {
    render(<ProblemBreakdown
      item={koreanItem}
      mathRetryCount={0}
      showMathScaffold={false}
    />);
    const story = screen.getByRole("group", { name: "이야기 문장" });
    const sentences = within(story).getAllByTestId("story-sentence");
    expect(sentences).toHaveLength(2);
    expect(sentences.map((node) => node.textContent).join(" "))
      .toBe(koreanItem.text);
    expect(screen.getByRole("group", { name: "오늘 만날 낱말" }))
      .toHaveTextContent("줄무늬 조개");
  });

  it("renders math clues, question, unit and the first scaffold", () => {
    render(<ProblemBreakdown
      item={mathItem}
      mathRetryCount={1}
      showMathScaffold
    />);
    const clues = screen.getByRole("group", { name: "숫자 단서" });
    expect(within(clues).getByText("13")).toBeVisible();
    expect(within(clues).getByText("5")).toBeVisible();
    expect(screen.getByRole("heading", { name: "무엇을 구할까?" }))
      .toBeVisible();
    expect(screen.getByText(mathItem.question)).toBeVisible();
    expect(screen.getByLabelText("답의 단위 개")).toBeVisible();
    expect(screen.getByRole("status", { name: "수학 도움" }))
      .toHaveTextContent(mathItem.checkHint);
  });
});
