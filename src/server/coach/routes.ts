import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import {
  AiBatchRequestSchema,
  CoachMessageRequestSchema,
  LearningItemPayloadSchema
} from "../../shared/learning";
import { StudyDateSchema } from "../../shared/study-date";
import { requireRole } from "../auth/routes";
import type { AppDeps } from "../app";
import { AiCoachService } from "./service";
import { AiStudioError, AiStudioService } from "./studio-service";

const SettingsInputSchema = z.object({
  enabled: z.boolean().optional(),
  provider: z.enum(["gemini", "openai"]).optional(),
  monthlyBudgetWon: z.number().int().min(0).max(10_000).optional(),
  apiKey: z.string().min(1).max(500).optional(),
  deleteApiKey: z.literal(true).optional()
}).strict().refine((input) => Object.keys(input).length > 0);

const ProviderParamsSchema = z.object({
  provider: z.enum(["gemini", "openai"])
}).strict();
const ProviderInputSchema = z.object({
  enabled: z.boolean().optional(),
  model: z.string().regex(/^[A-Za-z0-9._:-]{2,120}$/).optional(),
  apiKey: z.string().min(1).max(500).optional(),
  deleteApiKey: z.literal(true).optional()
}).strict()
  .refine((input) => Object.keys(input).length > 0)
  .refine((input) => !(input.apiKey !== undefined && input.deleteApiKey === true));
const DraftParamsSchema = z.object({
  draftId: z.string().min(1).max(120)
}).strict();
const DraftItemParamsSchema = DraftParamsSchema.extend({
  itemId: z.string().min(1).max(120)
}).strict();
const DraftItemInputSchema = z.object({
  payload: LearningItemPayloadSchema
}).strict();
const ReportQuerySchema = z.object({
  from: StudyDateSchema,
  to: StudyDateSchema
}).strict().refine((input) => input.from <= input.to);

function invalid(reply: FastifyReply): void {
  void reply.code(400).send({ code: "INVALID_REQUEST" });
}

async function handleStudioError(
  error: unknown,
  reply: FastifyReply
): Promise<void> {
  if (!(error instanceof AiStudioError)) throw error;
  const status = error.code === "AI_STUDIO_INVALID_REQUEST"
    ? 400
    : error.code === "AI_STUDIO_NOT_FOUND"
      ? 404
      : error.code === "AI_STUDIO_PROVIDER_FAILED"
        ? 502
        : 409;
  await reply.code(status).send({ code: error.code });
}

export function registerAiCoachRoutes(app: FastifyInstance, deps: AppDeps): void {
  const service = new AiCoachService({
    db: deps.db,
    encryptionKey: deps.config.llmEncryptionKey,
    fetcher: deps.aiFetcher,
    now: deps.now
  });
  const studio = new AiStudioService({
    db: deps.db,
    encryptionKey: deps.config.llmEncryptionKey,
    fetcher: deps.aiFetcher,
    now: deps.now,
    randomId: deps.randomToken
  });

  app.get(
    "/api/guardian/ai-coach-settings",
    { preHandler: requireRole("guardian") },
    async (_request, reply) => {
      await reply.send(service.getSettings());
    }
  );

  app.put(
    "/api/guardian/ai-coach-settings",
    { preHandler: requireRole("guardian") },
    async (request, reply) => {
      const body = SettingsInputSchema.safeParse(request.body);
      if (!body.success) return invalid(reply);
      try {
        await reply.send(service.updateSettings(body.data));
      } catch (error) {
        if (error instanceof Error && error.message.includes("LLM_ENCRYPTION_KEY")) {
          await reply.code(409).send({ code: "AI_COACH_ENCRYPTION_UNAVAILABLE" });
          return;
        }
        if (error instanceof Error && error.message.includes("API key")) {
          await reply.code(409).send({ code: "AI_COACH_API_KEY_REQUIRED" });
          return;
        }
        throw error;
      }
    }
  );

  app.post(
    "/api/student/coach-message",
    { preHandler: requireRole("student") },
    async (request, reply) => {
      const body = CoachMessageRequestSchema.safeParse(request.body);
      if (!body.success) return invalid(reply);
      if (request.currentTrustedDeviceId === null) {
        await reply.code(403).send({ code: "DEVICE_NOT_TRUSTED" });
        return;
      }
      await reply.send(await service.message(body.data));
    }
  );

  app.get(
    "/api/guardian/ai-studio/settings",
    { preHandler: requireRole("guardian") },
    async (_request, reply) => {
      await reply.send(studio.getProviderSettings());
    }
  );

  app.put(
    "/api/guardian/ai-studio/settings/:provider",
    { preHandler: requireRole("guardian") },
    async (request, reply) => {
      const params = ProviderParamsSchema.safeParse(request.params);
      const body = ProviderInputSchema.safeParse(request.body);
      if (!params.success || !body.success) return invalid(reply);
      try {
        await reply.send(studio.updateProvider(params.data.provider, body.data));
      } catch (error) {
        await handleStudioError(error, reply);
      }
    }
  );

  app.post(
    "/api/guardian/ai-studio/drafts",
    { preHandler: requireRole("guardian") },
    async (request, reply) => {
      const body = AiBatchRequestSchema.safeParse(request.body);
      if (!body.success) return invalid(reply);
      try {
        await reply.code(201).send(await studio.createDraft(body.data));
      } catch (error) {
        await handleStudioError(error, reply);
      }
    }
  );

  app.get(
    "/api/guardian/ai-studio/drafts/:draftId",
    { preHandler: requireRole("guardian") },
    async (request, reply) => {
      const params = DraftParamsSchema.safeParse(request.params);
      if (!params.success) return invalid(reply);
      try {
        await reply.send(studio.getDraft(params.data.draftId));
      } catch (error) {
        await handleStudioError(error, reply);
      }
    }
  );

  app.patch(
    "/api/guardian/ai-studio/drafts/:draftId/items/:itemId",
    { preHandler: requireRole("guardian") },
    async (request, reply) => {
      const params = DraftItemParamsSchema.safeParse(request.params);
      const body = DraftItemInputSchema.safeParse(request.body);
      if (!params.success || !body.success) return invalid(reply);
      try {
        await reply.send(studio.updateDraftItem(
          params.data.draftId,
          params.data.itemId,
          body.data
        ));
      } catch (error) {
        await handleStudioError(error, reply);
      }
    }
  );

  app.post(
    "/api/guardian/ai-studio/drafts/:draftId/publish",
    { preHandler: requireRole("guardian") },
    async (request, reply) => {
      const params = DraftParamsSchema.safeParse(request.params);
      if (!params.success) return invalid(reply);
      try {
        await reply.send(studio.publishDraft(params.data.draftId));
      } catch (error) {
        await handleStudioError(error, reply);
      }
    }
  );

  app.get(
    "/api/guardian/ai-studio/report",
    { preHandler: requireRole("guardian") },
    async (request, reply) => {
      const query = ReportQuerySchema.safeParse(request.query);
      if (!query.success) return invalid(reply);
      await reply.send(await studio.getReport(query.data));
    }
  );
}
