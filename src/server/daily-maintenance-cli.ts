import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { parseConfig } from "./config";
import { openDatabase } from "./db/client";
import { migrate } from "./db/migrate";
import { seedInitialContent } from "./db/seed";
import { runMissedPlanCatchUp } from "./stars/maintenance";

export function runDailyMaintenanceCli(now = new Date()): void {
  if (existsSync(".env")) {
    loadEnvFile(".env");
  }
  const config = parseConfig(process.env);
  const db = openDatabase(config.databasePath);
  try {
    migrate(db);
    seedInitialContent(db);
    const result = runMissedPlanCatchUp(db, now);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally {
    db.close();
  }
}

const entry = process.argv[1];
if (entry !== undefined && fileURLToPath(import.meta.url) === resolve(entry)) {
  runDailyMaintenanceCli();
}
