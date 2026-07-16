import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import type Database from "better-sqlite3";
import Fastify, { type FastifyInstance } from "fastify";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { registerAuthRoutes } from "./auth/routes";
import { registerBackupRoutes } from "./backup/routes";
import type { AppConfig } from "./config";
import { registerLearningRoutes } from "./learning/routes";
import { createOriginGuard } from "./security/origin";
import { trustFirstHopProxy } from "./security/proxy";
import { registerStarRoutes } from "./stars/routes";

export type AppDeps = {
  config: AppConfig;
  db: Database.Database;
  now: () => Date;
  randomToken: () => string;
  clientDistDir?: string;
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
  registerBackupRoutes(app, deps);
  registerLearningRoutes(app, deps);
  registerStarRoutes(app, deps);
  app.get("/api/health", async () => ({ status: "ok" as const }));

  const clientDistDir = deps.clientDistDir ?? resolve(process.cwd(), "dist/client");
  if (existsSync(join(clientDistDir, "index.html"))) {
    await app.register(fastifyStatic, {
      root: clientDistDir,
      wildcard: false
    });
    app.setNotFoundHandler(async (request, reply) => {
      const path = request.url.split("?", 1)[0] ?? request.url;
      const acceptsHtml = request.headers.accept?.includes("text/html") ?? false;
      if (
        request.method === "GET" &&
        path !== "/api" &&
        !path.startsWith("/api/") &&
        acceptsHtml
      ) {
        await reply.type("text/html; charset=utf-8").sendFile("index.html");
        return;
      }
      await reply.code(404).send({ code: "NOT_FOUND" });
    });
  }

  return app;
}
