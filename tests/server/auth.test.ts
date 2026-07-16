import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, expectTypeOf, it } from "vitest";
import {
  RegisterDeviceRequest,
  RenameDeviceRequest,
  RevokeDeviceRequest,
  type StudentLoginResult,
  type TrustedDeviceView
} from "../../src/shared/auth";
import {
  StudyDateSchema,
  kstDayBounds,
  kstStudyDate
} from "../../src/shared/study-date";
import {
  createTestHarness,
  type TestClient
} from "../helpers/app";

type Harness = Awaited<ReturnType<typeof createTestHarness>>;

const FAMILY = {
  setupSecret: "s".repeat(32),
  guardianName: "보호자",
  password: "correct horse battery staple",
  studentName: "수아"
};

async function bootstrapFamily(harness: Harness, client: TestClient) {
  const response = await client.request("POST", "/api/auth/setup", {
    ...FAMILY,
    setupSecret: harness.config.setupSecret
  });
  expect(response.statusCode).toBe(201);
  return response;
}

async function loginGuardian(client: TestClient) {
  const response = await client.request("POST", "/api/auth/guardian/login", {
    password: FAMILY.password
  });
  expect(response.statusCode).toBe(204);
  return response;
}

describe("shared auth and study-date contracts", () => {
  it("keeps device requests bounded and exposes the exact additive wire contracts", () => {
    expect(RegisterDeviceRequest.parse({ name: "  수아 태블릿  " }))
      .toEqual({ name: "수아 태블릿" });
    expect(RenameDeviceRequest.parse({ name: "  새 태블릿  " }))
      .toEqual({ name: "새 태블릿" });
    expect(RevokeDeviceRequest.parse({ publicId: "device-public-1" }))
      .toEqual({ publicId: "device-public-1" });
    expect(RenameDeviceRequest.safeParse({ name: "" }).success).toBe(false);
    expect(RevokeDeviceRequest.safeParse({ publicId: "" }).success).toBe(false);
    expectTypeOf<StudentLoginResult>().toEqualTypeOf<{
      offlineAccessUntil: string;
    }>();
    expectTypeOf<TrustedDeviceView>().toEqualTypeOf<{
      publicId: string;
      name: string;
      createdAt: string;
      lastUsedAt: string | null;
      status: "active" | "revoked";
      current: boolean;
    }>();
  });

  it.each([
    ["2024-02-29", true],
    ["2026-02-29", false],
    ["2026-02-31", false],
    ["2026-04-31", false],
    ["2026-00-10", false],
    ["2026-13-10", false],
    ["2026-07-16", true]
  ] as const)("validates %s as a real calendar date", (value, valid) => {
    expect(StudyDateSchema.safeParse(value).success).toBe(valid);
  });

  it("derives KST study dates and UTC day bounds across KST midnight", () => {
    expect(kstStudyDate(new Date("2026-07-15T14:59:59.999Z")))
      .toBe("2026-07-15");
    expect(kstStudyDate(new Date("2026-07-15T15:00:00.000Z")))
      .toBe("2026-07-16");
    expect(kstDayBounds("2026-07-16")).toEqual({
      start: "2026-07-15T15:00:00.000Z",
      end: "2026-07-16T15:00:00.000Z"
    });
    expect(kstDayBounds("2024-02-29")).toEqual({
      start: "2024-02-28T15:00:00.000Z",
      end: "2024-02-29T15:00:00.000Z"
    });
    expect(() => kstDayBounds("2026-02-31")).toThrow();
  });
});

describe("family authentication", () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = await createTestHarness();
  });

  afterEach(async () => {
    await harness.close();
  });

  it("reports setup state, rejects a bad secret, and bootstraps exactly one family concurrently", async () => {
    const beforeSetup = await harness.client().request("GET", "/api/auth/me");
    expect(beforeSetup.statusCode).toBe(409);
    expect(beforeSetup.json()).toEqual({ code: "SETUP_REQUIRED" });

    const rejected = await harness.client().request("POST", "/api/auth/setup", {
      ...FAMILY,
      setupSecret: "x".repeat(32)
    });
    expect(rejected.statusCode).toBe(403);
    expect(rejected.json()).toEqual({ code: "SETUP_SECRET_INVALID" });
    expect(
      (harness.db.prepare("SELECT COUNT(*) AS count FROM users").get() as {
        count: number;
      }).count
    ).toBe(0);

    const first = harness.client();
    const second = harness.client();
    const responses = await Promise.all([
      first.request("POST", "/api/auth/setup", {
        ...FAMILY,
        setupSecret: harness.config.setupSecret
      }),
      second.request("POST", "/api/auth/setup", {
        setupSecret: harness.config.setupSecret,
        guardianName: "다른 보호자",
        password: "another correct password",
        studentName: "다른 학생"
      })
    ]);
    const created = responses.find((response) => response.statusCode === 201);
    const conflict = responses.find((response) => response.statusCode === 409);
    expect(created?.json()).toEqual({ status: "created" });
    expect(conflict?.json()).toEqual({ code: "SETUP_ALREADY_COMPLETED" });

    const roles = harness.db.prepare(`
      SELECT role, COUNT(*) AS count
      FROM users
      GROUP BY role
      ORDER BY role
    `).all();
    expect(roles).toEqual([
      { role: "guardian", count: 1 },
      { role: "student", count: 1 }
    ]);

    const afterSetup = await harness.client().request("GET", "/api/auth/me");
    expect(afterSetup.statusCode).toBe(401);
    expect(afterSetup.json()).toEqual({ code: "AUTH_REQUIRED" });
  });

  it("bootstraps one family and restricts student access to a trusted device", async () => {
    const studentClient = harness.client();
    const setup = await bootstrapFamily(harness, studentClient);
    expect(setup.json()).toEqual({ status: "created" });

    const secondSetup = await studentClient.request("POST", "/api/auth/setup", {
      setupSecret: harness.config.setupSecret,
      guardianName: "다른 보호자",
      password: "another correct password",
      studentName: "다른 학생"
    });
    expect(secondSetup.statusCode).toBe(409);
    expect(secondSetup.json()).toEqual({ code: "SETUP_ALREADY_COMPLETED" });

    const guardianLogin = await loginGuardian(studentClient);
    expect(guardianLogin.headers["set-cookie"]).toContain("sua_session=");
    expect(guardianLogin.headers["set-cookie"]).toContain("HttpOnly");
    expect(guardianLogin.headers["set-cookie"]).toContain("SameSite=Strict");
    expect(guardianLogin.headers["set-cookie"]).toContain("Path=/");

    const register = await studentClient.request("POST", "/api/auth/devices", {
      name: "수아 갤럭시 탭"
    });
    expect(register.statusCode).toBe(201);
    expect(register.json()).toEqual({ status: "created" });
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

  it("normalizes invalid bodies, malformed JSON, and bad credentials", async () => {
    const invalidBody = await harness.client().request("POST", "/api/auth/setup", {
      ...FAMILY,
      password: "short"
    });
    expect(invalidBody.statusCode).toBe(400);
    expect(invalidBody.json()).toEqual({ code: "INVALID_REQUEST" });

    const malformed = await harness.app.inject({
      method: "POST",
      url: "/api/auth/setup",
      headers: {
        origin: harness.config.appOrigin,
        "content-type": "application/json"
      },
      payload: "{"
    });
    expect(malformed.statusCode).toBe(400);
    expect(malformed.json()).toEqual({ code: "INVALID_REQUEST" });

    const client = harness.client();
    await bootstrapFamily(harness, client);
    const badPassword = await client.request("POST", "/api/auth/guardian/login", {
      password: "wrong"
    });
    expect(badPassword.statusCode).toBe(401);
    expect(badPassword.json()).toEqual({ code: "AUTH_INVALID" });
  });

  it("locks guardian failures by window and clears failures after success", async () => {
    const client = harness.client();
    await bootstrapFamily(harness, client);

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await client.request("POST", "/api/auth/guardian/login", {
        password: "wrong"
      });
      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({ code: "AUTH_INVALID" });
    }

    await loginGuardian(client);
    await client.request("POST", "/api/auth/logout");
    expect(
      (
        await client.request("POST", "/api/auth/guardian/login", {
          password: "wrong"
        })
      ).statusCode
    ).toBe(401);

    harness.advanceTime(10 * 60 * 1_000 + 1);
    for (let attempt = 0; attempt < 4; attempt += 1) {
      expect(
        (
          await client.request("POST", "/api/auth/guardian/login", {
            password: "wrong"
          })
        ).statusCode
      ).toBe(401);
    }
    const locked = await client.request("POST", "/api/auth/guardian/login", {
      password: "wrong"
    });
    expect(locked.statusCode).toBe(429);
    expect(locked.json()).toEqual({ code: "AUTH_LOCKED" });

    harness.advanceTime(15 * 60 * 1_000);
    await loginGuardian(client);
  });

  it("expires sessions and removes persisted sessions on logout", async () => {
    const client = harness.client();
    await bootstrapFamily(harness, client);
    await loginGuardian(client);
    expect(
      (harness.db.prepare("SELECT COUNT(*) AS count FROM sessions").get() as {
        count: number;
      }).count
    ).toBe(1);

    harness.advanceTime(harness.config.sessionDays * 86_400 * 1_000 + 1);
    const expired = await client.request("GET", "/api/auth/me");
    expect(expired.statusCode).toBe(401);
    expect(expired.json()).toEqual({ code: "AUTH_REQUIRED" });

    const freshClient = harness.client();
    await loginGuardian(freshClient);
    const logout = await freshClient.request("POST", "/api/auth/logout");
    expect(logout.statusCode).toBe(204);
    expect(freshClient.cookie("sua_session")).toBeUndefined();
    expect(
      (harness.db.prepare("SELECT COUNT(*) AS count FROM sessions").get() as {
        count: number;
      }).count
    ).toBe(1);
    const loggedOut = await freshClient.request("GET", "/api/auth/me");
    expect(loggedOut.statusCode).toBe(401);
  });

  it("binds student sessions to their device and rejects revoked devices", async () => {
    const guardian = harness.client();
    await bootstrapFamily(harness, guardian);
    await loginGuardian(guardian);

    await guardian.request("POST", "/api/auth/devices", { name: "태블릿 A" });
    const deviceA = guardian.cookie("sua_device");
    expect(deviceA).toBeDefined();
    await guardian.request("POST", "/api/auth/devices", { name: "태블릿 B" });
    const deviceB = guardian.cookie("sua_device");
    expect(deviceB).toBeDefined();
    await guardian.request("PUT", "/api/auth/student-pin", { pin: "2580" });

    const student = harness.client();
    student.setCookie("sua_device", deviceA!);
    expect(
      (
        await student.request("POST", "/api/auth/student/login", {
          pin: "2580"
        })
      ).statusCode
    ).toBe(204);

    student.setCookie("sua_device", deviceB!);
    expect((await student.request("GET", "/api/auth/me")).statusCode).toBe(401);
    student.setCookie("sua_device", deviceA!);
    expect((await student.request("GET", "/api/auth/me")).statusCode).toBe(200);

    harness.db.prepare(`
      UPDATE trusted_devices
      SET revoked_at = ?
      WHERE name = ?
    `).run("2026-07-15T03:00:01.000Z", "태블릿 A");
    expect((await student.request("GET", "/api/auth/me")).statusCode).toBe(401);
    const revokedLogin = await student.request(
      "POST",
      "/api/auth/student/login",
      { pin: "2580" }
    );
    expect(revokedLogin.statusCode).toBe(403);
    expect(revokedLogin.json()).toEqual({ code: "DEVICE_NOT_TRUSTED" });
  });

  it("persists only peppered hashes of opaque session and device tokens", async () => {
    const client = harness.client();
    await bootstrapFamily(harness, client);
    await loginGuardian(client);

    const rawSession = client.cookie("sua_session");
    const sessionRow = harness.db.prepare(`
      SELECT token_hash AS tokenHash FROM sessions
    `).get() as { tokenHash: string };
    expect(rawSession).toBeDefined();
    expect(sessionRow.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(sessionRow.tokenHash).not.toBe(rawSession);
    expect(sessionRow.tokenHash).toBe(
      createHash("sha256")
        .update(rawSession! + harness.config.sessionPepper)
        .digest("hex")
    );

    await client.request("POST", "/api/auth/devices", { name: "해시 검증" });
    const rawDevice = client.cookie("sua_device");
    const deviceRow = harness.db.prepare(`
      SELECT token_hash AS tokenHash FROM trusted_devices
    `).get() as { tokenHash: string };
    expect(rawDevice).toBeDefined();
    expect(deviceRow.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(deviceRow.tokenHash).not.toBe(rawDevice);
    expect(deviceRow.tokenHash).toBe(
      createHash("sha256")
        .update(rawDevice! + harness.config.sessionPepper)
        .digest("hex")
    );
  });

  it("sets Secure on production session and device cookies", async () => {
    await harness.close();
    harness = await createTestHarness({ nodeEnv: "production" });
    const client = harness.client();
    await bootstrapFamily(harness, client);
    const login = await loginGuardian(client);
    expect(login.headers["set-cookie"]).toContain("Secure");

    const device = await client.request("POST", "/api/auth/devices", {
      name: "운영 태블릿"
    });
    expect(device.statusCode).toBe(201);
    expect(device.headers["set-cookie"]).toContain("Secure");
  });
});
