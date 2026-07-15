import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { buildApp } from "./app";
import { parseConfig } from "./config";
import { openDatabase } from "./db/client";
import { migrate } from "./db/migrate";
import { seedInitialContent } from "./db/seed";

if (existsSync(".env")) {
  loadEnvFile(".env");
}

const config = parseConfig(process.env);
const db = openDatabase(config.databasePath);

try {
  migrate(db);
  seedInitialContent(db);

  const app = await buildApp({
    config,
    db,
    now: () => new Date(),
    randomToken: () => randomBytes(32).toString("base64url")
  });
  let shuttingDown = false;

  const shutdown = async () => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;

    try {
      await app.close();
    } finally {
      db.close();
    }
  };

  process.once("SIGTERM", () => {
    void shutdown();
  });
  process.once("SIGINT", () => {
    void shutdown();
  });

  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  db.close();
  throw error;
}
