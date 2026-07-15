import type Database from "better-sqlite3";
import { initialMigration } from "./migrations/001-initial";
import { starLedgerMigration } from "./migrations/002-star-ledger";

const migrations = [initialMigration, starLedgerMigration];

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

    db.transaction(() => {
      migration.up(db);
      db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)")
        .run(migration.version, new Date().toISOString());
    })();
  }
}
