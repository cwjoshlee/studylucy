import type Database from "better-sqlite3";

export const aiStudioBudgetRatesMigration = {
  version: 9,
  up(db: Database.Database): void {
    db.exec(`
      ALTER TABLE ai_provider_settings ADD COLUMN input_won_per_1k INTEGER NOT NULL DEFAULT 1
        CHECK (input_won_per_1k >= 0 AND input_won_per_1k <= 1000000);
      ALTER TABLE ai_provider_settings ADD COLUMN output_won_per_1k INTEGER NOT NULL DEFAULT 4
        CHECK (output_won_per_1k >= 0 AND output_won_per_1k <= 1000000);

      ALTER TABLE ai_coach_usage ADD COLUMN reserved_input_tokens INTEGER NOT NULL DEFAULT 0
        CHECK (reserved_input_tokens >= 0);
      ALTER TABLE ai_coach_usage ADD COLUMN reserved_output_tokens INTEGER NOT NULL DEFAULT 0
        CHECK (reserved_output_tokens >= 0);
      ALTER TABLE ai_coach_usage ADD COLUMN input_won_per_1k INTEGER NOT NULL DEFAULT 0
        CHECK (input_won_per_1k >= 0);
      ALTER TABLE ai_coach_usage ADD COLUMN output_won_per_1k INTEGER NOT NULL DEFAULT 0
        CHECK (output_won_per_1k >= 0);
    `);
  }
} as const;
