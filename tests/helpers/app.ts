import type { FastifyInstance, InjectOptions } from "fastify";
import { requireRole } from "../../src/server/auth/routes";
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
    payload?: InjectOptions["payload"],
    options: {
      headers?: InjectOptions["headers"];
      remoteAddress?: string;
    } = {}
  ) {
    const cookie = [...this.cookies]
      .map(([key, value]) => `${key}=${value}`)
      .join("; ");
    const response = await this.app.inject({
      method,
      url,
      payload,
      remoteAddress: options.remoteAddress,
      headers: {
        origin: this.origin,
        ...options.headers,
        ...(cookie ? { cookie } : {})
      }
    });
    const values = response.headers["set-cookie"];
    for (const value of values ? (Array.isArray(values) ? values : [values]) : []) {
      const match = /^([^=]+)=([^;]*)/.exec(value);
      if (match?.[1] !== undefined && match[2] !== undefined) {
        if (match[2] === "") {
          this.cookies.delete(match[1]);
        } else {
          this.cookies.set(match[1], match[2]);
        }
      }
    }
    return response;
  }

  cookie(name: string): string | undefined {
    return this.cookies.get(name);
  }

  setCookie(name: string, value: string): void {
    this.cookies.set(name, value);
  }
}

export async function createTestHarness(options: {
  nodeEnv?: "test" | "production";
  clientDistDir?: string;
} = {}) {
  const db = openDatabase(":memory:");
  migrate(db);
  seedInitialContent(db);
  const config = parseConfig({
    ...TEST_ENV,
    NODE_ENV: options.nodeEnv ?? TEST_ENV.NODE_ENV
  });
  let sequence = 0;
  let currentTime = new Date("2026-07-15T03:00:00.000Z");
  const app = await buildApp({
    config,
    db,
    now: () => new Date(currentTime),
    randomToken: () => Buffer.alloc(32, ++sequence).toString("base64url"),
    clientDistDir: options.clientDistDir
  });
  app.get(
    "/api/auth/test-guardian-only",
    { preHandler: requireRole("guardian") },
    async () => ({ ok: true })
  );
  return {
    app,
    config,
    db,
    client: () => new TestClient(app, config.appOrigin),
    advanceTime: (milliseconds: number) => {
      currentTime = new Date(currentTime.getTime() + milliseconds);
    },
    close: async () => {
      await app.close();
      db.close();
    }
  };
}
