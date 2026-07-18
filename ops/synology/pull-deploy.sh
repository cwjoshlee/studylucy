#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
LOCK_DIR="${DEPLOY_LOCK_DIR:-$ROOT_DIR/.pull-deploy.lock}"
LOCK_MAX_AGE_MINUTES="${DEPLOY_LOCK_MAX_AGE_MINUTES:-30}"
HEALTH_ATTEMPTS="${DEPLOY_HEALTH_ATTEMPTS:-12}"
HEALTH_INTERVAL_SECONDS="${DEPLOY_HEALTH_INTERVAL_SECONDS:-5}"
cd "$ROOT_DIR"

cleanup() {
  rmdir "$LOCK_DIR" 2>/dev/null || true
}

acquire_lock() {
  if mkdir "$LOCK_DIR" 2>/dev/null; then
    trap cleanup EXIT
    return
  fi

  if find "$LOCK_DIR" -maxdepth 0 -mmin "+$LOCK_MAX_AGE_MINUTES" -print -quit | grep -q .; then
    echo "removing stale deployment lock" >&2
    rmdir "$LOCK_DIR" 2>/dev/null || {
      echo "deployment lock is active or malformed: $LOCK_DIR" >&2
      exit 75
    }
    mkdir "$LOCK_DIR"
    trap cleanup EXIT
    return
  fi

  echo "deployment lock is already held: $LOCK_DIR" >&2
  exit 75
}

check_health_once() {
  local container_id docker_health
  container_id="$(docker compose ps -q app)"
  test -n "$container_id"
  docker_health="$(docker inspect --format '{{.State.Health.Status}}' "$container_id")"
  test "$docker_health" = "healthy" \
    && curl --fail --silent --show-error http://127.0.0.1:8787/api/health | grep -q '"status":"ok"'
}

check_health() {
  local attempt
  for attempt in $(seq 1 "$HEALTH_ATTEMPTS"); do
    if check_health_once; then
      return 0
    fi
    sleep "$HEALTH_INTERVAL_SECONDS"
  done
  return 1
}

rollback() {
  echo "deployment health check failed; restoring the previous app image" >&2
  APP_IMAGE=$PREVIOUS_IMAGE docker compose up -d --no-deps app
  if check_health_once; then
    echo "rollback health check passed" >&2
  else
    echo "rollback health check failed; manual investigation is required" >&2
  fi
}

diagnose_failure() {
  echo "deployment failed; recent app logs follow" >&2
  docker compose logs --tail=50 app >&2 || true
}

acquire_lock

CURRENT_CONTAINER="$(docker compose ps -q app)"
if test -z "$CURRENT_CONTAINER"; then
  echo "app must already be running so its data can be backed up safely" >&2
  exit 1
fi

PREVIOUS_IMAGE="$(docker inspect --format '{{.Image}}' "$CURRENT_CONTAINER")"
docker compose pull app
TARGET_IMAGE_REFERENCE="$(docker compose config --images | sed -n '1p')"
TARGET_IMAGE="$(docker image inspect --format '{{.Id}}' "$TARGET_IMAGE_REFERENCE")"

if test "$PREVIOUS_IMAGE" = "$TARGET_IMAGE"; then
  echo "no new app image; deployment skipped"
  exit 0
fi

docker compose exec -T app npm run backup
if ! docker compose up -d --no-deps app || ! check_health; then
  diagnose_failure
  rollback
  exit 1
fi

echo "deployment health check passed"
