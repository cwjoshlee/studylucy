import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  GuardianLoginRequest,
  RegisterDeviceRequest,
  RevokeDeviceRequest,
  SetupRequest,
  StudentPinRequest,
  type CurrentUser
} from "../../shared/auth";
import { AuthError, AuthService, type AuthServiceDeps } from "./service";

declare module "fastify" {
  interface FastifyRequest {
    currentUser: CurrentUser | null;
    currentTrustedDeviceId: string | null;
    currentDeviceStatus: "missing" | "unknown" | "active" | "revoked";
    currentSessionStatus: "missing" | "invalid" | "valid";
  }
}

export function requireRole(role: CurrentUser["role"]) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (request.currentUser === null) {
      if (role === "student" && request.currentDeviceStatus === "revoked") {
        await reply.code(403).send({ code: "DEVICE_REVOKED" });
        return;
      }
      if (role === "student" && request.currentSessionStatus === "valid") {
        await reply.code(403).send({ code: "DEVICE_NOT_TRUSTED" });
        return;
      }
      await reply.code(401).send({ code: "AUTH_REQUIRED" });
      return;
    }
    if (request.currentUser.role !== role) {
      await reply.code(403).send({ code: "ROLE_FORBIDDEN" });
    }
  };
}

function parseBody<T>(
  schema: z.ZodType<T>,
  body: unknown,
  reply: FastifyReply
): T | null {
  const result = schema.safeParse(body);
  if (!result.success) {
    void reply.code(400).send({ code: "INVALID_REQUEST" });
    return null;
  }
  return result.data;
}

async function handleAuthError(
  error: unknown,
  reply: FastifyReply
): Promise<void> {
  if (error instanceof AuthError) {
    await reply.code(error.statusCode).send({ code: error.code });
    return;
  }
  throw error;
}

export function registerAuthRoutes(
  app: FastifyInstance,
  deps: AuthServiceDeps
): void {
  const service = new AuthService(deps);
  const sessionCookie = {
    path: "/",
    httpOnly: true,
    secure: deps.config.nodeEnv === "production",
    sameSite: "strict" as const,
    maxAge: deps.config.sessionDays * 86_400
  };

  app.decorateRequest("currentUser", null);
  app.decorateRequest("currentTrustedDeviceId", null);
  app.decorateRequest("currentDeviceStatus", "missing");
  app.decorateRequest("currentSessionStatus", "missing");
  app.addHook("preHandler", async (request) => {
    const context = service.getRequestAuthContext(
      request.cookies.sua_session,
      request.cookies.sua_device
    );
    request.currentUser = context.user;
    request.currentTrustedDeviceId = context.trustedDeviceId;
    request.currentDeviceStatus = context.deviceStatus;
    request.currentSessionStatus = context.sessionStatus;
  });

  app.post("/api/auth/setup", async (request, reply) => {
    const body = parseBody(SetupRequest, request.body, reply);
    if (body === null) {
      return;
    }
    try {
      await service.bootstrapGuardian(body);
      await reply.code(201).send({ status: "created" });
    } catch (error) {
      await handleAuthError(error, reply);
    }
  });

  app.post("/api/auth/guardian/login", async (request, reply) => {
    const body = parseBody(GuardianLoginRequest, request.body, reply);
    if (body === null) {
      return;
    }
    try {
      const token = await service.loginGuardian(body.password, request.ip);
      reply.setCookie("sua_session", token, sessionCookie);
      await reply.code(204).send();
    } catch (error) {
      await handleAuthError(error, reply);
    }
  });

  app.post(
    "/api/guardian/devices/current",
    { preHandler: requireRole("guardian") },
    async (request, reply) => {
      const body = parseBody(RegisterDeviceRequest, request.body, reply);
      if (body === null) {
        return;
      }
      const registration = service.registerDevice(
        body.name,
        request.cookies.sua_device
      );
      if (registration.rawToken !== null) {
        reply.setCookie("sua_device", registration.rawToken, {
          ...sessionCookie,
          maxAge: 365 * 86_400
        });
      }
      await reply
        .code(registration.created ? 201 : 200)
        .send(registration.device);
    }
  );

  app.get(
    "/api/guardian/devices",
    { preHandler: requireRole("guardian") },
    async (request, reply) => {
      await reply.send({
        devices: service.listDevices(request.currentTrustedDeviceId)
      });
    }
  );

  app.post(
    "/api/guardian/devices/:publicId/revoke",
    { preHandler: requireRole("guardian") },
    async (request, reply) => {
      const params = parseBody(RevokeDeviceRequest, request.params, reply);
      if (params === null) return;
      try {
        await reply.send(service.revokeDevice(
          params.publicId,
          request.currentTrustedDeviceId
        ));
      } catch (error) {
        await handleAuthError(error, reply);
      }
    }
  );

  app.put(
    "/api/auth/student-pin",
    { preHandler: requireRole("guardian") },
    async (request, reply) => {
      const body = parseBody(StudentPinRequest, request.body, reply);
      if (body === null) {
        return;
      }
      try {
        await service.setStudentPin(body.pin);
        await reply.code(204).send();
      } catch (error) {
        await handleAuthError(error, reply);
      }
    }
  );

  app.post("/api/auth/student/login", async (request, reply) => {
    const body = parseBody(StudentPinRequest, request.body, reply);
    if (body === null) {
      return;
    }
    try {
      const login = await service.loginStudent(
        body.pin,
        request.cookies.sua_device
      );
      reply.setCookie("sua_session", login.token, sessionCookie);
      await reply.send(login.result);
    } catch (error) {
      await handleAuthError(error, reply);
    }
  });

  app.post("/api/auth/logout", async (request, reply) => {
    service.endSession(request.cookies.sua_session);
    reply.clearCookie("sua_session", sessionCookie);
    await reply.code(204).send();
  });

  app.post("/api/auth/session/end", async (request, reply) => {
    const body = parseBody(
      z.union([z.undefined(), z.object({}).strict()]),
      request.body,
      reply
    );
    if (body === null) return;
    service.endSession(request.cookies.sua_session);
    reply.clearCookie("sua_session", sessionCookie);
    await reply.code(204).send();
  });

  app.get("/api/auth/me", async (request, reply) => {
    if (request.currentUser === null) {
      if (!service.isSetupComplete()) {
        await reply.code(409).send({ code: "SETUP_REQUIRED" });
        return;
      }
      if (request.currentDeviceStatus === "revoked") {
        await reply.code(403).send({ code: "DEVICE_REVOKED" });
        return;
      }
      if (request.currentSessionStatus === "valid") {
        await reply.code(403).send({ code: "DEVICE_NOT_TRUSTED" });
        return;
      }
      await reply.code(401).send({ code: "AUTH_REQUIRED" });
      return;
    }
    await reply.send(request.currentUser);
  });
}
