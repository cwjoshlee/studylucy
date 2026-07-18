import { z } from "zod";

const ConfigSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  DATABASE_PATH: z.string().min(1).default("/data/sua-learning.db"),
  BACKUP_DIR: z.string().min(1).default("/data/backups"),
  APP_ORIGIN: z.string().url(),
  SETUP_SECRET: z.string().min(32),
  SESSION_PEPPER: z.string().min(32),
  LLM_ENCRYPTION_KEY: z.string().optional(),
  SESSION_DAYS: z.coerce.number().int().min(1).max(90).default(14),
  TIME_ZONE: z.string().default("Asia/Seoul")
});

export type AppConfig = {
  nodeEnv: "development" | "test" | "production";
  host: string;
  port: number;
  databasePath: string;
  backupDir: string;
  appOrigin: string;
  setupSecret: string;
  sessionPepper: string;
  llmEncryptionKey: Buffer | null;
  sessionDays: number;
  timeZone: string;
};

export function parseConfig(env: NodeJS.ProcessEnv): AppConfig {
  const value = ConfigSchema.parse(env);
  if (value.NODE_ENV === "production" && !value.APP_ORIGIN.startsWith("https://")) {
    throw new Error("APP_ORIGIN must use https in production");
  }
  try {
    new Intl.DateTimeFormat("ko-KR", { timeZone: value.TIME_ZONE });
  } catch {
    throw new Error("TIME_ZONE is invalid");
  }
  let llmEncryptionKey: Buffer | null = null;
  if (value.LLM_ENCRYPTION_KEY !== undefined && value.LLM_ENCRYPTION_KEY !== "") {
    const decoded = Buffer.from(value.LLM_ENCRYPTION_KEY, "base64");
    if (decoded.length !== 32 || decoded.toString("base64") !== value.LLM_ENCRYPTION_KEY) {
      throw new Error("LLM_ENCRYPTION_KEY must be a base64-encoded 32-byte key");
    }
    llmEncryptionKey = decoded;
  }
  return {
    nodeEnv: value.NODE_ENV,
    host: value.HOST,
    port: value.PORT,
    databasePath: value.DATABASE_PATH,
    backupDir: value.BACKUP_DIR,
    appOrigin: value.APP_ORIGIN,
    setupSecret: value.SETUP_SECRET,
    sessionPepper: value.SESSION_PEPPER,
    llmEncryptionKey,
    sessionDays: value.SESSION_DAYS,
    timeZone: value.TIME_ZONE
  };
}
