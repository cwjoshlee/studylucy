import type { preHandlerHookHandler } from "fastify";

export function createOriginGuard(appOrigin: string): preHandlerHookHandler {
  const allowedOrigin = new URL(appOrigin).origin;

  return async (request, reply) => {
    if (request.method === "GET" || !request.url.startsWith("/api/")) {
      return;
    }
    if (request.headers.origin !== allowedOrigin) {
      return reply.code(403).send({ code: "ORIGIN_NOT_ALLOWED" });
    }
  };
}
