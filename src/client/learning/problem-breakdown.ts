import type { LearningItemPayload } from "../../shared/learning";

export function splitKoreanSentences(text: string): string[] {
  return (text.match(/[^.!?]+[.!?]?/g) ?? [text])
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

export function extractNumberClues(text: string): string[] {
  return [...text.matchAll(/-?\d+(?:,\d{3})*/g)].map((match) => match[0]!);
}

export function mathScaffold(
  item: Extract<LearningItemPayload, { kind: "math-story" }>,
  retryCount: number
): string {
  const numbers = extractNumberClues(item.text);
  if (retryCount <= 1) return item.checkHint;
  if (retryCount === 2 && numbers.length > 0) {
    return `두 수 ${numbers.join("과 ")}를 찾아 표시해 봐요.`;
  }
  if (retryCount === 3) return "어떤 계산을 할지 말해 봐요.";
  return "말한 방법으로 차근차근 계산해 봐요.";
}
