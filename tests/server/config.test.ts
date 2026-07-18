import { describe, expect, it } from "vitest";
import { parseConfig } from "../../src/server/config";

const validEnv = {
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

describe("parseConfig", () => {
  it("parses a complete configuration", () => {
    expect(parseConfig(validEnv)).toMatchObject({
      host: "127.0.0.1",
      port: 8787,
      databasePath: ":memory:",
      sessionDays: 14
    });
  });

  it("accepts an optional base64 32-byte AI coach encryption key only", () => {
    const key = Buffer.alloc(32, 3).toString("base64");
    expect(parseConfig({ ...validEnv, LLM_ENCRYPTION_KEY: key }).llmEncryptionKey)
      .toEqual(Buffer.alloc(32, 3));
    expect(parseConfig(validEnv).llmEncryptionKey).toBeNull();
    expect(() => parseConfig({ ...validEnv, LLM_ENCRYPTION_KEY: "not-a-key" }))
      .toThrow("LLM_ENCRYPTION_KEY");
  });

  it("rejects short security secrets", () => {
    expect(() => parseConfig({ ...validEnv, SETUP_SECRET: "short" }))
      .toThrow("SETUP_SECRET");
  });

  it("rejects a non-https production origin", () => {
    expect(() => parseConfig({
      ...validEnv,
      NODE_ENV: "production",
      APP_ORIGIN: "http://sua.example.test"
    })).toThrow("APP_ORIGIN");
  });

  it("rejects an unknown time zone", () => {
    expect(() => parseConfig({ ...validEnv, TIME_ZONE: "Mars/Olympus" }))
      .toThrow("TIME_ZONE");
  });
});
