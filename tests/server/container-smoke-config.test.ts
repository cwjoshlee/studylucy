import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

async function source(path: string): Promise<string> {
  return await readFile(path, "utf8").catch(() => "");
}

describe("isolated container smoke configuration", () => {
  it("builds the production image without rerunning the full test suite", async () => {
    const dockerfile = await source("Dockerfile");

    expect(dockerfile).toContain("RUN npm run build");
    expect(dockerfile).not.toContain("RUN npm run check");
    expect(dockerfile.indexOf("RUN npm run build"))
      .toBeLessThan(dockerfile.indexOf("npm prune --omit=dev"));
  });

  it("uses a dedicated project, temporary data, and nonproduction port", async () => {
    const [script, smokeCompose, productionCompose] = await Promise.all([
      source("scripts/smoke-container.sh"),
      source("compose.smoke.yaml"),
      source("compose.yaml")
    ]);

    expect(script).toContain("compose.smoke.yaml");
    expect(script).toContain("SMOKE_PROJECT_NAME=\"sua-learning-smoke-$$\"");
    expect(script).toContain("SMOKE_PORT=18787");
    expect(script).not.toContain("SMOKE_PORT:-");
    expect(script).toContain("--project-name \"$SMOKE_PROJECT_NAME\"");
    expect(script).not.toContain("-f compose.yaml");

    expect(smokeCompose).toContain("name: ${SMOKE_PROJECT_NAME:-sua-learning-smoke}");
    expect(smokeCompose).toContain("127.0.0.1:18787:8787");
    expect(smokeCompose).not.toContain("SMOKE_PORT");
    expect(smokeCompose).toContain("/data:uid=1000,gid=1000,mode=0700");
    expect(smokeCompose).not.toContain("./data:/data");
    expect(smokeCompose).not.toContain("env_file:");

    expect(productionCompose).toContain("127.0.0.1:8787:8787");
    expect(productionCompose).toContain("./data:/data");
    expect(productionCompose).toContain("image: ${APP_IMAGE:-ghcr.io/cwjoshlee/studylucy:main}");
    expect(productionCompose).not.toContain("build:");
  });

  it("installs cleanup before startup and logs failures before removing smoke resources", async () => {
    const script = await source("scripts/smoke-container.sh");
    const trapIndex = script.indexOf("trap finish EXIT");
    const upIndex = script.indexOf("up -d --build");
    const logsIndex = script.indexOf("logs --no-color app");
    const downIndex = script.indexOf("down --rmi local --volumes --remove-orphans");

    expect(trapIndex).toBeGreaterThan(-1);
    expect(upIndex).toBeGreaterThan(trapIndex);
    expect(logsIndex).toBeGreaterThan(-1);
    expect(downIndex).toBeGreaterThan(logsIndex);
    expect(script).toContain("down --rmi local --volumes --remove-orphans");
    expect(script).not.toMatch(/^docker compose down/m);
  });

  it("documents isolated smoke and measurable landscape tablet evidence", async () => {
    const [acceptance, tabletGuide] = await Promise.all([
      source("docs/phase1-acceptance.md"),
      source("docs/android-tablet.md")
    ]);

    expect(acceptance).toContain("compose.smoke.yaml");
    expect(acceptance).toContain("127.0.0.1:18787");
    expect(acceptance).toContain("Galaxy Tab 가로 화면 viewport");
    expect(acceptance).toContain("터치 대상 실측 최솟값(>=48px)");
    expect(acceptance).toContain("키보드 탐색/포커스 표시 증거");
    expect(tabletGuide).toContain("화면 방향: 가로 화면 기준");
    expect(tabletGuide).not.toContain("세로와 가로 모두 가능");
  });

  it("installs restore cleanup before artifacts and validates only a copied candidate", async () => {
    const [script, packageJson, guide] = await Promise.all([
      source("scripts/restore-smoke.sh"),
      source("package.json"),
      source("ops/synology/restore-backup.md")
    ]);
    const trapIndex = script.indexOf("trap cleanup EXIT");
    const mktempIndex = script.indexOf("mktemp");
    const copyIndex = script.indexOf('cp -p -- "$BACKUP" "$CANDIDATE"');
    const sqliteIndex = script.indexOf('sqlite3 "$CANDIDATE"');

    expect(trapIndex).toBeGreaterThan(-1);
    expect(mktempIndex).toBeGreaterThan(trapIndex);
    expect(copyIndex).toBeGreaterThan(mktempIndex);
    expect(sqliteIndex).toBeGreaterThan(copyIndex);
    expect(script).toContain('rm -f -- "$CANDIDATE" "${CANDIDATE}-wal" "${CANDIDATE}-shm"');
    expect(script).not.toMatch(/docker|sua-learning\.db|\bmv\b|\bchown\b/);
    expect(script).toContain("BACKUP_RESTORE_SMOKE_OK");

    const scripts = JSON.parse(packageJson).scripts;
    expect(scripts["smoke:container"]).toBe("bash scripts/smoke-container.sh");
    expect(scripts["smoke:restore"]).toBe("bash scripts/restore-smoke.sh");
    expect(guide).toContain("npm run smoke:restore --");
    expect(guide).toContain("컨테이너를 반드시 멈춘 상태");
    expect(guide).not.toContain("fail_candidate()");
    expect(guide.indexOf("cp -- \"$BACKUP\" \"$CANDIDATE\"")).toBe(-1);

    const shellBlocks = [...guide.matchAll(/```sh\n([\s\S]*?)```/g)]
      .map((match) => match[1] ?? "");
    const replacement = shellBlocks.find((block) =>
      block.includes("restore-approved-${STAMP}.sqlite")
    ) ?? "";
    const rollback = shellBlocks.find((block) =>
      block.includes("rollback-candidate-${RESTORE_STAMP}.sqlite")
    ) ?? "";
    const runningAssignment =
      "RUNNING_APP_SERVICES=$(docker compose ps --status running --services app)";
    const stoppedAssertion = 'test -z "$RUNNING_APP_SERVICES"';

    expect(replacement).toContain("set -euo pipefail");
    expect(replacement).toContain(runningAssignment);
    expect(replacement).toContain(stoppedAssertion);
    expect(replacement.indexOf("docker compose stop app"))
      .toBeLessThan(replacement.indexOf(runningAssignment));
    expect(replacement.indexOf(runningAssignment))
      .toBeLessThan(replacement.indexOf(stoppedAssertion));
    expect(replacement.indexOf(stoppedAssertion))
      .toBeLessThan(replacement.indexOf("rm -f -- ./data/sua-learning.db-wal"));
    expect(replacement.indexOf('test -f "$BACKUP"'))
      .toBeLessThan(replacement.indexOf("rm -f -- ./data/sua-learning.db-wal"));
    expect(replacement.indexOf('cp -p -- "$BACKUP" "$CANDIDATE"'))
      .toBeLessThan(replacement.indexOf("rm -f -- ./data/sua-learning.db-wal"));

    expect(rollback).toContain("set -euo pipefail");
    expect(rollback).toContain(runningAssignment);
    expect(rollback).toContain(stoppedAssertion);
    expect(rollback.indexOf("docker compose stop app"))
      .toBeLessThan(rollback.indexOf(runningAssignment));
    expect(rollback.indexOf(runningAssignment))
      .toBeLessThan(rollback.indexOf(stoppedAssertion));
    expect(rollback.indexOf('test -f "$ROLLBACK"'))
      .toBeLessThan(rollback.indexOf("rm -f -- ./data/sua-learning.db-wal"));
    expect(rollback.indexOf('cp -p -- "$ROLLBACK" "$ROLLBACK_CANDIDATE"'))
      .toBeLessThan(rollback.indexOf("rm -f -- ./data/sua-learning.db-wal"));
    expect(`${replacement}\n${rollback}`).not.toMatch(/2>\/dev\/null|\|\| true/);
    expect(`${replacement}\n${rollback}`).not.toContain(
      'test -z "$(docker compose ps --status running --services app)"'
    );
    expect(guide.match(/cp -p -- "\$BACKUP" "\$CANDIDATE"/g)).toHaveLength(1);
  });
});
