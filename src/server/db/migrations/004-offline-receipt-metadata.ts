import type Database from "better-sqlite3";

export const offlineReceiptMetadataMigration = {
  version: 4,
  up(db: Database.Database): void {
    db.exec(`
      CREATE TABLE offline_activity_receipts_v4 (
        student_id TEXT NOT NULL REFERENCES users(id),
        client_event_id TEXT NOT NULL,
        client_batch_id TEXT NOT NULL,
        study_date TEXT NOT NULL,
        item_id TEXT REFERENCES content_items(id),
        kind TEXT NOT NULL,
        status TEXT NOT NULL,
        code TEXT NOT NULL,
        receipt_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE (student_id, client_event_id),
        FOREIGN KEY (student_id, client_batch_id)
          REFERENCES offline_batches(student_id, client_batch_id)
      );
      INSERT INTO offline_activity_receipts_v4 (
        student_id, client_event_id, client_batch_id, study_date,
        item_id, kind, status, code, receipt_json, created_at
      )
      SELECT
        student_id, client_event_id, client_batch_id, study_date,
        item_id, kind, status, code, receipt_json, created_at
      FROM offline_activity_receipts;
      DROP TABLE offline_activity_receipts;
      ALTER TABLE offline_activity_receipts_v4
        RENAME TO offline_activity_receipts;
      CREATE INDEX offline_activity_receipts_guardian_rejection_idx
        ON offline_activity_receipts(student_id, study_date, created_at)
        WHERE status = 'rejected';
    `);
  }
} as const;
