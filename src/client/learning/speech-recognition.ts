const LISTENING_LIMIT_MS = 60_000;
const RESTART_DELAY_MS = 250;

type SpeechAlternativeLike = { transcript?: string };
type SpeechResultLike = {
  0?: SpeechAlternativeLike;
  isFinal?: boolean;
};
type SpeechResultEventLike = {
  resultIndex?: number;
  results: ArrayLike<SpeechResultLike>;
};
type BrowserSpeechRecognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  addEventListener(type: "result", listener: (event: SpeechResultEventLike) => void): void;
  addEventListener(type: "end" | "error", listener: () => void): void;
};
type BrowserSpeechRecognitionConstructor = new () => BrowserSpeechRecognition;

export type SpeechController = {
  readonly supported: boolean;
  start(): void;
  finish(): void;
  cancel(): void;
};

export type SpeechControllerOptions = {
  onTranscript: (transcript: string) => void;
  onActivity?: () => void;
  onUnavailable?: () => void;
  recognitionConstructor?: BrowserSpeechRecognitionConstructor | null;
};

export function isSpeechRecognitionSupported(): boolean {
  return resolveRecognitionConstructor(undefined) !== null;
}

export function createSpeechController(
  options: SpeechControllerOptions
): SpeechController {
  const Recognition = resolveRecognitionConstructor(options.recognitionConstructor);
  if (Recognition === null) {
    return {
      supported: false,
      start: () => options.onUnavailable?.(),
      finish: () => undefined,
      cancel: () => undefined
    };
  }

  const recognition = new Recognition();
  recognition.lang = "ko-KR";
  recognition.interimResults = true;
  recognition.continuous = true;

  let listening = false;
  let finishing = false;
  let deadline = 0;
  let stopTimer: ReturnType<typeof setTimeout> | null = null;
  let restartTimer: ReturnType<typeof setTimeout> | null = null;
  let committedParts: string[] = [];
  let sessionResults: string[] = [];
  let interimTranscript = "";

  recognition.addEventListener("result", (event) => {
    const startIndex = Number.isInteger(event.resultIndex) ? event.resultIndex! : 0;
    let interim = "";
    for (let index = startIndex; index < event.results.length; index += 1) {
      const result = event.results[index];
      const transcript = cleanSpeechText(result?.[0]?.transcript ?? "");
      if (!transcript) continue;
      if (result?.isFinal) sessionResults[index] = transcript;
      else interim = `${interim} ${transcript}`.trim();
    }
    interimTranscript = interim;
    options.onActivity?.();
  });

  recognition.addEventListener("end", () => {
    if (listening && !finishing && Date.now() < deadline) {
      commitSession();
      restartTimer = setTimeout(() => {
        restartTimer = null;
        if (listening && !finishing) startEngine();
      }, RESTART_DELAY_MS);
      return;
    }
    complete();
  });

  recognition.addEventListener("error", () => {
    if (listening && !finishing && Date.now() < deadline) {
      commitSession();
      restartTimer = setTimeout(() => {
        restartTimer = null;
        if (listening && !finishing) startEngine();
      }, RESTART_DELAY_MS);
      return;
    }
    complete();
  });

  function clearTimers(): void {
    if (stopTimer !== null) clearTimeout(stopTimer);
    if (restartTimer !== null) clearTimeout(restartTimer);
    stopTimer = null;
    restartTimer = null;
  }

  function startEngine(): void {
    try {
      recognition.start();
    } catch {
      options.onUnavailable?.();
      complete();
    }
  }

  function commitSession(): void {
    const text = collapseSpeechSegments([...sessionResults, interimTranscript]);
    if (text) addCollapsedSpeechPart(committedParts, text);
    sessionResults = [];
    interimTranscript = "";
  }

  function complete(): void {
    if (!listening && !finishing) return;
    commitSession();
    listening = false;
    finishing = false;
    clearTimers();
    const transcript = collapseSpeechSegments(committedParts);
    options.onTranscript(transcript);
  }

  function finishCapture(): void {
    if (!listening) return;
    finishing = true;
    clearTimers();
    try {
      recognition.stop();
    } catch {
      complete();
    }
  }

  return {
    supported: true,

    start() {
      if (listening) return;
      committedParts = [];
      sessionResults = [];
      interimTranscript = "";
      listening = true;
      finishing = false;
      deadline = Date.now() + LISTENING_LIMIT_MS;
      stopTimer = setTimeout(finishCapture, LISTENING_LIMIT_MS);
      startEngine();
    },

    finish: finishCapture,

    cancel() {
      const wasActive = listening || finishing;
      listening = false;
      finishing = false;
      clearTimers();
      committedParts = [];
      sessionResults = [];
      interimTranscript = "";
      if (wasActive) {
        try {
          recognition.abort();
        } catch {
          // The browser may already have ended recognition.
        }
      }
    }
  };
}

export function collapseSpeechSegments(segments: string[]): string {
  const sourceSegments = segments.splice(0, segments.length);
  const collapsed: string[] = [];
  for (const segment of sourceSegments) addCollapsedSpeechPart(collapsed, segment);
  return cleanSpeechText(collapsed.join(" "));
}

function addCollapsedSpeechPart(parts: string[], value: string): void {
  const cleaned = cleanSpeechText(value);
  const previous = parts.at(-1) ?? "";
  if (!cleaned) return;
  if (!previous) {
    parts.push(cleaned);
    return;
  }
  if (cleaned === previous || previous.includes(cleaned) || previous.endsWith(cleaned)) return;
  if (cleaned.startsWith(previous) || cleaned.includes(previous)) {
    parts[parts.length - 1] = cleaned;
    return;
  }
  const merged = mergeOverlappingSpeech(previous, cleaned);
  if (merged) parts[parts.length - 1] = merged;
  else parts.push(cleaned);
}

function mergeOverlappingSpeech(previous: string, next: string): string {
  const previousWords = previous.split(" ");
  const nextWords = next.split(" ");
  for (let size = Math.min(previousWords.length, nextWords.length); size > 0; size -= 1) {
    if (
      previousWords.slice(-size).join(" ") ===
      nextWords.slice(0, size).join(" ")
    ) {
      return cleanSpeechText([...previousWords, ...nextWords.slice(size)].join(" "));
    }
  }
  return "";
}

function cleanSpeechText(value: string): string {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function resolveRecognitionConstructor(
  explicit: BrowserSpeechRecognitionConstructor | null | undefined
): BrowserSpeechRecognitionConstructor | null {
  if (explicit !== undefined) return explicit;
  if (typeof window === "undefined") return null;
  const speechWindow = window as typeof window & {
    SpeechRecognition?: BrowserSpeechRecognitionConstructor;
    webkitSpeechRecognition?: BrowserSpeechRecognitionConstructor;
  };
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition ?? null;
}
