import type { LearningItemPayload } from "../../shared/learning";
import {
  extractNumberClues,
  mathScaffold,
  splitKoreanSentences
} from "./problem-breakdown";

export type ProblemBreakdownProps = {
  item: LearningItemPayload;
  mathRetryCount: number;
  showMathScaffold: boolean;
};

export function ProblemBreakdown({
  item,
  mathRetryCount,
  showMathScaffold
}: ProblemBreakdownProps) {
  const sentences = splitKoreanSentences(item.text);

  return (
    <section className="problem-breakdown">
      <div className="story-sentences" role="group" aria-label="이야기 문장">
        {sentences.map((sentence, index) => (
          <p className="story-sentence" data-testid="story-sentence" key={index}>
            {sentence}
          </p>
        ))}
      </div>

      <div className="learning-clues" role="group" aria-label="오늘 만날 낱말">
        {item.tokens.map((token, index) => (
          <span key={`${token}-${index}`}>{token}</span>
        ))}
      </div>

      {item.kind === "math-story" && (
        <>
          <div className="number-clues" role="group" aria-label="숫자 단서">
            {extractNumberClues(item.text).map((number, index) => (
              <span key={`${number}-${index}`}>{number}</span>
            ))}
          </div>

          <section className="question-focus" aria-labelledby="question-focus-heading">
            <h3 id="question-focus-heading">무엇을 구할까?</h3>
            <p>{item.question}</p>
            <span className="unit-badge" aria-label={`답의 단위 ${item.unitLabel}`}>
              {item.unitLabel}
            </span>
          </section>

          {showMathScaffold && (
            <aside role="status" aria-label="수학 도움">
              {mathScaffold(item, mathRetryCount)}
            </aside>
          )}
        </>
      )}
    </section>
  );
}
