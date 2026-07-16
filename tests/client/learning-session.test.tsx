// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AttemptReceipt, LearningItemPayload } from "../../src/shared/learning";
import type { IdleEventResult } from "../../src/shared/stars";
import { StarCelebration } from "../../src/client/delight/star-celebration";
import { LearningSession } from "../../src/client/learning/learning-session";
import { createSpeechController } from "../../src/client/learning/speech-recognition";

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

async function submitManualTranscript(transcript: string): Promise<void> {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("읽은 내용 직접 입력"), transcript);
  await user.click(screen.getByRole("button", { name: "읽기 판정하기" }));
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
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
