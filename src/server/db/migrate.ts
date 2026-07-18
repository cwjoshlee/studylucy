import type Database from "better-sqlite3";
import { initialMigration } from "./migrations/001-initial";
import { starLedgerMigration } from "./migrations/002-star-ledger";
import { authorityOfflineMigration } from "./migrations/003-authority-offline";
import { offlineReceiptMetadataMigration } from "./migrations/004-offline-receipt-metadata";
import { trustedDeviceTypesMigration } from "./migrations/005-trusted-device-types";
import { aiCoachMigration } from "./migrations/006-ai-coach";
import { stepUpAiStudioMigration } from "./migrations/007-step-up-ai-studio";
import { dictationInputFingerprintMigration } from "./migrations/008-dictation-input-fingerprint";

const migrations = [
  initialMigration,
  starLedgerMigration,
  authorityOfflineMigration,
  offlineReceiptMetadataMigration,
  trustedDeviceTypesMigration,
  aiCoachMigration,
  stepUpAiStudioMigration,
  dictationInputFingerprintMigration
];

function hasMigrationTable(db: Database.Database): boolean {
  return db.prepare(`
    SELECT 1
    FROM sqlite_master
    WHERE type = 'table' AND name = 'schema_migrations'
  `).get() !== undefined;
}

export function migrate(db: Database.Database): void {
  db.pragma("foreign_keys = ON");
  if (db.name !== ":memory:" && db.name !== "") {
    db.pragma("journal_mode = WAL");
  }

  const appliedVersions = hasMigrationTable(db)
    ? new Set(
        db.prepare("SELECT version FROM schema_migrations").all()
          .map((row) => (row as { version: number }).version)
      )
    : new Set<number>();

  for (const migration of migrations) {
    if (appliedVersions.has(migration.version)) {
      continue;
    }

    if ("requiresForeignKeysOff" in migration && migration.requiresForeignKeysOff) {
      db.pragma("foreign_keys = OFF");
      let transactionOpen = false;
      try {
        db.exec("BEGIN");
        transactionOpen = true;
        migration.up(db);
        db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)")
          .run(migration.version, new Date().toISOString());
        const violations = db.pragma("foreign_key_check") as unknown[];
        if (violations.length > 0) {
          throw new Error("MIGRATION_FOREIGN_KEY_CHECK_FAILED");
        }
        db.exec("COMMIT");
        transactionOpen = false;
      } catch (error) {
        if (transactionOpen) db.exec("ROLLBACK");
        throw error;
      } finally {
        db.pragma("foreign_keys = ON");
      }
      continue;
    }

    db.transaction(() => {
      migration.up(db);
      db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)")
        .run(migration.version, new Date().toISOString());
    })();
  }
}
