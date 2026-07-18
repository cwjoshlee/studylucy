import type Database from "better-sqlite3";

export const dictationInputFingerprintMigration = {
  version: 8,
  up(db: Database.Database): void {
    db.exec(`
      ALTER TABLE attempts ADD COLUMN dictation_input_fingerprint TEXT
        CHECK (
          dictation_input_fingerprint IS NULL OR (
            length(dictation_input_fingerprint) = 64 AND
            dictation_input_fingerprint NOT GLOB '*[^0-9a-f]*'
          )
        );
    `);
  }
} as const;
