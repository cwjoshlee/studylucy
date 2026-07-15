import type { FastifyInstance, InjectOptions } from "fastify";
import { buildApp } from "../../src/server/app";
import { parseConfig } from "../../src/server/config";
import { openDatabase } from "../../src/server/db/client";
import { migrate } from "../../src/server/db/migrate";
import { seedInitialContent } from "../../src/server/db/seed";

const TEST_ENV = {
  NODE_ENV: "test",
  HOST: "127.0.0.1",
  PORT: "8787",
  DATABASE_PATH: ":memory:",
  BACKUP_DIR: "/tmp/sua-backups",
  APP_ORIGIN: "https://sua.example.test",
  SETUP_SECRET: "s".repeat(32),
  SESSION_PEPPER: "p".repeat(32),
  SESSION_DAYS: "14",
  TIME_ZONE: "Asia/Seoul"
};

export class TestClient {
  private cookies = new Map<string, string>();

  constructor(private app: FastifyInstance, private origin: string) {}

  async request(
    method: NonNullable<InjectOptions["method"]>,
    url: string,
    payload?: InjectOptions["payload"]
  ) {
    const cookie = [...this.cookies]
      .map(([key, value]) => `${key}=${value}`)
      .join("; ");
    const response = await this.app.inject({
      method,
      url,
      payload,
      headers: { origin: this.origin, ...(cookie ? { cookie } : {}) }
    });
    const values = response.headers["set-cookie"];
    for (const value of values ? (Array.isArray(values) ? values : [values]) : []) {
      const match = /^([^=]+)=([^;]*)/.exec(value);
      if (match?.[1] !== undefined && match[2] !== undefined) {
        this.cookies.set(match[1], match[2]);
      }
    }
    return response;
  }
}

export async function createTestHarness() {
  const db = openDatabase(":memory:");
  migrate(db);
  seedInitialContent(db);
  const config = parseConfig(TEST_ENV);
  let sequence = 0;
  const app = await buildApp({
    config,
    db,
    now: () => new Date("2026-07-15T03:00:00.000Z"),
    randomToken: () => `test-token-${String(++sequence).padStart(4, "0")}`
  });
  return {
    app,
    config,
    client: () => new TestClient(app, config.appOrigin),
    close: async () => {
      await app.close();
      db.close();
    }
  };
}
