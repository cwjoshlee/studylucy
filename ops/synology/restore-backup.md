# SQLite 백업 복구 절차

이 절차는 `sua-learning-*.sqlite` 백업을 먼저 격리 검증한 뒤, 운영자가 별도 승인된 수동 절차로 운영 DB를 교체한다. 원본 백업은 직접 열거나 수정하지 않는다. `.env`, 비밀번호, PIN, 세션 쿠키와 원시 토큰은 출력이나 작업 기록에 남기지 않는다.

## 1. 복구 후보 격리 검증

패키지 디렉터리에서 검증할 백업 경로만 인자로 전달한다.

```sh
cd /volume1/docker/sua-learning
npm run smoke:restore -- ./data/backups/daily/sua-learning-YYYY-MM-DDTHH-mm-ss-sssZ.sqlite
```

`scripts/restore-smoke.sh`는 정리 trap을 가장 먼저 설치한 다음 임시 후보를 만들고, 백업을 그 후보로 복사한 뒤에만 SQLite를 연다. 무결성, 외래 키, 별 원장/잔액 일치, append-only 트리거, 음수 잔액 금지를 검사하고 여섯 가지 비식별 행 수를 출력한다. 성공과 실패 모두에서 후보와 WAL/SHM만 삭제하며 원본 백업과 운영 DB에는 접근하지 않는다.

성공 출력의 마지막 줄은 `BACKUP_RESTORE_SMOKE_OK`여야 한다. 다음 행 수를 `docs/phase1-acceptance.md`에 기록한다.

- `attempts`
- `star_events`
- `student_star_balances`
- `pending_star_adjustments`
- `daily_plan_settings`
- `daily_requirements`

검증 하나라도 실패하면 운영 교체를 진행하지 않는다. 앱 컨테이너 실행 중 가능한 이 격리 검증과 아래 수동 교체를 한 명령으로 합치지 않는다.

## 2. 수동 운영 DB 교체와 재시작

이 단계는 자동 smoke가 아니다. 운영자가 검증 결과와 백업 경로를 확인하고 교체를 승인한 뒤 아래 블록 전체를 한 셸에서 실행한다. 운영 파일을 바꾸는 구간은 컨테이너를 반드시 멈춘 상태여야 한다. `set -euo pipefail` 상태, 변수와 정지 확인을 다른 코드 블록으로 나누지 않는다.

```sh
set -euo pipefail
cd /volume1/docker/sua-learning

BACKUP=./data/backups/daily/sua-learning-YYYY-MM-DDTHH-mm-ss-sssZ.sqlite
STAMP=$(date +%Y%m%dT%H%M%S)
CANDIDATE=./data/restore-approved-${STAMP}.sqlite
ROLLBACK=./data/pre-restore-${STAMP}.sqlite

test -f "$BACKUP"
test -f ./data/sua-learning.db
test ! -e "$CANDIDATE"
test ! -e "$ROLLBACK"
test ! -e "${ROLLBACK}-wal"
test ! -e "${ROLLBACK}-shm"

docker compose stop app
RUNNING_APP_SERVICES=$(docker compose ps --status running --services app)
test -z "$RUNNING_APP_SERVICES"

cp -p -- "$BACKUP" "$CANDIDATE"
cp -p -- ./data/sua-learning.db "$ROLLBACK"
if [[ -f ./data/sua-learning.db-wal ]]; then
  cp -p -- ./data/sua-learning.db-wal "${ROLLBACK}-wal"
fi
if [[ -f ./data/sua-learning.db-shm ]]; then
  cp -p -- ./data/sua-learning.db-shm "${ROLLBACK}-shm"
fi

chown 1000:1000 "$CANDIDATE"
chmod 600 "$CANDIDATE"
rm -f -- ./data/sua-learning.db-wal ./data/sua-learning.db-shm
mv -- "$CANDIDATE" ./data/sua-learning.db

docker compose start app
curl --fail --silent http://127.0.0.1:8787/api/health
```

정지 assertion, 모든 입력/출력 사전조건, 후보와 롤백 복사가 성공한 뒤에만 운영 WAL/SHM을 제거한다. 응답이 `{"status":"ok"}`인지 확인하고 보호자 화면에서 백업 상태와 별 잔액, 1단계의 여섯 행 수를 다시 비교한다.

## 3. 수동 롤백

문제가 있으면 교체 때 기록한 `STAMP` 값을 `RESTORE_STAMP`에 넣고 아래 블록 전체를 한 셸에서 실행한다. 보존한 원본은 직접 이동하지 않고 새 후보로 복사한다. 선택적인 WAL/SHM은 존재할 때만 복사·권한 설정·이동한다.

```sh
set -euo pipefail
cd /volume1/docker/sua-learning

RESTORE_STAMP=YYYYMMDDTHHMMSS
test "$RESTORE_STAMP" != "YYYYMMDDTHHMMSS"
ROLLBACK=./data/pre-restore-${RESTORE_STAMP}.sqlite
ROLLBACK_CANDIDATE=./data/rollback-candidate-${RESTORE_STAMP}.sqlite

test -f "$ROLLBACK"
test -f ./data/sua-learning.db
test ! -e "$ROLLBACK_CANDIDATE"
test ! -e "${ROLLBACK_CANDIDATE}-wal"
test ! -e "${ROLLBACK_CANDIDATE}-shm"

docker compose stop app
RUNNING_APP_SERVICES=$(docker compose ps --status running --services app)
test -z "$RUNNING_APP_SERVICES"

cp -p -- "$ROLLBACK" "$ROLLBACK_CANDIDATE"
if [[ -f "${ROLLBACK}-wal" ]]; then
  cp -p -- "${ROLLBACK}-wal" "${ROLLBACK_CANDIDATE}-wal"
fi
if [[ -f "${ROLLBACK}-shm" ]]; then
  cp -p -- "${ROLLBACK}-shm" "${ROLLBACK_CANDIDATE}-shm"
fi

chown 1000:1000 "$ROLLBACK_CANDIDATE"
chmod 600 "$ROLLBACK_CANDIDATE"
if [[ -f "${ROLLBACK_CANDIDATE}-wal" ]]; then
  chown 1000:1000 "${ROLLBACK_CANDIDATE}-wal"
  chmod 600 "${ROLLBACK_CANDIDATE}-wal"
fi
if [[ -f "${ROLLBACK_CANDIDATE}-shm" ]]; then
  chown 1000:1000 "${ROLLBACK_CANDIDATE}-shm"
  chmod 600 "${ROLLBACK_CANDIDATE}-shm"
fi

rm -f -- ./data/sua-learning.db-wal ./data/sua-learning.db-shm
mv -- "$ROLLBACK_CANDIDATE" ./data/sua-learning.db
if [[ -f "${ROLLBACK_CANDIDATE}-wal" ]]; then
  mv -- "${ROLLBACK_CANDIDATE}-wal" ./data/sua-learning.db-wal
fi
if [[ -f "${ROLLBACK_CANDIDATE}-shm" ]]; then
  mv -- "${ROLLBACK_CANDIDATE}-shm" ./data/sua-learning.db-shm
fi

docker compose start app
curl --fail --silent http://127.0.0.1:8787/api/health
```

어느 명령이든 실패하면 셸이 즉시 중단된다. 실패한 소유권·권한 변경을 숨기지 않으며, 앱을 임의로 재시작하지 말고 현재 파일과 컨테이너 상태를 먼저 확인한다.

## DSM 예약 작업은 분리 유지

두 작업을 하나의 명령이나 하나의 예약 작업으로 합치지 않는다.

- 03:00 백업: `cd /volume1/docker/sua-learning && docker compose exec -T app npm run backup`
- 06:00 일일 정리: `cd /volume1/docker/sua-learning && docker compose exec -T app npm run daily-maintenance`
