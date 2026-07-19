import { afterEach, describe, expect, it } from "vitest";
import { AuthRepository } from "../../src/server/auth/repository";
import { openDatabase } from "../../src/server/db/client";
import { migrate } from "../../src/server/db/migrate";
import { initialMigration } from "../../src/server/db/migrations/001-initial";
import { starLedgerMigration } from "../../src/server/db/migrations/002-star-ledger";
import { authorityOfflineMigration } from "../../src/server/db/migrations/003-authority-offline";
import { seedInitialContent } from "../../src/server/db/seed";

function openVersionTwoDatabase() {
  const db = openDatabase(":memory:");
  db.pragma("foreign_keys = ON");
  initialMigration.up(db);
  db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)")
    .run(1, "2026-07-16T00:00:00.000Z");
  starLedgerMigration.up(db);
  db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)")
    .run(2, "2026-07-16T00:00:01.000Z");
  return db;
}

function openVersionThreeDatabase() {
  const db = openVersionTwoDatabase();
  authorityOfflineMigration.up(db);
  db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)")
    .run(3, "2026-07-16T00:00:02.000Z");
  return db;
}

function migrationVersions(db: ReturnType<typeof openDatabase>): number[] {
  return (db.prepare(`
    SELECT version FROM schema_migrations ORDER BY version
  `).all() as Array<{ version: number }>).map(({ version }) => version);
}

describe("database bootstrap", () => {
  const db = openDatabase(":memory:");

  afterEach(() => db.exec("DELETE FROM attempts; DELETE FROM content_versions; DELETE FROM content_items;"));

  it("runs migrations idempotently", () => {
    migrate(db);
    migrate(db);

    expect(migrationVersions(db)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("seeds the exact thirteen Korean and ten math items", () => {
    migrate(db);
    seedInitialContent(db);
    seedInitialContent(db);

    const rows = db.prepare("select subject, count(*) as count from content_items group by subject order by subject").all();
    expect(rows).toEqual([
      { subject: "korean", count: 13 },
      { subject: "math", count: 10 }
    ]);
  });

  it("activates version 4 without rewriting existing v1, v2, or v3 payloads", () => {
    const upgrade = openDatabase(":memory:");
    try {
      migrate(upgrade);
      seedInitialContent(upgrade);
      const v1Before = upgrade.prepare(`
        SELECT payload_json AS payloadJson FROM content_versions
        WHERE item_id = 'math-01' AND version = 1
      `).get() as { payloadJson: string };
      const v2Before = upgrade.prepare(`
        SELECT payload_json AS payloadJson FROM content_versions
        WHERE item_id = 'math-01' AND version = 2
      `).get() as { payloadJson: string };

      upgrade.prepare("UPDATE content_items SET active_version = 1 WHERE id = 'ko-01'").run();
      upgrade.prepare("DELETE FROM content_versions WHERE item_id = 'ko-01' AND version = 2").run();

      seedInitialContent(upgrade);

      expect(upgrade.prepare(`
        SELECT active_version AS activeVersion FROM content_items WHERE id = 'ko-01'
      `).get()).toEqual({ activeVersion: 4 });
      expect(upgrade.prepare(`
        SELECT payload_json AS payloadJson FROM content_versions
        WHERE item_id = 'math-01' AND version = 1
      `).get()).toEqual({ payloadJson: v1Before.payloadJson });
      expect(upgrade.prepare(`
        SELECT payload_json AS payloadJson FROM content_versions
        WHERE item_id = 'math-01' AND version = 2
      `).get()).toEqual({ payloadJson: v2Before.payloadJson });
      expect(upgrade.prepare(`
        SELECT payload_json AS payloadJson FROM content_versions
        WHERE item_id = 'math-01' AND version = 3
      `).get()).not.toEqual({ payloadJson: v2Before.payloadJson });
    } finally {
      upgrade.close();
    }
  });

  it("moves reusable math items to the calculation skill without touching guardian versions", () => {
    const upgrade = openDatabase(":memory:");
    try {
      migrate(upgrade);
      seedInitialContent(upgrade);
      const v1Before = upgrade.prepare(`
        SELECT payload_json AS payloadJson FROM content_versions
        WHERE item_id = 'math-01' AND version = 1
      `).get() as { payloadJson: string };
      const v2Before = upgrade.prepare(`
        SELECT payload_json AS payloadJson FROM content_versions
        WHERE item_id = 'math-01' AND version = 2
      `).get() as { payloadJson: string };
      const guardianPayload = JSON.stringify({ guardian: "kept" });

      upgrade.prepare(`
        UPDATE content_items
        SET skill_id = 'skill-math-story', active_version = 2
        WHERE id = 'math-01'
      `).run();
      upgrade.prepare(`
        INSERT INTO content_versions (item_id, version, payload_json, created_at)
        VALUES ('math-02', 5, ?, '2026-07-18T00:00:00.000Z')
      `).run(guardianPayload);
      upgrade.prepare(`
        UPDATE content_items
        SET skill_id = 'skill-math-story', active_version = 5
        WHERE id = 'math-02'
      `).run();

      seedInitialContent(upgrade);

      expect(upgrade.prepare(`
        SELECT skill_id AS skillId, active_version AS activeVersion
        FROM content_items WHERE id = 'math-01'
      `).get()).toEqual({ skillId: "skill-math-calculation", activeVersion: 4 });
      expect(upgrade.prepare(`
        SELECT payload_json AS payloadJson FROM content_versions
        WHERE item_id = 'math-01' AND version = 1
      `).get()).toEqual(v1Before);
      expect(upgrade.prepare(`
        SELECT payload_json AS payloadJson FROM content_versions
        WHERE item_id = 'math-01' AND version = 2
      `).get()).toEqual(v2Before);
      expect(upgrade.prepare(`
        SELECT skill_id AS skillId, active_version AS activeVersion
        FROM content_items WHERE id = 'math-02'
      `).get()).toEqual({ skillId: "skill-math-story", activeVersion: 5 });
      expect(upgrade.prepare(`
        SELECT payload_json AS payloadJson FROM content_versions
        WHERE item_id = 'math-02' AND version = 5
      `).get()).toEqual({ payloadJson: guardianPayload });
    } finally {
      upgrade.close();
    }
  });

  it("never downgrades a guardian-authored active version", () => {
    const edited = openDatabase(":memory:");
    try {
      migrate(edited);
      seedInitialContent(edited);
      const v2 = edited.prepare(`
        SELECT payload_json AS payloadJson FROM content_versions
        WHERE item_id = 'ko-01' AND version = 2
      `).get() as { payloadJson: string };
      edited.prepare(`
        INSERT INTO content_versions (item_id, version, payload_json, created_at)
        VALUES ('ko-01', 5, ?, '2026-07-17T00:00:00.000Z')
      `).run(v2.payloadJson);
      edited.prepare("UPDATE content_items SET active_version = 5 WHERE id = 'ko-01'").run();

      seedInitialContent(edited);

      expect(edited.prepare(`
        SELECT active_version AS activeVersion FROM content_items WHERE id = 'ko-01'
      `).get()).toEqual({ activeVersion: 5 });
    } finally {
      edited.close();
    }
  });

  it("migrates version-two authority data without rewriting existing records", () => {
    const versionTwo = openVersionTwoDatabase();
    try {
      seedInitialContent(versionTwo);
      versionTwo.exec(`
        INSERT INTO users (id, role, display_name, credential_hash, created_at)
        VALUES
          ('guardian-1', 'guardian', '보호자', 'hash', '2026-07-16T00:00:00.000Z'),
          ('student-1', 'student', '수아', NULL, '2026-07-16T00:00:00.000Z');
        INSERT INTO trusted_devices (id, name, token_hash, created_at)
        VALUES ('device-1', '기존 태블릿', 'token-hash-1', '2026-07-16T00:01:00.000Z');
        INSERT INTO attempts (
          id, client_attempt_id, user_id, item_id, content_version,
          study_date, reading_score, reading_pass, missed_tokens_json,
          math_answer_json, math_pass, duration_ms, difficulty_feedback,
          created_at
        ) VALUES (
          'attempt-1', 'client-attempt-1', 'student-1', 'ko-01', 1,
          '2026-07-16', 91, 1, '[]', NULL, NULL, 8000, 'thinking',
          '2026-07-16T00:02:00.000Z'
        );
        INSERT INTO student_star_balances (student_id, balance, updated_at)
        VALUES ('student-1', 4, '2026-07-16T00:03:00.000Z');
        INSERT INTO star_events (
          id, student_id, requested_delta, delta, balance_after,
          reason_code, reason_text, study_date, item_id, attempt_id,
          idle_event_id, pending_adjustment_id, actor_type, actor_user_id,
          source_key, reverses_event_id, created_at
        ) VALUES (
          'star-1', 'student-1', -1, -1, 4,
          'IDLE_TIMEOUT', '기존 자리비움', '2026-07-16', 'ko-01', 'attempt-1',
          'idle-1', NULL, 'system', NULL,
          'idle:student-1:idle-1', NULL, '2026-07-16T00:03:00.000Z'
        );
        INSERT INTO idle_events (
          id, student_id, study_date, item_id, learning_session_id,
          idle_started_at, occurred_at, outcome, star_event_id, created_at
        ) VALUES (
          'idle-1', 'student-1', '2026-07-16', 'ko-01', 'legacy-session-1',
          '2026-07-16T00:02:00.000Z', '2026-07-16T00:03:00.000Z',
          'applied', 'star-1', '2026-07-16T00:03:00.000Z'
        );
      `);

      const attemptBefore = versionTwo.prepare("SELECT * FROM attempts WHERE id = 'attempt-1'").get();
      const idleBefore = versionTwo.prepare("SELECT * FROM idle_events WHERE id = 'idle-1'").get();
      const starBefore = versionTwo.prepare("SELECT * FROM star_events WHERE id = 'star-1'").get();

      migrate(versionTwo);
      migrate(versionTwo);

      expect(migrationVersions(versionTwo)).toEqual([
        1, 2, 3, 4, 5, 6, 7, 8, 9
      ]);
      const deviceColumns = versionTwo.prepare("PRAGMA table_info('trusted_devices')").all()
        .map((column) => (column as { name: string }).name);
      expect(deviceColumns).toEqual(expect.arrayContaining([
        "public_id", "last_used_at", "device_type"
      ]));
      expect(versionTwo.prepare(`
        SELECT device_type AS deviceType FROM trusted_devices WHERE id = 'device-1'
      `).get()).toEqual({ deviceType: null });
      expect(() => versionTwo.prepare(`
        UPDATE trusted_devices SET device_type = 'tv' WHERE id = 'device-1'
      `).run()).toThrow();
      const attemptColumns = versionTwo.prepare("PRAGMA table_info('attempts')").all()
        .map((column) => (column as { name: string }).name);
      expect(attemptColumns).toEqual(expect.arrayContaining([
        "issued_plan_id", "occurred_at", "dictation_input_fingerprint"
      ]));

      const publicId = (versionTwo.prepare(`
        SELECT public_id AS publicId FROM trusted_devices WHERE id = 'device-1'
      `).get() as { publicId: string }).publicId;
      expect(publicId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      expect(() => versionTwo.prepare(`
        UPDATE trusted_devices SET public_id = '' WHERE id = 'device-1'
      `).run()).toThrow(/TRUSTED_DEVICE_PUBLIC_ID_REQUIRED/);

      const repository = new AuthRepository(versionTwo);
      repository.createTrustedDevice({
        id: "device-2",
        name: "호환 태블릿",
        tokenHash: "token-hash-2",
        deviceType: "tablet",
        createdAt: "2026-07-16T00:04:00.000Z"
      });
      const publicIds = versionTwo.prepare(`
        SELECT public_id AS publicId FROM trusted_devices ORDER BY id
      `).all() as Array<{ publicId: string }>;
      expect(publicIds).toHaveLength(2);
      expect(publicIds.every(({ publicId: value }) => value.length > 0)).toBe(true);
      expect(new Set(publicIds.map(({ publicId: value }) => value)).size).toBe(2);

      const attemptAfter = versionTwo.prepare(`
        SELECT id, client_attempt_id, user_id, item_id, content_version,
               study_date, reading_score, reading_pass, missed_tokens_json,
               math_answer_json, math_pass, duration_ms, difficulty_feedback,
               created_at
        FROM attempts WHERE id = 'attempt-1'
      `).get();
      expect(attemptAfter).toEqual(attemptBefore);
      expect(versionTwo.prepare(`
        SELECT issued_plan_id AS issuedPlanId, occurred_at AS occurredAt
        FROM attempts WHERE id = 'attempt-1'
      `).get()).toEqual({ issuedPlanId: null, occurredAt: null });
      expect(versionTwo.prepare("SELECT * FROM idle_events WHERE id = 'idle-1'").get())
        .toEqual(idleBefore);
      expect(versionTwo.prepare("SELECT * FROM star_events WHERE id = 'star-1'").get())
        .toEqual(starBefore);

      expect(() => versionTwo.prepare(`
        INSERT INTO idle_events (
          id, student_id, study_date, item_id, learning_session_id,
          idle_started_at, occurred_at, outcome, star_event_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        "idle-waived-1", "student-1", "2026-07-16", "ko-01", null,
        "2026-07-16T00:05:00.000Z", "2026-07-16T00:06:00.000Z",
        "order-conflict-waived", null, "2026-07-16T00:06:00.000Z"
      )).not.toThrow();
      expect(() => versionTwo.prepare(`
        INSERT INTO idle_events (
          id, student_id, study_date, item_id, learning_session_id,
          idle_started_at, occurred_at, outcome, star_event_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        "idle-invalid-1", "student-1", "2026-07-16", "ko-01", null,
        "2026-07-16T00:05:00.000Z", "2026-07-16T00:06:00.000Z",
        "applied", null, "2026-07-16T00:06:00.000Z"
      )).toThrow(/CHECK constraint failed/);

      const authorityTables = versionTwo.prepare(`
        SELECT name FROM sqlite_master
        WHERE type = 'table' AND name IN (
          'issued_daily_plans', 'issued_plan_items', 'issued_learning_sessions',
          'student_activity_cursors', 'offline_batches',
          'offline_activity_receipts'
        ) ORDER BY name
      `).all().map((row) => (row as { name: string }).name);
      expect(authorityTables).toEqual([
        "issued_daily_plans",
        "issued_learning_sessions",
        "issued_plan_items",
        "offline_activity_receipts",
        "offline_batches",
        "student_activity_cursors"
      ]);
    } finally {
      versionTwo.close();
    }
  });

  it("migrates version-three offline receipts to nullable authoritative item metadata without losing constraints", () => {
    const versionThree = openVersionThreeDatabase();
    try {
      seedInitialContent(versionThree);
      versionThree.exec(`
        INSERT INTO users (id, role, display_name, credential_hash, created_at)
        VALUES ('student-v3', 'student', '수아', NULL, '2026-07-16T00:00:00.000Z');
        INSERT INTO trusted_devices (
          id, name, token_hash, created_at, public_id, last_used_at
        ) VALUES (
          'device-v3', '기존 태블릿', 'device-token-v3',
          '2026-07-16T00:00:00.000Z', 'device-public-v3', NULL
        );
        INSERT INTO student_activity_cursors (
          student_id, next_epoch, current_cursor, updated_at
        ) VALUES ('student-v3', 2, 1, '2026-07-16T00:00:00.000Z');
        INSERT INTO issued_daily_plans (
          id, student_id, trusted_device_id, plan_kind,
          recovery_source_plan_id, study_date, issued_at, submit_until,
          offline_epoch, start_cursor
        ) VALUES (
          'plan-v3', 'student-v3', 'device-v3', 'daily', NULL,
          '2026-07-16', '2026-07-16T00:00:00.000Z',
          '2026-07-17T00:00:00.000Z', 1, 0
        );
        INSERT INTO offline_batches (
          client_batch_id, request_fingerprint, student_id,
          original_device_id, submitting_device_id, plan_id, offline_epoch,
          start_cursor, end_cursor, outcome, response_json, created_at
        ) VALUES (
          'batch-v3-existing', 'fingerprint-v3', 'student-v3',
          'device-v3', 'device-v3', 'plan-v3', 1, 0, 1,
          'applied', '{}', '2026-07-16T00:01:00.000Z'
        );
        INSERT INTO offline_activity_receipts (
          student_id, client_event_id, client_batch_id, study_date,
          item_id, kind, status, code, receipt_json, created_at
        ) VALUES (
          'student-v3', 'event-v3-existing', 'batch-v3-existing',
          '2026-07-16', 'ko-01', 'attempt', 'rejected',
          'CONTENT_VERSION_CONFLICT', '{}', '2026-07-16T00:01:00.000Z'
        );
      `);
      const receiptBefore = versionThree.prepare(`
        SELECT * FROM offline_activity_receipts
        WHERE client_event_id = 'event-v3-existing'
      `).get();

      migrate(versionThree);
      migrate(versionThree);

      expect(migrationVersions(versionThree)).toEqual([
        1, 2, 3, 4, 5, 6, 7, 8, 9
      ]);
      expect(versionThree.prepare(`
        SELECT * FROM offline_activity_receipts
        WHERE client_event_id = 'event-v3-existing'
      `).get()).toEqual(receiptBefore);
      const itemColumn = versionThree.prepare(`
        PRAGMA table_info('offline_activity_receipts')
      `).all().find((column) =>
        (column as { name: string }).name === "item_id"
      ) as { notnull: number };
      expect(itemColumn.notnull).toBe(0);
      expect(versionThree.prepare(`
        SELECT sql FROM sqlite_master
        WHERE type = 'index'
          AND name = 'offline_activity_receipts_guardian_rejection_idx'
      `).get()).toEqual({
        sql: expect.stringContaining("WHERE status = 'rejected'")
      });
      expect(versionThree.prepare("PRAGMA foreign_key_check").all()).toEqual([]);

      expect(() => versionThree.prepare(`
        INSERT INTO offline_activity_receipts (
          student_id, client_event_id, client_batch_id, study_date,
          item_id, kind, status, code, receipt_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        "student-v3", "event-v3-null-item", "batch-v3-existing",
        "2026-07-16", null, "attempt", "rejected", "PLAN_NOT_ISSUED",
        "{}", "2026-07-16T00:02:00.000Z"
      )).not.toThrow();
      expect(() => versionThree.prepare(`
        INSERT INTO offline_activity_receipts (
          student_id, client_event_id, client_batch_id, study_date,
          item_id, kind, status, code, receipt_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        "student-v3", "event-v3-missing-item", "batch-v3-existing",
        "2026-07-16", "missing-content-item", "attempt", "rejected",
        "PLAN_NOT_ISSUED", "{}", "2026-07-16T00:03:00.000Z"
      )).toThrow(/FOREIGN KEY constraint failed/);
    } finally {
      versionThree.close();
    }
  });
});
