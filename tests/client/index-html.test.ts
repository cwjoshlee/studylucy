import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("index.html", () => {
  it("uses the exact service name in the document title", async () => {
    const html = await readFile(new URL("../../index.html", import.meta.url), "utf8");
    const title = html.match(/<title>([^<]*)<\/title>/)?.[1];

    expect(title).toBe("수아의 공부방");
  });
});
