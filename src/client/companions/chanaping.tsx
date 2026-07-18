import { useEffect, useRef, useState } from "react";
import type {
  ChanaPingEvent,
  CoachMessageRequest,
  CoachMessageResponse
} from "../../shared/learning";
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
  hintStage = "none",
  requestMessage,
  hidden,
  onHide
}: {
  event: ChanaPingEvent;
  subject: "korean" | "math";
  retryCount: number;
  cueKey: string;
  hintStage?: CoachMessageRequest["hintStage"];
  requestMessage?: (input: CoachMessageRequest, signal?: AbortSignal) => Promise<CoachMessageResponse>;
  hidden: boolean;
  onHide: () => void;
}) {
  const mood = getChanaPingMood(event);
  const art = getChanaPingArt(mood);
  const initialCue = selectLocalChanaPingCue({ event, subject, retryCount, key: cueKey });
  const [cue, setCue] = useState(initialCue);
  const [remoteCue, setRemoteCue] = useState<string | null>(null);
  const lastCueRef = useRef({ text: initialCue, at: Date.now() });
  const abortRef = useRef<AbortController | null>(null);
  const generationRef = useRef(0);
  const lastRequestRef = useRef<{ key: string; at: number } | null>(null);
  const requestMessageRef = useRef(requestMessage);

  useEffect(() => {
    requestMessageRef.current = requestMessage;
  }, [requestMessage]);

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

  useEffect(() => {
    const send = requestMessageRef.current;
    if (send === undefined) return;
    const input = { event, subject, retryCount, hintStage };
    const key = JSON.stringify(input);
    const now = Date.now();
    if (lastRequestRef.current?.key === key && now - lastRequestRef.current.at < REPEAT_WINDOW_MS) return;
    lastRequestRef.current = { key, at: now };
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const generation = ++generationRef.current;
    setRemoteCue(null);
    void send(input, controller.signal).then((response) => {
      if (!controller.signal.aborted && generation === generationRef.current && response.source === "llm") {
        setRemoteCue(response.message);
      }
    }).catch(() => undefined);
    return () => controller.abort();
  }, [event, hintStage, retryCount, subject]);

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
        <span>{remoteCue ?? cue}</span>
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
