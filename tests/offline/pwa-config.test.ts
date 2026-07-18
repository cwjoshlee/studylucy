import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("PWA configuration boundaries", () => {
  it("allows both approved tablet orientations", async () => {
    const config = await readFile(
      new URL("../../vite.config.ts", import.meta.url),
      "utf8"
    );

    expect(config).toMatch(/orientation:\s*"any"/);
    expect(config).not.toMatch(/orientation:\s*"landscape"/);
  });

  it("keeps API routes outside navigation fallback and runtime caches", async () => {
    const worker = await readFile(
      new URL("../../src/client/sw.ts", import.meta.url),
      "utf8"
    );

    expect(worker).toContain("denylist: [/^\\/api(?:\\/|$)/]");
    expect(worker).not.toMatch(/workbox-strategies|runtimeCaching|CacheFirst|NetworkFirst|StaleWhileRevalidate/);
  });

  it("precaches both install icons through injectManifest", async () => {
    const config = await readFile(
      new URL("../../vite.config.ts", import.meta.url),
      "utf8"
    );

    expect(config).toMatch(/globPatterns:[\s\S]*"assets\/icon-192\.png"/);
    expect(config).toMatch(/globPatterns:[\s\S]*"assets\/icon-512\.png"/);
  });

  it("precaches nested companion SVGs through injectManifest", async () => {
    const config = await readFile(
      new URL("../../vite.config.ts", import.meta.url),
      "utf8"
    );

    expect(config).toMatch(
      /globPatterns:[\s\S]*"assets\/companions\/\*\.svg"/
    );
  });
});
