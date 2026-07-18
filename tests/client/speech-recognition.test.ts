import { describe, expect, it, vi } from "vitest";
import {
  collapseSpeechSegments,
  createSpeechController,
  type SpeechPhase
} from "../../src/client/learning/speech-recognition";

type Listener = (event?: any) => void;

class FakeRecognition {
  static instance: FakeRecognition | null = null;

  lang = "";
  interimResults = false;
  continuous = false;
  start = vi.fn();
  stop = vi.fn();
  abort = vi.fn();
  listeners = new Map<string, Listener>();

  constructor() {
    FakeRecognition.instance = this;
  }

  addEventListener(type: string, listener: Listener) {
    this.listeners.set(type, listener);
  }

  emit(type: string, event?: unknown) {
    this.listeners.get(type)?.(event);
  }

  emitFinalResult(transcript: string) {
    this.emit("result", {
      resultIndex: 0,
      results: [{ 0: { transcript }, isFinal: true }]
    });
  }
}

describe("speech transcript buffer", () => {
  it("drains source parts while preserving the transcript for callback delivery", () => {
    const committedParts = ["작은 씨앗이", "씨앗이 해를 보았어요"];

    const transcript = collapseSpeechSegments(committedParts);

    expect(transcript).toBe("작은 씨앗이 해를 보았어요");
    expect(committedParts).toEqual([]);
  });
});

describe("speech controller", () => {
  it("stops and delivers one transcript after 3 seconds of silence following a result", () => {
    vi.useFakeTimers();
    const onTranscript = vi.fn();
    const phases: SpeechPhase[] = [];
    const controller = createSpeechController({
      onTranscript,
      onPhaseChange: (phase) => phases.push(phase),
      recognitionConstructor: FakeRecognition
    });

    controller.start();
    FakeRecognition.instance!.emitFinalResult("작은 씨앗이 해를 보았어요");
    vi.advanceTimersByTime(2_999);
    expect(FakeRecognition.instance!.stop).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(FakeRecognition.instance!.stop).toHaveBeenCalledOnce();
    FakeRecognition.instance!.emit("end");
    FakeRecognition.instance!.emit("end");

    expect(onTranscript).toHaveBeenCalledExactlyOnceWith("작은 씨앗이 해를 보았어요");
    expect(phases).toEqual(["listening", "finishing", "ready"]);
  });

  it("guides a retry at 15 seconds with no result and stops at 45 seconds", () => {
    vi.useFakeTimers();
    const onNoResult = vi.fn();
    const onTranscript = vi.fn();
    const controller = createSpeechController({
      onTranscript,
      onNoResult,
      recognitionConstructor: FakeRecognition
    });

    controller.start();
    vi.advanceTimersByTime(15_000);
    expect(onNoResult).toHaveBeenCalledOnce();
    expect(FakeRecognition.instance!.stop).not.toHaveBeenCalled();
    vi.advanceTimersByTime(30_000);
    expect(FakeRecognition.instance!.stop).toHaveBeenCalledOnce();
    FakeRecognition.instance!.emit("end");

    expect(onTranscript).toHaveBeenCalledOnce();
    expect(onTranscript).toHaveBeenCalledWith("");
  });

  it("does not restart after an explicit finish", () => {
    vi.useFakeTimers();
    const controller = createSpeechController({
      onTranscript: vi.fn(),
      recognitionConstructor: FakeRecognition
    });

    controller.start();
    controller.finish();
    FakeRecognition.instance!.emit("end");
    vi.advanceTimersByTime(1_000);

    expect(FakeRecognition.instance!.start).toHaveBeenCalledOnce();
  });

  it("returns to manual input when the browser reports a permission error", () => {
    const onUnavailable = vi.fn();
    const controller = createSpeechController({
      onTranscript: vi.fn(),
      onUnavailable,
      recognitionConstructor: FakeRecognition
    });

    controller.start();
    FakeRecognition.instance!.emit("error", { error: "not-allowed" });

    expect(onUnavailable).toHaveBeenCalledOnce();
  });
});
