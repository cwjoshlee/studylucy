#!/usr/bin/env bash
set -euo pipefail

CANDIDATE=""

cleanup() {
  status=$?
  trap - EXIT
  if [[ -n "$CANDIDATE" ]]; then
    rm -f -- "$CANDIDATE" "${CANDIDATE}-wal" "${CANDIDATE}-shm" || true
  fi
  exit "$status"
}
trap cleanup EXIT

BACKUP=${1:-}
if [[ -z "$BACKUP" ]]; then
  echo "usage: npm run smoke:restore -- /path/to/backup.sqlite" >&2
  exit 64
fi
if [[ ! -f "$BACKUP" ]]; then
  echo "BACKUP_NOT_FOUND" >&2
  exit 66
fi
if ! command -v sqlite3 >/dev/null 2>&1; then
  echo "SQLITE3_REQUIRED" >&2
  exit 69
fi

CANDIDATE=$(mktemp "${TMPDIR:-/tmp}/sua-learning-restore-candidate.XXXXXX")
cp -p -- "$BACKUP" "$CANDIDATE"

INTEGRITY=$(sqlite3 "$CANDIDATE" 'PRAGMA integrity_check;')
[[ "$INTEGRITY" == "ok" ]] || {
  echo "BACKUP_INTEGRITY_FAILED" >&2
  exit 1
}

FOREIGN_KEY_ERRORS=$(sqlite3 "$CANDIDATE" \
  'SELECT COUNT(*) FROM pragma_foreign_key_check;')
[[ "$FOREIGN_KEY_ERRORS" == "0" ]] || {
  echo "BACKUP_FOREIGN_KEY_FAILED" >&2
  exit 1
}

BALANCE_ERRORS=$(sqlite3 "$CANDIDATE" <<'SQL'
WITH student_ids AS (
  SELECT student_id FROM student_star_balances
  UNION
  SELECT student_id FROM star_events
),
ledger_totals AS (
  SELECT student_id, SUM(delta) AS ledger_balance
  FROM star_events
  GROUP BY student_id
),
reconciled AS (
  SELECT
    students.student_id,
    balances.balance AS stored_balance,
    COALESCE(ledger.ledger_balance, 0) AS ledger_balance
  FROM student_ids AS students
  LEFT JOIN student_star_balances AS balances
    ON balances.student_id = students.student_id
  LEFT JOIN ledger_totals AS ledger
    ON ledger.student_id = students.student_id
)
SELECT COUNT(*)
FROM reconciled
WHERE stored_balance IS NULL OR stored_balance <> ledger_balance;
SQL
)
[[ "$BALANCE_ERRORS" == "0" ]] || {
  echo "BACKUP_LEDGER_RECONCILIATION_FAILED" >&2
  exit 1
}

PROBE_SUFFIX="$$"
if UPDATE_PROBE=$(sqlite3 -bail "$CANDIDATE" 2>&1 <<SQL
BEGIN;
INSERT INTO users (id, role, display_name, created_at)
VALUES ('__restore_update_user_${PROBE_SUFFIX}', 'student', 'constraint probe',
  '2000-01-01T00:00:00.000Z');
INSERT INTO star_events (
  id, student_id, requested_delta, delta, balance_after, reason_code,
  reason_text, study_date, actor_type, source_key, created_at
) VALUES (
  '__restore_update_event_${PROBE_SUFFIX}',
  '__restore_update_user_${PROBE_SUFFIX}', 0, 0, 0,
  'NO_BALANCE_AUDIT', 'constraint probe', '2000-01-01', 'system',
  '__restore_update_source_${PROBE_SUFFIX}', '2000-01-01T00:00:00.000Z'
);
UPDATE star_events SET reason_text = 'forbidden update'
WHERE id = '__restore_update_event_${PROBE_SUFFIX}';
ROLLBACK;
SQL
); then
  echo "BACKUP_APPEND_ONLY_UPDATE_MISSING" >&2
  exit 1
fi
[[ "$UPDATE_PROBE" == *"STAR_EVENTS_APPEND_ONLY"* ]] || {
  echo "BACKUP_APPEND_ONLY_UPDATE_PROBE_FAILED" >&2
  exit 1
}

if DELETE_PROBE=$(sqlite3 -bail "$CANDIDATE" 2>&1 <<SQL
BEGIN;
INSERT INTO users (id, role, display_name, created_at)
VALUES ('__restore_delete_user_${PROBE_SUFFIX}', 'student', 'constraint probe',
  '2000-01-01T00:00:00.000Z');
INSERT INTO star_events (
  id, student_id, requested_delta, delta, balance_after, reason_code,
  reason_text, study_date, actor_type, source_key, created_at
) VALUES (
  '__restore_delete_event_${PROBE_SUFFIX}',
  '__restore_delete_user_${PROBE_SUFFIX}', 0, 0, 0,
  'NO_BALANCE_AUDIT', 'constraint probe', '2000-01-01', 'system',
  '__restore_delete_source_${PROBE_SUFFIX}', '2000-01-01T00:00:00.000Z'
);
DELETE FROM star_events WHERE id = '__restore_delete_event_${PROBE_SUFFIX}';
ROLLBACK;
SQL
); then
  echo "BACKUP_APPEND_ONLY_DELETE_MISSING" >&2
  exit 1
fi
[[ "$DELETE_PROBE" == *"STAR_EVENTS_APPEND_ONLY"* ]] || {
  echo "BACKUP_APPEND_ONLY_DELETE_PROBE_FAILED" >&2
  exit 1
}

if BALANCE_PROBE=$(sqlite3 -bail "$CANDIDATE" 2>&1 <<SQL
BEGIN;
INSERT INTO users (id, role, display_name, created_at)
VALUES ('__restore_balance_user_${PROBE_SUFFIX}', 'student', 'constraint probe',
  '2000-01-01T00:00:00.000Z');
INSERT INTO student_star_balances (student_id, balance, updated_at)
VALUES ('__restore_balance_user_${PROBE_SUFFIX}', -1,
  '2000-01-01T00:00:00.000Z');
ROLLBACK;
SQL
); then
  echo "BACKUP_NONNEGATIVE_BALANCE_MISSING" >&2
  exit 1
fi
[[ "$BALANCE_PROBE" == *"CHECK constraint failed"* ]] || {
  echo "BACKUP_NONNEGATIVE_BALANCE_PROBE_FAILED" >&2
  exit 1
}

POST_PROBE_INTEGRITY=$(sqlite3 "$CANDIDATE" 'PRAGMA integrity_check;')
[[ "$POST_PROBE_INTEGRITY" == "ok" ]] || {
  echo "BACKUP_POST_PROBE_INTEGRITY_FAILED" >&2
  exit 1
}

sqlite3 "$CANDIDATE" <<'SQL'
SELECT 'attempts', COUNT(*) FROM attempts;
SELECT 'star_events', COUNT(*) FROM star_events;
SELECT 'student_star_balances', COUNT(*) FROM student_star_balances;
SELECT 'pending_star_adjustments', COUNT(*) FROM pending_star_adjustments;
SELECT 'daily_plan_settings', COUNT(*) FROM daily_plan_settings;
SELECT 'daily_requirements', COUNT(*) FROM daily_requirements;
SQL

echo "BACKUP_RESTORE_SMOKE_OK"
