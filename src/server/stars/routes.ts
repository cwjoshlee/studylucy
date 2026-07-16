import type { FastifyInstance, FastifyReply } from "fastify";
import { IdleEventInputSchema } from "../../shared/stars";
import {
  ApprovalInputSchema,
  DailyPlanInputSchema,
  ManualStarInputSchema,
  NoteInputSchema,
  StarReasonSchema
} from "../../shared/stars";
import { requireRole } from "../auth/routes";
import { z } from "zod";
import { isValidStudyDate } from "./kst";
import {
  StarService,
  StarServiceError,
  type StarServiceDeps
} from "./service";

const ClientIdleEventIdSchema = IdleEventInputSchema.pick({
  clientIdleEventId: true
});
const ClientCommandIdSchema = ManualStarInputSchema.pick({
  clientCommandId: true
});
const IdParamsSchema = z.object({ id: z.string().min(1) });
const EventIdParamsSchema = z.object({ eventId: z.string().min(1) });
const StudyDateSchema = z.string().refine(isValidStudyDate);
const DateParamsSchema = z.object({
  date: StudyDateSchema
});
const LimitQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(100)
});
const LedgerQuerySchema = LimitQuerySchema.extend({
  cursor: z.string().min(1).max(100).optional(),
  from: StudyDateSchema.optional(),
  to: StudyDateSchema.optional(),
  direction: z.enum(["all", "earned", "deducted"]).default("all"),
  reason: StarReasonSchema.optional()
}).refine((query) =>
  query.from === undefined || query.to === undefined || query.from <= query.to
);

async function invalidRequest(reply: FastifyReply): Promise<void> {
  await reply.code(400).send({ code: "INVALID_REQUEST" });
}

async function handleStarError(
  error: unknown,
  reply: FastifyReply
): Promise<void> {
  if (error instanceof StarServiceError) {
    await reply.code(error.statusCode).send({ code: error.code });
    return;
  }
  throw error;
}

export function registerStarRoutes(
  app: FastifyInstance,
  deps: StarServiceDeps
): void {
  const service = new StarService(deps);

  app.post(
    "/api/student/idle-events",
    { preHandler: requireRole("student") },
    async (request, reply) => {
      const clientId = ClientIdleEventIdSchema.safeParse(request.body);
      if (clientId.success) {
        const duplicate = service.findIdleResult(
          request.currentUser!.id,
          clientId.data.clientIdleEventId
        );
        if (duplicate !== null) {
          await reply.code(200).send(duplicate);
          return;
        }
      }
      const body = IdleEventInputSchema.safeParse(request.body);
      if (!body.success) {
        await reply.code(400).send({ code: "INVALID_REQUEST" });
        return;
      }
      try {
        const result = service.recordIdleEvent(
          request.currentUser!.id,
          body.data
        );
        await reply.code(result.duplicate ? 200 : 201).send(result);
      } catch (error) {
        await handleStarError(error, reply);
      }
    }
  );

  app.get(
    "/api/student/stars",
    { preHandler: requireRole("student") },
    async (request, reply) => {
      await reply.send(service.getStudentStars(request.currentUser!.id));
    }
  );

  app.get(
    "/api/guardian/stars",
    { preHandler: requireRole("guardian") },
    async (request, reply) => {
      const query = LedgerQuerySchema.safeParse(request.query);
      if (!query.success) {
        await invalidRequest(reply);
        return;
      }
      try {
        await reply.send(service.getGuardianStars({
          limit: query.data.limit,
          cursor: query.data.cursor ?? null,
          from: query.data.from ?? null,
          to: query.data.to ?? null,
          direction: query.data.direction,
          reason: query.data.reason ?? null
        }));
      } catch (error) {
        await handleStarError(error, reply);
      }
    }
  );

  app.get(
    "/api/guardian/star-adjustments",
    { preHandler: requireRole("guardian") },
    async (request, reply) => {
      const query = LimitQuerySchema.safeParse(request.query);
      if (!query.success) {
        await invalidRequest(reply);
        return;
      }
      await reply.send({ adjustments: service.listAdjustments(query.data.limit) });
    }
  );

  app.post(
    "/api/guardian/star-adjustments/:id/approve",
    { preHandler: requireRole("guardian") },
    async (request, reply) => {
      const params = IdParamsSchema.safeParse(request.params);
      const body = ApprovalInputSchema.safeParse(request.body);
      if (!params.success || !body.success) {
        await invalidRequest(reply);
        return;
      }
      try {
        await reply.send(service.approveAdjustment(
          params.data.id,
          request.currentUser!.id,
          body.data
        ));
      } catch (error) {
        await handleStarError(error, reply);
      }
    }
  );

  app.post(
    "/api/guardian/star-adjustments/:id/waive",
    { preHandler: requireRole("guardian") },
    async (request, reply) => {
      const params = IdParamsSchema.safeParse(request.params);
      const body = NoteInputSchema.safeParse(request.body);
      if (!params.success || !body.success) {
        await invalidRequest(reply);
        return;
      }
      try {
        await reply.send(service.waiveAdjustment(
          params.data.id,
          request.currentUser!.id,
          body.data.note
        ));
      } catch (error) {
        await handleStarError(error, reply);
      }
    }
  );

  app.post(
    "/api/guardian/stars/manual",
    { preHandler: requireRole("guardian") },
    async (request, reply) => {
      const clientId = ClientCommandIdSchema.safeParse(request.body);
      if (clientId.success) {
        const duplicate = service.findManualAdjustment(
          request.currentUser!.id,
          clientId.data.clientCommandId
        );
        if (duplicate !== null) {
          await reply.code(200).send(duplicate);
          return;
        }
      }
      const body = ManualStarInputSchema.safeParse(request.body);
      if (!body.success) {
        await invalidRequest(reply);
        return;
      }
      const result = service.applyManualAdjustment(
        request.currentUser!.id,
        body.data
      );
      await reply.code(result.duplicate ? 200 : 201).send(result);
    }
  );

  app.post(
    "/api/guardian/stars/:eventId/reverse",
    { preHandler: requireRole("guardian") },
    async (request, reply) => {
      const params = EventIdParamsSchema.safeParse(request.params);
      const body = NoteInputSchema.safeParse(request.body);
      if (!params.success || !body.success) {
        await invalidRequest(reply);
        return;
      }
      try {
        const result = service.reverseEvent(
          params.data.eventId,
          request.currentUser!.id,
          body.data.note
        );
        await reply.code(result.duplicate ? 200 : 201).send(result);
      } catch (error) {
        await handleStarError(error, reply);
      }
    }
  );

  app.get(
    "/api/guardian/daily-plans/:date",
    { preHandler: requireRole("guardian") },
    async (request, reply) => {
      const params = DateParamsSchema.safeParse(request.params);
      if (!params.success) {
        await invalidRequest(reply);
        return;
      }
      await reply.send(service.getGuardianPlan(params.data.date));
    }
  );

  app.put(
    "/api/guardian/daily-plans/:date",
    { preHandler: requireRole("guardian") },
    async (request, reply) => {
      const params = DateParamsSchema.safeParse(request.params);
      const body = DailyPlanInputSchema.safeParse(request.body);
      if (!params.success || !body.success) {
        await invalidRequest(reply);
        return;
      }
      try {
        await reply.send(service.updateGuardianPlan(
          params.data.date,
          body.data,
          request.currentUser!.id
        ));
      } catch (error) {
        await handleStarError(error, reply);
      }
    }
  );
}
