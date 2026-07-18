import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

async function source(path: string): Promise<string> {
  return await readFile(path, "utf8").catch(() => "");
}

async function writeExecutable(path: string, content: string): Promise<void> {
  await writeFile(path, content, "utf8");
  await chmod(path, 0o700);
}

async function runDeployScenario(scenario: "unchanged" | "healthy" | "failed") {
  const tempDir = await mkdtemp(resolve(tmpdir(), "sua-pull-deploy-"));
  const binDir = resolve(tempDir, "bin");
  const stateDir = resolve(tempDir, "state");
  const lockDir = resolve(tempDir, "lock");
  await Promise.all([mkdir(binDir), mkdir(stateDir)]);

  await writeExecutable(resolve(binDir, "docker"), String.raw`#!/usr/bin/env bash
set -euo pipefail
printf '%s|%s\n' "$APP_IMAGE" "$*" >> "$STATE_DIR/commands"

if [[ "$1" == "compose" && "$2" == "ps" ]]; then
  printf '%s\n' app-container
  exit 0
fi
if [[ "$1" == "compose" && "$2" == "pull" ]]; then
  exit 0
fi
if [[ "$1" == "compose" && "$2" == "config" ]]; then
  printf '%s\n' ghcr.io/example/app:main
  exit 0
fi
if [[ "$1" == "compose" && "$2" == "exec" ]]; then
  exit 0
fi
if [[ "$1" == "compose" && "$2" == "logs" ]]; then
  printf '%s\n' "bounded app diagnostic" >&2
  exit 0
fi
if [[ "$1" == "compose" && "$2" == "up" ]]; then
  exit 0
fi
if [[ "$1" == "inspect" && "$3" == "{{.Image}}" ]]; then
  printf '%s\n' sha256:previous
  exit 0
fi
if [[ "$1" == "inspect" && "$3" == "{{.State.Health.Status}}" ]]; then
  count_file="$STATE_DIR/health-count"
  count=0
  test -f "$count_file" && count="$(cat "$count_file")"
  count=$((count + 1))
  printf '%s' "$count" > "$count_file"
  if [[ "$SCENARIO" == "failed" && "$count" -le 12 ]]; then
    printf '%s\n' unhealthy
  else
    printf '%s\n' healthy
  fi
  exit 0
fi
if [[ "$1" == "image" && "$2" == "inspect" ]]; then
  if [[ "$SCENARIO" == "unchanged" ]]; then
    printf '%s\n' sha256:previous
  else
    printf '%s\n' sha256:replacement
  fi
  exit 0
fi
printf '%s\n' "unexpected docker command: $*" >&2
exit 64
`);
  await writeExecutable(resolve(binDir, "curl"), String.raw`#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "curl $*" >> "$STATE_DIR/commands"
printf '%s\n' '{"status":"ok"}'
`);
  await writeExecutable(resolve(binDir, "sleep"), String.raw`#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "sleep $*" >> "$STATE_DIR/commands"
`);

  try {
    const result = spawnSync("bash", ["ops/synology/pull-deploy.sh"], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH ?? ""}`,
        STATE_DIR: stateDir,
        SCENARIO: scenario,
        APP_IMAGE: "",
        DEPLOY_LOCK_DIR: lockDir,
        DEPLOY_HEALTH_INTERVAL_SECONDS: "0"
      }
    });
    const commands = await readFile(resolve(stateDir, "commands"), "utf8");
    const healthCount = await readFile(resolve(stateDir, "health-count"), "utf8")
      .catch(() => "0");
    return { result, commands, healthCount };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

describe("GHCR pull deployment configuration", () => {
  it("checks every pull request and publishes multi-architecture images only from main", async () => {
    const workflow = await source(".github/workflows/ci.yml");

    expect(workflow).toContain("pull_request:");
    expect(workflow).toContain("push:");
    expect(workflow).toContain("main");
    expect(workflow).toContain("npm ci");
    expect(workflow).toContain("npm run check");
    expect(workflow).toContain("contents: read");
    expect(workflow).toContain("packages: write");
    expect(workflow).toContain("github.event_name == 'push'");
    expect(workflow).toContain("github.ref == 'refs/heads/main'");
    expect(workflow).toContain("docker/setup-buildx-action");
    expect(workflow).toContain("docker/login-action");
    expect(workflow).toContain("docker/build-push-action");
    expect(workflow).toContain("linux/amd64,linux/arm64");
    expect(workflow).toContain("type=raw,value=main");
    expect(workflow).toContain("type=sha");
    expect(workflow).toContain("org.opencontainers.image.revision=${{ github.sha }}");
    expect(workflow).toContain("org.opencontainers.image.source=${{ github.server_url }}/${{ github.repository }}");
  });

  it("keeps production image-only and smoke build-only on separate loopback ports", async () => {
    const [production, smoke, dockerfile] = await Promise.all([
      source("compose.yaml"),
      source("compose.smoke.yaml"),
      source("Dockerfile")
    ]);

    expect(production).toContain("image: ${APP_IMAGE:-ghcr.io/");
    expect(production).not.toContain("build:");
    expect(production).toContain("127.0.0.1:8787:8787");
    expect(production).toContain("./data:/data");
    expect(smoke).toContain("build:");
    expect(smoke).toContain("127.0.0.1:18787:8787");
    expect(dockerfile).toContain("HEALTHCHECK");
    expect(dockerfile).toContain("http://127.0.0.1:8787/api/health");
  });

  it("pulls safely, backs up before replacement, verifies both health signals, and rolls back only the app image", async () => {
    const script = await source("ops/synology/pull-deploy.sh");

    expect(script).toContain('mkdir "$LOCK_DIR"');
    expect(script).toContain("trap cleanup EXIT");
    expect(script).toContain("docker compose pull app");
    expect(script).toContain("docker inspect --format '{{.Image}}'");
    expect(script).toContain("docker compose exec -T app npm run backup");
    expect(script.indexOf("npm run backup"))
      .toBeLessThan(script.lastIndexOf("docker compose up -d --no-deps app"));
    expect(script).toContain("docker inspect --format '{{.State.Health.Status}}'");
    expect(script).toContain("http://127.0.0.1:8787/api/health");
    expect(script).toContain('HEALTH_ATTEMPTS="${DEPLOY_HEALTH_ATTEMPTS:-12}"');
    expect(script).toContain('HEALTH_INTERVAL_SECONDS="${DEPLOY_HEALTH_INTERVAL_SECONDS:-5}"');
    expect(script).toContain('seq 1 "$HEALTH_ATTEMPTS"');
    expect(script).toContain('sleep "$HEALTH_INTERVAL_SECONDS"');
    expect(script).toContain("docker compose logs --tail=50 app >&2 || true");
    expect(script).toContain("APP_IMAGE=$PREVIOUS_IMAGE docker compose up -d --no-deps app");
    expect(script).toContain("rollback");
    expect(script).not.toMatch(/\brm\b|docker compose down|--volumes|data\/(?:\*|\$)|ports:|webhook|cat \.env|printenv|env\s*$/mi);
  });

  it("skips backup and replacement when the pulled image ID is unchanged", async () => {
    const { result, commands } = await runDeployScenario("unchanged");

    expect(result.status).toBe(0);
    expect(commands).toContain("|compose pull app");
    expect(commands).not.toContain("|compose exec -T app npm run backup");
    expect(commands).not.toContain("|compose up -d --no-deps app");
  });

  it("backs up before replacing a changed image and accepts both health signals", async () => {
    const { result, commands } = await runDeployScenario("healthy");

    expect(result.status).toBe(0);
    expect(commands.indexOf("|compose exec -T app npm run backup"))
      .toBeLessThan(commands.indexOf("|compose up -d --no-deps app"));
    expect(commands).toContain("curl --fail --silent --show-error http://127.0.0.1:8787/api/health");
    expect(commands).not.toContain("sha256:previous|compose up -d --no-deps app");
  });

  it("logs bounded diagnostics then rolls back the previous app image after twelve failed polls without touching data", async () => {
    const { result, commands, healthCount } = await runDeployScenario("failed");

    expect(result.status).toBe(1);
    expect(healthCount).toBe("13");
    expect(commands.match(/\|compose logs --tail=50 app/g)).toHaveLength(1);
    expect(commands.indexOf("|compose logs --tail=50 app"))
      .toBeLessThan(commands.indexOf("sha256:previous|compose up -d --no-deps app"));
    expect(commands).toContain("sha256:previous|compose up -d --no-deps app");
    expect(commands.match(/sleep 0/g)).toHaveLength(12);
    expect(commands.match(/curl --fail/g)).toHaveLength(1);
    expect(commands).not.toMatch(/\brm\b|\brestore\b|\bdelete\b|data\//);
  });
});
