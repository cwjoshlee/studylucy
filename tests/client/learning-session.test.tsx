// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { deleteDB } from "idb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../src/client/api/client";
import type { AttemptReceipt, LearningItemPayload } from "../../src/shared/learning";
import type { IdleEventResult } from "../../src/shared/stars";
import { StarCelebration } from "../../src/client/delight/star-celebration";
import { LearningSession } from "../../src/client/learning/learning-session";
import { createSpeechController } from "../../src/client/learning/speech-recognition";
import {
  OFFLINE_DB_NAME,
  getQueueCounts,
  listQueuedAttempts,
  listQueuedIdleEvents
} from "../../src/client/offline/db";

const mathItem: LearningItemPayload = {
  id: "math-01",
  subject: "math",
  unit: "더하기",
  title: "별을 세어요",
  level: "1단계",
  readLabel: "수학 지문 읽기",
  text: "별 세 개와 별 두 개가 있어요.",
  question: "별은 모두 몇 개일까요?",
  hint: "두 수를 더해 봐요.",
  tokens: ["별", "세 개", "두 개", "모두"],
  answer: 5,
  unitLabel: "개",
  checkHint: "3과 2를 더해 봐요.",
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
  kind: "korean-reading"
};

function receipt(overrides: Partial<AttemptReceipt> = {}): AttemptReceipt {
  return {
    id: "attempt-server-1",
    duplicate: false,
    readingPass: true,
    mathPass: true,
    completed: true,
    starAward: {
      awarded: false,
      amount: 0,
      balance: 7,
      eventId: null
    },
    ...overrides
  };
}

function idleResult(outcome: IdleEventResult["outcome"]): IdleEventResult {
  return {
    id: `idle-${outcome}-0001`,
    outcome,
    starEventId: outcome === "applied" ? "star-idle-1" : null,
    duplicate: false
  };
}

function createLearningApi() {
  return {
    saveAttempt: vi.fn().mockResolvedValue(receipt()),
    sendIdleEvent: vi.fn().mockResolvedValue(idleResult("applied"))
  };
}

function supportSpeechRecognition(): void {
  class FakeRecognition {
    lang = "";
    interimResults = false;
    continuous = false;
    start = vi.fn();
    stop = vi.fn();
    abort = vi.fn();
    addEventListener = vi.fn();
  }
  Object.defineProperty(window, "SpeechRecognition", {
    configurable: true,
    value: FakeRecognition
  });
}

async function submitManualTranscript(transcript: string): Promise<void> {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("읽은 내용 직접 입력"), transcript);
  await user.click(screen.getByRole("button", { name: "읽기 판정하기" }));
}

function offlineId(prefix: "learning-session" | "attempt" | "idle-event"): string {
  return `${prefix}-offline-0001`;
}

beforeEach(async () => {
  await deleteDB(OFFLINE_DB_NAME);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  Reflect.deleteProperty(window, "SpeechRecognition");
});

describe("LearningSession", () => {
  it("keeps math locked until the full reading passes", async () => {
    render(<LearningSession item={mathItem} api={createLearningApi()} studyDate="2026-07-16" />);

    expect(screen.getByLabelText("답 쓰기")).toBeDisabled();
    await submitManualTranscript(`${mathItem.text} ${mathItem.question}`);
    expect(screen.getByText("읽기 PASS")).toBeVisible();
    expect(screen.getByLabelText("답 쓰기")).toBeEnabled();
  });

  it("keeps Next locked for a server-rejected math answer and unlocks it after a correct attempt", async () => {
    const api = createLearningApi();
    api.saveAttempt.mockImplementation(async (input) => input.mathAnswer === 5
      ? receipt()
      : receipt({ mathPass: false, completed: false }));
    const user = userEvent.setup();
    render(<LearningSession item={mathItem} api={api} studyDate="2026-07-16" />);
    await submitManualTranscript(`${mathItem.text} ${mathItem.question}`);

    await user.type(screen.getByLabelText("답 쓰기"), "4");
    await user.click(screen.getByRole("button", { name: "답 확인" }));
    expect(await screen.findByText("답을 다시 생각해 봐요.")).toBeVisible();
    expect(screen.getByRole("button", { name: "다음 문제" })).toBeDisabled();

    await user.clear(screen.getByLabelText("답 쓰기"));
    await user.type(screen.getByLabelText("답 쓰기"), "5");
    await user.click(screen.getByRole("button", { name: "답 확인" }));
    expect(await screen.findByText("정답이에요.")).toBeVisible();
    expect(screen.getByRole("button", { name: "다음 문제" })).toBeEnabled();
    expect(api.saveAttempt).toHaveBeenLastCalledWith(expect.objectContaining({
      itemId: "math-01",
      contentVersion: 1,
      studyDate: "2026-07-16",
      readingScore: 100,
      missedTokens: [],
      mathAnswer: 5
    }));
  });

  it("saves a passing reading attempt without retaining the transcript", async () => {
    const api = createLearningApi();
    render(<LearningSession item={readingItem} api={api} studyDate="2026-07-16" />);

    await submitManualTranscript(readingItem.text);
    expect(api.saveAttempt).toHaveBeenCalledWith(expect.objectContaining({
      itemId: "ko-01",
      readingScore: 100,
      missedTokens: [],
      mathAnswer: null
    }));
    expect(api.saveAttempt.mock.calls[0]![0]).not.toHaveProperty("transcript");
    expect(screen.getByRole("button", { name: "다음 문제" })).toBeEnabled();
    await expect(getQueueCounts()).resolves.toEqual({ attempts: 0, idleEvents: 0 });
  });

  it.each([
    ["network", new TypeError("offline")],
    ["server", new ApiError(503, "SERVICE_UNAVAILABLE")],
    ["expired session", new ApiError(401, "AUTH_REQUIRED")]
  ])("queues a passing reading submission after a recoverable %s failure", async (_label, failure) => {
    const api = createLearningApi();
    api.saveAttempt.mockRejectedValue(failure);
    render(<LearningSession
      item={readingItem}
      api={api}
      studyDate="2026-07-16"
      idFactory={offlineId}
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
    expect(screen.getByRole("button", { name: "다음 문제" })).toBeDisabled();
  });

  it("does not queue a rejected invalid attempt", async () => {
    const api = createLearningApi();
    api.saveAttempt.mockRejectedValue(new ApiError(400, "INVALID_ATTEMPT"));
    render(<LearningSession item={readingItem} api={api} studyDate="2026-07-16" />);

    await submitManualTranscript(readingItem.text);

    await screen.findByText("학습 기록을 저장하지 못했어요. 다시 시도해 주세요.");
    await expect(listQueuedAttempts()).resolves.toEqual([]);
  });

  it("queues a math answer after a network failure without unlocking Next", async () => {
    const api = createLearningApi();
    api.saveAttempt.mockRejectedValue(new TypeError("offline"));
    const user = userEvent.setup();
    render(<LearningSession
      item={mathItem}
      api={api}
      studyDate="2026-07-16"
      idFactory={offlineId}
    />);
    await submitManualTranscript(`${mathItem.text} ${mathItem.question}`);

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
    expect(screen.getByRole("button", { name: "다음 문제" })).toBeDisabled();
  });

  it("queues an idle event after a network failure and keeps learning paused", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    vi.setSystemTime(new Date("2026-07-16T01:00:00.000Z"));
    const api = createLearningApi();
    api.sendIdleEvent.mockRejectedValue(new TypeError("offline"));
    render(<LearningSession
      item={readingItem}
      api={api}
      studyDate="2026-07-16"
      idFactory={offlineId}
    />);

    await act(async () => {
      vi.advanceTimersByTime(300_000);
      await Promise.resolve();
    });
    vi.useRealTimers();
    await waitFor(async () => {
      expect(await listQueuedIdleEvents()).toHaveLength(1);
    });
    expect(await listQueuedIdleEvents()).toEqual([
      expect.objectContaining({
        clientIdleEventId: "idle-event-offline-0001",
        learningSessionId: "learning-session-offline-0001",
        itemId: "ko-01",
        studyDate: "2026-07-16"
      })
    ]);
    expect(screen.getByRole("button", { name: "학습 계속하기" })).toBeVisible();
  });

  it("leaves no idle queue row after a direct success", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-16T01:00:00.000Z"));
    render(<LearningSession item={readingItem} api={createLearningApi()} studyDate="2026-07-16" />);

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
    ["no-balance", "5분 동안 학습 활동이 없었어요. 줄어들 별은 없고 기록만 남겼어요."]
  ] as const)("pauses for an idle %s result until the child explicitly resumes", async (outcome, message) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-16T01:00:00.000Z"));
    const api = createLearningApi();
    api.sendIdleEvent.mockResolvedValue(idleResult(outcome));
    render(<LearningSession item={readingItem} api={api} studyDate="2026-07-16" />);

    await act(async () => {
      vi.advanceTimersByTime(300_000);
      await Promise.resolve();
    });

    expect(api.sendIdleEvent).toHaveBeenCalledOnce();
    expect(api.sendIdleEvent).toHaveBeenCalledWith(expect.objectContaining({
      itemId: "ko-01",
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
    supportSpeechRecognition();
    const api = createLearningApi();
    render(<LearningSession item={mathItem} api={api} studyDate="2026-07-16" />);

    fireEvent.change(screen.getByLabelText("읽은 내용 직접 입력"), {
      target: { value: `${mathItem.text} ${mathItem.question}` }
    });
    fireEvent.click(screen.getByRole("button", { name: "읽기 판정하기" }));
    expect(screen.getByLabelText("답 쓰기")).toBeEnabled();
    fireEvent.change(screen.getByLabelText("답 쓰기"), {
      target: { value: "5" }
    });

    await act(async () => {
      vi.advanceTimersByTime(300_000);
      await Promise.resolve();
    });
    expect(screen.getByRole("button", { name: "학습 계속하기" })).toBeVisible();
    expect(screen.getByRole("button", { name: "읽기 시작" })).toBeDisabled();
    expect(screen.getByLabelText("읽은 내용 직접 입력")).toBeDisabled();
    expect(screen.getByRole("button", { name: "읽기 판정하기" })).toBeDisabled();
    expect(screen.getByLabelText("답 쓰기")).toBeDisabled();
    expect(screen.getByRole("button", { name: "답 확인" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "다음 문제" })).toBeDisabled();
    fireEvent.submit(screen.getByLabelText("답 쓰기").closest("form")!);
    await act(async () => {
      await Promise.resolve();
    });
    expect(api.saveAttempt).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "학습 계속하기" }));
    expect(screen.getByRole("button", { name: "읽기 시작" })).toBeEnabled();
    expect(screen.getByLabelText("읽은 내용 직접 입력")).toBeEnabled();
    expect(screen.getByLabelText("답 쓰기")).toBeEnabled();
    expect(screen.getByRole("button", { name: "답 확인" })).toBeEnabled();
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
    render(<LearningSession item={readingItem} api={api} studyDate="2026-07-16" />);

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
      vi.advanceTimersByTime(2_000);
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

  it("completes once and removes the celebration after its display window", () => {
    vi.useFakeTimers();
    const onComplete = vi.fn();
    render(<StarCelebration starAward={{
      awarded: true,
      amount: 1,
      balance: 10,
      eventId: "star-celebration-completion-1"
    }} onComplete={onComplete} />);

    act(() => vi.advanceTimersByTime(1_999));
    expect(onComplete).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onComplete).toHaveBeenCalledOnce();
    expect(onComplete).toHaveBeenCalledWith("star-celebration-completion-1");
    expect(screen.queryByRole("status", { name: "별 보상" })).not.toBeInTheDocument();
  });
});

describe("SpeechController", () => {
  it("finishes a capture at 60 seconds without relying on method this binding", () => {
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
      addEventListener(type: "end" | "error", listener: () => void): void;
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
    expect(() => vi.advanceTimersByTime(60_000)).not.toThrow();
    expect(stop).toHaveBeenCalledOnce();
    expect(onTranscript).toHaveBeenCalledWith("");
  });
});
