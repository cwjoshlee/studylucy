import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createInactivityController,
  type InactivityActivity,
  type InactivityPauseReason
} from "../../src/client/learning/inactivity-controller";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-16T01:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("InactivityController", () => {
  it("moves through 2, 4, and 5 minutes only while active", () => {
    const events: string[] = [];
    const controller = createInactivityController({
      onEvent: (event) => events.push(event.type)
    });
    controller.start();
    vi.advanceTimersByTime(120_000);
    expect(events).toEqual(["hint"]);
    vi.advanceTimersByTime(120_000);
    expect(events).toEqual(["hint", "confirm"]);
    controller.pause("document-hidden");
    vi.advanceTimersByTime(600_000);
    expect(events).toEqual(["hint", "confirm"]);
    controller.resume("document-hidden");
    vi.advanceTimersByTime(60_000);
    expect(events).toEqual(["hint", "confirm", "deduct"]);
  });

  it.each<InactivityActivity>([
    "touch",
    "keyboard",
    "answer",
    "speech-result",
    "hint",
    "생각 중이에요"
  ])("resets the full timer for %s activity", (activity) => {
    const events: string[] = [];
    const controller = createInactivityController({
      onEvent: (event) => events.push(event.type)
    });
    controller.start();
    vi.advanceTimersByTime(119_000);

    controller.recordActivity(activity);
    expect(events).toEqual(["active"]);
    vi.advanceTimersByTime(119_999);
    expect(events).toEqual(["active"]);
    vi.advanceTimersByTime(1);
    expect(events).toEqual(["active", "hint"]);
  });

  it.each<InactivityPauseReason>([
    "document-hidden",
    "screen-lock",
    "server-wait",
    "celebration",
    "guardian-break"
  ])("does not count time while paused for %s", (reason) => {
    const events: string[] = [];
    const controller = createInactivityController({
      onEvent: (event) => events.push(event.type)
    });
    controller.start();
    vi.advanceTimersByTime(119_000);

    controller.pause(reason);
    vi.advanceTimersByTime(600_000);
    expect(events).toEqual([]);
    controller.resume(reason);
    vi.advanceTimersByTime(999);
    expect(events).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(events).toEqual(["hint"]);
  });

  it("stays paused until each overlapping pause condition is released", () => {
    const events: string[] = [];
    const controller = createInactivityController({
      onEvent: (event) => events.push(event.type)
    });
    controller.start();
    vi.advanceTimersByTime(60_000);
    controller.pause("document-hidden");
    controller.pause("server-wait");

    controller.resume("document-hidden");
    vi.advanceTimersByTime(600_000);
    expect(events).toEqual([]);

    controller.resume("server-wait");
    vi.advanceTimersByTime(60_000);
    expect(events).toEqual(["hint"]);
  });

  it("reports the five-minute idle interval and waits for an explicit restart", () => {
    const events: Array<{ type: string; idleStartedAt?: string; occurredAt?: string }> = [];
    const controller = createInactivityController({
      onEvent: (event) => events.push(event)
    });
    controller.start();
    vi.advanceTimersByTime(300_000);

    expect(events.at(-1)).toEqual({
      type: "deduct",
      idleStartedAt: "2026-07-16T01:00:00.000Z",
      occurredAt: "2026-07-16T01:05:00.000Z"
    });
    vi.advanceTimersByTime(600_000);
    expect(events).toHaveLength(3);

    controller.recordActivity("touch");
    controller.resume("deduction");
    vi.advanceTimersByTime(120_000);
    expect(events.map((event) => event.type)).toEqual([
      "hint",
      "confirm",
      "deduct",
      "active",
      "hint"
    ]);
  });

  it("releases only the deduction latch on explicit post-deduction resume", () => {
    const events: string[] = [];
    const controller = createInactivityController({
      onEvent: (event) => events.push(event.type)
    });
    controller.start();
    vi.advanceTimersByTime(300_000);
    controller.pause("document-hidden");
    controller.recordActivity("continue");
    events.length = 0;

    controller.resume("deduction");
    vi.advanceTimersByTime(600_000);
    expect(events).toEqual([]);

    controller.resume("document-hidden");
    vi.advanceTimersByTime(120_000);
    expect(events).toEqual(["hint"]);
  });
});
