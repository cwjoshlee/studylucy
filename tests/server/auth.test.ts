import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, expectTypeOf, it } from "vitest";
import {
  DEVICE_TYPE_LIMITS,
  DeviceTypeSchema,
  RegisterDeviceRequest,
  RenameDeviceRequest,
  RevokeDeviceRequest,
  UpdateDeviceTypeRequest,
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
    expect(RegisterDeviceRequest.parse({ name: "  수아 태블릿  ", deviceType: "tablet" }))
      .toEqual({ name: "수아 태블릿", deviceType: "tablet" });
    expect(RenameDeviceRequest.parse({ name: "  새 태블릿  " }))
      .toEqual({ name: "새 태블릿" });
    expect(RevokeDeviceRequest.parse({ publicId: "device-public-1" }))
      .toEqual({ publicId: "device-public-1" });
    expect(UpdateDeviceTypeRequest.parse({ deviceType: "windows" }))
      .toEqual({ deviceType: "windows" });
    expect(RenameDeviceRequest.safeParse({ name: "" }).success).toBe(false);
    expect(RegisterDeviceRequest.safeParse({ name: "태블릿" }).success).toBe(false);
    expect(DeviceTypeSchema.options).toEqual(["tablet", "phone", "mac", "windows"]);
    expect(DEVICE_TYPE_LIMITS).toEqual({ tablet: 3, phone: 3, mac: 1, windows: 2 });
    expect(RevokeDeviceRequest.safeParse({ publicId: "" }).success).toBe(false);
    expectTypeOf<StudentLoginResult>().toEqualTypeOf<{
      offlineAccessUntil: string;
    }>();
    expectTypeOf<TrustedDeviceView>().toEqualTypeOf<{
      publicId: string;
      name: string;
      createdAt: string;
      lastUsedAt: string | null;
      deviceType: "tablet" | "phone" | "mac" | "windows" | null;
      status: "active" | "revoked";
      current: boolean;
    }>();
  });

  it("enforces typed capacity only for a new device and requires legacy classification", async () => {
    const harness = await createTestHarness();
    try {
    const guardian = harness.client();
    await bootstrapFamily(harness, guardian);
    await loginGuardian(guardian);

    let existingDeviceClient: TestClient | null = null;
    for (const [index, deviceType, limit] of [
      [1, "tablet", 3],
      [2, "phone", 3],
      [3, "mac", 1],
      [4, "windows", 2]
    ] as const) {
      for (let count = 0; count < limit; count += 1) {
        const client = harness.client();
        await loginGuardian(client);
        const registration = await client.request("POST", "/api/guardian/devices/current", {
          name: `${deviceType}-${index}-${count}`,
          deviceType
        });
        expect(registration.statusCode).toBe(201);
        expect(registration.json()).toMatchObject({ deviceType });
        if (existingDeviceClient === null) existingDeviceClient = client;
      }
    }

    const tabletOverflow = harness.client();
    await loginGuardian(tabletOverflow);
    const rejected = await tabletOverflow.request("POST", "/api/guardian/devices/current", {
      name: "태블릿 초과",
      deviceType: "tablet"
    });
    expect(rejected.statusCode).toBe(409);
    expect(rejected.json()).toEqual({ code: "DEVICE_TYPE_LIMIT_REACHED" });
    expect(tabletOverflow.cookie("sua_device")).toBeUndefined();
    expect((harness.db.prepare("SELECT COUNT(*) AS count FROM trusted_devices").get() as {
      count: number;
    }).count).toBe(9);

    expect(existingDeviceClient).not.toBeNull();
    const existingToken = existingDeviceClient!.cookie("sua_device")!;
    const repeat = await existingDeviceClient!.request("POST", "/api/guardian/devices/current", {
      name: "다른 이름",
      deviceType: "tablet"
    });
    expect(repeat.statusCode).toBe(200);
    expect(existingDeviceClient!.cookie("sua_device")).toBe(existingToken);

    const legacyToken = "legacy-active-device";
    harness.db.prepare(`
      INSERT INTO trusted_devices (
        id, public_id, name, token_hash, created_at, device_type
      ) VALUES (?, ?, ?, ?, ?, NULL)
    `).run("legacy-id", "legacy-public", "기존 기기", createHash("sha256")
      .update(legacyToken + harness.config.sessionPepper).digest("hex"),
    "2026-07-15T03:00:00.000Z");
    const legacy = harness.client();
    legacy.setCookie("sua_device", legacyToken);
    await guardian.request("PUT", "/api/auth/student-pin", { pin: "2580" });
    expect((await legacy.request("POST", "/api/auth/student/login", { pin: "2580" })).statusCode)
      .toBe(200);

    const blocked = harness.client();
    await loginGuardian(blocked);
    const classificationRequired = await blocked.request("POST", "/api/guardian/devices/current", {
      name: "새 휴대폰",
      deviceType: "phone"
    });
    expect(classificationRequired.statusCode).toBe(409);
    expect(classificationRequired.json()).toEqual({ code: "DEVICE_TYPE_CLASSIFICATION_REQUIRED" });

    const releasedPhone = harness.db.prepare(`
      SELECT public_id AS publicId FROM trusted_devices
      WHERE device_type = 'phone' AND revoked_at IS NULL
      LIMIT 1
    `).get() as { publicId: string };
    expect((await guardian.request(
      "POST",
      `/api/guardian/devices/${releasedPhone.publicId}/revoke`
    )).statusCode).toBe(200);

    const classified = await guardian.request(
      "PUT",
      "/api/guardian/devices/legacy-public/type",
      { deviceType: "phone" }
    );
    expect(classified.statusCode).toBe(200);
    expect(classified.json()).toMatchObject({
      publicId: "legacy-public",
      deviceType: "phone"
    });

    const releasedMac = harness.db.prepare(`
      SELECT public_id AS publicId FROM trusted_devices
      WHERE device_type = 'mac' AND revoked_at IS NULL
      LIMIT 1
    `).get() as { publicId: string };
    expect((await guardian.request(
      "POST",
      `/api/guardian/devices/${releasedMac.publicId}/revoke`
    )).statusCode).toBe(200);
    const afterClassification = await blocked.request("POST", "/api/guardian/devices/current", {
      name: "새 Mac",
      deviceType: "mac"
    });
    expect(afterClassification.statusCode).toBe(201);
    } finally {
      await harness.close();
    }
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

    const register = await studentClient.request("POST", "/api/guardian/devices/current", {
      name: "수아 갤럭시 탭", deviceType: "tablet"
    });
    expect(register.statusCode).toBe(201);
    expect(register.json()).toMatchObject({
      name: "수아 갤럭시 탭",
      status: "active",
      current: true
    });
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
    expect(studentLogin.statusCode).toBe(200);
    expect(studentLogin.json()).toEqual({
      offlineAccessUntil: "2026-07-15T14:59:59.999Z"
    });

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

    await guardian.request("POST", "/api/guardian/devices/current", { name: "태블릿 A", deviceType: "tablet" });
    const deviceA = guardian.cookie("sua_device");
    expect(deviceA).toBeDefined();
    guardian.setCookie("sua_device", "different-device-cookie");
    await guardian.request("POST", "/api/guardian/devices/current", { name: "태블릿 B", deviceType: "tablet" });
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
    ).toBe(200);

    student.setCookie("sua_device", deviceB!);
    const wrongActiveDevice = await student.request("GET", "/api/auth/me");
    expect(wrongActiveDevice.statusCode).toBe(403);
    expect(wrongActiveDevice.json()).toEqual({ code: "DEVICE_NOT_TRUSTED" });
    student.setCookie("sua_device", "unknown-device-cookie");
    const unknownDeviceWithValidSession = await student.request(
      "GET",
      "/api/auth/me"
    );
    expect(unknownDeviceWithValidSession.statusCode).toBe(403);
    expect(unknownDeviceWithValidSession.json()).toEqual({
      code: "DEVICE_NOT_TRUSTED"
    });
    student.setCookie("sua_device", deviceA!);
    expect((await student.request("GET", "/api/auth/me")).statusCode).toBe(200);

    harness.db.prepare(`
      UPDATE trusted_devices
      SET revoked_at = ?
      WHERE name = ?
    `).run("2026-07-15T03:00:01.000Z", "태블릿 A");
    const revokedMe = await student.request("GET", "/api/auth/me");
    expect(revokedMe.statusCode).toBe(403);
    expect(revokedMe.json()).toEqual({ code: "DEVICE_REVOKED" });
    const revokedLogin = await student.request(
      "POST",
      "/api/auth/student/login",
      { pin: "2580" }
    );
    expect(revokedLogin.statusCode).toBe(403);
    expect(revokedLogin.json()).toEqual({ code: "DEVICE_REVOKED" });
  });

  it("reports a revoked cold session after guardian revocation while preserving guardian access and ordinary unauthenticated semantics", async () => {
    const guardian = harness.client();
    await bootstrapFamily(harness, guardian);
    await loginGuardian(guardian);
    const registered = await guardian.request(
      "POST",
      "/api/guardian/devices/current",
      { name: "해제할 수아 태블릿", deviceType: "tablet" }
    );
    const registeredView = registered.json() as TrustedDeviceView;
    const deviceCookie = guardian.cookie("sua_device");
    expect(deviceCookie).toBeDefined();
    await guardian.request("PUT", "/api/auth/student-pin", { pin: "2580" });

    const student = harness.client();
    student.setCookie("sua_device", deviceCookie!);
    expect((await student.request("POST", "/api/auth/student/login", {
      pin: "2580"
    })).statusCode).toBe(200);
    expect((harness.db.prepare(`
      SELECT COUNT(*) AS count
      FROM sessions AS s
      JOIN users AS u ON u.id = s.user_id
      WHERE u.role = 'student'
    `).get() as { count: number }).count).toBe(1);

    const revoked = await guardian.request(
      "POST",
      `/api/guardian/devices/${registeredView.publicId}/revoke`
    );
    expect(revoked.statusCode).toBe(200);
    expect((harness.db.prepare(`
      SELECT COUNT(*) AS count
      FROM sessions AS s
      JOIN users AS u ON u.id = s.user_id
      WHERE u.role = 'student'
    `).get() as { count: number }).count).toBe(0);

    const coldMe = await student.request("GET", "/api/auth/me");
    expect(coldMe.statusCode).toBe(403);
    expect(coldMe.json()).toEqual({ code: "DEVICE_REVOKED" });

    const guardianMe = await guardian.request("GET", "/api/auth/me");
    expect(guardianMe.statusCode).toBe(200);
    expect(guardianMe.json()).toMatchObject({ role: "guardian" });

    const ordinaryUnauthenticated = harness.client();
    ordinaryUnauthenticated.setCookie("sua_device", "unknown-device-cookie");
    const unauthenticatedMe = await ordinaryUnauthenticated.request(
      "GET",
      "/api/auth/me"
    );
    expect(unauthenticatedMe.statusCode).toBe(401);
    expect(unauthenticatedMe.json()).toEqual({ code: "AUTH_REQUIRED" });
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

    await client.request("POST", "/api/guardian/devices/current", { name: "해시 검증", deviceType: "tablet" });
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

    const device = await client.request("POST", "/api/guardian/devices/current", {
      name: "운영 태블릿", deviceType: "tablet"
    });
    expect(device.statusCode).toBe(201);
    expect(device.headers["set-cookie"]).toContain("Secure");
  });

  it("manages the guardian device lifecycle with safe public views and bounded student authority", async () => {
    const guardian = harness.client();
    await bootstrapFamily(harness, guardian);
    await loginGuardian(guardian);

    const empty = await guardian.request("GET", "/api/guardian/devices");
    expect(empty.statusCode).toBe(200);
    expect(empty.json()).toEqual({ devices: [] });

    const registered = await guardian.request(
      "POST",
      "/api/guardian/devices/current",
      { name: "수아 태블릿", deviceType: "tablet" }
    );
    expect(registered.statusCode).toBe(201);
    expect(registered.headers["set-cookie"]).toContain("sua_device=");
    const registeredView = registered.json() as TrustedDeviceView;
    expect(registeredView).toEqual({
      publicId: expect.any(String),
      name: "수아 태블릿",
      createdAt: "2026-07-15T03:00:00.000Z",
      lastUsedAt: null,
      deviceType: "tablet",
      status: "active",
      current: true
    });
    expect(JSON.stringify(registeredView)).not.toMatch(/token|hash|\"id\"/i);

    const deviceRow = harness.db.prepare(`
      SELECT id, token_hash AS tokenHash, public_id AS publicId,
             last_used_at AS lastUsedAt
      FROM trusted_devices
    `).get() as {
      id: string;
      tokenHash: string;
      publicId: string;
      lastUsedAt: string | null;
    };
    expect(registeredView.publicId).toBe(deviceRow.publicId);
    expect(registeredView.publicId).not.toBe(deviceRow.id);
    expect(registeredView.publicId).not.toBe(deviceRow.tokenHash);

    const repeatedRegister = await guardian.request(
      "POST",
      "/api/guardian/devices/current",
      { name: "무시되는 새 이름", deviceType: "tablet" }
    );
    expect(repeatedRegister.statusCode).toBe(200);
    expect(repeatedRegister.json()).toMatchObject({
      publicId: registeredView.publicId,
      name: "수아 태블릿",
      status: "active",
      current: true
    });
    expect((harness.db.prepare(`
      SELECT COUNT(*) AS count FROM trusted_devices
    `).get() as { count: number }).count).toBe(1);

    const firstUse = (harness.db.prepare(`
      SELECT last_used_at AS lastUsedAt FROM trusted_devices WHERE id = ?
    `).get(deviceRow.id) as { lastUsedAt: string | null }).lastUsedAt;
    expect(firstUse).toBe("2026-07-15T03:00:00.000Z");
    harness.advanceTime(5 * 60 * 1_000 - 1);
    await guardian.request("GET", "/api/guardian/devices");
    expect((harness.db.prepare(`
      SELECT last_used_at AS lastUsedAt FROM trusted_devices WHERE id = ?
    `).get(deviceRow.id) as { lastUsedAt: string | null }).lastUsedAt).toBe(firstUse);
    harness.advanceTime(1);
    await guardian.request("GET", "/api/guardian/devices");
    expect((harness.db.prepare(`
      SELECT last_used_at AS lastUsedAt FROM trusted_devices WHERE id = ?
    `).get(deviceRow.id) as { lastUsedAt: string | null }).lastUsedAt)
      .toBe("2026-07-15T03:05:00.000Z");

    await guardian.request("PUT", "/api/auth/student-pin", { pin: "2580" });
    const student = harness.client();
    student.setCookie("sua_device", guardian.cookie("sua_device")!);
    const studentLogin = await student.request(
      "POST",
      "/api/auth/student/login",
      { pin: "2580" }
    );
    expect(studentLogin.statusCode).toBe(200);
    const loginResult = studentLogin.json() as StudentLoginResult;
    const studentSession = harness.db.prepare(`
      SELECT expires_at AS expiresAt
      FROM sessions AS s
      JOIN users AS u ON u.id = s.user_id
      WHERE u.role = 'student'
    `).get() as { expiresAt: string };
    expect(loginResult).toEqual({
      offlineAccessUntil: new Date(Math.min(
        Date.parse("2026-07-15T14:59:59.999Z"),
        Date.parse(studentSession.expiresAt)
      )).toISOString()
    });

    const studentId = (harness.db.prepare(`
      SELECT id FROM users WHERE role = 'student'
    `).get() as { id: string }).id;
    const content = harness.db.prepare(`
      SELECT id, active_version AS version FROM content_items LIMIT 1
    `).get() as { id: string; version: number };
    harness.db.prepare(`
      INSERT INTO issued_daily_plans (
        id, student_id, trusted_device_id, plan_kind, recovery_source_plan_id,
        study_date, issued_at, submit_until, offline_epoch, start_cursor
      ) VALUES (?, ?, ?, 'daily', NULL, ?, ?, ?, 1, 0)
    `).run(
      "plan-for-revocation",
      studentId,
      deviceRow.id,
      "2026-07-15",
      "2026-07-15T03:00:00.000Z",
      "2026-07-16T03:00:00.000Z"
    );
    harness.db.prepare(`
      INSERT INTO issued_plan_items (
        plan_id, item_id, content_version, is_required, sort_order
      ) VALUES (?, ?, ?, 1, 0)
    `).run("plan-for-revocation", content.id, content.version);
    harness.db.prepare(`
      INSERT INTO issued_learning_sessions (
        id, plan_id, student_id, trusted_device_id, item_id, content_version,
        study_date, issued_at, active_until, submit_until, revoked_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
    `).run(
      "learning-session-for-revocation",
      "plan-for-revocation",
      studentId,
      deviceRow.id,
      content.id,
      content.version,
      "2026-07-15",
      "2026-07-15T03:00:00.000Z",
      "2026-07-15T04:00:00.000Z",
      "2026-07-16T03:00:00.000Z"
    );

    const revoked = await guardian.request(
      "POST",
      `/api/guardian/devices/${registeredView.publicId}/revoke`
    );
    expect(revoked.statusCode).toBe(200);
    expect(revoked.json()).toMatchObject({
      publicId: registeredView.publicId,
      status: "revoked",
      current: true
    });
    expect((harness.db.prepare(`
      SELECT COUNT(*) AS count
      FROM sessions AS s JOIN users AS u ON u.id = s.user_id
      WHERE u.role = 'student'
    `).get() as { count: number }).count).toBe(0);
    expect((harness.db.prepare(`
      SELECT COUNT(*) AS count
      FROM sessions AS s JOIN users AS u ON u.id = s.user_id
      WHERE u.role = 'guardian'
    `).get() as { count: number }).count).toBe(1);
    expect((harness.db.prepare(`
      SELECT revoked_at AS revokedAt
      FROM issued_learning_sessions
      WHERE id = 'learning-session-for-revocation'
    `).get() as { revokedAt: string | null }).revokedAt)
      .toBe("2026-07-15T03:05:00.000Z");

    const repeatedRevoke = await guardian.request(
      "POST",
      `/api/guardian/devices/${registeredView.publicId}/revoke`
    );
    expect(repeatedRevoke.statusCode).toBe(200);
    expect(repeatedRevoke.json()).toEqual(revoked.json());
    expect(JSON.stringify(repeatedRevoke.json())).not.toMatch(/token|hash|\"id\"/i);

    const oldCookieLogin = await student.request(
      "POST",
      "/api/auth/student/login",
      { pin: "2580" }
    );
    expect(oldCookieLogin.statusCode).toBe(403);
    expect(oldCookieLogin.json()).toEqual({ code: "DEVICE_REVOKED" });

    const randomCookie = harness.client();
    randomCookie.setCookie("sua_device", "random-unknown-cookie");
    const unknownLogin = await randomCookie.request(
      "POST",
      "/api/auth/student/login",
      { pin: "2580" }
    );
    expect(unknownLogin.statusCode).toBe(403);
    expect(unknownLogin.json()).toEqual({ code: "DEVICE_NOT_TRUSTED" });

    const devices = await guardian.request("GET", "/api/guardian/devices");
    expect(devices.json()).toEqual({ devices: [repeatedRevoke.json()] });
    expect(JSON.stringify(devices.json())).not.toMatch(/token|hash|\"id\"/i);
  });

  it("ends only the cookie-selected session and rejects role or user targeting", async () => {
    const first = harness.client();
    const second = harness.client();
    await bootstrapFamily(harness, first);
    await loginGuardian(first);
    await loginGuardian(second);

    for (const target of [{ role: "student" }, { userId: "student-1" }]) {
      const rejected = await first.request(
        "POST",
        "/api/auth/session/end",
        target
      );
      expect(rejected.statusCode).toBe(400);
      expect(rejected.json()).toEqual({ code: "INVALID_REQUEST" });
      expect(first.cookie("sua_session")).toBeDefined();
    }
    expect((harness.db.prepare(`
      SELECT COUNT(*) AS count FROM sessions
    `).get() as { count: number }).count).toBe(2);

    const ended = await first.request("POST", "/api/auth/session/end");
    expect(ended.statusCode).toBe(204);
    expect(first.cookie("sua_session")).toBeUndefined();
    expect((harness.db.prepare(`
      SELECT COUNT(*) AS count FROM sessions
    `).get() as { count: number }).count).toBe(1);
    expect((await first.request("GET", "/api/auth/me")).statusCode).toBe(401);
    expect((await second.request("GET", "/api/auth/me")).statusCode).toBe(200);
  });

  it("distinguishes missing, unknown, and revoked devices from genuine student session failures", async () => {
    const guardian = harness.client();
    await bootstrapFamily(harness, guardian);
    await loginGuardian(guardian);
    const registered = await guardian.request(
      "POST",
      "/api/guardian/devices/current",
      { name: "권한 구분 태블릿", deviceType: "tablet" }
    );
    const publicId = (registered.json() as TrustedDeviceView).publicId;
    const deviceToken = guardian.cookie("sua_device")!;
    await guardian.request("PUT", "/api/auth/student-pin", { pin: "2580" });

    const student = harness.client();
    student.setCookie("sua_device", deviceToken);
    expect((await student.request("POST", "/api/auth/student/login", {
      pin: "2580"
    })).statusCode).toBe(200);
    const sessionToken = student.cookie("sua_session")!;

    const anonymous = await harness.client().request("GET", "/api/student/stars");
    expect(anonymous.statusCode).toBe(401);
    expect(anonymous.json()).toEqual({ code: "AUTH_REQUIRED" });

    const activeDeviceWithoutSession = harness.client();
    activeDeviceWithoutSession.setCookie("sua_device", deviceToken);
    const missingSession = await activeDeviceWithoutSession.request(
      "GET",
      "/api/student/stars"
    );
    expect(missingSession.statusCode).toBe(401);
    expect(missingSession.json()).toEqual({ code: "AUTH_REQUIRED" });

    const missingDevice = harness.client();
    missingDevice.setCookie("sua_session", sessionToken);
    const missingDeviceResponse = await missingDevice.request(
      "GET",
      "/api/student/stars"
    );
    expect(missingDeviceResponse.statusCode).toBe(403);
    expect(missingDeviceResponse.json()).toEqual({ code: "DEVICE_NOT_TRUSTED" });

    const unknownDevice = harness.client();
    unknownDevice.setCookie("sua_session", sessionToken);
    unknownDevice.setCookie("sua_device", "unknown-device-token");
    const unknownDeviceResponse = await unknownDevice.request(
      "GET",
      "/api/student/stars"
    );
    expect(unknownDeviceResponse.statusCode).toBe(403);
    expect(unknownDeviceResponse.json()).toEqual({ code: "DEVICE_NOT_TRUSTED" });

    harness.db.prepare(`
      UPDATE sessions
      SET expires_at = '2026-07-15T02:59:59.999Z'
      WHERE user_id IN (SELECT id FROM users WHERE role = 'student')
    `).run();
    const expiredSession = await student.request("GET", "/api/student/stars");
    expect(expiredSession.statusCode).toBe(401);
    expect(expiredSession.json()).toEqual({ code: "AUTH_REQUIRED" });

    const expiredWithoutDevice = harness.client();
    expiredWithoutDevice.setCookie("sua_session", sessionToken);
    const expiredWithoutDeviceResponse = await expiredWithoutDevice.request(
      "GET",
      "/api/student/stars"
    );
    expect(expiredWithoutDeviceResponse.statusCode).toBe(401);
    expect(expiredWithoutDeviceResponse.json()).toEqual({ code: "AUTH_REQUIRED" });

    expect((await student.request("POST", "/api/auth/student/login", {
      pin: "2580"
    })).statusCode).toBe(200);

    expect((await guardian.request(
      "POST",
      `/api/guardian/devices/${publicId}/revoke`
    )).statusCode).toBe(200);
    const revokedDevice = await student.request("GET", "/api/student/stars");
    expect(revokedDevice.statusCode).toBe(403);
    expect(revokedDevice.json()).toEqual({ code: "DEVICE_REVOKED" });
    expect((await guardian.request("GET", "/api/guardian/devices")).statusCode)
      .toBe(200);
  });
});
