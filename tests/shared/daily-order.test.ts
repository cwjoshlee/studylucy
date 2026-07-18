import { describe, expect, it } from "vitest";
import { getDailyItems } from "../../src/shared/daily-order";

describe("daily item ordering", () => {
  it("matches the prototype vector without mutating its input", () => {
    const items = ["a", "b", "c", "d", "e"].map((id) => ({ id }));
    const original = items.map((item) => ({ ...item }));

    const ordered = getDailyItems(items, "2026-07-15");

    expect(ordered.map((item) => item.id)).toEqual([
      "d",
      "a",
      "e",
      "c",
      "b"
    ]);
    expect(items).toEqual(original);
    expect(ordered).not.toBe(items);
  });
});
