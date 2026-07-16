import type Database from "better-sqlite3";
import type { FastifyInstance } from "fastify";
import { basename } from "node:path";
import { requireRole } from "../auth/routes";

const DISPLAY_SAFE_BACKUP_PATTERN =
  /^sua-learning-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.sqlite$/;

type BackupStatusRow = {
  status: "success" | "failure";
  path: string | null;
  created_at: string;
};

export function registerBackupRoutes(
  app: FastifyInstance,
  deps: { db: Database.Database }
): void {
  app.get(
    "/api/guardian/backup-status",
    { preHandler: requireRole("guardian") },
    async () => {
      const latest = deps.db.prepare(`
        SELECT status, path, created_at
        FROM backup_runs
        ORDER BY created_at DESC, rowid DESC
        LIMIT 1
      `).get() as BackupStatusRow | undefined;
      if (latest === undefined) {
        return { status: "never-run" as const };
      }
      if (latest.status === "success") {
        const candidate = latest.path === null ? null : basename(latest.path);
        const filename = candidate !== null &&
          DISPLAY_SAFE_BACKUP_PATTERN.test(candidate)
          ? candidate
          : undefined;
        return {
          status: "success" as const,
          finishedAt: latest.created_at,
          ...(filename === undefined ? {} : { filename })
        };
      }
      return {
        status: "failure" as const,
        finishedAt: latest.created_at
      };
    }
  );
}
