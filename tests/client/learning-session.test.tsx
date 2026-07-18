// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { deleteDB } from "idb";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  expectTypeOf,
  it,
  vi
} from "vitest";
import { ApiClient, ApiError } from "../../src/client/api/client";
import type {
  AttemptReceipt,
  CalculationItem,
  KoreanDictationItem,
  LearningItemPayload,
  LearningSessionReceipt,
  TodayPlan
} from "../../src/shared/learning";
import type { IdleEventResult } from "../../src/shared/stars";
import { StarCelebration } from "../../src/client/delight/star-celebration";
import {
  LearningSession,
  type LearningSessionProps
} from "../../src/client/learning/learning-session";
import { createSpeechController } from "../../src/client/learning/speech-recognition";
import {
  OFFLINE_DB_NAME,
  cacheIssuedPlan,
  getQueueCounts,
  listActivities,
  listQueuedAttempts,
  listQueuedIdleEvents,
  markStudentAuthenticated
} from "../../src/client/offline/db";

const mathItem: LearningItemPayload = {
  id: "math-01",
  subject: "math",
  unit: "더하기",
  title: "별을 세어요",
  level: "1단계",
  readLabel: "수학 지문 읽기",
  text: "별 3개와 별 2개가 있어요.",
  question: "별은 모두 몇 개일까요?",
  hint: "두 수를 더해 봐요.",
  tokens: ["별", "3개", "2개", "모두"],
  answer: 5,
  unitLabel: "개",
  checkHint: "3과 2를 더해 봐요.",
  delight: {
    companion: "momo",
    mishap: "모모의 주판이 살짝 흔들렸어요.",
    openingCue: "모모가 숫자 단서를 펼쳤어요. 차근차근 찾아볼까요?",
    celebrationCue: "모모와 함께 계산을 끝냈어요! 봉봉이 축하하러 왔어요."
  },
  kind: "math-story"
};

const readingItem: LearningItemPayload = {
  id: "ko-01",
  subject: "korean",
  unit: "동화 읽기",
  title: "작은 씨앗",
  level: "1단계",
  readLabel: "동화 단락 읽기",
  text: "작은 씨앗이 밝은 해를 보았어요.",
  hint: "천천히 읽어 봐요.",
  tokens: ["작은 씨앗", "밝은 해", "보았어요"],
  delight: {
    companion: "toto",
    mishap: "또또의 수첩이 살짝 젖었어요.",
    openingCue: "또또가 낱말 수첩을 펼쳤어요. 함께 읽어 볼까요?",
    celebrationCue: "또또와 함께 낱말을 모두 읽었어요! 봉봉이 축하하러 왔어요."
  },
  kind: "korean-reading"
};

const mathPlanItem: TodayPlan["items"][number] = {
  id: mathItem.id,
  version: 1,
  step: "current",
  payload: mathItem
};

const calculationItem: CalculationItem = {
  id: "calculation-01",
  kind: "math-story",
  subject: "math",
  unit: "세 수의 혼합 계산",
  title: "세 수를 계산해요",
  level: "2단계",
  readLabel: "읽으면 안 되는 안내",
  text: "이야기 문장으로 보이면 안 되는 텍스트예요.",
  hint: "낱말 힌트로 보이면 안 되는 텍스트예요.",
  tokens: ["이야기", "낱말"],
  question: "계산한 답은 얼마일까요?",
  answer: 26,
  unitLabel: "",
  calculation: {
    operands: [13, 9, 4],
    operators: ["+", "+"],
    layout: "horizontal"
  },
  checkHint: "13에 9를 더한 뒤 4를 더해 봐요.",
  delight: {
    companion: "momo",
    mishap: "모모의 주판이 살짝 흔들렸어요.",
    openingCue: "모모가 계산판을 펼쳤어요.",
    celebrationCue: "모모와 함께 계산을 끝냈어요!"
  }
};

const calculationPlanItem: TodayPlan["items"][number] = {
  id: calculationItem.id,
  version: 3,
  step: "current",
  payload: calculationItem
};

const readingPlanItem: TodayPlan["items"][number] = {
  id: readingItem.id,
  version: 1,
  step: "current",
  payload: readingItem
};

const dictationItem: KoreanDictationItem = {
  id: "dictation-01",
  kind: "korean-dictation",
  subject: "korean",
  unit: "받아쓰기",
  title: "봄비를 써요",
  level: "2단계",
  readLabel: "다시 듣기",
  text: "들은 내용을 써 보세요.",
  hint: "천천히 다시 들어 봐요.",
  tokens: ["봄비"],
  promptText: "봄비",
  answerText: "봄비",
  mode: "word"
};

const currentDictationPlanItem: TodayPlan["items"][number] = {
  id: dictationItem.id,
  version: 4,
  step: "current",
  payload: dictationItem
};

const challengeDictationPlanItem: TodayPlan["items"][number] = {
  ...currentDictationPlanItem,
  step: "challenge"
};

const challengeCalculationPlanItem: TodayPlan["items"][number] = {
  ...calculationPlanItem,
  step: "challenge"
};

function receipt(overrides: Partial<AttemptReceipt> = {}): AttemptReceipt {
  return {
    id: "attempt-server-1",
    duplicate: false,
    readingPass: true,
    mathPass: true,
    dictationPass: null,
    completed: true,
    activityCursor: 1,
    starAward: {
      awarded: false,
      amount: 0,
      balance: 7,
      eventId: null
    },
    ...overrides
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((settle, fail) => {
    resolve = settle;
    reject = fail;
  });
  return { promise, reject, resolve };
}

function idleResult(outcome: IdleEventResult["outcome"]): IdleEventResult {
  return {
    id: `idle-${outcome}-0001`,
    outcome,
    starEventId: outcome === "applied" ? "star-idle-1" : null,
    duplicate: false,
    activityCursor: 2
  };
}

function createLearningApi() {
  return {
    createLearningSession: vi.fn().mockResolvedValue({
      learningSessionId: "server-issued-learning-session-0001",
      activeUntil: "2026-07-16T07:00:00.000Z",
      submitUntil: "2026-07-17T14:59:59.999Z"
    }),
    saveAttempt: vi.fn().mockResolvedValue(receipt()),
    sendIdleEvent: vi.fn().mockResolvedValue(idleResult("applied")),
    coachMessage: vi.fn().mockResolvedValue({
      message: "천천히 다시 해 보자!",
      source: "local" as const
    })
  };
}

async function flushLearningSessionIssue(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function supportSpeechRecognition(): { emit(type: string, event?: unknown): void } {
  const listeners = new Map<string, Array<(event?: unknown) => void>>();
  class FakeRecognition {
    lang = "";
    interimResults = false;
    continuous = false;
    start = vi.fn();
    stop = vi.fn();
    abort = vi.fn();
    addEventListener(type: string, listener: (event?: unknown) => void) {
      const current = listeners.get(type) ?? [];
      current.push(listener);
      listeners.set(type, current);
    }
  }
  Object.defineProperty(window, "SpeechRecognition", {
    configurable: true,
    value: FakeRecognition
  });
  return {
    emit(type: string, event?: unknown) {
      listeners.get(type)?.forEach((listener) => listener(event));
    }
  };
}

async function submitManualTranscript(transcript: string): Promise<void> {
  const user = userEvent.setup();
  await user.click(await screen.findByText("직접 입력으로 확인하기"));
  await user.type(screen.getByLabelText("읽은 내용 직접 입력"), transcript);
  await user.click(screen.getByRole("button", { name: "읽기 판정하기" }));
}

function companionBubble(): HTMLElement {
  return screen.getByRole("status", { name: "마법 친구 말풍선" });
}

function expectNoProtectedHumor(element: HTMLElement): void {
  expect(element).not.toHaveTextContent(/딸꾹|양말|포도알|비눗방울|우당탕/);
}

function offlineId(prefix: "learning-session" | "attempt" | "idle-event"): string {
  return `${prefix}-offline-0001`;
}

beforeEach(async () => {
  await deleteDB(OFFLINE_DB_NAME);
  await markStudentAuthenticated();
  await cacheIssuedPlan({
    planId: "plan-daily-1",
    planKind: "daily",
    recoverySourcePlanId: null,
    date: "2026-07-16",
    submitUntil: "2026-07-17T14:59:59.999Z",
    offlineEpoch: 1,
    activityCursor: 0,
    studentDisplayName: "수아",
    completedItemIds: [],
    requiredItemIds: [readingPlanItem.id, mathPlanItem.id],
    stars: {
      balance: 7,
      earnedToday: 2,
      deductedToday: 1,
      lastReason: "확정 별"
    },
    items: [readingPlanItem, mathPlanItem]
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  Reflect.deleteProperty(window, "SpeechRecognition");
});

describe("LearningSession", () => {
  it("asks the optional coach with only the shared event contract after a retry", async () => {
    const api = createLearningApi();
    api.saveAttempt.mockResolvedValue(receipt({ completed: false, mathPass: false }));
    const user = userEvent.setup();
    render(<LearningSession
      item={calculationPlanItem}
      api={api}
      planId="plan-private-1"
      studyDate="2026-07-16"
    />);

    await flushLearningSessionIssue();
    await screen.findByRole("status", { name: "차나핑 코치" });
    api.coachMessage.mockClear();
    await user.click(screen.getByRole("button", { name: "1" }));
    await user.click(screen.getByRole("button", { name: "답 확인" }));

    await waitFor(() => expect(api.coachMessage).toHaveBeenCalledWith({
      event: "retry", subject: "math", retryCount: 1, hintStage: "first"
    }, expect.any(AbortSignal)));
    expect(JSON.stringify(api.coachMessage.mock.calls)).not.toMatch(/plan-private|answer|transcript|cookie|device/i);
  });

  it("keeps an in-flight current coach request through an ordinary session rerender", async () => {
    const api = createLearningApi();
    api.saveAttempt.mockResolvedValue(receipt({ completed: false, mathPass: false }));
    api.coachMessage.mockResolvedValueOnce({ message: "", source: "local" });
    const pending = deferred<{ message: string; source: "llm" }>();
    const user = userEvent.setup();
    const props: LearningSessionProps = {
      item: calculationPlanItem,
      api,
      planId: "plan-daily-1",
      studyDate: "2026-07-16"
    };
    const { rerender } = render(<LearningSession {...props} />);

    await flushLearningSessionIssue();
    await screen.findByRole("status", { name: "차나핑 코치" });
    await waitFor(() => expect(api.coachMessage).toHaveBeenCalledOnce());
    api.coachMessage.mockClear();
    api.coachMessage.mockReturnValue(pending.promise);
    await user.click(screen.getByRole("button", { name: "1" }));
    await user.click(screen.getByRole("button", { name: "답 확인" }));
    await waitFor(() => expect(api.coachMessage).toHaveBeenCalledOnce());
    const signal = api.coachMessage.mock.calls[0]?.[1] as AbortSignal;

    rerender(<LearningSession {...props} reducedMotion />);

    expect(signal.aborted).toBe(false);
    expect(api.coachMessage).toHaveBeenCalledOnce();
    await act(async () => {
      pending.resolve({ message: "천천히 다시 해 보자", source: "llm" });
      await pending.promise;
    });
    expect(await screen.findByText("천천히 다시 해 보자")).toBeVisible();
  });

  it.each([
    [readingPlanItem, "읽기 판정하기", readingItem.delight!.openingCue],
    [mathPlanItem, "답 확인", mathItem.delight!.openingCue]
  ] as const)("keeps %s unavailable until online session issuance resolves", async (
    item,
    submissionName,
    openingCue
  ) => {
    const issuance = deferred<LearningSessionReceipt>();
    const api = createLearningApi();
    api.createLearningSession.mockReturnValue(issuance.promise);
    const onExit = vi.fn();

    render(<LearningSession
      item={item}
      api={api}
      planId="plan-daily-1"
      studyDate="2026-07-16"
      onExit={onExit}
    />);

    const preparing = screen.getByRole("status", { name: "학습 준비 상태" });
    expect(preparing).toHaveTextContent("학습을 준비하고 있어요. 잠깐 기다려 주세요.");
    expect(preparing).toHaveAttribute("data-cue-tone", "status");
    expect(screen.getByRole("button", { name: "대시보드로 돌아가기" })).toBeEnabled();
    expect(screen.queryByRole("status", { name: "마법 친구 말풍선" }))
      .not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "읽기 판정하기" }))
      .not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "답 확인" }))
      .not.toBeInTheDocument();
    expect(screen.queryByText(item.payload.text)).not.toBeInTheDocument();
    expect(api.saveAttempt).not.toHaveBeenCalled();

    await act(async () => {
      issuance.resolve({
        learningSessionId: "server-issued-learning-session-deferred-1",
        activeUntil: "2026-07-16T07:00:00.000Z",
        submitUntil: "2026-07-17T14:59:59.999Z"
      });
      await issuance.promise;
    });

    expect(await screen.findByRole("status", { name: "마법 친구 말풍선" }))
      .toHaveTextContent(openingCue);
    expect(screen.getByRole("button", { name: submissionName })).toBeInTheDocument();
    expect(screen.getByText(item.payload.text)).toBeVisible();
  });

  it("keeps a rejected issuance unavailable with no late lesson reveal or submission", async () => {
    const issuance = deferred<LearningSessionReceipt>();
    const api = createLearningApi();
    api.createLearningSession.mockReturnValue(issuance.promise);
    const onExit = vi.fn();

    render(<LearningSession
      item={readingPlanItem}
      api={api}
      planId="plan-daily-1"
      studyDate="2026-07-16"
      onExit={onExit}
    />);

    expect(screen.getByRole("status", { name: "학습 준비 상태" })).toBeVisible();
    await act(async () => {
      issuance.reject(new ApiError(409, "PLAN_NOT_ISSUED"));
      await issuance.promise.catch(() => undefined);
      await Promise.resolve();
    });

    expect(onExit).toHaveBeenCalledOnce();
    const unavailable = screen.getByRole("status", { name: "학습 이용 불가 상태" });
    expect(unavailable).toHaveTextContent("학습을 시작할 수 없어요. 대시보드에서 다시 시도해 주세요.");
    expect(unavailable).toHaveAttribute("data-cue-tone", "status");
    expect(screen.queryByRole("status", { name: "마법 친구 말풍선" }))
      .not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "읽기 판정하기" }))
      .not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "답 확인" }))
      .not.toBeInTheDocument();
    expect(screen.queryByText(readingItem.text)).not.toBeInTheDocument();
    expect(api.saveAttempt).not.toHaveBeenCalled();
  });

  it("reveals the validated offline lesson only after network issuance fails", async () => {
    const issuance = deferred<LearningSessionReceipt>();
    const api = createLearningApi();
    api.createLearningSession.mockReturnValue(issuance.promise);

    render(<LearningSession
      item={readingPlanItem}
      api={api}
      planId="plan-daily-1"
      studyDate="2026-07-16"
      offlineEligibility="validated"
    />);

    expect(screen.getByRole("status", { name: "학습 준비 상태" })).toBeVisible();
    expect(screen.queryByText(readingItem.text)).not.toBeInTheDocument();

    await act(async () => {
      issuance.reject(new TypeError("offline"));
      await issuance.promise.catch(() => undefined);
    });

    const bubble = await screen.findByRole("status", { name: "마법 친구 말풍선" });
    expect(bubble).toHaveAttribute("data-cue-tone", "status");
    expect(bubble).toHaveTextContent("지금은 오프라인이에요");
    expect(screen.getByText(readingItem.text)).toBeVisible();
    expect(screen.getByText("직접 입력으로 확인하기")).toBeVisible();
  });

  it.each([
    [readingPlanItem, "수달 또또", readingItem.delight!.openingCue],
    [mathPlanItem, "너구리 모모", mathItem.delight!.openingCue]
  ] as const)("opens %s with its subject friend and exact content cue", async (item, friend, openingCue) => {
    render(<LearningSession
      item={item}
      api={createLearningApi()}
      planId="plan-daily-1"
      studyDate="2026-07-16"
    />);

    const bubble = await screen.findByRole("status", { name: "마법 친구 말풍선" });
    expect(bubble).toHaveTextContent(friend);
    expect(bubble).toHaveTextContent(openingCue);
  });

  it("updates the local coach for a receipt-confirmed retry, not a keypad digit", async () => {
    const api = createLearningApi();
    api.saveAttempt.mockResolvedValue(receipt({
      completed: false,
      mathPass: false
    }));
    const user = userEvent.setup();
    render(<LearningSession
      item={calculationPlanItem}
      api={api}
      planId="plan-daily-1"
      studyDate="2026-07-16"
    />);

    const coach = await screen.findByRole("status", { name: "차나핑 코치" });
    const openingCue = coach.textContent;
    const coachArt = screen.getByRole("img", { name: "누운 차나핑 학습 코치" });
    const openingArt = coachArt.getAttribute("src");
    await user.click(screen.getByRole("button", { name: "1" }));
    expect(coach).toHaveTextContent(openingCue ?? "");
    expect(coachArt).toHaveAttribute("src", openingArt ?? "");

    await user.click(screen.getByRole("button", { name: "답 확인" }));
    await waitFor(() => expect(coach).not.toHaveTextContent(openingCue ?? ""));
    await waitFor(() => expect(coachArt)
      .toHaveAttribute("src", "/assets/companions/chanaping-grumble.svg"));
    expect(coach).not.toHaveTextContent(/별|차감|바보|느려|게으르|벌|못하|틀렸잖/);
  });

  it("keeps ChanaPing celebrating after a correct keypad receipt reaches the next cue", async () => {
    vi.useFakeTimers();
    const api = createLearningApi();
    const onNext = vi.fn();
    render(<LearningSession
      item={calculationPlanItem}
      api={api}
      planId="plan-daily-1"
      studyDate="2026-07-16"
      onNext={onNext}
    />);
    await flushLearningSessionIssue();

    fireEvent.click(screen.getByRole("button", { name: "2" }));
    fireEvent.click(screen.getByRole("button", { name: "6" }));
    fireEvent.click(screen.getByRole("button", { name: "답 확인" }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    act(() => vi.advanceTimersByTime(1_000));

    expect(onNext).not.toHaveBeenCalled();
    expect(screen.getByRole("img", { name: "누운 차나핑 학습 코치" }))
      .toHaveAttribute("src", "/assets/companions/chanaping-celebrate.svg");
    expect(screen.getByRole("status", { name: "차나핑 코치" }))
      .toHaveTextContent(/칭찬하는 것도 귀찮은데|살짝 기분이 좋아졌어|작은 반짝임으로 기록/);
  });

  it("keeps reading retry supportive, names missed tokens, and never exposes PASS or FAIL", async () => {
    render(<LearningSession
      item={readingPlanItem}
      api={createLearningApi()}
      planId="plan-daily-1"
      studyDate="2026-07-16"
    />);

    await submitManualTranscript("작은 씨앗이 해를 보았어요.");

    const result = screen.getByRole("status", { name: "읽기 결과" });
    expect(within(result).getByText("한 번 더 읽어 볼 낱말이 있어요")).toBeVisible();
    expect(result).toHaveTextContent("밝은 해");
    expect(screen.queryByText(/PASS|FAIL/)).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/바보|못하|틀렸잖|왜 이것도|느려|벌 받아/);
    const bubble = companionBubble();
    expect(bubble).toHaveAttribute("data-cue-tone", "support");
    expectNoProtectedHumor(bubble);
  });

  it("keeps speech and manual reading controls out of a math story while submitting its answer", async () => {
    const api = createLearningApi();
    const user = userEvent.setup();
    render(<LearningSession
      item={mathPlanItem}
      api={api}
      planId="plan-daily-1"
      studyDate="2026-07-16"
    />);

    expect(await screen.findByLabelText("답 쓰기")).toBeEnabled();
    expect(screen.queryByRole("button", { name: "읽기 시작" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "읽기 멈추기" })).not.toBeInTheDocument();
    expect(screen.queryByText("직접 입력으로 확인하기")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("읽은 내용 직접 입력")).not.toBeInTheDocument();

    await user.type(screen.getByLabelText("답 쓰기"), "5");
    await user.click(screen.getByRole("button", { name: "답 확인" }));
    expect(api.saveAttempt).toHaveBeenCalledWith(expect.objectContaining({
      readingScore: 100,
      missedTokens: [],
      mathAnswer: 5
    }));
  });

  it("shows one authoritative Bunny reward cue then the Toto reading cue at one second", async () => {
    vi.useFakeTimers();
    const api = createLearningApi();
    api.saveAttempt.mockResolvedValue(receipt({
      id: "attempt-celebration-transition-1",
      starAward: {
        awarded: true,
        amount: 1,
        balance: 8,
        eventId: "star-celebration-transition-1"
      }
    }));
    render(<LearningSession
      item={readingPlanItem}
      api={api}
      planId="plan-daily-1"
      studyDate="2026-07-16"
    />);
    await flushLearningSessionIssue();
    fireEvent.click(screen.getByText("직접 입력으로 확인하기"));
    fireEvent.change(screen.getByLabelText("읽은 내용 직접 입력"), {
      target: { value: readingItem.text }
    });
    fireEvent.click(screen.getByRole("button", { name: "읽기 판정하기" }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(companionBubble()).toHaveTextContent(readingItem.delight!.celebrationCue);
    expect(companionBubble()).toHaveTextContent("별토끼 버니");
    expect(screen.getAllByText("별 1개를 모았어요")).toHaveLength(1);

    act(() => vi.advanceTimersByTime(999));
    expect(companionBubble()).toHaveTextContent(readingItem.delight!.celebrationCue);
    act(() => vi.advanceTimersByTime(1));
    expect(companionBubble()).toHaveTextContent("수달 또또");
    expect(companionBubble()).not.toHaveTextContent("아기용 밀키");
    expect(companionBubble()).not.toHaveTextContent("별토끼 버니");
    expect(screen.queryByText("별 1개를 모았어요")).not.toBeInTheDocument();
  });

  it("does not show stale next after a delayed duplicate resubmit invalidates the prior completion timer", async () => {
    vi.useFakeTimers();
    const delayedDuplicate = deferred<AttemptReceipt>();
    const api = createLearningApi();
    api.saveAttempt
      .mockResolvedValueOnce(receipt({ id: "attempt-first-completion-1" }))
      .mockReturnValueOnce(delayedDuplicate.promise);
    render(<LearningSession
      item={readingPlanItem}
      api={api}
      planId="plan-daily-1"
      studyDate="2026-07-16"
    />);
    await flushLearningSessionIssue();
    fireEvent.click(screen.getByText("직접 입력으로 확인하기"));
    fireEvent.change(screen.getByLabelText("읽은 내용 직접 입력"), {
      target: { value: readingItem.text }
    });
    fireEvent.click(screen.getByRole("button", { name: "읽기 판정하기" }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(companionBubble()).toHaveTextContent(readingItem.delight!.celebrationCue);

    act(() => vi.advanceTimersByTime(500));
    fireEvent.click(screen.getByRole("button", { name: "읽기 판정하기" }));
    act(() => vi.advanceTimersByTime(500));
    await act(async () => {
      delayedDuplicate.resolve(receipt({
        id: "attempt-first-completion-1",
        duplicate: true,
        completed: true
      }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(api.saveAttempt).toHaveBeenCalledTimes(2);
    expect(companionBubble()).not.toHaveTextContent(
      "다음 마법 걸음으로 가요. 버니가 도망간 양말을 잡아 둘게요."
    );
    expect(companionBubble()).toHaveTextContent(readingItem.delight!.openingCue);
    act(() => vi.advanceTimersByTime(2_000));
    expect(companionBubble()).not.toHaveTextContent(
      "다음 마법 걸음으로 가요. 버니가 도망간 양말을 잡아 둘게요."
    );
  });

  it("automatically advances once 1.5 seconds after an authoritative reading completion", async () => {
    vi.useFakeTimers();
    const onNext = vi.fn();
    render(<LearningSession
      item={readingPlanItem}
      api={createLearningApi()}
      planId="plan-daily-1"
      studyDate="2026-07-16"
      onNext={onNext}
    />);
    await flushLearningSessionIssue();
    fireEvent.click(screen.getByText("직접 입력으로 확인하기"));
    fireEvent.change(screen.getByLabelText("읽은 내용 직접 입력"), {
      target: { value: readingItem.text }
    });
    fireEvent.click(screen.getByRole("button", { name: "읽기 판정하기" }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    act(() => vi.advanceTimersByTime(1_499));
    expect(onNext).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onNext).toHaveBeenCalledOnce();
    act(() => vi.advanceTimersByTime(5_000));
    expect(onNext).toHaveBeenCalledOnce();
  });

  it("automatically advances once after a locally queued passing reading", async () => {
    const api = createLearningApi();
    const onNext = vi.fn();
    api.saveAttempt.mockRejectedValue(new TypeError("offline"));
    render(<LearningSession
      item={readingPlanItem}
      api={api}
      planId="plan-daily-1"
      studyDate="2026-07-16"
      idFactory={offlineId}
      onNext={onNext}
    />);
    await flushLearningSessionIssue();
    fireEvent.click(screen.getByText("직접 입력으로 확인하기"));
    fireEvent.change(screen.getByLabelText("읽은 내용 직접 입력"), {
      target: { value: readingItem.text }
    });
    fireEvent.click(screen.getByRole("button", { name: "읽기 판정하기" }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => expect(onNext).toHaveBeenCalledOnce(), { timeout: 2_000 });
  });

  it("cancels a stale automatic next when a repeat reading submission supersedes it", async () => {
    vi.useFakeTimers();
    const api = createLearningApi();
    const onNext = vi.fn();
    api.saveAttempt
      .mockResolvedValueOnce(receipt({ id: "attempt-auto-next-first" }))
      .mockResolvedValueOnce(receipt({
        id: "attempt-auto-next-duplicate",
        completed: true,
        duplicate: true
      }));
    render(<LearningSession
      item={readingPlanItem}
      api={api}
      planId="plan-daily-1"
      studyDate="2026-07-16"
      onNext={onNext}
    />);
    await flushLearningSessionIssue();
    fireEvent.click(screen.getByText("직접 입력으로 확인하기"));
    fireEvent.change(screen.getByLabelText("읽은 내용 직접 입력"), {
      target: { value: readingItem.text }
    });
    fireEvent.click(screen.getByRole("button", { name: "읽기 판정하기" }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    act(() => vi.advanceTimersByTime(750));
    fireEvent.click(screen.getByRole("button", { name: "읽기 판정하기" }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    act(() => vi.advanceTimersByTime(5_000));
    expect(onNext).not.toHaveBeenCalled();
  });

  it("removes both companion and awarded star status when a resubmit exits on 4xx", async () => {
    vi.useFakeTimers();
    const api = createLearningApi();
    api.saveAttempt
      .mockResolvedValueOnce(receipt({
        id: "attempt-awarded-before-exit-1",
        starAward: {
          awarded: true,
          amount: 1,
          balance: 8,
          eventId: "star-awarded-before-exit-1"
        }
      }))
      .mockRejectedValueOnce(new ApiError(409, "PLAN_NOT_ISSUED"));
    const onExit = vi.fn();
    render(<LearningSession
      item={readingPlanItem}
      api={api}
      planId="plan-daily-1"
      studyDate="2026-07-16"
      onExit={onExit}
    />);
    await flushLearningSessionIssue();
    fireEvent.click(screen.getByText("직접 입력으로 확인하기"));
    fireEvent.change(screen.getByLabelText("읽은 내용 직접 입력"), {
      target: { value: readingItem.text }
    });
    fireEvent.click(screen.getByRole("button", { name: "읽기 판정하기" }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByRole("status", { name: "별 보상" })).toBeVisible();

    act(() => vi.advanceTimersByTime(500));
    fireEvent.click(screen.getByRole("button", { name: "읽기 판정하기" }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onExit).toHaveBeenCalledOnce();
    expect(screen.queryByRole("status", { name: "마법 친구 말풍선" }))
      .not.toBeInTheDocument();
    expect(screen.queryByRole("status", { name: "별 보상" }))
      .not.toBeInTheDocument();
  });

  it.each([
    [false, false],
    [true, true]
  ])("shows a non-star completion cue only for completed=%s duplicate=%s", async (completed, duplicate) => {
    const api = createLearningApi();
    api.saveAttempt.mockResolvedValue(receipt({ completed, duplicate }));
    render(<LearningSession
      item={readingPlanItem}
      api={api}
      planId="plan-daily-1"
      studyDate="2026-07-16"
    />);

    await submitManualTranscript(readingItem.text);

    expect(screen.queryByText(/별 1개를 모았어요/)).not.toBeInTheDocument();
    expect(companionBubble()).not.toHaveTextContent(readingItem.delight!.celebrationCue);
  });

  it("may show a completion cue without making a star claim", async () => {
    const api = createLearningApi();
    api.saveAttempt.mockResolvedValue(receipt({
      id: "attempt-complete-without-star-1",
      completed: true,
      duplicate: false,
      starAward: { awarded: false, amount: 0, balance: 7, eventId: null }
    }));
    render(<LearningSession
      item={readingPlanItem}
      api={api}
      planId="plan-daily-1"
      studyDate="2026-07-16"
    />);

    await submitManualTranscript(readingItem.text);

    expect(companionBubble()).toHaveTextContent(readingItem.delight!.celebrationCue);
    expect(companionBubble()).toHaveTextContent("수달 또또");
    expect(companionBubble()).not.toHaveTextContent("별토끼 버니");
    expect(companionBubble()).not.toHaveTextContent("아기용 밀키");
    expect(screen.queryByText(/별 1개를 모았어요/)).not.toBeInTheDocument();
  });

  it("keeps queued Korean work in a non-humorous save state", async () => {
    const api = createLearningApi();
    api.saveAttempt.mockRejectedValue(new TypeError("offline"));
    const user = userEvent.setup();
    render(<LearningSession
      item={readingPlanItem}
      api={api}
      planId="plan-daily-1"
      studyDate="2026-07-16"
      idFactory={offlineId}
    />);
    await submitManualTranscript(readingItem.text);

    await waitFor(() => {
      expect(companionBubble()).toHaveTextContent(
        "학습 기록이 아직 여행 중이에요. 연결되면 확인할게요."
      );
    });
    const bubble = companionBubble();
    expect(bubble).toHaveAttribute("data-cue-tone", "status");
    expect(bubble).not.toHaveTextContent(/저장했어요|별을 받았어요/);
    expectNoProtectedHumor(bubble);
  });

  it("keeps a total local-preservation failure in a non-humorous failed save state", async () => {
    const api = createLearningApi();
    api.saveAttempt.mockRejectedValue(new Error("not retryable"));
    render(<LearningSession
      item={readingPlanItem}
      api={api}
      planId="plan-daily-1"
      studyDate="2026-07-16"
    />);

    await submitManualTranscript(readingItem.text);

    await waitFor(() => {
      expect(companionBubble()).toHaveTextContent(
        "학습 기록을 안전하게 보관하지 못했어요. 다시 시도해 주세요."
      );
    });
    const bubble = companionBubble();
    expect(bubble).toHaveAttribute("data-cue-tone", "status");
    expectNoProtectedHumor(bubble);
  });

  it("maps 2-minute idle to thinking while keeping 4 and 5 minutes protected", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-16T01:00:00.000Z"));
    const api = createLearningApi();
    render(<LearningSession
      item={readingPlanItem}
      api={api}
      planId="plan-daily-1"
      studyDate="2026-07-16"
    />);
    await flushLearningSessionIssue();

    act(() => vi.advanceTimersByTime(120_000));
    expect(companionBubble()).toHaveTextContent("힌트를 살짝 열어도 괜찮아요.");
    expect(companionBubble()).toHaveAttribute("data-cue-tone", "humor");

    act(() => vi.advanceTimersByTime(120_000));
    expect(companionBubble()).toHaveAttribute("data-cue-tone", "support");
    expectNoProtectedHumor(companionBubble());

    await act(async () => {
      vi.advanceTimersByTime(60_000);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(companionBubble()).toHaveAttribute("data-cue-tone", "support");
    expectNoProtectedHumor(companionBubble());
  });

  it("hides the floating coach while the inactivity confirmation dialog is open", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-16T01:00:00.000Z"));
    render(<LearningSession
      item={readingPlanItem}
      api={createLearningApi()}
      planId="plan-daily-1"
      studyDate="2026-07-16"
    />);
    await flushLearningSessionIssue();

    await act(async () => {
      vi.advanceTimersByTime(240_000);
    });

    expect(screen.getByRole("alertdialog", { name: "학습 계속 확인" })).toBeVisible();
    expect(screen.queryByRole("status", { name: "차나핑 코치" })).not.toBeInTheDocument();
  });

  it("keeps manual reading as a collapsed details fallback", async () => {
    render(<LearningSession
      item={readingPlanItem}
      api={createLearningApi()}
      planId="plan-daily-1"
      studyDate="2026-07-16"
    />);

    const summary = await screen.findByText("직접 입력으로 확인하기");
    const details = summary.closest("details");
    expect(details).not.toBeNull();
    expect(details).not.toHaveAttribute("open");
  });

  it("shows the timed listening and finishing states while keeping direct input available", async () => {
    vi.useFakeTimers();
    const speech = supportSpeechRecognition();
    render(<LearningSession
      item={readingPlanItem}
      api={createLearningApi()}
      planId="plan-daily-1"
      studyDate="2026-07-16"
    />);
    await flushLearningSessionIssue();

    fireEvent.click(screen.getByRole("button", { name: "읽기 시작" }));
    expect(screen.getByRole("button", { name: "읽기 멈추기" })).toBeEnabled();
    expect(screen.getByText("● 듣고 있어요 · 0초")).toBeVisible();
    expect(screen.getByText("직접 입력으로 확인하기")).toBeVisible();
    act(() => vi.advanceTimersByTime(1_000));
    expect(screen.getByText("● 듣고 있어요 · 1초")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "읽기 멈추기" }));
    expect(screen.getByRole("button", { name: "읽은 내용을 확인하고 있어요" })).toBeDisabled();
    expect(screen.getAllByText("읽은 내용을 확인하고 있어요")).toHaveLength(2);
    act(() => speech.emit("end"));
    expect(screen.getByRole("button", { name: "읽기 시작" })).toBeEnabled();
  });

  it("keeps direct input available after microphone permission is denied", async () => {
    const speech = supportSpeechRecognition();
    render(<LearningSession
      item={readingPlanItem}
      api={createLearningApi()}
      planId="plan-daily-1"
      studyDate="2026-07-16"
    />);
    await flushLearningSessionIssue();

    fireEvent.click(screen.getByRole("button", { name: "읽기 시작" }));
    act(() => speech.emit("error", { error: "not-allowed" }));

    expect(screen.getByText("마이크를 사용할 수 없어요. 직접 입력으로 읽기를 확인해 주세요."))
      .toBeVisible();
    expect(screen.getByText("직접 입력으로 확인하기")).toBeVisible();
    expect(screen.getByRole("button", { name: "읽기 시작" })).toBeDisabled();
  });

  it("reveals the existing word hint and token chips immediately without revealing the answer", async () => {
    const user = userEvent.setup();
    render(<LearningSession
      item={mathPlanItem}
      api={createLearningApi()}
      planId="plan-daily-1"
      studyDate="2026-07-16"
    />);

    const button = await screen.findByRole("button", { name: "낱말 힌트" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("region", { name: "낱말 힌트" })).not.toBeInTheDocument();

    await user.click(button);

    expect(button).toHaveAttribute("aria-expanded", "true");
    const region = screen.getByRole("region", { name: "낱말 힌트" });
    expect(region).toHaveTextContent(mathItem.hint);
    for (const token of mathItem.tokens) expect(region).toHaveTextContent(token);
    expect(within(region).queryByText(String(mathItem.answer))).not.toBeInTheDocument();
  });

  it("requires an issued plan item as the final session item contract", () => {
    expectTypeOf<LearningSessionProps["item"]>()
      .toEqualTypeOf<TodayPlan["items"][number]>();
  });

  it("requests a server-issued learning session for the exact plan item and keeps its ID out of the client ID factory", async () => {
    const api = createLearningApi();
    const idFactory = vi.fn(offlineId);
    render(<LearningSession
      item={{ ...readingPlanItem, version: 2 }}
      api={api}
      planId="plan-daily-1"
      studyDate="2026-07-16"
      idFactory={idFactory}
    />);

    await waitFor(() => {
      expect(api.createLearningSession).toHaveBeenCalledWith({
        planId: "plan-daily-1",
        itemId: "ko-01",
        contentVersion: 2
      });
    });
    expect(idFactory).not.toHaveBeenCalled();
    await expect(listQueuedIdleEvents()).resolves.toEqual([]);
  });

  it("discards the old issued authority when the plan changes for the same item", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    vi.setSystemTime(new Date("2026-07-16T01:00:00.000Z"));
    const api = createLearningApi();
    api.createLearningSession.mockImplementation(async (input) => {
      if (input.planId === "plan-daily-1") {
        return {
          learningSessionId: "server-issued-learning-session-old",
          activeUntil: "2026-07-16T07:00:00.000Z",
          submitUntil: "2026-07-17T14:59:59.999Z"
        };
      }
      return await new Promise(() => {});
    });
    const view = render(<LearningSession
      item={readingPlanItem}
      api={api}
      planId="plan-daily-1"
      studyDate="2026-07-16"
      idFactory={offlineId}
    />);
    await flushLearningSessionIssue();

    view.rerender(<LearningSession
      item={readingPlanItem}
      api={api}
      planId="plan-daily-2"
      studyDate="2026-07-16"
      idFactory={offlineId}
    />);
    await act(async () => {
      vi.advanceTimersByTime(300_000);
      await Promise.resolve();
    });

    expect(api.createLearningSession).toHaveBeenLastCalledWith({
      planId: "plan-daily-2",
      itemId: "ko-01",
      contentVersion: 1
    });
    expect(api.sendIdleEvent).not.toHaveBeenCalled();
  });

  it("enters offline-unissued only after a caller-validated network boundary and never creates or queues an idle ID", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    vi.setSystemTime(new Date("2026-07-16T01:00:00.000Z"));
    const api = createLearningApi();
    api.createLearningSession.mockRejectedValue(new TypeError("offline"));
    const idFactory = vi.fn(offlineId);
    render(<LearningSession
      item={readingPlanItem}
      api={api}
      planId="plan-daily-1"
      studyDate="2026-07-16"
      offlineEligibility="validated"
      idFactory={idFactory}
    />);
    await flushLearningSessionIssue();

    await act(async () => {
      vi.advanceTimersByTime(300_000);
      await Promise.resolve();
    });

    expect(api.sendIdleEvent).not.toHaveBeenCalled();
    expect(idFactory).not.toHaveBeenCalledWith("idle-event");
    await expect(listQueuedIdleEvents()).resolves.toEqual([]);
    expect(screen.getByText("오프라인에서는 별을 차감하지 않아요")).toBeVisible();
    expect(screen.getByRole("button", { name: "학습 계속하기" })).toBeVisible();
  });

  it("exits instead of entering offline-unissued when the caller did not validate offline eligibility", async () => {
    const api = createLearningApi();
    api.createLearningSession.mockRejectedValue(new TypeError("offline"));
    const onExit = vi.fn();
    render(<LearningSession
      item={readingPlanItem}
      api={api}
      planId="plan-daily-1"
      studyDate="2026-07-16"
      onExit={onExit}
    />);

    await waitFor(() => expect(onExit).toHaveBeenCalledOnce());
    expect(api.sendIdleEvent).not.toHaveBeenCalled();
    await expect(listQueuedIdleEvents()).resolves.toEqual([]);
  });

  it.each([
    [401, "AUTH_REQUIRED"],
    [403, "DEVICE_REVOKED"],
    [403, "DEVICE_NOT_TRUSTED"],
    [409, "PLAN_NOT_ISSUED"],
    [400, "INVALID_REQUEST"]
  ])("exits learning on an explicit %s %s session-authority failure", async (status, code) => {
    const api = createLearningApi();
    api.createLearningSession.mockRejectedValue(new ApiError(status, code));
    const onExit = vi.fn();
    render(<LearningSession
      item={readingPlanItem}
      api={api}
      planId="plan-daily-1"
      studyDate="2026-07-16"
      offlineEligibility="validated"
      onExit={onExit}
    />);

    await waitFor(() => expect(onExit).toHaveBeenCalledOnce());
    expect(api.sendIdleEvent).not.toHaveBeenCalled();
    await expect(listQueuedIdleEvents()).resolves.toEqual([]);
  });

  it("exits instead of entering offline-unissued when authority clearing itself rejects", async () => {
    const api = new ApiClient(
      vi.fn().mockResolvedValue(new Response(
        JSON.stringify({ code: "PLAN_NOT_ISSUED" }),
        { status: 409, headers: { "content-type": "application/json" } }
      )),
      {
        onAuthorityFailure: vi.fn().mockRejectedValue(
          new TypeError("indexedDB unavailable")
        )
      }
    );
    const onExit = vi.fn();
    render(<LearningSession
      item={readingPlanItem}
      api={api}
      planId="plan-daily-1"
      studyDate="2026-07-16"
      offlineEligibility="validated"
      onExit={onExit}
    />);

    await waitFor(() => expect(onExit).toHaveBeenCalledOnce());
    expect(api).toBeDefined();
    await expect(listQueuedIdleEvents()).resolves.toEqual([]);
  });

  it("submits the issued content version without fabricating a fallback", async () => {
    const api = createLearningApi();
    render(<LearningSession
      item={{ ...readingPlanItem, version: 2 }}
      api={api}
      planId="plan-daily-1"
      studyDate="2026-07-16"
    />);

    await submitManualTranscript(readingItem.text);

    expect(api.saveAttempt).toHaveBeenCalledWith(expect.objectContaining({
      itemId: "ko-01",
      contentVersion: 2
    }));
  });

  it("keeps the math answer control available without reading controls", async () => {
    render(<LearningSession item={mathPlanItem} api={createLearningApi()} planId="plan-daily-1" studyDate="2026-07-16" />);

    expect(await screen.findByLabelText("답 쓰기")).toBeEnabled();
    expect(screen.queryByLabelText("읽은 내용 직접 입력")).not.toBeInTheDocument();
  });

  it("uses the keypad-only calculation screen and submits its answer without a reading result", async () => {
    const api = createLearningApi();
    api.saveAttempt.mockImplementation(async (input) => input.mathAnswer === 26
      ? receipt()
      : receipt({ mathPass: false, completed: false }));
    const user = userEvent.setup();
    render(<LearningSession
      item={calculationPlanItem}
      api={api}
      planId="plan-daily-1"
      studyDate="2026-07-16"
    />);

    expect(await screen.findByLabelText("13 + 9 + 4 = ?")).toBeVisible();
    expect(screen.queryByRole("button", { name: "읽기 시작" })).not.toBeInTheDocument();
    expect(screen.queryByText("직접 입력으로 확인하기")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "낱말 힌트" })).not.toBeInTheDocument();
    expect(screen.queryByText(calculationItem.text)).not.toBeInTheDocument();
    expect(screen.queryByLabelText("답 쓰기")).not.toBeInTheDocument();

    for (const key of ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "지우기"]) {
      expect(screen.getByRole("button", { name: key })).toBeEnabled();
    }
    expect(screen.getByRole("button", { name: "답 확인" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "2" }));
    await user.click(screen.getByRole("button", { name: "6" }));
    expect(screen.getByRole("button", { name: "답 확인" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "답 확인" }));

    await waitFor(() => expect(api.saveAttempt).toHaveBeenCalledWith(expect.objectContaining({
      readingScore: 100,
      missedTokens: [],
      mathAnswer: 26
    })));
    expect(await screen.findByText("정답이에요.")).toBeVisible();
  });

  it("shows the calculation check hint after the first wrong keypad answer", async () => {
    const api = createLearningApi();
    api.saveAttempt.mockResolvedValue(receipt({ mathPass: false, completed: false }));
    const user = userEvent.setup();
    render(<LearningSession
      item={calculationPlanItem}
      api={api}
      planId="plan-daily-1"
      studyDate="2026-07-16"
    />);

    await screen.findByLabelText("13 + 9 + 4 = ?");
    await user.click(screen.getByRole("button", { name: "1" }));
    await user.click(screen.getByRole("button", { name: "답 확인" }));

    expect(await screen.findByRole("status", { name: "수학 도움" }))
      .toHaveTextContent(calculationItem.checkHint);
  });

  it("keeps Next locked for a server-rejected math answer and unlocks it after a correct attempt", async () => {
    const api = createLearningApi();
    api.saveAttempt.mockImplementation(async (input) => input.mathAnswer === 26
      ? receipt()
      : receipt({ mathPass: false, completed: false }));
    const user = userEvent.setup();
    render(<LearningSession item={calculationPlanItem} api={api} planId="plan-daily-1" studyDate="2026-07-16" />);

    await screen.findByLabelText("13 + 9 + 4 = ?");
    await user.click(screen.getByRole("button", { name: "4" }));
    await user.click(screen.getByRole("button", { name: "답 확인" }));
    expect(await screen.findByText("답을 다시 생각해 봐요.")).toBeVisible();
    expect(screen.getByRole("button", { name: "다음 문제" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "지우기" }));
    await user.click(screen.getByRole("button", { name: "2" }));
    await user.click(screen.getByRole("button", { name: "6" }));
    await user.click(screen.getByRole("button", { name: "답 확인" }));
    expect(await screen.findByText("정답이에요.")).toBeVisible();
    expect(screen.getByRole("button", { name: "다음 문제" })).toBeEnabled();
    expect(api.saveAttempt).toHaveBeenLastCalledWith(expect.objectContaining({
      planId: "plan-daily-1",
      itemId: "calculation-01",
      contentVersion: 3,
      studyDate: "2026-07-16",
      readingScore: 100,
      missedTokens: [],
      mathAnswer: 26,
      occurredAt: expect.any(String)
    }));
  });

  it("keeps dictation keyboard-only, replays only on a direct click, and sends raw text only to the online request", async () => {
    const api = createLearningApi();
    const speak = vi.fn();
    const utterances: Array<{ lang: string; text: string }> = [];
    vi.stubGlobal("SpeechSynthesisUtterance", class {
      lang = "";
      constructor(readonly text: string) {
        utterances.push(this);
      }
    });
    vi.stubGlobal("speechSynthesis", { speak });
    const user = userEvent.setup();

    render(<LearningSession
      item={currentDictationPlanItem}
      api={api}
      planId="plan-daily-1"
      studyDate="2026-07-16"
    />);

    const input = await screen.findByLabelText("받아쓰기 답");
    expect(input).toHaveAttribute("lang", "ko");
    expect(input).toHaveAttribute("maxlength", "200");
    expect(input).toHaveAttribute("autocorrect", "off");
    expect(input).toHaveAttribute("autocomplete", "off");
    expect(input).toHaveClass("dictation-panel__input");
    expect(screen.queryByRole("button", { name: /마이크|녹음|말하기/ })).not.toBeInTheDocument();
    expect(speak).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "다시 듣기" }));
    expect(utterances).toEqual([expect.objectContaining({ text: "봄비", lang: "ko-KR" })]);
    expect(speak).toHaveBeenCalledOnce();

    await user.type(input, "봄 비");
    await user.click(screen.getByRole("button", { name: "받아쓰기 확인" }));
    expect(api.saveAttempt).toHaveBeenCalledWith(expect.objectContaining({
      dictationText: "봄 비",
      mathAnswer: null,
      readingScore: 100,
      missedTokens: []
    }));
    await expect(listQueuedAttempts()).resolves.toEqual([]);
  });

  it("shows an accessible connection error when offline dictation cannot be queued", async () => {
    const rawText = "봄 비";
    const api = createLearningApi();
    api.saveAttempt.mockRejectedValue(new TypeError("offline"));
    const user = userEvent.setup();

    render(<LearningSession
      item={currentDictationPlanItem}
      api={api}
      planId="plan-daily-1"
      studyDate="2026-07-16"
      idFactory={offlineId}
    />);

    await user.type(await screen.findByLabelText("받아쓰기 답"), rawText);
    await user.click(screen.getByRole("button", { name: "받아쓰기 확인" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "받아쓰기는 연결된 상태에서 다시 확인해 주세요."
    );
    await expect(listQueuedAttempts()).resolves.toEqual([]);
    expect(JSON.stringify(await listActivities())).not.toContain(rawText);
  });

  it("advances a receipt-completed wrong challenge but leaves an ordinary wrong dictation retryable", async () => {
    const challengeApi = createLearningApi();
    challengeApi.saveAttempt.mockResolvedValue(receipt({
      dictationPass: false,
      completed: true,
      challengeBonus: { eligible: false, awarded: false, amount: 0 }
    }));
    const onNext = vi.fn();
    const user = userEvent.setup();
    const challenge = render(<LearningSession
      item={challengeDictationPlanItem}
      api={challengeApi}
      planId="plan-daily-1"
      studyDate="2026-07-16"
      onNext={onNext}
    />);

    await screen.findByLabelText("받아쓰기 답");
    await user.type(screen.getByLabelText("받아쓰기 답"), "틀린 답");
    await user.click(screen.getByRole("button", { name: "받아쓰기 확인" }));
    expect(await screen.findByText("도전 시도 완료")).toBeVisible();
    expect(screen.getByRole("button", { name: "다음 문제" })).toBeEnabled();
    expect(screen.queryByText(/도전 만점 보너스/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "다음 문제" }));
    expect(onNext).toHaveBeenCalledOnce();
    challenge.unmount();

    const ordinaryApi = createLearningApi();
    ordinaryApi.saveAttempt.mockResolvedValue(receipt({
      dictationPass: false,
      completed: false
    }));
    render(<LearningSession
      item={currentDictationPlanItem}
      api={ordinaryApi}
      planId="plan-daily-1"
      studyDate="2026-07-16"
    />);
    await userEvent.type(await screen.findByLabelText("받아쓰기 답"), "틀린 답");
    await userEvent.click(screen.getByRole("button", { name: "받아쓰기 확인" }));
    expect(await screen.findByText("다시 써 볼까요?")).toBeVisible();
    expect(screen.getByRole("button", { name: "다음 문제" })).toBeDisabled();
  });

  it("shows challenge bonus only when the canonical receipt awards it", async () => {
    const api = createLearningApi();
    api.saveAttempt.mockResolvedValue(receipt({
      challengeBonus: { eligible: true, awarded: true, amount: 2 }
    }));
    const user = userEvent.setup();
    render(<LearningSession
      item={challengeCalculationPlanItem}
      api={api}
      planId="plan-daily-1"
      studyDate="2026-07-16"
    />);
    await screen.findByLabelText("13 + 9 + 4 = ?");
    await user.click(screen.getByRole("button", { name: "2" }));
    await user.click(screen.getByRole("button", { name: "6" }));
    await user.click(screen.getByRole("button", { name: "답 확인" }));
    expect(await screen.findByText("도전 만점 보너스 별 2개")).toBeVisible();
    expect(companionBubble()).toHaveTextContent("별토끼 버니");
    expect(screen.getByRole("status", { name: "차나핑 코치" }))
      .toHaveTextContent(/칭찬하는 것도 귀찮은데|살짝 기분이 좋아졌어|작은 반짝임으로 기록/);
  });

  it("never fabricates completion for a wrong challenge while its receipt is offline", async () => {
    const api = createLearningApi();
    api.saveAttempt.mockRejectedValue(new TypeError("offline"));
    const onNext = vi.fn();
    const onProvisional = vi.fn();
    const user = userEvent.setup();
    render(<LearningSession
      item={challengeCalculationPlanItem}
      api={api}
      planId="plan-daily-1"
      studyDate="2026-07-16"
      idFactory={offlineId}
      onNext={onNext}
      onProvisional={onProvisional}
    />);
    await screen.findByLabelText("13 + 9 + 4 = ?");
    await user.click(screen.getByRole("button", { name: "1" }));
    await user.click(screen.getByRole("button", { name: "답 확인" }));

    await waitFor(() => expect(api.saveAttempt).toHaveBeenCalledOnce());
    expect(screen.queryByText("도전 시도 완료")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "다음 문제" })).toBeDisabled();
    expect(onProvisional).not.toHaveBeenCalled();
    expect(onNext).not.toHaveBeenCalled();
  });

  it("saves a passing reading attempt without retaining the transcript", async () => {
    const api = createLearningApi();
    render(<LearningSession item={readingPlanItem} api={api} planId="plan-daily-1" studyDate="2026-07-16" />);

    await submitManualTranscript(readingItem.text);
    expect(api.saveAttempt).toHaveBeenCalledWith(expect.objectContaining({
      planId: "plan-daily-1",
      itemId: "ko-01",
      readingScore: 100,
      missedTokens: [],
      mathAnswer: null,
      occurredAt: expect.any(String)
    }));
    expect(api.saveAttempt.mock.calls[0]![0]).not.toHaveProperty("transcript");
    expect(screen.getByRole("button", { name: "다음 문제" })).toBeEnabled();
    await expect(getQueueCounts()).resolves.toEqual({
      activities: 0,
      provisionalAttempts: 0,
      rejected: 0
    });
  });

  it("reports the authoritative online cursor after a saved attempt", async () => {
    const api = createLearningApi();
    api.saveAttempt.mockResolvedValue(receipt({ activityCursor: 7 }));
    const onActivityCursor = vi.fn();
    render(<LearningSession
      item={readingPlanItem}
      api={api}
      planId="plan-daily-1"
      studyDate="2026-07-16"
      onActivityCursor={onActivityCursor}
    />);

    await submitManualTranscript(readingItem.text);

    expect(onActivityCursor).toHaveBeenCalledWith(7);
  });

  it.each([
    ["network", new TypeError("offline")],
    ["server", new ApiError(503, "SERVICE_UNAVAILABLE")]
  ])("queues a passing reading submission after a recoverable %s failure", async (_label, failure) => {
    const api = createLearningApi();
    const onExit = vi.fn();
    api.saveAttempt.mockRejectedValue(failure);
    render(<LearningSession
      item={readingPlanItem}
      api={api}
      planId="plan-daily-1"
      studyDate="2026-07-16"
      idFactory={offlineId}
      onExit={onExit}
    />);

    await submitManualTranscript(readingItem.text);

    await waitFor(async () => {
      expect(await listQueuedAttempts()).toHaveLength(1);
    });
    expect(await listQueuedAttempts()).toEqual([
      expect.objectContaining({
        clientAttemptId: "attempt-offline-0001",
        itemId: "ko-01",
        studyDate: "2026-07-16",
        readingScore: 100,
        mathAnswer: null
      })
    ]);
    expect(screen.getByRole("button", { name: "다음 문제" })).toBeEnabled();
    expect(screen.getByText("동기화 대기")).toBeVisible();
    const dashboardReturn = screen.getByRole("button", { name: "대시보드로 돌아가기" });
    expect(dashboardReturn).toBeEnabled();
    await userEvent.click(dashboardReturn);
    expect(onExit).toHaveBeenCalledOnce();
    await expect(listQueuedAttempts()).resolves.toHaveLength(1);
  });

  it.each([
    [401, "AUTH_REQUIRED"],
    [403, "DEVICE_REVOKED"],
    [403, "DEVICE_NOT_TRUSTED"],
    [409, "PLAN_NOT_ISSUED"],
    [400, "INVALID_REQUEST"]
  ])("exits and does not queue an attempt after an explicit %s %s authority failure", async (status, code) => {
    const api = createLearningApi();
    api.saveAttempt.mockRejectedValue(new ApiError(status, code));
    const onExit = vi.fn();
    render(<LearningSession
      item={readingPlanItem}
      api={api}
      planId="plan-daily-1"
      studyDate="2026-07-16"
      onExit={onExit}
    />);

    await submitManualTranscript(readingItem.text);

    await waitFor(() => expect(onExit).toHaveBeenCalledOnce());
    expect(screen.queryByRole("status", { name: "마법 친구 말풍선" }))
      .not.toBeInTheDocument();
    await expect(listQueuedAttempts()).resolves.toEqual([]);
  });

  it("does not queue a rejected invalid attempt", async () => {
    const api = createLearningApi();
    const onExit = vi.fn();
    api.saveAttempt.mockRejectedValue(new ApiError(400, "INVALID_ATTEMPT"));
    render(<LearningSession
      item={readingPlanItem}
      api={api}
      planId="plan-daily-1"
      studyDate="2026-07-16"
      onExit={onExit}
    />);

    await submitManualTranscript(readingItem.text);

    await waitFor(() => expect(onExit).toHaveBeenCalledOnce());
    await expect(listQueuedAttempts()).resolves.toEqual([]);
  });

  it("queues a locally correct math answer as provisional and unlocks Next without confirming a star", async () => {
    const api = createLearningApi();
    api.saveAttempt.mockRejectedValue(new TypeError("offline"));
    const user = userEvent.setup();
    render(<LearningSession
      item={mathPlanItem}
      api={api}
      planId="plan-daily-1"
      studyDate="2026-07-16"
      idFactory={offlineId}
    />);
    await screen.findByLabelText("답 쓰기");
    await user.type(screen.getByLabelText("답 쓰기"), "5");
    await user.click(screen.getByRole("button", { name: "답 확인" }));

    await waitFor(async () => {
      expect(await listQueuedAttempts()).toHaveLength(1);
    });
    expect(await listQueuedAttempts()).toEqual([
      expect.objectContaining({
        clientAttemptId: "attempt-offline-0001",
        itemId: "math-01",
        readingScore: 100,
        mathAnswer: 5
      })
    ]);
    expect(screen.getByRole("button", { name: "다음 문제" })).toBeEnabled();
    expect(screen.getByText("동기화 대기")).toBeVisible();
    expect(screen.queryByText(/별 1개를 모았어요/)).not.toBeInTheDocument();
  });

  it.each([
    ["network", new TypeError("offline")],
    ["server", new ApiError(503, "HTTP_503")]
  ])("journals a failed online-issued idle as a sanitized legacy waiver after a %s failure", async (_label, failure) => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    vi.setSystemTime(new Date("2026-07-16T01:00:00.000Z"));
    const api = createLearningApi();
    api.sendIdleEvent.mockRejectedValue(failure);
    render(<LearningSession
      item={readingPlanItem}
      api={api}
      planId="plan-daily-1"
      studyDate="2026-07-16"
      idFactory={offlineId}
    />);
    await flushLearningSessionIssue();

    await act(async () => {
      vi.advanceTimersByTime(300_000);
      await Promise.resolve();
    });
    vi.useRealTimers();
    await expect(listActivities()).resolves.toEqual([
      expect.objectContaining({
        clientId: "idle-event-offline-0001",
        planId: "plan-daily-1",
        event: {
          kind: "idle",
          legacy: true,
          payload: expect.objectContaining({
            clientIdleEventId: "idle-event-offline-0001",
            itemId: "ko-01",
            studyDate: "2026-07-16"
          })
        }
      })
    ]);
    await expect(listQueuedIdleEvents()).resolves.toEqual([]);
    expect(JSON.stringify(await listActivities()))
      .not.toContain("server-issued-learning-session-0001");
    expect(screen.getByText(
      "쉬는 기록을 동기화 대기 중이에요. 연결되면 확인할게요."
    )).toBeVisible();
    expect(screen.getByRole("button", { name: "학습 계속하기" })).toBeVisible();
  });

  it("exits on an explicit idle 4xx without queuing or deducting locally", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    vi.setSystemTime(new Date("2026-07-16T01:00:00.000Z"));
    const api = createLearningApi();
    api.sendIdleEvent.mockRejectedValue(new ApiError(409, "PLAN_SUBMISSION_EXPIRED"));
    const onExit = vi.fn();
    render(<LearningSession
      item={readingPlanItem}
      api={api}
      planId="plan-daily-1"
      studyDate="2026-07-16"
      onExit={onExit}
    />);
    await flushLearningSessionIssue();

    await act(async () => {
      vi.advanceTimersByTime(300_000);
      await Promise.resolve();
    });

    expect(onExit).toHaveBeenCalledOnce();
    expect(screen.queryByRole("status", { name: "마법 친구 말풍선" }))
      .not.toBeInTheDocument();
    await expect(listActivities()).resolves.toEqual([]);
    await expect(listQueuedIdleEvents()).resolves.toEqual([]);
  });

  it("exits on an idle denial when authority clearing itself rejects", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    vi.setSystemTime(new Date("2026-07-16T01:00:00.000Z"));
    const fetcher = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/student/learning-sessions") {
        return new Response(JSON.stringify({
          learningSessionId: "server-issued-learning-session-0001",
          activeUntil: "2026-07-16T07:00:00.000Z",
          submitUntil: "2026-07-17T14:59:59.999Z"
        }), { status: 201, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ code: "LEARNING_SESSION_EXPIRED" }), {
        status: 409,
        headers: { "content-type": "application/json" }
      });
    });
    const api = new ApiClient(fetcher, {
      onAuthorityFailure: vi.fn().mockRejectedValue(
        new TypeError("indexedDB unavailable")
      )
    });
    const onExit = vi.fn();
    render(<LearningSession
      item={readingPlanItem}
      api={api}
      planId="plan-daily-1"
      studyDate="2026-07-16"
      onExit={onExit}
    />);
    await flushLearningSessionIssue();

    await act(async () => {
      vi.advanceTimersByTime(300_000);
      await Promise.resolve();
    });

    expect(onExit).toHaveBeenCalledOnce();
    await expect(listActivities()).resolves.toEqual([]);
    await expect(listQueuedIdleEvents()).resolves.toEqual([]);
  });

  it("leaves no idle queue row after a direct success", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-16T01:00:00.000Z"));
    const api = createLearningApi();
    render(<LearningSession item={readingPlanItem} api={api} planId="plan-daily-1" studyDate="2026-07-16" />);
    await flushLearningSessionIssue();

    await act(async () => {
      vi.advanceTimersByTime(300_000);
      await Promise.resolve();
    });
    vi.useRealTimers();

    await expect(listQueuedIdleEvents()).resolves.toEqual([]);
  });

  it.each([
    ["applied", "5분 동안 학습 활동이 없어서 별 1개가 줄었어요. 준비되면 다시 시작할 수 있어요."],
    ["capped", "오늘은 별이 더 줄지 않아요. 준비되면 다시 시작할 수 있어요."],
    ["no-balance", "5분 동안 학습 활동이 없었어요. 줄어들 별은 없고 기록만 남겼어요."],
    ["order-conflict-waived", "오프라인 순서가 달라 별을 차감하지 않았어요. 준비되면 다시 시작할 수 있어요."]
  ] as const)("pauses for an idle %s result until the child explicitly resumes", async (outcome, message) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-16T01:00:00.000Z"));
    const api = createLearningApi();
    api.sendIdleEvent.mockResolvedValue(idleResult(outcome));
    render(<LearningSession item={readingPlanItem} api={api} planId="plan-daily-1" studyDate="2026-07-16" />);
    await flushLearningSessionIssue();

    await act(async () => {
      vi.advanceTimersByTime(300_000);
      await Promise.resolve();
    });

    expect(api.sendIdleEvent).toHaveBeenCalledOnce();
    expect(api.sendIdleEvent).toHaveBeenCalledWith(expect.objectContaining({
      itemId: "ko-01",
      planId: "plan-daily-1",
      contentVersion: 1,
      learningSessionId: "server-issued-learning-session-0001",
      studyDate: "2026-07-16",
      idleStartedAt: "2026-07-16T01:00:00.000Z",
      occurredAt: "2026-07-16T01:05:00.000Z"
    }));
    expect(screen.getByText(message)).toBeVisible();
    expect(screen.getByRole("button", { name: "학습 계속하기" })).toBeVisible();

    await act(async () => {
      vi.advanceTimersByTime(600_000);
      await Promise.resolve();
    });
    expect(api.sendIdleEvent).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "학습 계속하기" }));
    await act(async () => {
      vi.advanceTimersByTime(300_000);
      await Promise.resolve();
    });
    expect(api.sendIdleEvent).toHaveBeenCalledTimes(2);
    const [first, second] = api.sendIdleEvent.mock.calls.map((call) => call[0]);
    expect(first.learningSessionId).toBe(second.learningSessionId);
    expect(first.clientIdleEventId).not.toBe(second.clientIdleEventId);
  });

  it("disables every learning control after deduction until explicit resume", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-16T01:00:00.000Z"));
    const api = createLearningApi();
    render(<LearningSession item={mathPlanItem} api={api} planId="plan-daily-1" studyDate="2026-07-16" />);
    await flushLearningSessionIssue();

    expect(screen.getByLabelText("답 쓰기")).toBeEnabled();
    fireEvent.change(screen.getByLabelText("답 쓰기"), {
      target: { value: "5" }
    });

    await act(async () => {
      vi.advanceTimersByTime(300_000);
      await Promise.resolve();
    });
    expect(screen.getByRole("button", { name: "학습 계속하기" })).toBeVisible();
    expect(screen.getByLabelText("답 쓰기")).toBeDisabled();
    expect(screen.getByRole("button", { name: "답 확인" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "다음 문제" })).toBeDisabled();
    fireEvent.submit(screen.getByLabelText("답 쓰기").closest("form")!);
    await act(async () => {
      await Promise.resolve();
    });
    expect(api.saveAttempt).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "학습 계속하기" }));
    expect(screen.getByLabelText("답 쓰기")).toBeEnabled();
    expect(screen.getByRole("button", { name: "답 확인" })).toBeEnabled();
  });

  it("pauses inactivity for a requested break without clearing the answer or deducting a star", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-16T01:00:00.000Z"));
    const api = createLearningApi();
    render(<LearningSession item={mathPlanItem} api={api} planId="plan-daily-1" studyDate="2026-07-16" />);
    await flushLearningSessionIssue();

    fireEvent.change(screen.getByLabelText("답 쓰기"), {
      target: { value: "5" }
    });
    fireEvent.click(screen.getByRole("button", { name: "메뉴 열기" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "학생 메뉴" }))
      .getByRole("button", { name: "잠깐 쉬기" }));

    expect(screen.getByRole("button", { name: "학습 계속" })).toBeVisible();
    expect(screen.getByLabelText("답 쓰기")).toHaveValue("5");
    expect(screen.getByLabelText("답 쓰기")).toBeDisabled();

    await act(async () => {
      vi.advanceTimersByTime(900_000);
      await Promise.resolve();
    });
    expect(api.sendIdleEvent).not.toHaveBeenCalled();
    expect(screen.getByLabelText("답 쓰기")).toHaveValue("5");

    fireEvent.click(screen.getByRole("button", { name: "학습 계속" }));
    expect(screen.getByLabelText("답 쓰기")).toBeEnabled();
    expect(screen.getByLabelText("답 쓰기")).toHaveValue("5");

    await act(async () => {
      vi.advanceTimersByTime(300_000);
      await Promise.resolve();
    });
    expect(api.sendIdleEvent).toHaveBeenCalledOnce();
  });

  it("invokes student back navigation without exiting or clearing the current answer", async () => {
    const api = createLearningApi();
    const onExit = vi.fn();
    const onNavigateToday = vi.fn();
    render(
      <LearningSession
        item={mathPlanItem}
        api={api}
        planId="plan-daily-1"
        studyDate="2026-07-16"
        onExit={onExit}
        onNavigateToday={onNavigateToday}
      />
    );
    await flushLearningSessionIssue();

    fireEvent.change(screen.getByLabelText("답 쓰기"), {
      target: { value: "5" }
    });
    fireEvent.click(screen.getByRole("button", { name: "뒤로" }));

    expect(onNavigateToday).toHaveBeenCalledOnce();
    expect(onExit).not.toHaveBeenCalled();
    expect(screen.getByLabelText("답 쓰기")).toHaveValue("5");
  });

  it("pauses inactivity while a preserved session is behind the dashboard", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-16T01:00:00.000Z"));
    const api = createLearningApi();
    const { rerender } = render(
      <LearningSession
        active
        item={mathPlanItem}
        api={api}
        planId="plan-daily-1"
        studyDate="2026-07-16"
      />
    );
    await flushLearningSessionIssue();

    rerender(
      <LearningSession
        active={false}
        item={mathPlanItem}
        api={api}
        planId="plan-daily-1"
        studyDate="2026-07-16"
      />
    );
    await act(async () => {
      vi.advanceTimersByTime(900_000);
      await Promise.resolve();
    });
    expect(api.sendIdleEvent).not.toHaveBeenCalled();

    rerender(
      <LearningSession
        active
        item={mathPlanItem}
        api={api}
        planId="plan-daily-1"
        studyDate="2026-07-16"
      />
    );
    await act(async () => {
      vi.advanceTimersByTime(300_000);
      await Promise.resolve();
    });
    expect(api.sendIdleEvent).toHaveBeenCalledOnce();
  });

  it("preserves screen lock while celebration ends then continues the 2/4/5-minute lifecycle", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-16T01:00:00.000Z"));
    const api = createLearningApi();
    api.saveAttempt.mockResolvedValue(receipt({
      starAward: {
        awarded: true,
        amount: 1,
        balance: 8,
        eventId: "star-learning-session-completion-1"
      }
    }));
    render(<LearningSession item={readingPlanItem} api={api} planId="plan-daily-1" studyDate="2026-07-16" />);
    await flushLearningSessionIssue();

    fireEvent.click(screen.getByText("직접 입력으로 확인하기"));
    fireEvent.change(screen.getByLabelText("읽은 내용 직접 입력"), {
      target: { value: readingItem.text }
    });
    fireEvent.click(screen.getByRole("button", { name: "읽기 판정하기" }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByText("별 1개를 모았어요")).toBeVisible();
    fireEvent(window, new Event("pagehide"));

    await act(async () => {
      vi.advanceTimersByTime(1_000);
    });
    expect(screen.queryByText("별 1개를 모았어요")).not.toBeInTheDocument();
    await act(async () => {
      vi.advanceTimersByTime(120_000);
    });
    expect(screen.queryByText("힘들면 힌트를 열어 봐요.")).not.toBeInTheDocument();

    fireEvent(window, new Event("pageshow"));
    await act(async () => {
      vi.advanceTimersByTime(120_000);
    });
    expect(screen.getByText("힘들면 힌트를 열어 봐요.")).toBeVisible();
    await act(async () => {
      vi.advanceTimersByTime(120_000);
    });
    expect(screen.getByText("계속 할 수 있을까요?")).toBeVisible();
    await act(async () => {
      vi.advanceTimersByTime(60_000);
      await Promise.resolve();
    });
    expect(api.sendIdleEvent).toHaveBeenCalledOnce();
  });
});

describe("StarCelebration", () => {
  it("plays an awarded event only once across rerenders and duplicate receipts", () => {
    const starAward = {
      awarded: true,
      amount: 1,
      balance: 8,
      eventId: "star-celebration-once-1"
    };
    const view = render(<StarCelebration starAward={starAward} reducedMotion={false} />);

    expect(screen.getByText("별 1개를 모았어요")).toBeVisible();
    view.rerender(<StarCelebration starAward={starAward} reducedMotion={false} />);
    expect(screen.getAllByText("별 1개를 모았어요")).toHaveLength(1);

    view.unmount();
    render(<StarCelebration starAward={starAward} reducedMotion={false} />);
    expect(screen.queryByText("별 1개를 모았어요")).not.toBeInTheDocument();
  });

  it("uses text without transforms or particles under reduced motion", () => {
    render(<StarCelebration starAward={{
      awarded: true,
      amount: 1,
      balance: 9,
      eventId: "star-celebration-reduced-1"
    }} reducedMotion />);

    const celebration = screen.getByRole("status", { name: "별 보상" });
    expect(celebration).toHaveTextContent("별 1개를 모았어요");
    expect(celebration).toHaveAttribute("data-reduced-motion", "true");
    expect(celebration.querySelector("[data-star-particle]")).toBeNull();
    expect(celebration.getAttribute("style") ?? "").not.toContain("transform");
  });

  it("does not show a celebration for a non-awarded receipt", () => {
    render(<StarCelebration starAward={{
      awarded: false,
      amount: 0,
      balance: 9,
      eventId: "star-not-awarded-1"
    }} />);

    expect(screen.queryByRole("status", { name: "별 보상" })).not.toBeInTheDocument();
  });

  it("completes once and removes the celebration within one second", () => {
    vi.useFakeTimers();
    const onComplete = vi.fn();
    render(<StarCelebration starAward={{
      awarded: true,
      amount: 1,
      balance: 10,
      eventId: "star-celebration-completion-1"
    }} onComplete={onComplete} />);

    act(() => vi.advanceTimersByTime(999));
    expect(onComplete).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onComplete).toHaveBeenCalledOnce();
    expect(onComplete).toHaveBeenCalledWith("star-celebration-completion-1");
    expect(screen.queryByRole("status", { name: "별 보상" })).not.toBeInTheDocument();
  });

  it("still completes an active event after its receipt is cleared from view", () => {
    vi.useFakeTimers();
    const onComplete = vi.fn();
    const starAward = {
      awarded: true,
      amount: 1,
      balance: 11,
      eventId: "star-cleared-active-completion-1"
    };
    const view = render(<StarCelebration
      starAward={starAward}
      onComplete={onComplete}
    />);
    expect(screen.getByRole("status", { name: "별 보상" })).toBeVisible();

    view.rerender(<StarCelebration starAward={null} onComplete={onComplete} />);
    expect(screen.queryByRole("status", { name: "별 보상" }))
      .not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1_000));

    expect(onComplete).toHaveBeenCalledOnce();
    expect(onComplete).toHaveBeenCalledWith("star-cleared-active-completion-1");
  });
});

describe("SpeechController", () => {
  it("finishes a capture at 45 seconds without relying on method this binding", () => {
    vi.useFakeTimers();
    const listeners = new Map<string, Array<(...args: any[]) => void>>();
    const stop = vi.fn(() => {
      listeners.get("end")?.forEach((listener) => listener());
    });
    class FakeRecognition {
      lang = "";
      interimResults = false;
      continuous = false;
      start = vi.fn();
      stop = stop;
      abort = vi.fn();
      addEventListener(type: "result", listener: (event: any) => void): void;
      addEventListener(type: "end", listener: () => void): void;
      addEventListener(type: "error", listener: (event: any) => void): void;
      addEventListener(type: string, listener: (...args: any[]) => void) {
        const current = listeners.get(type) ?? [];
        current.push(listener);
        listeners.set(type, current);
      }
    }
    const onTranscript = vi.fn();
    const controller = createSpeechController({
      onTranscript,
      recognitionConstructor: FakeRecognition
    });
    const start = controller.start;

    start();
    expect(() => vi.advanceTimersByTime(45_000)).not.toThrow();
    expect(stop).toHaveBeenCalledOnce();
    expect(onTranscript).toHaveBeenCalledWith("");
  });
});
