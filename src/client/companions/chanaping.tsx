import { useEffect, useRef, useState } from "react";
import type { ChanaPingEvent } from "../../shared/learning";
import {
  getChanaPingArt,
  getChanaPingMood,
  selectLocalChanaPingCue
} from "./chanaping-cues";

const REPEAT_WINDOW_MS = 4 * 60 * 1_000;

export function ChanaPingCoach({
  event,
  subject,
  retryCount,
  cueKey,
  hidden,
  onHide
}: {
  event: ChanaPingEvent;
  subject: "korean" | "math";
  retryCount: number;
  cueKey: string;
  hidden: boolean;
  onHide: () => void;
}) {
  const mood = getChanaPingMood(event);
  const art = getChanaPingArt(mood);
  const initialCue = selectLocalChanaPingCue({ event, subject, retryCount, key: cueKey });
  const [cue, setCue] = useState(initialCue);
  const lastCueRef = useRef({ text: initialCue, at: Date.now() });

  useEffect(() => {
    const nextCue = selectLocalChanaPingCue({ event, subject, retryCount, key: cueKey });
    const now = Date.now();
    if (
      lastCueRef.current.text === nextCue &&
      now - lastCueRef.current.at < REPEAT_WINDOW_MS
    ) return;
    lastCueRef.current = { text: nextCue, at: now };
    setCue(nextCue);
  }, [cueKey, event, retryCount, subject]);

  if (hidden) return null;

  return (
    <aside
      className="chanaping-coach"
      aria-label="차나핑 학습 코치"
      data-chanaping-mood={mood}
    >
      <img
        className="chanaping-coach__art"
        src={art}
        alt="누운 차나핑 학습 코치"
      />
      <p className="chanaping-coach__cue" role="status" aria-live="polite" aria-label="차나핑 코치">
        <strong>차나핑</strong>
        <span>{cue}</span>
      </p>
      <button
        type="button"
        className="chanaping-coach__hide"
        aria-label="차나핑 코치 숨기기"
        onClick={onHide}
      >
        숨기기
      </button>
    </aside>
  );
}
