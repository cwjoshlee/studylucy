import type Database from "better-sqlite3";

export const initialMigration = {
  version: 1,
  up(db: Database.Database): void {
    db.exec(`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        role TEXT NOT NULL CHECK (role IN ('guardian','student')),
        display_name TEXT NOT NULL,
        credential_hash TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE trusted_devices (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        revoked_at TEXT
      );
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        token_hash TEXT NOT NULL UNIQUE,
        user_id TEXT NOT NULL REFERENCES users(id),
        trusted_device_id TEXT REFERENCES trusted_devices(id),
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE auth_failures (
        key TEXT PRIMARY KEY,
        failure_count INTEGER NOT NULL,
        locked_until TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE curriculum_nodes (
        id TEXT PRIMARY KEY,
        parent_id TEXT REFERENCES curriculum_nodes(id),
        kind TEXT NOT NULL CHECK (kind IN ('grade','subject','unit','skill')),
        code TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        sort_order INTEGER NOT NULL
      );
      CREATE TABLE content_items (
        id TEXT PRIMARY KEY,
        skill_id TEXT NOT NULL REFERENCES curriculum_nodes(id),
        subject TEXT NOT NULL CHECK (subject IN ('korean','math')),
        status TEXT NOT NULL CHECK (status IN ('published','archived')) DEFAULT 'published',
        active_version INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE content_versions (
        item_id TEXT NOT NULL REFERENCES content_items(id),
        version INTEGER NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (item_id, version)
      );
      CREATE TABLE attempts (
        id TEXT PRIMARY KEY,
        client_attempt_id TEXT NOT NULL UNIQUE,
        user_id TEXT NOT NULL REFERENCES users(id),
        item_id TEXT NOT NULL REFERENCES content_items(id),
        content_version INTEGER NOT NULL,
        study_date TEXT NOT NULL,
        reading_score INTEGER NOT NULL CHECK (reading_score BETWEEN 0 AND 100),
        reading_pass INTEGER NOT NULL CHECK (reading_pass IN (0,1)),
        missed_tokens_json TEXT NOT NULL DEFAULT '[]',
        math_answer_json TEXT,
        math_pass INTEGER CHECK (math_pass IS NULL OR math_pass IN (0,1)),
        duration_ms INTEGER NOT NULL CHECK (duration_ms >= 0),
        difficulty_feedback TEXT CHECK (difficulty_feedback IS NULL OR difficulty_feedback IN ('easy','thinking','hard')),
        created_at TEXT NOT NULL,
        FOREIGN KEY (item_id, content_version) REFERENCES content_versions(item_id, version)
      );
      CREATE TABLE backup_runs (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL CHECK (status IN ('success','failure')),
        path TEXT,
        error_code TEXT,
        created_at TEXT NOT NULL
      );
    `);
  }
} as const;
