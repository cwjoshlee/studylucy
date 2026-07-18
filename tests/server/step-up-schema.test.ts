import { describe, expect, it } from "vitest";
import { openDatabase } from "../../src/server/db/client";
import { migrate } from "../../src/server/db/migrate";
import { initialMigration } from "../../src/server/db/migrations/001-initial";
import { starLedgerMigration } from "../../src/server/db/migrations/002-star-ledger";
import { authorityOfflineMigration } from "../../src/server/db/migrations/003-authority-offline";
import { offlineReceiptMetadataMigration } from "../../src/server/db/migrations/004-offline-receipt-metadata";
import { trustedDeviceTypesMigration } from "../../src/server/db/migrations/005-trusted-device-types";
import { aiCoachMigration } from "../../src/server/db/migrations/006-ai-coach";
import {
  AttemptInputSchema,
  KoreanDictationItemSchema,
  LearningStepSchema,
  TodayPlanSchema
} from "../../src/shared/learning";

const legacyPayload = {
  id: "ko-01",
  kind: "korean-reading",
  subject: "korean",
  unit: "동화 읽기",
  title: "작은 씨앗",
  level: "1단계",
  readLabel: "읽어 보기",
  text: "작은 씨앗이 자라요.",
  hint: "천천히 읽어요.",
  tokens: ["작은 씨앗", "자라요"]
};

describe("step-up learning schema", () => {
  it("defaults legacy today-plan items to the current step", () => {
    const parsed = TodayPlanSchema.parse({
      planId: "plan-01",
      planKind: "daily",
      recoverySourcePlanId: null,
      date: "2026-07-18",
      submitUntil: "2026-07-18T14:59:59.999Z",
      offlineEpoch: 1,
      activityCursor: 0,
      studentDisplayName: "수아",
      completedItemIds: [],
      requiredItemIds: ["ko-01"],
      stars: { balance: 0, earnedToday: 0, deductedToday: 0, lastReason: null },
      items: [{ id: "ko-01", version: 1, payload: legacyPayload }]
    });

    expect(LearningStepSchema.options).toEqual([
      "foundation", "current", "challenge"
    ]);
    expect(parsed.items[0]?.step).toBe("current");
  });

  it("accepts only word and sentence dictation targets", () => {
    const item = {
      ...legacyPayload,
      kind: "korean-dictation",
      promptText: "씨앗",
      answerText: "씨앗"
    };

    expect(KoreanDictationItemSchema.parse({ ...item, mode: "word" }).mode)
      .toBe("word");
    expect(KoreanDictationItemSchema.safeParse({ ...item, mode: "paragraph" }).success)
      .toBe(false);
  });

  it("keeps raw dictation text request-only", () => {
    const parsed = AttemptInputSchema.parse({
      clientAttemptId: "step-up-attempt-0001",
      planId: "plan-01",
      itemId: "ko-01",
      contentVersion: 1,
      studyDate: "2026-07-18",
      occurredAt: "2026-07-18T01:00:00.000Z",
      readingScore: 100,
      missedTokens: [],
      mathAnswer: null,
      durationMs: 1000,
      difficultyFeedback: null,
      dictationText: "씨앗"
    });

    expect(parsed.dictationText).toBe("씨앗");
  });

  it("keeps legacy daily, issued, attempt, star, and coach rows readable", () => {
    const db = openDatabase(":memory:");
    try {
      const migrations = [
        initialMigration,
        starLedgerMigration,
        authorityOfflineMigration,
        offlineReceiptMetadataMigration,
        trustedDeviceTypesMigration,
        aiCoachMigration
      ];
      for (const migration of migrations) {
        migration.up(db);
        db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)")
          .run(migration.version, "2026-07-18T00:00:00.000Z");
      }
      db.exec(`
        INSERT INTO users (id, role, display_name, created_at)
        VALUES ('student-1', 'student', '수아', '2026-07-18T00:00:00.000Z');
        INSERT INTO curriculum_nodes (id, parent_id, kind, code, title, sort_order)
        VALUES ('skill-1', NULL, 'skill', 'skill-1', '기초', 1);
        INSERT INTO content_items (id, skill_id, subject, active_version, created_at)
        VALUES ('math-01', 'skill-1', 'math', 1, '2026-07-18T00:00:00.000Z');
        INSERT INTO content_versions (item_id, version, payload_json, created_at)
        VALUES ('math-01', 1, '{}', '2026-07-18T00:00:00.000Z');
        INSERT INTO trusted_devices (id, name, token_hash, created_at)
        VALUES ('device-1', '태블릿', 'token-1', '2026-07-18T00:00:00.000Z');
        INSERT INTO daily_requirements (student_id, study_date, item_id, subject, sort_order, created_at)
        VALUES ('student-1', '2026-07-18', 'math-01', 'math', 1, '2026-07-18T00:00:00.000Z');
        INSERT INTO issued_daily_plans (
          id, student_id, trusted_device_id, plan_kind, recovery_source_plan_id,
          study_date, issued_at, submit_until, offline_epoch, start_cursor
        ) VALUES (
          'plan-01', 'student-1', 'device-1', 'daily', NULL,
          '2026-07-18', '2026-07-18T00:00:00.000Z', '2026-07-18T14:59:59.999Z', 1, 0
        );
        INSERT INTO issued_plan_items (plan_id, item_id, content_version, is_required, sort_order)
        VALUES ('plan-01', 'math-01', 1, 1, 1);
        INSERT INTO attempts (
          id, client_attempt_id, user_id, item_id, content_version, study_date,
          reading_score, reading_pass, missed_tokens_json, math_answer_json,
          math_pass, duration_ms, difficulty_feedback, created_at
        ) VALUES (
          'legacy-attempt', 'legacy-client-attempt', 'student-1', 'math-01', 1, '2026-07-18',
          100, 1, '[]', '1', 1, 1000, NULL, '2026-07-18T00:00:00.000Z'
        );
        INSERT INTO star_events (
          id, student_id, requested_delta, delta, balance_after, reason_code, reason_text,
          study_date, item_id, attempt_id, actor_type, source_key, reverses_event_id, created_at
        ) VALUES (
          'legacy-star', 'student-1', 1, 1, 1, 'REQUIRED_ITEM_COMPLETED', '기존 별',
          '2026-07-18', 'math-01', 'legacy-attempt', 'system', 'legacy:star', NULL,
          '2026-07-18T00:00:00.000Z'
        );
        UPDATE ai_coach_settings
        SET enabled = 1, provider = 'gemini', model = 'gemini-2.5-flash-lite'
        WHERE singleton = 1;
      `);
      migrate(db);

      expect(db.prepare("SELECT step FROM daily_requirements WHERE item_id = ?")
        .get("math-01")).toEqual({ step: "current" });
      expect(db.prepare("SELECT step FROM issued_plan_items WHERE item_id = ?")
        .get("math-01")).toEqual({ step: "current" });
      expect(db.prepare("SELECT completed FROM attempts WHERE id = ?")
        .get("legacy-attempt")).toEqual({ completed: 1 });
      expect(db.prepare("SELECT dictation_pass FROM attempts WHERE id = ?")
        .get("legacy-attempt")).toEqual({ dictation_pass: null });
      expect(db.prepare(`
        SELECT dictation_input_fingerprint AS dictationInputFingerprint
        FROM attempts WHERE id = ?
      `).get("legacy-attempt")).toEqual({ dictationInputFingerprint: null });
      expect(db.prepare("PRAGMA table_info('attempts')").all()
        .map((column) => (column as { name: string }).name)).not.toContain("dictation_text");
      expect(db.prepare("SELECT id, source_key FROM star_events WHERE id = ?")
        .get("legacy-star")).toEqual({ id: "legacy-star", source_key: "legacy:star" });
      db.prepare(`
        INSERT INTO star_events (
          id, student_id, requested_delta, delta, balance_after, reason_code, reason_text,
          study_date, actor_type, source_key, reverses_event_id, created_at
        ) VALUES (?, ?, 2, 2, 3, 'CHALLENGE_PERFECT', '도전 단계 만점', ?, 'system', ?, NULL, ?)
      `).run(
        "challenge-star",
        "student-1",
        "2026-07-18",
        "challenge:student-1:math-01",
        "2026-07-18T00:01:00.000Z"
      );
      expect(() => db.prepare("UPDATE star_events SET reason_text = '변경' WHERE id = ?")
        .run("legacy-star")).toThrow(/STAR_EVENTS_APPEND_ONLY/);
      expect(db.prepare("SELECT provider, model FROM ai_coach_settings WHERE singleton = 1")
        .get()).toEqual({ provider: "gemini", model: "gemini-2.5-flash-lite" });
    } finally {
      db.close();
    }
  });
});
