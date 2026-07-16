import {
  type FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState
} from "react";
import type {
  AttemptInput,
  AttemptReceipt,
  LearningItemPayload,
  TodayPlan
} from "../../shared/learning";
import type { ReadingResult } from "../../shared/reading";
import type { IdleEventResult } from "../../shared/stars";
import type { ApiClient } from "../api/client";
import { StarCelebration } from "../delight/star-celebration";
import {
  createInactivityController,
  type InactivityActivity,
  type InactivityController,
  type InactivityEvent
} from "./inactivity-controller";
import { judgeReading } from "./reading-judge";
import {
  createSpeechController,
  isSpeechRecognitionSupported,
  type SpeechController
} from "./speech-recognition";

type LearningApi = Pick<ApiClient, "saveAttempt" | "sendIdleEvent">;
type PlanItem = TodayPlan["items"][number];
type SessionItem = LearningItemPayload | PlanItem;

export type LearningSessionProps = {
  item: SessionItem;
  api: LearningApi;
  studyDate?: string;
  contentVersion?: number;
  reducedMotion?: boolean;
  onNext?: () => void;
  idFactory?: (prefix: "learning-session" | "attempt" | "idle-event") => string;
};

type IdleUi =
  | { phase: "hint" }
  | { phase: "confirm" }
  | { phase: "waiting" }
  | { phase: "paused"; message: string }
  | null;

const IDLE_RESULT_TEXT: Record<IdleEventResult["outcome"], string> = {
  applied: "5분 동안 학습 활동이 없어서 별 1개가 줄었어요. 준비되면 다시 시작할 수 있어요.",
  capped: "오늘은 별이 더 줄지 않아요. 준비되면 다시 시작할 수 있어요.",
  "no-balance": "5분 동안 학습 활동이 없었어요. 줄어들 별은 없고 기록만 남겼어요."
};

export function LearningSession(props: LearningSessionProps) {
  const resolved = resolveItem(props.item, props.contentVersion);
  return (
    <LearningSessionView
      {...props}
      key={`${resolved.payload.id}:${resolved.version}`}
      item={resolved.payload}
      contentVersion={resolved.version}
      studyDate={props.studyDate ?? kstStudyDate()}
    />
  );
}

function LearningSessionView({
  item,
  api,
  studyDate,
  contentVersion,
  reducedMotion,
  onNext,
  idFactory = createClientId
}: Omit<LearningSessionProps, "item" | "studyDate" | "contentVersion"> & {
  item: LearningItemPayload;
  studyDate: string;
  contentVersion: number;
}) {
  const [learningSessionId] = useState(() => idFactory("learning-session"));
  const [viewStartedAt] = useState(() => Date.now());
  const [manualTranscript, setManualTranscript] = useState("");
  const [readingResult, setReadingResult] = useState<ReadingResult | null>(null);
  const [mathAnswer, setMathAnswer] = useState("");
  const [mathFeedback, setMathFeedback] = useState("");
  const [nextUnlocked, setNextUnlocked] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [idleUi, setIdleUi] = useState<IdleUi>(null);
  const [showHint, setShowHint] = useState(false);
  const [difficultyFeedback, setDifficultyFeedback] = useState<AttemptInput["difficultyFeedback"]>(null);
  const [attemptReceipt, setAttemptReceipt] = useState<AttemptReceipt | null>(null);
  const [speechListening, setSpeechListening] = useState(false);
  const controllerRef = useRef<InactivityController | null>(null);
  const speechRef = useRef<SpeechController | null>(null);
  const learningControlsPaused = waiting || idleUi?.phase === "paused";

  const recordActivity = useCallback((activity: InactivityActivity) => {
    controllerRef.current?.recordActivity(activity);
  }, []);

  const handleIdleDeduction = useCallback(async (
    event: Extract<InactivityEvent, { type: "deduct" }>
  ) => {
    controllerRef.current?.pause("server-wait");
    setWaiting(true);
    setIdleUi({ phase: "waiting" });
    const clientIdleEventId = idFactory("idle-event");
    try {
      const result = await api.sendIdleEvent({
        clientIdleEventId,
        learningSessionId,
        itemId: item.id,
        studyDate,
        idleStartedAt: event.idleStartedAt,
        occurredAt: event.occurredAt
      });
      setIdleUi({ phase: "paused", message: IDLE_RESULT_TEXT[result.outcome] });
    } catch {
      setIdleUi({
        phase: "paused",
        message: "쉬는 기록을 보내지 못했어요. 준비되면 다시 시작해 주세요."
      });
    } finally {
      setWaiting(false);
      controllerRef.current?.resume("server-wait");
    }
  }, [api, idFactory, item.id, learningSessionId, studyDate]);

  const handleInactivityEvent = useCallback((event: InactivityEvent) => {
    if (event.type === "hint") {
      setIdleUi({ phase: "hint" });
      return;
    }
    if (event.type === "confirm") {
      setIdleUi({ phase: "confirm" });
      return;
    }
    if (event.type === "deduct") {
      void handleIdleDeduction(event);
      return;
    }
    setIdleUi((current) =>
      current?.phase === "waiting" || current?.phase === "paused" ? current : null
    );
  }, [handleIdleDeduction]);

  useEffect(() => {
    const controller = createInactivityController({ onEvent: handleInactivityEvent });
    controllerRef.current = controller;
    controller.start();

    const handleVisibility = () => {
      if (document.hidden) controller.pause("document-hidden");
      else controller.resume("document-hidden");
    };
    const handlePageHide = () => controller.pause("screen-lock");
    const handlePageShow = () => controller.resume("screen-lock");
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("pagehide", handlePageHide);
    window.addEventListener("pageshow", handlePageShow);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("pagehide", handlePageHide);
      window.removeEventListener("pageshow", handlePageShow);
      controller.stop();
      controllerRef.current = null;
    };
  }, [handleInactivityEvent]);

  const buildAttempt = useCallback((
    result: ReadingResult,
    answer: number | null
  ): AttemptInput => ({
    clientAttemptId: idFactory("attempt"),
    itemId: item.id,
    contentVersion,
    studyDate,
    readingScore: result.score,
    missedTokens: result.missedTokens,
    mathAnswer: answer,
    durationMs: Math.min(3_600_000, Math.max(0, Date.now() - viewStartedAt)),
    difficultyFeedback
  }), [contentVersion, difficultyFeedback, idFactory, item.id, studyDate, viewStartedAt]);

  const saveReadingAttempt = useCallback(async (result: ReadingResult) => {
    controllerRef.current?.pause("server-wait");
    setWaiting(true);
    try {
      const receipt = await api.saveAttempt(buildAttempt(result, null));
      setAttemptReceipt(receipt);
      setNextUnlocked(receipt.completed);
      if (!receipt.readingPass) {
        setMathFeedback("서버 확인에서 읽기를 다시 해야 해요.");
      }
    } catch {
      setNextUnlocked(false);
      setMathFeedback("학습 기록을 저장하지 못했어요. 다시 시도해 주세요.");
    } finally {
      setWaiting(false);
      controllerRef.current?.resume("server-wait");
    }
  }, [api, buildAttempt]);

  const judgeTranscript = useCallback((transcript: string) => {
    if (learningControlsPaused) return;
    const result = judgeReading(item, transcript);
    setReadingResult(result);
    recordActivity("speech-result");
    if (item.kind === "korean-reading" && result.passed) {
      void saveReadingAttempt(result);
    } else if (!result.passed) {
      setNextUnlocked(false);
    }
  }, [item, learningControlsPaused, recordActivity, saveReadingAttempt]);

  useEffect(() => {
    const speech = createSpeechController({
      onTranscript: (transcript) => {
        setSpeechListening(false);
        if (transcript) judgeTranscript(transcript);
      },
      onActivity: () => recordActivity("speech-result")
    });
    speechRef.current = speech;
    return () => {
      speech.cancel();
      speechRef.current = null;
    };
  }, [judgeTranscript, recordActivity]);

  async function checkMathAnswer(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (
      item.kind !== "math-story" ||
      readingResult?.passed !== true ||
      learningControlsPaused
    ) return;
    if (!/^-?\d+$/.test(mathAnswer.trim())) {
      setMathFeedback("숫자로 답을 써 보세요.");
      return;
    }
    recordActivity("answer");
    controllerRef.current?.pause("server-wait");
    setWaiting(true);
    try {
      const receipt = await api.saveAttempt(
        buildAttempt(readingResult, Number(mathAnswer))
      );
      setAttemptReceipt(receipt);
      const passed = receipt.readingPass && receipt.mathPass === true;
      setNextUnlocked(receipt.completed && passed);
      setMathFeedback(passed ? "정답이에요." : "답을 다시 생각해 봐요.");
    } catch {
      setNextUnlocked(false);
      setMathFeedback("답을 확인하지 못했어요. 다시 시도해 주세요.");
    } finally {
      setWaiting(false);
      controllerRef.current?.resume("server-wait");
    }
  }

  function resumeAfterIdle(activity: "continue" | "생각 중이에요"): void {
    recordActivity(activity);
    if (activity === "생각 중이에요") setDifficultyFeedback("thinking");
    setIdleUi(null);
    controllerRef.current?.resume("deduction");
  }

  function toggleSpeech(): void {
    if (learningControlsPaused) return;
    recordActivity("touch");
    if (speechListening) {
      speechRef.current?.finish();
      setSpeechListening(false);
      return;
    }
    speechRef.current?.start();
    setSpeechListening(true);
  }

  return (
    <section
      className="learning-session"
      aria-label={`${item.title} 학습`}
      onPointerDown={() => recordActivity("touch")}
      onKeyDown={() => recordActivity("keyboard")}
    >
      <p className="subject-chip">{item.subject === "korean" ? "국어" : "수학"} · {item.unit}</p>
      <h2>{item.title}</h2>
      <p>{item.text}</p>
      {item.kind === "math-story" ? <p>{item.question}</p> : null}

      <div aria-label="읽기 연습">
        <button
          type="button"
          onClick={toggleSpeech}
          disabled={!isSpeechRecognitionSupported() || learningControlsPaused}
        >
          {speechListening ? "읽기 완료" : "읽기 시작"}
        </button>
        {!isSpeechRecognitionSupported() ? (
          <p>이 브라우저에서는 수동 입력으로 읽기를 확인해 주세요.</p>
        ) : null}
        <form onSubmit={(event) => {
          event.preventDefault();
          if (manualTranscript.trim()) judgeTranscript(manualTranscript);
        }}>
          <label>
            읽은 내용 직접 입력
            <textarea
              value={manualTranscript}
              onChange={(event) => setManualTranscript(event.target.value)}
              disabled={learningControlsPaused}
            />
          </label>
          <button type="submit" disabled={learningControlsPaused || manualTranscript.trim() === ""}>
            읽기 판정하기
          </button>
        </form>
      </div>

      {readingResult ? (
        <div role="status" aria-label="읽기 결과">
          <strong>{readingResult.passed ? "읽기 PASS" : "읽기 FAIL"}</strong>
          <span> {readingResult.score}점</span>
          {readingResult.missedTokens.length > 0 ? (
            <p>다시 읽을 표현: {readingResult.missedTokens.join(", ")}</p>
          ) : null}
        </div>
      ) : null}

      {item.kind === "math-story" ? (
        <form onSubmit={(event) => void checkMathAnswer(event)}>
          <label>
            답 쓰기
            <input
              inputMode="numeric"
              value={mathAnswer}
              onChange={(event) => {
                setMathAnswer(event.target.value);
                recordActivity("answer");
              }}
              disabled={readingResult?.passed !== true || learningControlsPaused}
            />
          </label>
          <span>{item.unitLabel}</span>
          <button type="submit" disabled={readingResult?.passed !== true || learningControlsPaused}>답 확인</button>
        </form>
      ) : null}
      {mathFeedback ? <p role="status">{mathFeedback}</p> : null}

      {idleUi?.phase === "hint" ? (
        <aside role="status">
          <p>힘들면 힌트를 열어 봐요.</p>
          <button type="button" onClick={() => {
            setShowHint(true);
            recordActivity("hint");
          }}>힌트 보기</button>
        </aside>
      ) : null}
      {idleUi?.phase === "confirm" ? (
        <aside role="alertdialog" aria-label="학습 계속 확인">
          <p>계속 할 수 있을까요?</p>
          <button type="button" onClick={() => resumeAfterIdle("continue")}>계속하기</button>
          <button type="button" onClick={() => resumeAfterIdle("생각 중이에요")}>생각 중이에요</button>
        </aside>
      ) : null}
      {idleUi?.phase === "waiting" ? <p role="status">쉬는 기록을 확인하고 있어요.</p> : null}
      {idleUi?.phase === "paused" ? (
        <aside role="alert">
          <p>{idleUi.message}</p>
          <button type="button" onClick={() => resumeAfterIdle("continue")}>학습 계속하기</button>
        </aside>
      ) : null}
      {showHint ? <p>{item.hint}</p> : null}

      <StarCelebration
        starAward={attemptReceipt?.starAward ?? null}
        reducedMotion={reducedMotion}
        onPlay={() => controllerRef.current?.pause("celebration")}
        onComplete={() => controllerRef.current?.resume("celebration")}
      />

      <button
        type="button"
        disabled={!nextUnlocked || learningControlsPaused}
        onClick={() => {
          recordActivity("continue");
          onNext?.();
        }}
      >
        다음 문제
      </button>
    </section>
  );
}

function resolveItem(
  item: SessionItem,
  contentVersion: number | undefined
): { payload: LearningItemPayload; version: number } {
  if ("payload" in item) return { payload: item.payload, version: item.version };
  return { payload: item, version: contentVersion ?? 1 };
}

function createClientId(prefix: string): string {
  const random = typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${random}`;
}

function kstStudyDate(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}
