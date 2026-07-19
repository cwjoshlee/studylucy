import { useEffect, useRef, useState } from "react";
import type { StarAwardReceipt } from "../../shared/learning";
import { CompanionAvatar } from "../companions/companion-avatar";

const celebratedEventIds = new Set<string>();
const CELEBRATION_DISPLAY_MS = 1_000;

export function StarCelebration({
  starAward,
  reducedMotion = prefersReducedMotion(),
  onPlay,
  onComplete,
  paused = false
}: {
  starAward: StarAwardReceipt | null;
  reducedMotion?: boolean;
  onPlay?: (eventId: string) => void;
  onComplete?: (eventId: string) => void;
  paused?: boolean;
}) {
  const [visibleEventId, setVisibleEventId] = useState<string | null>(null);
  const onPlayRef = useRef(onPlay);
  const onCompleteRef = useRef(onComplete);
  onPlayRef.current = onPlay;
  onCompleteRef.current = onComplete;

  useEffect(() => {
    const eventId = starAward?.eventId;
    if (
      paused ||
      !starAward?.awarded ||
      typeof eventId !== "string" ||
      celebratedEventIds.has(eventId)
    ) {
      return;
    }
    celebratedEventIds.add(eventId);
    setVisibleEventId(eventId);
    onPlayRef.current?.(eventId);
  }, [paused, starAward?.awarded, starAward?.eventId]);

  useEffect(() => {
    if (paused || visibleEventId === null) return;
    const eventId = visibleEventId;
    const timer = setTimeout(() => {
      setVisibleEventId(null);
      onCompleteRef.current?.(eventId);
    }, CELEBRATION_DISPLAY_MS);
    return () => clearTimeout(timer);
  }, [paused, visibleEventId]);

  if (
    paused ||
    !starAward?.awarded ||
    starAward.eventId === null ||
    starAward.eventId !== visibleEventId
  ) {
    return null;
  }

  return (
    <div
      className={reducedMotion ? "star-celebration star-celebration--still" : "star-celebration"}
      role="status"
      aria-label="별 보상"
      data-reduced-motion={String(reducedMotion)}
    >
      {!reducedMotion ? (
        <span className="star-celebration__particles" aria-hidden="true">
          {[0, 1, 2, 3, 4].map((particle) => (
            <span data-star-particle key={particle}>★</span>
          ))}
        </span>
      ) : null}
      <CompanionAvatar id="bongbong" size="small" decorative />
      <strong>별 1개를 모았어요</strong>
    </div>
  );
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;
}
