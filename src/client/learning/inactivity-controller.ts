const HINT_AT_MS = 120_000;
const CONFIRM_AT_MS = 240_000;
const DEDUCT_AT_MS = 300_000;

export type InactivityActivity =
  | "touch"
  | "keyboard"
  | "answer"
  | "speech-result"
  | "hint"
  | "continue"
  | "생각 중이에요";

export type InactivityPauseReason =
  | "document-hidden"
  | "screen-lock"
  | "server-wait"
  | "celebration";

export type InactivityEvent =
  | { type: "hint" }
  | { type: "confirm" }
  | {
    type: "deduct";
    idleStartedAt: string;
    occurredAt: string;
  }
  | { type: "active"; activity: InactivityActivity };

export type InactivityController = {
  start(): void;
  pause(reason: InactivityPauseReason): void;
  resume(reason: InactivityPauseReason | "deduction"): void;
  recordActivity(activity: InactivityActivity): void;
  stop(): void;
};

export function createInactivityController({
  onEvent,
  now = () => Date.now()
}: {
  onEvent: (event: InactivityEvent) => void;
  now?: () => number;
}): InactivityController {
  let started = false;
  const pauseReasons = new Set<InactivityPauseReason>();
  let deductionPaused = false;
  let elapsedMs = 0;
  let stage = 0;
  let segmentStartedAt: number | null = null;
  let idleStartedAt = now();
  let timer: ReturnType<typeof setTimeout> | null = null;

  function clearTimer(): void {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function captureActiveTime(): void {
    if (segmentStartedAt !== null) {
      elapsedMs += Math.max(0, now() - segmentStartedAt);
      segmentStartedAt = now();
    }
  }

  function nextThreshold(): number | null {
    if (stage === 0) return HINT_AT_MS;
    if (stage === 1) return CONFIRM_AT_MS;
    if (stage === 2) return DEDUCT_AT_MS;
    return null;
  }

  function schedule(): void {
    clearTimer();
    if (!started || isPaused()) return;
    const threshold = nextThreshold();
    if (threshold === null) return;
    timer = setTimeout(reachThreshold, Math.max(0, threshold - elapsedMs));
  }

  function reachThreshold(): void {
    timer = null;
    captureActiveTime();

    if (stage === 0 && elapsedMs >= HINT_AT_MS) {
      stage = 1;
      onEvent({ type: "hint" });
    } else if (stage === 1 && elapsedMs >= CONFIRM_AT_MS) {
      stage = 2;
      onEvent({ type: "confirm" });
    } else if (stage === 2 && elapsedMs >= DEDUCT_AT_MS) {
      stage = 3;
      deductionPaused = true;
      segmentStartedAt = null;
      onEvent({
        type: "deduct",
        idleStartedAt: new Date(idleStartedAt).toISOString(),
        occurredAt: new Date(now()).toISOString()
      });
    }
    schedule();
  }

  function isPaused(): boolean {
    return deductionPaused || pauseReasons.size > 0;
  }

  function startController(): void {
    if (started) return;
    started = true;
    pauseReasons.clear();
    deductionPaused = false;
    elapsedMs = 0;
    stage = 0;
    idleStartedAt = now();
    segmentStartedAt = now();
    schedule();
  }

  return {
    start: startController,

    pause(reason) {
      if (!started) return;
      if (!isPaused()) captureActiveTime();
      pauseReasons.add(reason);
      segmentStartedAt = null;
      clearTimer();
    },

    resume(reason) {
      if (!started) {
        startController();
        return;
      }
      const wasPaused = isPaused();
      if (reason === "deduction") {
        deductionPaused = false;
      } else {
        pauseReasons.delete(reason);
      }
      if (!wasPaused || isPaused()) return;
      segmentStartedAt = now();
      schedule();
    },

    recordActivity(activity) {
      elapsedMs = 0;
      stage = 0;
      idleStartedAt = now();
      segmentStartedAt = started && !isPaused() ? now() : null;
      onEvent({ type: "active", activity });
      schedule();
    },

    stop() {
      clearTimer();
      started = false;
      pauseReasons.clear();
      deductionPaused = false;
      elapsedMs = 0;
      stage = 0;
      segmentStartedAt = null;
    }
  };
}
