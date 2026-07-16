import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("PWA configuration boundaries", () => {
  it("binds the tablet manifest to landscape orientation", async () => {
    const config = await readFile(
      new URL("../../vite.config.ts", import.meta.url),
      "utf8"
    );

    expect(config).toMatch(/orientation:\s*"landscape"/);
    expect(config).not.toMatch(/orientation:\s*"any"/);
  });

  it("keeps API routes outside navigation fallback and runtime caches", async () => {
    const worker = await readFile(
      new URL("../../src/client/sw.ts", import.meta.url),
      "utf8"
    );

    expect(worker).toContain("denylist: [/^\\/api(?:\\/|$)/]");
    expect(worker).not.toMatch(/workbox-strategies|runtimeCaching|CacheFirst|NetworkFirst|StaleWhileRevalidate/);
  });
});
