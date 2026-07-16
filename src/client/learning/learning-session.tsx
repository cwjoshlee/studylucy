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
import { StarCelebration } from "../delight/star-celebration";
import { preserveFailedAttempt } from "../offline/sync";
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
  const [nextUnlocked, setNextUnlocked] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [idleUi, setIdleUi] = useState<IdleUi>(null);
  const [showHint, setShowHint] = useState(false);
  const [difficultyFeedback, setDifficultyFeedback] = useState<AttemptInput["difficultyFeedback"]>(null);
  const [attemptReceipt, setAttemptReceipt] = useState<AttemptReceipt | null>(null);
  const [speechListening, setSpeechListening] = useState(false);
  const controllerRef = useRef<InactivityController | null>(null);
  const speechRef = useRef<SpeechController | null>(null);
  const volatileIdleRef = useRef<IdleEventInput | null>(null);
  const learningControlsPaused =
    authority.phase === "unavailable" ||
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
      volatileIdleRef.current = null;
      onActivityCursor?.(result.activityCursor);
      setIdleUi({ phase: "paused", message: IDLE_RESULT_TEXT[result.outcome] });
    } catch (error) {
      if (isExplicitClientError(error)) {
        onExit?.();
        return;
      }
      volatileIdleRef.current = input;
      setIdleUi({
        phase: "paused",
        message: "쉬는 기록을 보내지 못했어요. 준비되면 다시 시작해 주세요."
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

  const saveReadingAttempt = useCallback(async (result: ReadingResult) => {
    controllerRef.current?.pause("server-wait");
    setWaiting(true);
    const input = buildAttempt(result, null);
    try {
      const receipt = await api.saveAttempt(input);
      setAttemptReceipt(receipt);
      onActivityCursor?.(receipt.activityCursor);
      setNextUnlocked(receipt.completed);
      if (!receipt.readingPass) {
        setMathFeedback("서버 확인에서 읽기를 다시 해야 해요.");
      }
    } catch (error) {
      if (isExplicitClientError(error)) {
        onExit?.();
        return;
      }
      const queued = await preserveFailedAttempt(error, input).catch(() => false);
      setNextUnlocked(false);
      setMathFeedback(queued
        ? "학습 기록을 동기화 대기 중이에요. 연결되면 확인할게요."
        : "학습 기록을 저장하지 못했어요. 다시 시도해 주세요.");
    } finally {
      setWaiting(false);
      controllerRef.current?.resume("server-wait");
    }
  }, [api, buildAttempt, onActivityCursor, onExit]);

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
    const input = buildAttempt(readingResult, Number(mathAnswer));
    try {
      const receipt = await api.saveAttempt(input);
      setAttemptReceipt(receipt);
      onActivityCursor?.(receipt.activityCursor);
      const passed = receipt.readingPass && receipt.mathPass === true;
      setNextUnlocked(receipt.completed && passed);
      setMathFeedback(passed ? "정답이에요." : "답을 다시 생각해 봐요.");
    } catch (error) {
      if (isExplicitClientError(error)) {
        onExit?.();
        return;
      }
      const queued = await preserveFailedAttempt(error, input).catch(() => false);
      setNextUnlocked(false);
      setMathFeedback(queued
        ? "답을 동기화 대기 중이에요. 연결되면 확인할게요."
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
      {onExit ? (
        <button type="button" className="button-secondary" onClick={onExit}>
          대시보드로 돌아가기
        </button>
      ) : null}
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

function createClientId(prefix: string): string {
  const random = typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${random}`;
}
