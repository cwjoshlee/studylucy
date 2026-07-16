import { describe, expect, it } from "vitest";
import {
  INITIAL_CONTENT_VERSION,
  INITIAL_ITEMS
} from "../../src/server/db/seed";

const ENGLISH_INSTRUCTION = /\b(?:read|look|find|add|slow|pause|sentence|number|finish)\b/i;
const FORBIDDEN_NAMES = /마이\s*리틀\s*포니|티니핑|시나모롤/i;
const CHILD_SHAMING = /바보|못하|틀렸잖|왜 이것도|느려|벌 받아/;

describe("approved magical companion seed content", () => {
  it("publishes exactly ten Korean and ten math v2 items", () => {
    expect(INITIAL_CONTENT_VERSION).toBe(2);
    expect(INITIAL_ITEMS.filter((item) => item.subject === "korean")).toHaveLength(10);
    expect(INITIAL_ITEMS.filter((item) => item.subject === "math")).toHaveLength(10);
  });

  it("gives every item distinct Korean delight copy and no commercial names", () => {
    const delight = INITIAL_ITEMS.map((item) => item.delight);
    expect(delight.every(Boolean)).toBe(true);
    expect(new Set(delight.map((entry) => entry!.mishap)).size).toBe(20);
    for (const item of INITIAL_ITEMS) {
      const childCopy = JSON.stringify({
        title: item.title,
        text: item.text,
        hint: item.hint,
        delight: item.delight,
        checkHint: item.kind === "math-story" ? item.checkHint : undefined
      });
      expect(childCopy).toMatch(/[가-힣]/);
      expect(childCopy).not.toMatch(ENGLISH_INSTRUCTION);
      expect(childCopy).not.toMatch(FORBIDDEN_NAMES);
      expect(childCopy).not.toMatch(CHILD_SHAMING);
      expect(childCopy).not.toMatch(/\bPASS\b|\bFAIL\b/);
    }
  });

  it("keeps every math answer, unit and scaffold internally consistent", () => {
    for (const item of INITIAL_ITEMS) {
      if (item.kind !== "math-story") continue;
      expect(item.text.match(/\d+/g)).toHaveLength(2);
      expect(item.question).toContain("몇");
      expect(item.unitLabel.length).toBeGreaterThan(0);
      expect(item.checkHint).toMatch(/[가-힣]/);
      expect(Number.isInteger(item.answer)).toBe(true);
    }
  });
});
