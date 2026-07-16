import type { FastifyInstance, FastifyReply } from "fastify";
import {
  OfflineBatchInputSchema,
  RecoveryPlanRequestSchema
} from "../../shared/learning";
import { requireRole } from "../auth/routes";
import {
  OfflineBatchError,
  OfflineBatchService,
  type OfflineBatchServiceDeps
} from "./service";

async function handleOfflineError(
  error: unknown,
  reply: FastifyReply
): Promise<void> {
  if (error instanceof OfflineBatchError) {
    await reply.code(error.statusCode).send({ code: error.code });
    return;
  }
  throw error;
}

export function registerOfflineRoutes(
  app: FastifyInstance,
  deps: OfflineBatchServiceDeps
): void {
  const service = new OfflineBatchService(deps);

  app.post(
    "/api/student/recovery-plans",
    { preHandler: requireRole("student") },
    async (request, reply) => {
      const body = RecoveryPlanRequestSchema.safeParse(request.body);
      if (!body.success) {
        await reply.code(400).send({ code: "INVALID_REQUEST" });
        return;
      }
      if (request.currentTrustedDeviceId === null) {
        await reply.code(403).send({ code: "DEVICE_NOT_TRUSTED" });
        return;
      }
      try {
        await reply.send(service.createRecoveryPlan(
          request.currentUser!.id,
          request.currentTrustedDeviceId,
          body.data.sourcePlanId
        ));
      } catch (error) {
        await handleOfflineError(error, reply);
      }
    }
  );

  app.post(
    "/api/student/offline-batches",
    { preHandler: requireRole("student") },
    async (request, reply) => {
      const body = OfflineBatchInputSchema.safeParse(request.body);
      if (!body.success) {
        await reply.code(400).send({ code: "INVALID_REQUEST" });
        return;
      }
      if (request.currentTrustedDeviceId === null) {
        await reply.code(403).send({ code: "DEVICE_NOT_TRUSTED" });
        return;
      }
      try {
        await reply.send(service.apply(
          request.currentUser!.id,
          request.currentTrustedDeviceId,
          body.data
        ));
      } catch (error) {
        await handleOfflineError(error, reply);
      }
    }
  );
}
