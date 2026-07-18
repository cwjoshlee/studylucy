import type Database from "better-sqlite3";

export const starLedgerMigration = {
  version: 2,
  up(db: Database.Database): void {
    db.exec(`
      CREATE TABLE student_star_balances (
        student_id TEXT PRIMARY KEY REFERENCES users(id),
        balance INTEGER NOT NULL CHECK (balance >= 0),
        updated_at TEXT NOT NULL
      );
      CREATE TABLE daily_plan_settings (
        student_id TEXT NOT NULL REFERENCES users(id),
        study_date TEXT NOT NULL,
        korean_target INTEGER NOT NULL DEFAULT 2 CHECK (korean_target BETWEEN 0 AND 10),
        math_target INTEGER NOT NULL DEFAULT 2 CHECK (math_target BETWEEN 0 AND 10),
        is_rest_day INTEGER NOT NULL DEFAULT 0 CHECK (is_rest_day IN (0,1)),
        updated_by TEXT REFERENCES users(id),
        updated_at TEXT NOT NULL,
        PRIMARY KEY (student_id, study_date)
      );
      CREATE TABLE daily_requirements (
        student_id TEXT NOT NULL REFERENCES users(id),
        study_date TEXT NOT NULL,
        item_id TEXT NOT NULL REFERENCES content_items(id),
        subject TEXT NOT NULL CHECK (subject IN ('korean','math')),
        sort_order INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (student_id, study_date, item_id)
      );
      CREATE TABLE star_events (
        id TEXT PRIMARY KEY,
        student_id TEXT NOT NULL REFERENCES users(id),
        requested_delta INTEGER NOT NULL,
        delta INTEGER NOT NULL,
        balance_after INTEGER NOT NULL CHECK (balance_after >= 0),
        reason_code TEXT NOT NULL CHECK (reason_code IN (
          'REQUIRED_ITEM_COMPLETED','IDLE_TIMEOUT','MISSED_DAILY_PLAN',
          'GUARDIAN_BONUS','GUARDIAN_ADJUSTMENT','REWARD_REDEMPTION',
          'REVERSAL','NO_BALANCE_AUDIT'
        )),
        reason_text TEXT NOT NULL,
        study_date TEXT NOT NULL,
        item_id TEXT REFERENCES content_items(id),
        attempt_id TEXT REFERENCES attempts(id),
        idle_event_id TEXT,
        pending_adjustment_id TEXT,
        actor_type TEXT NOT NULL CHECK (actor_type IN ('system','guardian')),
        actor_user_id TEXT REFERENCES users(id),
        source_key TEXT NOT NULL UNIQUE,
        reverses_event_id TEXT UNIQUE REFERENCES star_events(id),
        created_at TEXT NOT NULL,
        CHECK ((reason_code = 'REVERSAL') = (reverses_event_id IS NOT NULL))
      );
      CREATE TRIGGER star_events_append_only_update
      BEFORE UPDATE ON star_events
      BEGIN
        SELECT RAISE(ABORT, 'STAR_EVENTS_APPEND_ONLY');
      END;
      CREATE TRIGGER star_events_append_only_delete
      BEFORE DELETE ON star_events
      BEGIN
        SELECT RAISE(ABORT, 'STAR_EVENTS_APPEND_ONLY');
      END;
      CREATE TABLE attempt_star_receipts (
        attempt_id TEXT PRIMARY KEY REFERENCES attempts(id),
        awarded INTEGER NOT NULL CHECK (awarded IN (0,1)),
        amount INTEGER NOT NULL CHECK (amount IN (0,1)),
        balance INTEGER NOT NULL CHECK (balance >= 0),
        event_id TEXT REFERENCES star_events(id),
        CHECK (
          (awarded = 1 AND amount = 1 AND event_id IS NOT NULL)
          OR (awarded = 0 AND amount = 0)
        )
      );
      INSERT INTO attempt_star_receipts (
        attempt_id, awarded, amount, balance, event_id
      )
      SELECT id, 0, 0, 0, NULL FROM attempts;
      CREATE TABLE idle_events (
        id TEXT PRIMARY KEY,
        student_id TEXT NOT NULL REFERENCES users(id),
        study_date TEXT NOT NULL,
        item_id TEXT NOT NULL REFERENCES content_items(id),
        learning_session_id TEXT NOT NULL,
        idle_started_at TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        outcome TEXT NOT NULL CHECK (outcome IN ('applied','capped','no-balance')),
        star_event_id TEXT REFERENCES star_events(id),
        created_at TEXT NOT NULL,
        UNIQUE (student_id, id)
      );
      CREATE TABLE pending_star_adjustments (
        id TEXT PRIMARY KEY,
        student_id TEXT NOT NULL REFERENCES users(id),
        study_date TEXT NOT NULL,
        item_id TEXT NOT NULL REFERENCES content_items(id),
        requested_stars INTEGER NOT NULL CHECK (requested_stars BETWEEN 1 AND 2),
        approved_stars INTEGER CHECK (approved_stars BETWEEN 0 AND 2),
        applied_stars INTEGER CHECK (applied_stars BETWEEN 0 AND 2),
        status TEXT NOT NULL CHECK (status IN ('pending','approved','waived')),
        processed_by TEXT REFERENCES users(id),
        note TEXT,
        star_event_id TEXT REFERENCES star_events(id),
        created_at TEXT NOT NULL,
        processed_at TEXT,
        UNIQUE (student_id, study_date, item_id)
      );
      CREATE INDEX star_events_student_date_created_idx
        ON star_events(student_id, study_date, created_at);
      CREATE INDEX pending_star_adjustments_student_status_date_idx
        ON pending_star_adjustments(student_id, status, study_date);
    `);
  }
} as const;
