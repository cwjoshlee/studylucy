import type Database from "better-sqlite3";
import type { FastifyInstance } from "fastify";
import { basename } from "node:path";
import { requireRole } from "../auth/routes";
import {
  canonicalTimestamp,
  isCanonicalBackupFilename
} from "./validation";

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
      const candidates = deps.db.prepare(`
        SELECT status, path, created_at
        FROM backup_runs
        ORDER BY created_at DESC, rowid DESC
      `).all() as BackupStatusRow[];
      let latest: { row: BackupStatusRow; finishedAt: string } | undefined;
      for (const row of candidates) {
        const finishedAt = canonicalTimestamp(row.created_at);
        if (finishedAt !== null) {
          latest = { row, finishedAt };
          break;
        }
      }
      if (latest === undefined) {
        return { status: "never-run" as const };
      }
      if (latest.row.status === "success") {
        const candidate = latest.row.path === null
          ? null
          : basename(latest.row.path);
        const filename = candidate !== null &&
          isCanonicalBackupFilename(candidate)
          ? candidate
          : undefined;
        return {
          status: "success" as const,
          finishedAt: latest.finishedAt,
          ...(filename === undefined ? {} : { filename })
        };
      }
      return {
        status: "failure" as const,
        finishedAt: latest.finishedAt
      };
    }
  );
}
