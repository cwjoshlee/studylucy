import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

async function source(path: string): Promise<string> {
  return await readFile(path, "utf8").catch(() => "");
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
    expect(script).toContain("seq 1 12");
    expect(script).toContain("sleep 5");
    expect(script).toContain("APP_IMAGE=$PREVIOUS_IMAGE docker compose up -d --no-deps app");
    expect(script).toContain("rollback");
    expect(script).not.toMatch(/\brm\b|docker compose down|--volumes|data\/(?:\*|\$)|ports:|webhook|cat \.env|printenv|env\s*$/mi);
  });
});
