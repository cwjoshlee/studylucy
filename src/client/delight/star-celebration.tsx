import { useEffect, useState } from "react";
import type { StarAwardReceipt } from "../../shared/learning";

const celebratedEventIds = new Set<string>();

export function StarCelebration({
  starAward,
  reducedMotion = prefersReducedMotion(),
  onPlay
}: {
  starAward: StarAwardReceipt | null;
  reducedMotion?: boolean;
  onPlay?: (eventId: string) => void;
}) {
  const [visibleEventId, setVisibleEventId] = useState<string | null>(null);

  useEffect(() => {
    const eventId = starAward?.eventId;
    if (
      !starAward?.awarded ||
      typeof eventId !== "string" ||
      celebratedEventIds.has(eventId)
    ) {
      return;
    }
    celebratedEventIds.add(eventId);
    setVisibleEventId(eventId);
    onPlay?.(eventId);
  }, [onPlay, starAward?.awarded, starAward?.eventId]);

  if (
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
      <strong>별 1개를 모았어요</strong>
    </div>
  );
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;
}
