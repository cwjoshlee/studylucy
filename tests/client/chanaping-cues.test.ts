import { describe, expect, it } from "vitest";
import {
  getChanaPingArt,
  getChanaPingMood,
  selectLocalChanaPingCue
} from "../../src/client/companions/chanaping-cues";

describe("ChanaPing emotion cues", () => {
  it.each([
    ["correct", "celebrate"],
    ["retry", "grumble"],
    ["thinking", "bored"],
    ["speech-start", "focus"],
    ["lesson-open", "rest"]
  ] as const)("maps %s to the %s mood", (event, mood) => {
    expect(getChanaPingMood(event)).toBe(mood);
  });

  it("uses varied, supportive retry cues", () => {
    const cues = new Set(
      Array.from({ length: 6 }, (_, retryCount) => selectLocalChanaPingCue({
        event: "retry",
        subject: "math",
        retryCount,
        key: "retry-check"
      }))
    );

    expect(cues.size).toBeGreaterThanOrEqual(3);
    for (const cue of cues) {
      expect(cue).not.toMatch(/바보|느려|게으르|별|차감|벌|포기|못하/);
    }
  });

  it("selects a local asset for every emotion mood", () => {
    expect(getChanaPingArt("celebrate")).toBe("/assets/companions/chanaping-celebrate.svg");
    expect(getChanaPingArt("grumble")).toBe("/assets/companions/chanaping-grumble.svg");
    expect(getChanaPingArt("bored")).toBe("/assets/companions/chanaping-bored.svg");
    expect(getChanaPingArt("focus")).toBe("/assets/companions/chanaping-focus.svg");
    expect(getChanaPingArt("rest")).toBe("/assets/companions/chanaping.svg");
  });
});
