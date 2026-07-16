#!/usr/bin/env bash
set -euo pipefail

docker compose up -d --build
trap 'docker compose down' EXIT

for _ in $(seq 1 30); do
  if curl --fail --silent http://127.0.0.1:8787/api/health | grep -q '"status":"ok"'; then
    exit 0
  fi
  sleep 1
done

docker compose logs app
exit 1
