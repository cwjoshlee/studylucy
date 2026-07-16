# SQLite 백업 복구 절차

이 절차는 `sua-learning-*.sqlite` 백업을 검증한 뒤 운영 DB를 교체한다. 원본 백업 파일은 직접 열어 수정하지 않고, 항상 새 후보 파일로 복사해서 검사한다. `.env`, 비밀번호, PIN, 세션 토큰은 명령 출력이나 작업 기록에 남기지 않는다.

## 1. 복구 후보를 새 파일로 복사

패키지 디렉터리에서 실행한다. `BACKUP`에는 복구할 일간 또는 주간 백업 하나를 지정한다.

```sh
set -eu
cd /volume1/docker/sua-learning
BACKUP=./data/backups/daily/sua-learning-YYYY-MM-DDTHH-mm-ss-sssZ.sqlite
STAMP=$(date +%Y%m%dT%H%M%S)
CANDIDATE=./data/restore-candidate-${STAMP}.sqlite

test -f "$BACKUP"
test ! -e "$CANDIDATE"
cp -- "$BACKUP" "$CANDIDATE"

fail_candidate() {
  rm -f -- "$CANDIDATE" "${CANDIDATE}-wal" "${CANDIDATE}-shm"
  printf '%s\n' "$1" >&2
  exit 1
}
```

이 단계에서는 앱 컨테이너를 계속 실행해도 된다. 운영 DB가 아니라 새 후보 파일만 읽는다.

## 2. 무결성과 별 원장을 검증

`integrity_check` 결과는 정확히 `ok`, 외래 키 위반과 별 잔액 불일치는 각각 0건이어야 한다.

```sh
INTEGRITY=$(sqlite3 "$CANDIDATE" 'PRAGMA integrity_check;')
test "$INTEGRITY" = "ok" || fail_candidate BACKUP_INTEGRITY_FAILED

FOREIGN_KEY_ERRORS=$(sqlite3 "$CANDIDATE" 'SELECT COUNT(*) FROM pragma_foreign_key_check;')
test "$FOREIGN_KEY_ERRORS" = "0" || fail_candidate BACKUP_FOREIGN_KEY_FAILED

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
test "$BALANCE_ERRORS" = "0" || fail_candidate BACKUP_LEDGER_RECONCILIATION_FAILED
```

복구 전후 비교를 위해 학습 시도, 별 원장, 잔액, 대기 승인, 일일 계획 설정, 일일 필수 항목 건수도 기록한다. 이 출력에는 사용자 이름이나 내부 레코드 내용이 포함되지 않는다.

```sh
sqlite3 "$CANDIDATE" <<'SQL'
SELECT 'attempts', COUNT(*) FROM attempts;
SELECT 'star_events', COUNT(*) FROM star_events;
SELECT 'student_star_balances', COUNT(*) FROM student_star_balances;
SELECT 'pending_star_adjustments', COUNT(*) FROM pending_star_adjustments;
SELECT 'daily_plan_settings', COUNT(*) FROM daily_plan_settings;
SELECT 'daily_requirements', COUNT(*) FROM daily_requirements;
SQL
```

다음 세 검사는 후보 DB 안에서 임시 사용자와 원장 행을 트랜잭션으로 만든 뒤 의도적으로 금지된 변경을 시도한다. 각 `sqlite3` 프로세스가 예상 오류로 끝나면 열린 트랜잭션 전체가 자동 롤백되어 후보 데이터는 바뀌지 않는다. 다른 오류이거나 금지된 변경이 성공하면 복구를 중단한다.

```sh
if UPDATE_PROBE=$(sqlite3 -bail "$CANDIDATE" 2>&1 <<SQL
BEGIN;
INSERT INTO users (id, role, display_name, created_at)
VALUES ('__restore_update_user_${STAMP}', 'student', 'constraint probe',
  '2000-01-01T00:00:00.000Z');
INSERT INTO star_events (
  id, student_id, requested_delta, delta, balance_after, reason_code,
  reason_text, study_date, actor_type, source_key, created_at
) VALUES (
  '__restore_update_event_${STAMP}', '__restore_update_user_${STAMP}',
  0, 0, 0, 'NO_BALANCE_AUDIT', 'constraint probe', '2000-01-01',
  'system', '__restore_update_source_${STAMP}', '2000-01-01T00:00:00.000Z'
);
UPDATE star_events
SET reason_text = 'forbidden update'
WHERE id = '__restore_update_event_${STAMP}';
ROLLBACK;
SQL
); then
  fail_candidate BACKUP_APPEND_ONLY_UPDATE_MISSING
fi
case "$UPDATE_PROBE" in
  *"STAR_EVENTS_APPEND_ONLY"*) ;;
  *) fail_candidate BACKUP_APPEND_ONLY_UPDATE_PROBE_FAILED ;;
esac

if DELETE_PROBE=$(sqlite3 -bail "$CANDIDATE" 2>&1 <<SQL
BEGIN;
INSERT INTO users (id, role, display_name, created_at)
VALUES ('__restore_delete_user_${STAMP}', 'student', 'constraint probe',
  '2000-01-01T00:00:00.000Z');
INSERT INTO star_events (
  id, student_id, requested_delta, delta, balance_after, reason_code,
  reason_text, study_date, actor_type, source_key, created_at
) VALUES (
  '__restore_delete_event_${STAMP}', '__restore_delete_user_${STAMP}',
  0, 0, 0, 'NO_BALANCE_AUDIT', 'constraint probe', '2000-01-01',
  'system', '__restore_delete_source_${STAMP}', '2000-01-01T00:00:00.000Z'
);
DELETE FROM star_events WHERE id = '__restore_delete_event_${STAMP}';
ROLLBACK;
SQL
); then
  fail_candidate BACKUP_APPEND_ONLY_DELETE_MISSING
fi
case "$DELETE_PROBE" in
  *"STAR_EVENTS_APPEND_ONLY"*) ;;
  *) fail_candidate BACKUP_APPEND_ONLY_DELETE_PROBE_FAILED ;;
esac

if BALANCE_PROBE=$(sqlite3 -bail "$CANDIDATE" 2>&1 <<SQL
BEGIN;
INSERT INTO users (id, role, display_name, created_at)
VALUES ('__restore_balance_user_${STAMP}', 'student', 'constraint probe',
  '2000-01-01T00:00:00.000Z');
INSERT INTO student_star_balances (student_id, balance, updated_at)
VALUES ('__restore_balance_user_${STAMP}', -1, '2000-01-01T00:00:00.000Z');
ROLLBACK;
SQL
); then
  fail_candidate BACKUP_NONNEGATIVE_BALANCE_MISSING
fi
case "$BALANCE_PROBE" in
  *"CHECK constraint failed"*) ;;
  *) fail_candidate BACKUP_NONNEGATIVE_BALANCE_PROBE_FAILED ;;
esac

POST_PROBE_INTEGRITY=$(sqlite3 "$CANDIDATE" 'PRAGMA integrity_check;')
test "$POST_PROBE_INTEGRITY" = "ok" || fail_candidate BACKUP_POST_PROBE_INTEGRITY_FAILED
```

검사 하나라도 실패하면 후보 파일을 삭제하고 여기서 중단한다. 운영 DB를 교체하지 않는다.

## 3. 컨테이너를 멈춘 뒤 운영 DB 교체

운영 DB 파일을 교체하는 동안 앱 컨테이너는 반드시 정지 상태여야 한다. 먼저 정상 종료를 기다린 뒤 상태를 확인한다.

```sh
docker compose stop app
docker compose ps app
```

`app`이 실행 중이 아님을 확인한 다음에만 기존 DB와 남아 있을 수 있는 WAL 파일을 별도 이름으로 보존하고 후보 파일을 같은 파일시스템에서 원자적으로 이동한다.

```sh
ROLLBACK=./data/pre-restore-${STAMP}.sqlite
cp -p -- ./data/sua-learning.db "$ROLLBACK"
test ! -f ./data/sua-learning.db-wal || cp -p -- ./data/sua-learning.db-wal "${ROLLBACK}-wal"
test ! -f ./data/sua-learning.db-shm || cp -p -- ./data/sua-learning.db-shm "${ROLLBACK}-shm"

rm -f -- ./data/sua-learning.db-wal ./data/sua-learning.db-shm
rm -f -- "${CANDIDATE}-wal" "${CANDIDATE}-shm"
chown 1000:1000 "$CANDIDATE"
chmod 600 "$CANDIDATE"
mv -- "$CANDIDATE" ./data/sua-learning.db
```

컨테이너가 실행 중인 상태에서는 위 `rm` 또는 `mv` 명령을 절대 실행하지 않는다.

## 4. 재시작과 확인

```sh
docker compose start app
curl --fail --silent http://127.0.0.1:8787/api/health
```

헬스 체크 후 보호자 화면에서 백업 상태와 별 잔액을 확인하고, 2단계의 여섯 가지 건수를 다시 비교한다. 문제가 있으면 다음처럼 앱을 다시 멈춘 상태에서 `ROLLBACK` 파일과 함께 보존한 WAL 쌍으로 되돌린다.

```sh
docker compose stop app
docker compose ps app

rm -f -- ./data/sua-learning.db-wal ./data/sua-learning.db-shm
cp -p -- "$ROLLBACK" ./data/rollback-candidate-${STAMP}.sqlite
mv -- ./data/rollback-candidate-${STAMP}.sqlite ./data/sua-learning.db
test ! -f "${ROLLBACK}-wal" || cp -p -- "${ROLLBACK}-wal" ./data/sua-learning.db-wal
test ! -f "${ROLLBACK}-shm" || cp -p -- "${ROLLBACK}-shm" ./data/sua-learning.db-shm
chown 1000:1000 ./data/sua-learning.db ./data/sua-learning.db-wal ./data/sua-learning.db-shm 2>/dev/null || true
chmod 600 ./data/sua-learning.db ./data/sua-learning.db-wal ./data/sua-learning.db-shm 2>/dev/null || true
docker compose start app
```

롤백에서도 원본 보존 파일을 직접 이동하지 않고 새 후보 파일을 만든다.

## DSM 예약 작업은 분리 유지

두 작업을 하나의 명령이나 하나의 예약 작업으로 합치지 않는다.

- 03:00 백업: `cd /volume1/docker/sua-learning && docker compose exec -T app npm run backup`
- 06:00 일일 정리: `cd /volume1/docker/sua-learning && docker compose exec -T app npm run daily-maintenance`
