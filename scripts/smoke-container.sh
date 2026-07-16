#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

SMOKE_PROJECT_NAME="sua-learning-smoke-$$"
SMOKE_PORT=18787
export SMOKE_PROJECT_NAME SMOKE_PORT

compose=(
  docker compose
  --project-name "$SMOKE_PROJECT_NAME"
  -f compose.smoke.yaml
)

finish() {
  status=$?
  trap - EXIT
  if command -v docker >/dev/null 2>&1; then
    if ((status != 0)); then
      "${compose[@]}" logs --no-color app >&2 || true
    fi
    "${compose[@]}" down --rmi local --volumes --remove-orphans >/dev/null 2>&1 || true
  fi
  exit "$status"
}
trap finish EXIT

if ! command -v docker >/dev/null 2>&1; then
  echo "docker command is required for the isolated container smoke test" >&2
  exit 127
fi

"${compose[@]}" up -d --build

for _ in $(seq 1 30); do
  if curl --fail --silent "http://127.0.0.1:${SMOKE_PORT}/api/health" \
    | grep -q '"status":"ok"'; then
    exit 0
  fi
  sleep 1
done

exit 1
