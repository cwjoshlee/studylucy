import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import type Database from "better-sqlite3";
import Fastify, { type FastifyInstance } from "fastify";
import { registerAuthRoutes } from "./auth/routes";
import type { AppConfig } from "./config";
import { createOriginGuard } from "./security/origin";
import { trustFirstHopProxy } from "./security/proxy";

export type AppDeps = {
  config: AppConfig;
  db: Database.Database;
  now: () => Date;
  randomToken: () => string;
};

function isInvalidJsonError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const code = "code" in error ? error.code : undefined;
  const statusCode = "statusCode" in error ? error.statusCode : undefined;
  return (
    code === "FST_ERR_CTP_INVALID_JSON_BODY" ||
    (error instanceof SyntaxError && statusCode === 400)
  );
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: deps.config.nodeEnv !== "test",
    trustProxy: trustFirstHopProxy
  });

  await app.register(cookie);
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"]
      }
    }
  });
  await app.register(rateLimit, { max: 120, timeWindow: "1 minute" });

  app.setErrorHandler(async (error, _request, reply) => {
    if (isInvalidJsonError(error)) {
      await reply.code(400).send({ code: "INVALID_REQUEST" });
      return;
    }
    await reply.send(error);
  });

  app.addHook("preHandler", createOriginGuard(deps.config.appOrigin));
  registerAuthRoutes(app, deps);
  app.get("/api/health", async () => ({ status: "ok" as const }));

  return app;
}
