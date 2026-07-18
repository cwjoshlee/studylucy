import type Database from "better-sqlite3";

export const stepUpAiStudioMigration = {
  version: 7,
  requiresForeignKeysOff: true,
  up(db: Database.Database): void {
    db.exec(`
      ALTER TABLE daily_requirements ADD COLUMN step TEXT NOT NULL DEFAULT 'current'
        CHECK (step IN ('foundation', 'current', 'challenge'));
      ALTER TABLE issued_plan_items ADD COLUMN step TEXT NOT NULL DEFAULT 'current'
        CHECK (step IN ('foundation', 'current', 'challenge'));
      ALTER TABLE attempts ADD COLUMN completed INTEGER NOT NULL DEFAULT 0
        CHECK (completed IN (0, 1));
      ALTER TABLE attempts ADD COLUMN dictation_pass INTEGER
        CHECK (dictation_pass IS NULL OR dictation_pass IN (0, 1));
      UPDATE attempts SET completed = CASE
        WHEN reading_pass = 1 AND (math_pass IS NULL OR math_pass = 1) THEN 1 ELSE 0 END;

      CREATE TABLE daily_step_settings (
        student_id TEXT NOT NULL REFERENCES users(id),
        study_date TEXT NOT NULL,
        subject TEXT NOT NULL CHECK (subject IN ('korean', 'math')),
        difficulty INTEGER NOT NULL DEFAULT 3 CHECK (difficulty BETWEEN 1 AND 5),
        challenge_bonus_stars INTEGER NOT NULL DEFAULT 2
          CHECK (challenge_bonus_stars BETWEEN 0 AND 5),
        PRIMARY KEY (student_id, study_date, subject)
      );
      CREATE TABLE ai_provider_settings (
        provider TEXT PRIMARY KEY CHECK (provider IN ('gemini', 'openai')),
        enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
        model TEXT NOT NULL,
        api_key_ciphertext TEXT,
        api_key_iv TEXT,
        api_key_tag TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE ai_generation_drafts (
        id TEXT PRIMARY KEY,
        subject TEXT NOT NULL CHECK (subject IN ('korean', 'math')),
        step TEXT NOT NULL CHECK (step IN ('foundation', 'current', 'challenge')),
        requested_count INTEGER NOT NULL CHECK (requested_count BETWEEN 2 AND 40),
        difficulty INTEGER NOT NULL CHECK (difficulty BETWEEN 1 AND 5),
        weak_topics_json TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('draft', 'failed', 'published')),
        created_at TEXT NOT NULL,
        published_at TEXT
      );
      CREATE TABLE ai_generation_items (
        id TEXT PRIMARY KEY,
        draft_id TEXT NOT NULL REFERENCES ai_generation_drafts(id),
        source_provider TEXT NOT NULL CHECK (source_provider IN ('gemini', 'openai')),
        payload_json TEXT NOT NULL,
        review_json TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('accepted', 'rejected', 'edited', 'published')),
        sort_order INTEGER NOT NULL
      );

      DROP TRIGGER star_events_append_only_update;
      DROP TRIGGER star_events_append_only_delete;
      CREATE TABLE star_events_step_up (
        id TEXT PRIMARY KEY,
        student_id TEXT NOT NULL REFERENCES users(id),
        requested_delta INTEGER NOT NULL,
        delta INTEGER NOT NULL,
        balance_after INTEGER NOT NULL CHECK (balance_after >= 0),
        reason_code TEXT NOT NULL CHECK (reason_code IN (
          'REQUIRED_ITEM_COMPLETED','IDLE_TIMEOUT','MISSED_DAILY_PLAN',
          'GUARDIAN_BONUS','GUARDIAN_ADJUSTMENT','REWARD_REDEMPTION',
          'REVERSAL','NO_BALANCE_AUDIT','CHALLENGE_PERFECT'
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
        reverses_event_id TEXT UNIQUE REFERENCES star_events_step_up(id),
        created_at TEXT NOT NULL,
        CHECK ((reason_code = 'REVERSAL') = (reverses_event_id IS NOT NULL))
      );
      INSERT INTO star_events_step_up (
        id, student_id, requested_delta, delta, balance_after, reason_code,
        reason_text, study_date, item_id, attempt_id, idle_event_id,
        pending_adjustment_id, actor_type, actor_user_id, source_key,
        reverses_event_id, created_at
      ) SELECT
        id, student_id, requested_delta, delta, balance_after, reason_code,
        reason_text, study_date, item_id, attempt_id, idle_event_id,
        pending_adjustment_id, actor_type, actor_user_id, source_key,
        reverses_event_id, created_at
      FROM star_events;
      DROP TABLE star_events;
      ALTER TABLE star_events_step_up RENAME TO star_events;
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
      CREATE INDEX star_events_student_date_created_idx
        ON star_events(student_id, study_date, created_at);
    `);
  }
} as const;
