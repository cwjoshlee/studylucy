import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestHarness } from "../helpers/app";

describe("family authentication", () => {
  let harness: Awaited<ReturnType<typeof createTestHarness>>;

  beforeEach(async () => {
    harness = await createTestHarness();
  });

  afterEach(async () => {
    await harness.close();
  });

  it("bootstraps one family and restricts student access to a trusted device", async () => {
    const studentClient = harness.client();
    const setup = await studentClient.request("POST", "/api/auth/setup", {
      setupSecret: harness.config.setupSecret,
      guardianName: "보호자",
      password: "correct horse battery staple",
      studentName: "수아"
    });
    expect(setup.statusCode).toBe(201);

    const secondSetup = await studentClient.request("POST", "/api/auth/setup", {
      setupSecret: harness.config.setupSecret,
      guardianName: "다른 보호자",
      password: "another correct password",
      studentName: "다른 학생"
    });
    expect(secondSetup.statusCode).toBe(409);

    const guardianLogin = await studentClient.request(
      "POST",
      "/api/auth/guardian/login",
      { password: "correct horse battery staple" }
    );
    expect(guardianLogin.statusCode).toBe(204);
    expect(guardianLogin.headers["set-cookie"]).toContain("sua_session=");
    expect(guardianLogin.headers["set-cookie"]).toContain("HttpOnly");
    expect(guardianLogin.headers["set-cookie"]).toContain("SameSite=Strict");
    expect(guardianLogin.headers["set-cookie"]).toContain("Path=/");

    const register = await studentClient.request("POST", "/api/auth/devices", {
      name: "수아 갤럭시 탭"
    });
    expect(register.statusCode).toBe(201);
    expect(register.headers["set-cookie"]).toContain("sua_device=");
    expect(register.headers["set-cookie"]).toContain("Max-Age=31536000");

    const setPin = await studentClient.request("PUT", "/api/auth/student-pin", {
      pin: "2580"
    });
    expect(setPin.statusCode).toBe(204);

    expect(
      (await studentClient.request("POST", "/api/auth/logout")).statusCode
    ).toBe(204);
    const studentLogin = await studentClient.request(
      "POST",
      "/api/auth/student/login",
      { pin: "2580" }
    );
    expect(studentLogin.statusCode).toBe(204);

    const me = await studentClient.request("GET", "/api/auth/me");
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ role: "student", displayName: "수아" });

    const guardianOnly = await studentClient.request(
      "GET",
      "/api/auth/test-guardian-only"
    );
    expect(guardianOnly.statusCode).toBe(403);
    expect(guardianOnly.json()).toEqual({ code: "ROLE_FORBIDDEN" });

    const untrusted = harness.client();
    const untrustedLogin = await untrusted.request(
      "POST",
      "/api/auth/student/login",
      { pin: "2580" }
    );
    expect(untrustedLogin.statusCode).toBe(403);
    expect(untrustedLogin.json()).toEqual({ code: "DEVICE_NOT_TRUSTED" });

    expect(
      (await studentClient.request("POST", "/api/auth/logout")).statusCode
    ).toBe(204);
    for (let attempt = 0; attempt < 4; attempt += 1) {
      expect(
        (
          await studentClient.request("POST", "/api/auth/student/login", {
            pin: "0000"
          })
        ).statusCode
      ).toBe(401);
    }
    const locked = await studentClient.request(
      "POST",
      "/api/auth/student/login",
      { pin: "0000" }
    );
    expect(locked.statusCode).toBe(429);
    expect(locked.json()).toEqual({ code: "AUTH_LOCKED" });
  });
});
