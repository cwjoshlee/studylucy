import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";

export const authorityOfflineMigration = {
  version: 3,
  up(db: Database.Database): void {
    db.exec(`
      ALTER TABLE trusted_devices ADD COLUMN public_id TEXT;
      ALTER TABLE trusted_devices ADD COLUMN last_used_at TEXT;
    `);

    const activeDevices = db.prepare(`
      SELECT id FROM trusted_devices WHERE public_id IS NULL OR public_id = ''
    `).all() as Array<{ id: string }>;
    const setPublicId = db.prepare(`
      UPDATE trusted_devices SET public_id = ? WHERE id = ?
    `);
    for (const device of activeDevices) {
      setPublicId.run(randomUUID(), device.id);
    }

    db.exec(`
      CREATE UNIQUE INDEX trusted_devices_public_id_idx
        ON trusted_devices(public_id)
        WHERE public_id IS NOT NULL AND public_id <> '';
      CREATE TRIGGER trusted_devices_fill_public_id
      AFTER INSERT ON trusted_devices
      FOR EACH ROW
      WHEN NEW.public_id IS NULL OR trim(NEW.public_id) = ''
      BEGIN
        UPDATE trusted_devices
        SET public_id = lower(hex(randomblob(16)))
        WHERE id = NEW.id;
      END;
      CREATE TRIGGER trusted_devices_keep_public_id
      BEFORE UPDATE OF public_id ON trusted_devices
      FOR EACH ROW
      WHEN OLD.public_id IS NOT NULL
        AND trim(OLD.public_id) <> ''
        AND (NEW.public_id IS NULL OR trim(NEW.public_id) = '')
      BEGIN
        SELECT RAISE(ABORT, 'TRUSTED_DEVICE_PUBLIC_ID_REQUIRED');
      END;

      ALTER TABLE attempts ADD COLUMN issued_plan_id TEXT;
      ALTER TABLE attempts ADD COLUMN occurred_at TEXT;

      ALTER TABLE idle_events RENAME TO idle_events_v2;
      CREATE TABLE idle_events (
        id TEXT PRIMARY KEY,
        student_id TEXT NOT NULL REFERENCES users(id),
        study_date TEXT NOT NULL,
        item_id TEXT NOT NULL REFERENCES content_items(id),
        learning_session_id TEXT,
        idle_started_at TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        outcome TEXT NOT NULL CHECK (outcome IN (
          'applied','capped','no-balance','order-conflict-waived'
        )),
        star_event_id TEXT REFERENCES star_events(id),
        created_at TEXT NOT NULL,
        UNIQUE (student_id, id),
        CHECK (
          (outcome = 'order-conflict-waived')
          OR learning_session_id IS NOT NULL
        )
      );
      INSERT INTO idle_events (
        id, student_id, study_date, item_id, learning_session_id,
        idle_started_at, occurred_at, outcome, star_event_id, created_at
      )
      SELECT
        id, student_id, study_date, item_id, learning_session_id,
        idle_started_at, occurred_at, outcome, star_event_id, created_at
      FROM idle_events_v2;
      DROP TABLE idle_events_v2;

      CREATE TABLE issued_daily_plans (
        id TEXT PRIMARY KEY,
        student_id TEXT NOT NULL REFERENCES users(id),
        trusted_device_id TEXT NOT NULL REFERENCES trusted_devices(id),
        plan_kind TEXT NOT NULL CHECK (plan_kind IN ('daily','recovery')),
        recovery_source_plan_id TEXT REFERENCES issued_daily_plans(id),
        study_date TEXT NOT NULL,
        issued_at TEXT NOT NULL,
        submit_until TEXT NOT NULL,
        offline_epoch INTEGER NOT NULL CHECK (offline_epoch > 0),
        start_cursor INTEGER NOT NULL CHECK (start_cursor >= 0),
        CHECK ((plan_kind = 'recovery') = (recovery_source_plan_id IS NOT NULL))
      );
      CREATE TABLE issued_plan_items (
        plan_id TEXT NOT NULL REFERENCES issued_daily_plans(id),
        item_id TEXT NOT NULL REFERENCES content_items(id),
        content_version INTEGER NOT NULL,
        is_required INTEGER NOT NULL CHECK (is_required IN (0,1)),
        sort_order INTEGER NOT NULL,
        PRIMARY KEY (plan_id, item_id),
        FOREIGN KEY (item_id, content_version) REFERENCES content_versions(item_id, version)
      );
      CREATE TABLE issued_learning_sessions (
        id TEXT PRIMARY KEY,
        plan_id TEXT NOT NULL REFERENCES issued_daily_plans(id),
        student_id TEXT NOT NULL REFERENCES users(id),
        trusted_device_id TEXT NOT NULL REFERENCES trusted_devices(id),
        item_id TEXT NOT NULL,
        content_version INTEGER NOT NULL,
        study_date TEXT NOT NULL,
        issued_at TEXT NOT NULL,
        active_until TEXT NOT NULL,
        submit_until TEXT NOT NULL,
        revoked_at TEXT,
        FOREIGN KEY (plan_id, item_id) REFERENCES issued_plan_items(plan_id, item_id)
      );
      CREATE TABLE student_activity_cursors (
        student_id TEXT PRIMARY KEY REFERENCES users(id),
        next_epoch INTEGER NOT NULL CHECK (next_epoch > 0),
        current_cursor INTEGER NOT NULL CHECK (current_cursor >= 0),
        updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX issued_daily_plan_one_daily_idx
        ON issued_daily_plans(student_id, trusted_device_id, study_date)
        WHERE plan_kind = 'daily';
      CREATE UNIQUE INDEX issued_daily_plan_one_recovery_idx
        ON issued_daily_plans(student_id, trusted_device_id, recovery_source_plan_id)
        WHERE plan_kind = 'recovery';

      CREATE TABLE offline_batches (
        client_batch_id TEXT NOT NULL,
        request_fingerprint TEXT NOT NULL,
        student_id TEXT NOT NULL REFERENCES users(id),
        original_device_id TEXT NOT NULL REFERENCES trusted_devices(id),
        submitting_device_id TEXT NOT NULL REFERENCES trusted_devices(id),
        plan_id TEXT NOT NULL REFERENCES issued_daily_plans(id),
        offline_epoch INTEGER NOT NULL CHECK (offline_epoch > 0),
        start_cursor INTEGER NOT NULL CHECK (start_cursor >= 0),
        end_cursor INTEGER NOT NULL CHECK (end_cursor >= start_cursor),
        outcome TEXT NOT NULL,
        response_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE (student_id, client_batch_id)
      );
      CREATE TABLE offline_activity_receipts (
        student_id TEXT NOT NULL REFERENCES users(id),
        client_event_id TEXT NOT NULL,
        client_batch_id TEXT NOT NULL,
        study_date TEXT NOT NULL,
        item_id TEXT NOT NULL REFERENCES content_items(id),
        kind TEXT NOT NULL,
        status TEXT NOT NULL,
        code TEXT NOT NULL,
        receipt_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE (student_id, client_event_id),
        FOREIGN KEY (student_id, client_batch_id)
          REFERENCES offline_batches(student_id, client_batch_id)
      );

      CREATE INDEX sessions_active_device_idx
        ON sessions(trusted_device_id, expires_at)
        WHERE trusted_device_id IS NOT NULL;
      CREATE INDEX issued_daily_plans_lookup_idx
        ON issued_daily_plans(student_id, trusted_device_id, study_date, issued_at);
      CREATE INDEX issued_learning_sessions_active_idx
        ON issued_learning_sessions(
          student_id, trusted_device_id, plan_id, active_until, submit_until
        ) WHERE revoked_at IS NULL;
      CREATE INDEX offline_activity_receipts_guardian_rejection_idx
        ON offline_activity_receipts(student_id, study_date, created_at)
        WHERE status = 'rejected';
    `);
  }
} as const;
