# SQLite 백업 복구 절차

이 절차는 `sua-learning-*.sqlite` 백업을 먼저 격리 검증한 뒤, 운영자가 별도 승인된 수동 절차로 운영 DB를 교체한다. 원본 백업은 직접 열거나 수정하지 않는다. `.env`, 비밀번호, PIN, 세션 쿠키와 원시 토큰은 출력이나 작업 기록에 남기지 않는다.

## 1. 복구 후보 격리 검증

패키지 디렉터리에서 검증할 백업의 경로만 인자로 전달한다.

```sh
cd /volume1/docker/sua-learning
npm run smoke:restore -- ./data/backups/daily/sua-learning-YYYY-MM-DDTHH-mm-ss-sssZ.sqlite
```

`scripts/restore-smoke.sh`는 정리 trap을 가장 먼저 설치한 다음 임시 후보를 만들고, 백업을 그 후보로 복사한 뒤에만 SQLite를 연다. 무결성, 외래 키, 별 원장/잔액 일치, append-only 트리거, 음수 잔액 금지를 검사하고 여섯 가지 비식별 행 수를 출력한다. 성공과 실패 모두에서 후보와 WAL/SHM만 삭제하며 원본 백업과 운영 DB에는 접근하지 않는다.

성공 출력의 마지막 줄은 `BACKUP_RESTORE_SMOKE_OK`여야 한다. 다음 표의 결과를 `docs/phase1-acceptance.md`에 기록한다.

- `attempts`
- `star_events`
- `student_star_balances`
- `pending_star_adjustments`
- `daily_plan_settings`
- `daily_requirements`

검증 하나라도 실패하면 운영 교체를 진행하지 않는다. 앱 컨테이너를 실행한 상태에서도 이 격리 검증은 가능하지만, 아래 수동 교체 절차와 섞지 않는다.

## 2. 수동 운영 DB 교체

이 단계는 자동 smoke가 아니다. 운영자가 검증 결과를 확인하고 교체를 승인한 뒤 수행한다. 운영 DB 파일과 WAL/SHM을 다루는 모든 명령은 앱 컨테이너를 반드시 멈춘 상태에서만 실행한다.

```sh
cd /volume1/docker/sua-learning
BACKUP=./data/backups/daily/sua-learning-YYYY-MM-DDTHH-mm-ss-sssZ.sqlite
STAMP=$(date +%Y%m%dT%H%M%S)
CANDIDATE=./data/restore-approved-${STAMP}.sqlite
ROLLBACK=./data/pre-restore-${STAMP}.sqlite

docker compose stop app
docker compose ps app
```

`docker compose ps app`에서 `app`이 실행 중이 아님을 확인한 다음에만 승인된 백업을 새 후보로 복사하고 운영 DB를 교체한다.

```sh
test -f "$BACKUP"
test ! -e "$CANDIDATE"
cp -p -- "$BACKUP" "$CANDIDATE"
cp -p -- ./data/sua-learning.db "$ROLLBACK"
test ! -f ./data/sua-learning.db-wal || cp -p -- ./data/sua-learning.db-wal "${ROLLBACK}-wal"
test ! -f ./data/sua-learning.db-shm || cp -p -- ./data/sua-learning.db-shm "${ROLLBACK}-shm"

rm -f -- ./data/sua-learning.db-wal ./data/sua-learning.db-shm
chown 1000:1000 "$CANDIDATE"
chmod 600 "$CANDIDATE"
mv -- "$CANDIDATE" ./data/sua-learning.db
```

컨테이너가 실행 중이면 위 `rm`, `cp`, `mv`를 실행하지 않는다.

## 3. 재시작과 검증

```sh
docker compose start app
curl --fail --silent http://127.0.0.1:8787/api/health
```

응답이 `{"status":"ok"}`인지 확인한다. 보호자 화면에서 백업 상태와 별 잔액을 확인하고 1단계에서 출력한 여섯 건수를 다시 비교한다.

## 4. 수동 롤백

문제가 있으면 앱 컨테이너를 다시 멈추고 상태를 확인한 뒤, 보존한 원본의 복사본으로 되돌린다.

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

롤백에서도 보존 원본을 직접 이동하지 않는다. 컨테이너를 반드시 멈춘 상태에서 새 롤백 후보를 만든다.

## DSM 예약 작업은 분리 유지

두 작업을 하나의 명령이나 하나의 예약 작업으로 합치지 않는다.

- 03:00 백업: `cd /volume1/docker/sua-learning && docker compose exec -T app npm run backup`
- 06:00 일일 정리: `cd /volume1/docker/sua-learning && docker compose exec -T app npm run daily-maintenance`
