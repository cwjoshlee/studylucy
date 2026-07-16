import type { ReadingResult } from "../../shared/reading";

export const READING_PASS_SCORE = 85;

export type ReadingTarget = {
  text: string;
  question?: string;
  tokens: readonly string[];
};

export function judgeReading(
  target: ReadingTarget,
  rawTranscript: string
): ReadingResult {
  const expectedText = getExpectedReadingText(target);
  const transcript = prepareTranscriptForJudging(rawTranscript, expectedText);
  const expected = normalizeReadingText(expectedText);
  const heard = normalizeReadingText(transcript);
  const expectedJamo = toJamo(expected);
  const distance = levenshtein(expectedJamo, toJamo(heard));
  const similarity = Math.max(0, 1 - distance / Math.max(expectedJamo.length, 1));
  const tokenHits = target.tokens.filter((token) => {
    const normalized = normalizeReadingText(token);
    return heard.includes(normalized) || numberAliases(normalized).some((alias) =>
      heard.includes(normalizeReadingText(alias))
    );
  });
  const missedTokens = target.tokens.filter((token) => !tokenHits.includes(token));
  const tokenScore = tokenHits.length / Math.max(target.tokens.length, 1);
  const score = Math.round((similarity * 0.58 + tokenScore * 0.42) * 100);

  return {
    score,
    passed: score >= READING_PASS_SCORE && missedTokens.length === 0,
    missedTokens: [...missedTokens]
  };
}

export function getExpectedReadingText(target: ReadingTarget): string {
  return [target.text, target.question].filter(Boolean).join(" ");
}

export function prepareTranscriptForJudging(
  rawTranscript: string,
  expectedText: string
): string {
  const transcript = cleanSpeechText(rawTranscript);
  const transcriptWords = transcript.split(" ").filter(Boolean);
  const expectedWords = cleanSpeechText(expectedText).split(" ").filter(Boolean);

  if (
    transcriptWords.length <= Math.max(
      expectedWords.length * 2,
      expectedWords.length + 8
    )
  ) {
    return transcript;
  }

  return findBestTranscriptWindow(
    transcriptWords,
    expectedText,
    expectedWords.length
  );
}

export function normalizeReadingText(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[.,!?~\s]/g, "")
    .replace(/영/g, "0")
    .replace(/공/g, "0")
    .replace(/일/g, "1")
    .replace(/하나/g, "1")
    .replace(/이/g, "2")
    .replace(/둘/g, "2")
    .replace(/삼/g, "3")
    .replace(/셋/g, "3")
    .replace(/사/g, "4")
    .replace(/넷/g, "4")
    .replace(/오/g, "5")
    .replace(/다섯/g, "5")
    .replace(/육/g, "6")
    .replace(/여섯/g, "6")
    .replace(/칠/g, "7")
    .replace(/일곱/g, "7")
    .replace(/팔/g, "8")
    .replace(/여덟/g, "8")
    .replace(/구/g, "9")
    .replace(/아홉/g, "9")
    .replace(/십/g, "10")
    .replace(/열/g, "10");
}

export function levenshtein(a: string, b: string): number {
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  const current = Array.from({ length: b.length + 1 }, () => 0);

  for (let row = 1; row <= a.length; row += 1) {
    current[0] = row;
    for (let column = 1; column <= b.length; column += 1) {
      const cost = a[row - 1] === b[column - 1] ? 0 : 1;
      current[column] = Math.min(
        current[column - 1]! + 1,
        previous[column]! + 1,
        previous[column - 1]! + cost
      );
    }
    for (let column = 0; column <= b.length; column += 1) {
      previous[column] = current[column]!;
    }
  }

  return previous[b.length]!;
}

function cleanSpeechText(value: string): string {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function findBestTranscriptWindow(
  words: string[],
  expectedText: string,
  expectedWordCount: number
): string {
  const minSize = Math.max(4, expectedWordCount - 5);
  const maxSize = Math.min(words.length, expectedWordCount + 10);
  let bestText = words.join(" ");
  let bestScore = -1;

  for (let size = minSize; size <= maxSize; size += 1) {
    for (let start = 0; start <= words.length - size; start += 1) {
      const candidate = words.slice(start, start + size).join(" ");
      const score = transcriptSimilarity(expectedText, candidate);
      if (score > bestScore) {
        bestScore = score;
        bestText = candidate;
      }
    }
  }

  return cleanSpeechText(bestText);
}

function transcriptSimilarity(expectedText: string, candidateText: string): number {
  const expected = toJamo(normalizeReadingText(expectedText));
  const candidate = toJamo(normalizeReadingText(candidateText));
  return 1 - levenshtein(expected, candidate) / Math.max(expected.length, 1);
}

function numberAliases(value: string): string[] {
  const aliases: Record<string, string[]> = {
    "1": ["하나", "일"],
    "2": ["둘", "이"],
    "3": ["셋", "삼"],
    "4": ["넷", "사"],
    "5": ["다섯", "오"],
    "6": ["여섯", "육"],
    "7": ["일곱", "칠"],
    "8": ["여덟", "팔"],
    "9": ["아홉", "구"],
    "10": ["열", "십"]
  };
  return aliases[value] ?? [];
}

function toJamo(value: string): string {
  return value.normalize("NFD");
}
