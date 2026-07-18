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
  LearningSessionReceipt,
  TodayPlan
} from "../../shared/learning";
import type { ReadingResult } from "../../shared/reading";
import type { IdleEventInput, IdleEventResult } from "../../shared/stars";
import type { ApiClient } from "../api/client";
import { LearningCompanion } from "../companions/learning-companion";
import type { CompanionMoment } from "../companions/cues";
import { StarCelebration } from "../delight/star-celebration";
import {
  preserveFailedAttempt,
  preserveFailedIdleEvent
} from "../offline/sync";
import {
  createInactivityController,
  type InactivityActivity,
  type InactivityController,
  type InactivityEvent
} from "./inactivity-controller";
import { CalculationKeypad } from "./calculation-keypad";
import { judgeReading } from "./reading-judge";
import { ProblemBreakdown } from "./problem-breakdown-view";
import {
  createSpeechController,
  isSpeechRecognitionSupported,
  type SpeechController,
  type SpeechPhase
} from "./speech-recognition";

type LearningApi = Pick<
  ApiClient,
  "createLearningSession" | "saveAttempt" | "sendIdleEvent"
>;
type PlanItem = TodayPlan["items"][number];

export type LearningSessionProps = {
  item: PlanItem;
  api: LearningApi;
  planId: string;
  studyDate: string;
  reducedMotion?: boolean;
  onNext?: () => void;
  onExit?: () => void;
  onActivityCursor?: (activityCursor: number) => void;
  onProvisional?: () => void;
  offlineEligibility?: "validated";
  idFactory?: (prefix: "attempt" | "idle-event") => string;
};

type LearningAuthority =
  | { phase: "issuing" }
  | { phase: "online-issued"; receipt: LearningSessionReceipt }
  | { phase: "offline-unissued" }
  | { phase: "unavailable" };

type IdleUi =
  | { phase: "hint" }
  | { phase: "confirm" }
  | { phase: "waiting" }
  | { phase: "paused"; message: string }
  | null;

const IDLE_RESULT_TEXT: Record<IdleEventResult["outcome"], string> = {
  applied: "5분 동안 학습 활동이 없어서 별 1개가 줄었어요. 준비되면 다시 시작할 수 있어요.",
  capped: "오늘은 별이 더 줄지 않아요. 준비되면 다시 시작할 수 있어요.",
  "no-balance": "5분 동안 학습 활동이 없었어요. 줄어들 별은 없고 기록만 남겼어요.",
  "order-conflict-waived": "오프라인 순서가 달라 별을 차감하지 않았어요. 준비되면 다시 시작할 수 있어요."
};

function isExplicitClientError(error: unknown): boolean {
  return error !== null &&
    typeof error === "object" &&
    "status" in error &&
    typeof error.status === "number" &&
    error.status >= 400 &&
    error.status < 500;
}

export function LearningSession(props: LearningSessionProps) {
  return (
    <LearningSessionView
      {...props}
      key={`${props.planId}:${props.item.id}:${props.item.version}`}
      item={props.item.payload}
      contentVersion={props.item.version}
      studyDate={props.studyDate}
    />
  );
}

function LearningSessionView({
  item,
  api,
  planId,
  studyDate,
  contentVersion,
  reducedMotion,
  onNext,
  onExit,
  onActivityCursor,
  onProvisional,
  offlineEligibility,
  idFactory = createClientId
}: Omit<LearningSessionProps, "item"> & {
  item: LearningItemPayload;
  studyDate: string;
  contentVersion: number;
}) {
  const [authority, setAuthority] = useState<LearningAuthority>({
    phase: "issuing"
  });
  const [viewStartedAt] = useState(() => Date.now());
  const [manualTranscript, setManualTranscript] = useState("");
  const [readingResult, setReadingResult] = useState<ReadingResult | null>(null);
  const [mathAnswer, setMathAnswer] = useState("");
  const [mathFeedback, setMathFeedback] = useState("");
  const [mathRetryCount, setMathRetryCount] = useState(0);
  const [nextUnlocked, setNextUnlocked] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [saveUiState, setSaveUiState] = useState<
    "idle" | "saving" | "queued" | "failed"
  >("idle");
  const [showNextCue, setShowNextCue] = useState(false);
  const [idleUi, setIdleUi] = useState<IdleUi>(null);
  const [showHint, setShowHint] = useState(false);
  const [difficultyFeedback, setDifficultyFeedback] = useState<AttemptInput["difficultyFeedback"]>(null);
  const [attemptReceipt, setAttemptReceipt] = useState<AttemptReceipt | null>(null);
  const [provisional, setProvisional] = useState(false);
  const [speechPhase, setSpeechPhase] = useState<SpeechPhase>("ready");
  const [speechStartedAt, setSpeechStartedAt] = useState<number | null>(null);
  const [speechElapsedSeconds, setSpeechElapsedSeconds] = useState(0);
  const [speechUnavailable, setSpeechUnavailable] = useState(false);
  const [speechNotice, setSpeechNotice] = useState<string | null>(null);
  const controllerRef = useRef<InactivityController | null>(null);
  const speechRef = useRef<SpeechController | null>(null);
  const completionCueTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const automaticNextTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const automaticNextReceiptIdRef = useRef<string | null>(null);
  const attemptGenerationRef = useRef(0);
  const attemptReceiptRef = useRef<AttemptReceipt | null>(null);
  const learningControlsPaused =
    (
      authority.phase !== "online-issued" &&
      authority.phase !== "offline-unissued"
    ) ||
    waiting ||
    idleUi?.phase === "paused";

  useEffect(() => {
    let active = true;
    void api.createLearningSession({
      planId,
      itemId: item.id,
      contentVersion
    }).then(
      (receipt) => {
        if (active) setAuthority({ phase: "online-issued", receipt });
      },
      (error: unknown) => {
        if (!active) return;
        if (error instanceof TypeError && offlineEligibility === "validated") {
          setAuthority({ phase: "offline-unissued" });
          return;
        }
        setAuthority({ phase: "unavailable" });
        onExit?.();
      }
    );
    return () => {
      active = false;
    };
  }, [api, contentVersion, item.id, offlineEligibility, onExit, planId]);

  const recordActivity = useCallback((activity: InactivityActivity) => {
    controllerRef.current?.recordActivity(activity);
  }, []);

  const handleIdleDeduction = useCallback(async (
    event: Extract<InactivityEvent, { type: "deduct" }>
  ) => {
    if (authority.phase === "offline-unissued") {
      setIdleUi({
        phase: "paused",
        message: "오프라인에서는 별을 차감하지 않아요"
      });
      return;
    }
    if (authority.phase !== "online-issued") return;
    controllerRef.current?.pause("server-wait");
    setWaiting(true);
    setIdleUi({ phase: "waiting" });
    const clientIdleEventId = idFactory("idle-event");
    const input: IdleEventInput = {
      clientIdleEventId,
      learningSessionId: authority.receipt.learningSessionId,
      planId,
      itemId: item.id,
      contentVersion,
      studyDate,
      idleStartedAt: event.idleStartedAt,
      occurredAt: event.occurredAt
    };
    try {
      const result = await api.sendIdleEvent(input);
      onActivityCursor?.(result.activityCursor);
      setIdleUi({ phase: "paused", message: IDLE_RESULT_TEXT[result.outcome] });
    } catch (error) {
      if (isExplicitClientError(error)) {
        setAuthority({ phase: "unavailable" });
        onExit?.();
        return;
      }
      const queued = await preserveFailedIdleEvent(error, input)
        .catch(() => false);
      setIdleUi({
        phase: "paused",
        message: queued
          ? "쉬는 기록을 동기화 대기 중이에요. 연결되면 확인할게요."
          : "쉬는 기록을 보내지 못했어요. 준비되면 다시 시작해 주세요."
      });
    } finally {
      setWaiting(false);
      controllerRef.current?.resume("server-wait");
    }
  }, [
    api,
    authority,
    contentVersion,
    idFactory,
    item.id,
    onActivityCursor,
    onExit,
    planId,
    studyDate
  ]);

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
    if (
      authority.phase !== "online-issued" &&
      authority.phase !== "offline-unissued"
    ) return;
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
  }, [authority.phase, handleInactivityEvent]);

  const buildAttempt = useCallback((
    result: ReadingResult,
    answer: number | null
  ): AttemptInput => ({
    clientAttemptId: idFactory("attempt"),
    planId,
    itemId: item.id,
    contentVersion,
    studyDate,
    occurredAt: new Date().toISOString(),
    readingScore: result.score,
    missedTokens: result.missedTokens,
    mathAnswer: answer,
    durationMs: Math.min(3_600_000, Math.max(0, Date.now() - viewStartedAt)),
    difficultyFeedback
  }), [contentVersion, difficultyFeedback, idFactory, item.id, planId, studyDate, viewStartedAt]);

  const clearAutomaticNext = useCallback(() => {
    if (automaticNextTimerRef.current !== null) {
      clearTimeout(automaticNextTimerRef.current);
      automaticNextTimerRef.current = null;
    }
    automaticNextReceiptIdRef.current = null;
  }, []);

  const scheduleAutomaticNext = useCallback((receiptId: string, generation: number) => {
    clearAutomaticNext();
    automaticNextReceiptIdRef.current = receiptId;
    automaticNextTimerRef.current = setTimeout(() => {
      automaticNextTimerRef.current = null;
      if (
        attemptGenerationRef.current === generation &&
        automaticNextReceiptIdRef.current === receiptId
      ) {
        automaticNextReceiptIdRef.current = null;
        onNext?.();
      }
    }, 1_500);
  }, [clearAutomaticNext, onNext]);

  useEffect(() => clearAutomaticNext, [clearAutomaticNext]);

  const beginAttempt = useCallback(() => {
    attemptGenerationRef.current += 1;
    attemptReceiptRef.current = null;
    setAttemptReceipt(null);
    if (completionCueTimerRef.current !== null) {
      clearTimeout(completionCueTimerRef.current);
      completionCueTimerRef.current = null;
    }
    clearAutomaticNext();
    setShowNextCue(false);
  }, [clearAutomaticNext]);

  const saveReadingAttempt = useCallback(async (result: ReadingResult) => {
    controllerRef.current?.pause("server-wait");
    setSaveUiState("saving");
    beginAttempt();
    setWaiting(true);
    const input = buildAttempt(result, null);
    try {
      const receipt = await api.saveAttempt(input);
      attemptReceiptRef.current = receipt;
      setAttemptReceipt(receipt);
      setSaveUiState("idle");
      if (receipt.completed && !receipt.duplicate) {
        setShowNextCue(false);
        scheduleAutomaticNext(receipt.id, attemptGenerationRef.current);
      }
      onActivityCursor?.(receipt.activityCursor);
      setNextUnlocked(receipt.completed);
      if (!receipt.readingPass) {
        setMathFeedback("서버 확인에서 읽기를 다시 해야 해요.");
      }
    } catch (error) {
      if (isExplicitClientError(error)) {
        setAuthority({ phase: "unavailable" });
        onExit?.();
        return;
      }
      const queued = await preserveFailedAttempt(error, input).catch(() => false);
      setSaveUiState(queued ? "queued" : "failed");
      setNextUnlocked(queued);
      setProvisional(queued);
      if (queued) {
        onProvisional?.();
        scheduleAutomaticNext(`queued:${input.clientAttemptId}`, attemptGenerationRef.current);
      }
      setMathFeedback(queued
        ? "학습 기록이 아직 여행 중이에요. 연결되면 확인할게요."
        : "학습 기록을 저장하지 못했어요. 다시 시도해 주세요.");
    } finally {
      setWaiting(false);
      controllerRef.current?.resume("server-wait");
    }
  }, [
    api,
    beginAttempt,
    buildAttempt,
    onActivityCursor,
    onExit,
    onProvisional,
    scheduleAutomaticNext
  ]);

  useEffect(() => {
    if (!attemptReceipt?.completed || attemptReceipt.duplicate) return;
    const generation = attemptGenerationRef.current;
    const receiptId = attemptReceipt.id;
    const timer = setTimeout(() => {
      const currentReceipt = attemptReceiptRef.current;
      completionCueTimerRef.current = null;
      if (
        attemptGenerationRef.current === generation &&
        currentReceipt?.id === receiptId &&
        currentReceipt.completed &&
        !currentReceipt.duplicate
      ) {
        setShowNextCue(true);
      }
    }, 1_000);
    completionCueTimerRef.current = timer;
    return () => {
      clearTimeout(timer);
      if (completionCueTimerRef.current === timer) {
        completionCueTimerRef.current = null;
      }
    };
  }, [attemptReceipt?.completed, attemptReceipt?.duplicate, attemptReceipt?.id]);

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
    if (speechPhase !== "listening" || speechStartedAt === null) return;
    setSpeechElapsedSeconds(Math.max(0, Math.floor((Date.now() - speechStartedAt) / 1_000)));
    const timer = setInterval(() => {
      setSpeechElapsedSeconds(Math.max(0, Math.floor((Date.now() - speechStartedAt) / 1_000)));
    }, 1_000);
    return () => clearInterval(timer);
  }, [speechPhase, speechStartedAt]);

  useEffect(() => {
    if (item.kind !== "korean-reading") return;
    const speech = createSpeechController({
      onTranscript: (transcript) => {
        if (transcript) judgeTranscript(transcript);
      },
      onPhaseChange: (phase) => {
        setSpeechPhase(phase);
        if (phase === "listening") {
          setSpeechStartedAt(Date.now());
          setSpeechElapsedSeconds(0);
        } else if (phase === "ready") {
          setSpeechStartedAt(null);
        }
      },
      onActivity: () => recordActivity("speech-result"),
      onNoResult: () => {
        setSpeechNotice("말한 내용이 들리지 않아요. 다시 읽어 볼까요?");
      },
      onUnavailable: () => {
        setSpeechUnavailable(true);
        setSpeechNotice("마이크를 사용할 수 없어요. 직접 입력으로 읽기를 확인해 주세요.");
      }
    });
    speechRef.current = speech;
    return () => {
      speech.cancel();
      speechRef.current = null;
    };
  }, [item.kind, judgeTranscript, recordActivity]);

  async function checkMathAnswer(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (
      item.kind !== "math-story" ||
      learningControlsPaused
    ) return;
    if (!/^-?\d+$/.test(mathAnswer.trim())) {
      setMathFeedback("숫자로 답을 써 보세요.");
      return;
    }
    await saveMathAnswer(
      { score: 100, passed: true, missedTokens: [] },
      Number(mathAnswer),
      item.answer
    );
  }

  async function checkCalculationAnswer(): Promise<void> {
    if (
      item.kind !== "math-calculation" ||
      learningControlsPaused ||
      !/^\d+$/.test(mathAnswer)
    ) return;
    await saveMathAnswer(
      { score: 100, passed: true, missedTokens: [] },
      Number(mathAnswer),
      item.answer
    );
  }

  async function saveMathAnswer(
    result: ReadingResult,
    answer: number,
    expectedAnswer: number
  ): Promise<void> {
    recordActivity("answer");
    controllerRef.current?.pause("server-wait");
    setSaveUiState("saving");
    beginAttempt();
    setWaiting(true);
    const input = buildAttempt(result, answer);
    try {
      const receipt = await api.saveAttempt(input);
      attemptReceiptRef.current = receipt;
      setAttemptReceipt(receipt);
      setSaveUiState("idle");
      if (receipt.completed && !receipt.duplicate) setShowNextCue(false);
      onActivityCursor?.(receipt.activityCursor);
      const passed = receipt.readingPass && receipt.mathPass === true;
      setNextUnlocked(receipt.completed && passed);
      if (!passed) setMathRetryCount((count) => count + 1);
      setMathFeedback(passed ? "정답이에요." : "답을 다시 생각해 봐요.");
    } catch (error) {
      if (isExplicitClientError(error)) {
        setAuthority({ phase: "unavailable" });
        onExit?.();
        return;
      }
      const queued = await preserveFailedAttempt(error, input).catch(() => false);
      setSaveUiState(queued ? "queued" : "failed");
      const locallyComplete = queued && answer === expectedAnswer;
      if (!locallyComplete) setMathRetryCount((count) => count + 1);
      setNextUnlocked(locallyComplete);
      setProvisional(locallyComplete);
      if (locallyComplete) onProvisional?.();
      setMathFeedback(queued
        ? "학습 기록이 아직 여행 중이에요. 연결되면 확인할게요."
        : "답을 확인하지 못했어요. 다시 시도해 주세요.");
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
    if (learningControlsPaused || speechUnavailable || speechPhase === "finishing") return;
    recordActivity("touch");
    if (speechPhase === "listening") {
      speechRef.current?.finish();
      return;
    }
    setSpeechNotice(null);
    speechRef.current?.start();
  }

  if (authority.phase === "issuing" || authority.phase === "unavailable") {
    const issuing = authority.phase === "issuing";
    return (
      <section className="learning-session" aria-label={`${item.title} 학습`}>
        {onExit ? (
          <button type="button" className="button-secondary" onClick={onExit}>
            대시보드로 돌아가기
          </button>
        ) : null}
        <p
          role="status"
          aria-label={issuing ? "학습 준비 상태" : "학습 이용 불가 상태"}
          data-cue-tone="status"
        >
          {issuing
            ? "학습을 준비하고 있어요. 잠깐 기다려 주세요."
            : "학습을 시작할 수 없어요. 대시보드에서 다시 시도해 주세요."}
        </p>
      </section>
    );
  }

  const companionMoment: CompanionMoment =
    idleUi?.phase === "paused" ? "idle-paused" :
    idleUi?.phase === "confirm" ? "idle-confirm" :
    idleUi?.phase === "hint" ? "thinking" :
    waiting || saveUiState !== "idle" ? "save-wait" :
    attemptReceipt?.completed && !attemptReceipt.duplicate && !showNextCue ? "correct" :
    nextUnlocked && showNextCue ? "next" :
    readingResult !== null && !readingResult.passed ? "retry" :
    mathRetryCount > 0 && !nextUnlocked ? "retry" :
    authority.phase === "offline-unissued" ? "offline" :
    "lesson-open";

  return (
    <section
      className="learning-session"
      aria-label={`${item.title} 학습`}
      onPointerDown={() => recordActivity("touch")}
      onKeyDown={() => recordActivity("keyboard")}
    >
      {onExit ? (
        <button type="button" className="button-secondary" onClick={onExit}>
          대시보드로 돌아가기
        </button>
      ) : null}
      <LearningCompanion
        moment={companionMoment}
        studyDate={studyDate}
        item={item}
        saveState={saveUiState === "idle" ? undefined : saveUiState}
      />
      <p className="subject-chip">{item.subject === "korean" ? "국어" : "수학"} · {item.unit}</p>
      <h2>{item.title}</h2>
      {item.kind === "math-calculation" ? (
        <div className="calculation-lesson">
          <ProblemBreakdown
            item={item}
            mathRetryCount={mathRetryCount}
            showMathScaffold={mathRetryCount > 0 && !nextUnlocked}
          />
          <CalculationKeypad
            value={mathAnswer}
            disabled={learningControlsPaused}
            onChange={(value) => {
              setMathAnswer(value);
              recordActivity("answer");
            }}
            onSubmit={() => void checkCalculationAnswer()}
          />
        </div>
      ) : (
        <>
          <ProblemBreakdown
            item={item}
            mathRetryCount={mathRetryCount}
            showMathScaffold={mathRetryCount > 0 && !nextUnlocked}
          />
          <button
        type="button"
        aria-expanded={showHint}
        aria-controls="learning-word-hint"
        onClick={() => {
          setShowHint((current) => !current);
          recordActivity("hint");
        }}
          >낱말 힌트</button>
          {showHint ? (
        <section id="learning-word-hint" role="region" aria-label="낱말 힌트">
          <p>{item.hint}</p>
          <div className="learning-clues">
            {item.tokens.map((token, index) => (
              <span key={`${token}-${index}`}>{token}</span>
            ))}
          </div>
        </section>
          ) : null}

          {item.kind === "korean-reading" ? (
          <>
          <div aria-label="읽기 연습">
        <button
          type="button"
          onClick={toggleSpeech}
          disabled={!isSpeechRecognitionSupported() || speechUnavailable || learningControlsPaused || speechPhase === "finishing"}
        >
          {speechPhase === "listening"
            ? "읽기 멈추기"
            : speechPhase === "finishing"
              ? "읽은 내용을 확인하고 있어요"
              : "읽기 시작"}
        </button>
        {speechPhase === "listening" ? (
          <p role="status" aria-live="polite" style={{ color: "#b42318", fontWeight: 800 }}>
            ● 듣고 있어요 · {speechElapsedSeconds}초
          </p>
        ) : null}
        {speechPhase === "finishing" ? <p role="status">읽은 내용을 확인하고 있어요</p> : null}
        {speechNotice ? <p role="status">{speechNotice}</p> : null}
        {!isSpeechRecognitionSupported() || speechUnavailable ? (
          <p>이 브라우저에서는 수동 입력으로 읽기를 확인해 주세요.</p>
        ) : null}
        <details className="manual-reading-check">
          <summary>직접 입력으로 확인하기</summary>
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
        </details>
          </div>

          {readingResult ? (
        <div role="status" aria-label="읽기 결과">
          <strong>{readingResult.passed ? "읽기가 잘 도착했어요" : "한 번 더 읽어 볼 낱말이 있어요"}</strong>
          <span> {readingResult.score}점</span>
          {readingResult.missedTokens.length > 0 ? (
            <p>다시 읽을 표현: {readingResult.missedTokens.join(", ")}</p>
          ) : null}
        </div>
          ) : null}
          </>
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
              disabled={learningControlsPaused}
            />
          </label>
          <span>{item.unitLabel}</span>
          <button type="submit" disabled={learningControlsPaused}>답 확인</button>
        </form>
          ) : null}
        </>
      )}
      {mathFeedback && saveUiState === "idle" ? <p role="status">{mathFeedback}</p> : null}
      {provisional ? <p className="provisional-label" role="status">동기화 대기</p> : null}

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
          clearAutomaticNext();
          onNext?.();
        }}
      >
        다음 문제
      </button>
    </section>
  );
}

function createClientId(prefix: string): string {
  const random = typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${random}`;
}
