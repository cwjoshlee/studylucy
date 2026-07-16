import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createTestHarness } from "../helpers/app";

describe("production client serving", () => {
  const openHarnesses: Array<Awaited<ReturnType<typeof createTestHarness>>> = [];
  const tempDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(openHarnesses.splice(0).map((harness) => harness.close()));
    await Promise.all(tempDirectories.splice(0).map((path) =>
      rm(path, { recursive: true, force: true })));
  });

  it("serves assets and falls back only for non-API GET navigation", async () => {
    const clientDistDir = await mkdtemp(join(tmpdir(), "sua-client-"));
    tempDirectories.push(clientDistDir);
    await mkdir(join(clientDistDir, "assets"));
    await writeFile(
      join(clientDistDir, "index.html"),
      "<!doctype html><title>수아의 공부방</title><div id=\"root\"></div>"
    );
    await writeFile(join(clientDistDir, "assets", "app.js"), "export {};\n");
    const harness = await createTestHarness({ clientDistDir });
    openHarnesses.push(harness);

    const asset = await harness.app.inject({ method: "GET", url: "/assets/app.js" });
    expect(asset.statusCode).toBe(200);
    expect(asset.body).toBe("export {};\n");

    const navigation = await harness.app.inject({
      method: "GET",
      url: "/learning/today",
      headers: { accept: "text/html" }
    });
    expect(navigation.statusCode).toBe(200);
    expect(navigation.body).toContain("수아의 공부방");

    const apiMiss = await harness.app.inject({
      method: "GET",
      url: "/api/not-a-route"
    });
    expect(apiMiss.statusCode).toBe(404);
    expect(apiMiss.headers["content-type"]).toContain("application/json");
    expect(apiMiss.body).not.toContain("<title>");

    const nonGetMiss = await harness.app.inject({
      method: "POST",
      url: "/learning/today",
      headers: { origin: harness.config.appOrigin }
    });
    expect(nonGetMiss.statusCode).toBe(404);
    expect(nonGetMiss.headers["content-type"]).toContain("application/json");
  });
});
