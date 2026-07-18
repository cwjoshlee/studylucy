import type Database from "better-sqlite3";

export const aiCoachMigration = {
  version: 6,
  up(db: Database.Database): void {
    db.exec(`
      CREATE TABLE ai_coach_settings (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
        provider TEXT NOT NULL DEFAULT 'gemini' CHECK (provider IN ('gemini', 'openai')),
        model TEXT NOT NULL DEFAULT 'gemini-2.5-flash-lite',
        monthly_budget_won INTEGER NOT NULL DEFAULT 1000
          CHECK (monthly_budget_won >= 0 AND monthly_budget_won <= 10000),
        api_key_ciphertext TEXT,
        api_key_iv TEXT,
        api_key_tag TEXT,
        updated_at TEXT NOT NULL
      );
      INSERT INTO ai_coach_settings (singleton, updated_at) VALUES (1, CURRENT_TIMESTAMP);

      CREATE TABLE ai_coach_usage (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        month TEXT NOT NULL,
        provider TEXT NOT NULL CHECK (provider IN ('gemini', 'openai')),
        model TEXT NOT NULL,
        input_tokens INTEGER NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
        output_tokens INTEGER NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
        estimated_won INTEGER NOT NULL CHECK (estimated_won >= 0),
        created_at TEXT NOT NULL
      );
      CREATE INDEX ai_coach_usage_month_idx ON ai_coach_usage(month);
    `);
  }
} as const;
