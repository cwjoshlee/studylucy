import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestHarness } from "../helpers/app";

describe("Fastify application shell", () => {
  let harness: Awaited<ReturnType<typeof createTestHarness>>;

  beforeEach(async () => {
    harness = await createTestHarness();
  });

  afterEach(async () => {
    await harness.close();
  });

  it("returns a minimal health response with security headers", async () => {
    const response = await harness.app.inject({ method: "GET", url: "/api/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["content-security-policy"]).toContain("default-src 'self'");
    expect(response.headers["content-security-policy"]).toContain("object-src 'none'");
    expect(response.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
  });

  it.each([
    "/api",
    "/api/health",
    "/api/auth/me",
    "/api/student/today?date=2026-07-16",
    "/api/guardian/progress?from=2026-07-01&to=2026-07-16"
  ])("prevents API responses from being stored for %s", async (url) => {
    const response = await harness.app.inject({ method: "GET", url });

    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("rejects a state-changing cross-origin API request", async () => {
    harness.app.post("/api/test-write", async () => ({ ok: true }));

    const response = await harness.app.inject({
      method: "POST",
      url: "/api/test-write",
      headers: { origin: "https://attacker.example" }
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ code: "ORIGIN_NOT_ALLOWED" });
  });

  it("allows a same-origin state-changing API request", async () => {
    harness.app.post("/api/test-write", async () => ({ ok: true }));

    const response = await harness.app.inject({
      method: "POST",
      url: "/api/test-write",
      headers: { origin: harness.config.appOrigin }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
  });

  it("rejects a state-changing API request without an origin", async () => {
    harness.app.post("/api/test-write", async () => ({ ok: true }));

    const response = await harness.app.inject({ method: "POST", url: "/api/test-write" });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ code: "ORIGIN_NOT_ALLOWED" });
  });

  it("does not apply the origin guard to GET API requests", async () => {
    harness.app.get("/api/test-read", async () => ({ ok: true }));

    const response = await harness.app.inject({
      method: "GET",
      url: "/api/test-read",
      headers: { origin: "https://attacker.example" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
  });

  it("does not apply the API origin guard to non-API requests", async () => {
    harness.app.post("/test-write", async () => ({ ok: true }));

    const response = await harness.app.inject({
      method: "POST",
      url: "/test-write",
      headers: { origin: "https://attacker.example" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
  });

  it("trusts forwarded client IPs only from a private first-hop proxy", async () => {
    harness.app.get("/api/test-ip", async (request) => ({ ip: request.ip }));

    const proxied = await harness.app.inject({
      method: "GET",
      url: "/api/test-ip",
      remoteAddress: "172.20.0.2",
      headers: { "x-forwarded-for": "198.51.100.44" }
    });
    expect(proxied.json()).toEqual({ ip: "198.51.100.44" });

    const spoofed = await harness.app.inject({
      method: "GET",
      url: "/api/test-ip",
      remoteAddress: "203.0.113.50",
      headers: { "x-forwarded-for": "198.51.100.99" }
    });
    expect(spoofed.json()).toEqual({ ip: "203.0.113.50" });
  });
});
