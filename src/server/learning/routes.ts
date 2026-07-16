import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { requireRole } from "../auth/routes";
import { AttemptInputSchema } from "../../shared/learning";
import { StudyDateSchema } from "../../shared/study-date";
import {
  LearningError,
  LearningService,
  type LearningServiceDeps
} from "./service";

const TodayQuerySchema = z.object({}).strict();
const ProgressQuerySchema = z.object({
  from: StudyDateSchema,
  to: StudyDateSchema
}).refine((query) => query.from <= query.to);

function sendInvalidRequest(reply: FastifyReply): void {
  void reply.code(400).send({ code: "INVALID_REQUEST" });
}

async function handleLearningError(
  error: unknown,
  reply: FastifyReply
): Promise<void> {
  if (error instanceof LearningError) {
    await reply.code(error.statusCode).send({ code: error.code });
    return;
  }
  throw error;
}

export function registerLearningRoutes(
  app: FastifyInstance,
  deps: LearningServiceDeps
): void {
  const service = new LearningService(deps);

  app.get(
    "/api/student/today",
    { preHandler: requireRole("student") },
    async (request, reply) => {
      const query = TodayQuerySchema.safeParse(request.query);
      if (!query.success) {
        sendInvalidRequest(reply);
        return;
      }
      if (request.currentTrustedDeviceId === null) {
        await reply.code(403).send({ code: "DEVICE_NOT_TRUSTED" });
        return;
      }
      await reply.send(
        service.getTodayPlan(
          request.currentUser!.id,
          request.currentTrustedDeviceId
        )
      );
    }
  );

  app.post(
    "/api/student/attempts",
    { preHandler: requireRole("student") },
    async (request, reply) => {
      const body = AttemptInputSchema.safeParse(request.body);
      if (!body.success) {
        sendInvalidRequest(reply);
        return;
      }
      if (request.currentTrustedDeviceId === null) {
        await reply.code(403).send({ code: "DEVICE_NOT_TRUSTED" });
        return;
      }
      try {
        const receipt = service.saveAttempt(
          request.currentUser!.id,
          request.currentTrustedDeviceId,
          body.data
        );
        await reply.code(receipt.duplicate ? 200 : 201).send(receipt);
      } catch (error) {
        await handleLearningError(error, reply);
      }
    }
  );

  app.get(
    "/api/guardian/progress",
    { preHandler: requireRole("guardian") },
    async (request, reply) => {
      const query = ProgressQuerySchema.safeParse(request.query);
      if (!query.success) {
        sendInvalidRequest(reply);
        return;
      }
      await reply.send(
        service.getGuardianProgress(query.data.from, query.data.to)
      );
    }
  );
}
