import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { CoachMessageRequestSchema } from "../../shared/learning";
import { requireRole } from "../auth/routes";
import type { AppDeps } from "../app";
import { AiCoachService } from "./service";

const SettingsInputSchema = z.object({
  enabled: z.boolean().optional(),
  provider: z.enum(["gemini", "openai"]).optional(),
  monthlyBudgetWon: z.number().int().min(0).max(10_000).optional(),
  apiKey: z.string().min(1).max(500).optional(),
  deleteApiKey: z.literal(true).optional()
}).strict().refine((input) => Object.keys(input).length > 0);

function invalid(reply: FastifyReply): void {
  void reply.code(400).send({ code: "INVALID_REQUEST" });
}

export function registerAiCoachRoutes(app: FastifyInstance, deps: AppDeps): void {
  const service = new AiCoachService({
    db: deps.db,
    encryptionKey: deps.config.llmEncryptionKey,
    now: deps.now
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
}
