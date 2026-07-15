# 수아의 공부방 1단계 플랫폼 기반 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Synology NAS에서 가족 로그인으로 접속하고, 수아가 현재 국어·수학 문제를 풀면 여러 기기에서 같은 진도를 확인할 수 있는 1단계 플랫폼을 완성한다.

**Architecture:** Node.js 22 기반 Fastify 서버가 React PWA, 인증 API, 학습 API와 SQLite를 한 컨테이너에서 제공한다. 새 기기는 보호자가 등록하며 등록된 기기에서만 수아 PIN 로그인을 허용한다. 오늘의 학습 자료와 미전송 풀이는 브라우저 IndexedDB에 저장하고 서버는 `clientAttemptId`로 중복 동기화를 막는다.

**Tech Stack:** Node.js 22, TypeScript 7.0, Fastify 5.10, React 19.2, Vite 8.1, SQLite 3 via better-sqlite3 12.11, Zod 4.4, Vitest 4.1, Testing Library 16.3, vite-plugin-pwa 1.3, Docker Compose

## Global Constraints

- 서비스명과 모든 사용자용 기본 문구는 `수아의 공부방`을 사용한다.
- 전체 학습 사이트는 가족 로그인 뒤에만 보이며 공개 회원가입과 게스트 학습을 제공하지 않는다.
- 새 기기는 보호자 비밀번호로 등록하고 등록된 기기에서만 수아의 4자리 PIN 로그인을 허용한다.
- 13인치 갤럭시 탭 가로 화면을 기본으로 하고 모든 핵심 터치 영역은 최소 48px이다.
- 현재 `prototype/`의 한글 읽기 10개와 20 이하 수학 이야기 10개를 내용 변경 없이 초기 콘텐츠로 이관한다.
- 음성 파일과 전체 음성 전사문은 서버와 SQLite에 저장하지 않는다.
- 외부에는 HTTPS 443만 공개하고 DSM 5001, 앱 내부 포트와 SQLite는 공개하지 않는다.
- SQLite 경로는 `/data/sua-learning.db`, 백업 경로는 `/data/backups`를 기본값으로 사용한다.
- 1단계에는 콘텐츠 편집, 주간 계획, 보상 설정, 적응형 난이도, LLM 문제 생성과 AI 보고서를 구현하지 않는다.
- npm을 사용하고 생성된 `package-lock.json`을 커밋한다.

---

## File Map

### Root and build

- `package.json`: 실행, 테스트, 타입 검사, 빌드와 백업 명령
- `package-lock.json`: 고정된 npm 의존성
- `tsconfig.json`: 공통 TypeScript 설정
- `vite.config.ts`: React 빌드, 개발 API 프록시와 PWA 설정
- `vitest.config.ts`: Node, jsdom과 IndexedDB 테스트 프로젝트
- `.env.example`: 필수 서버 설정 키와 생성 명령
- `index.html`: React 진입 HTML

### Shared contracts

- `src/shared/auth.ts`: 인증 요청·응답 타입과 Zod 스키마
- `src/shared/learning.ts`: 콘텐츠, 오늘의 계획, 풀이와 진도 타입
- `src/shared/reading.ts`: 브라우저와 서버가 공유하는 읽기 결과 타입
- `src/shared/daily-order.ts`: 날짜별 결정적 문제 순서

### Server

- `src/server/config.ts`: 환경 변수 검증
- `src/server/app.ts`: Fastify 조립과 공통 보안 설정
- `src/server/index.ts`: 프로세스 진입점과 정상 종료
- `src/server/db/client.ts`: SQLite 연결
- `src/server/db/migrate.ts`: 트랜잭션 마이그레이션
- `src/server/db/migrations/001-initial.ts`: 1단계 스키마
- `src/server/db/seed.ts`: 현재 20개 콘텐츠 시드
- `src/server/auth/password.ts`: Argon2id 해시와 검증
- `src/server/auth/token.ts`: 토큰 생성과 SHA-256 해시
- `src/server/auth/repository.ts`: 사용자, 기기, 세션과 잠금 저장
- `src/server/auth/service.ts`: 초기 보호자, 로그인, 기기 등록과 수아 PIN 규칙
- `src/server/auth/routes.ts`: 인증 HTTP API와 역할 검사
- `src/server/learning/repository.ts`: 콘텐츠, 풀이와 진도 쿼리
- `src/server/learning/service.ts`: 오늘의 계획과 중복 없는 풀이 저장
- `src/server/learning/routes.ts`: 학생·보호자 학습 API
- `src/server/backup/service.ts`: SQLite 백업과 상태 메타데이터
- `src/server/backup-cli.ts`: DSM 예약 작업에서 실행할 백업 명령

### Client

- `src/client/main.tsx`: React 부트스트랩과 서비스 워커 등록
- `src/client/app.tsx`: 인증 상태별 화면 라우팅
- `src/client/api/client.ts`: JSON API와 401 처리
- `src/client/auth/auth-context.tsx`: 현재 사용자와 로그인 동작
- `src/client/auth/login-screen.tsx`: 초기 설정, 보호자 로그인과 수아 PIN
- `src/client/home/student-home.tsx`: 확정된 태블릿 A안
- `src/client/learning/learning-session.tsx`: 문제 풀이 상태와 통과 잠금
- `src/client/learning/reading-judge.ts`: 현재 한글 읽기 비교 알고리즘
- `src/client/learning/speech-recognition.ts`: Web Speech 수명주기
- `src/client/offline/db.ts`: 오늘의 자료와 풀이 대기열 IndexedDB
- `src/client/offline/sync.ts`: 중복 없는 재전송
- `src/client/guardian/guardian-dashboard.tsx`: 읽기 전용 보호자 진도
- `src/client/styles/tokens.css`: 색, 글자, 간격과 터치 토큰
- `src/client/styles/layout.css`: 학생·보호자 레이아웃
- `src/client/styles/components.css`: 카드, 버튼, 진행률과 피드백
- `src/client/styles/responsive.css`: 태블릿 세로와 휴대폰 대응
- `src/client/sw.ts`: 앱 셸만 캐시하는 서비스 워커

### Operations and tests

- `Dockerfile`: 다단계 Node.js 컨테이너 빌드
- `compose.yaml`: 내부 바인딩, 데이터 볼륨과 헬스 체크
- `ops/synology/README.md`: DDNS, 인증서, 리버스 프록시, 공유기와 백업 설정
- `scripts/smoke-container.sh`: 컨테이너 헬스 스모크 테스트
- `tests/server/*.test.ts`: 설정, DB, 인증, 학습과 백업 통합 테스트
- `tests/client/*.test.tsx`: 로그인, 학생 화면, 학습과 보호자 화면 테스트
- `tests/offline/*.test.ts`: IndexedDB와 재동기화 테스트
- `tests/helpers/app.ts`: Fastify 테스트 앱과 쿠키를 유지하는 테스트 클라이언트
- `tests/helpers/client.ts`: 공통 학습 항목, 오늘 계획, 진도와 API 대역
- `tests/setup.ts`: Testing Library DOM matcher 등록

---

### Task 1: Full-stack toolchain and validated configuration

**Files:**
- Create: `package.json`
- Create: `package-lock.json`
- Create: `tsconfig.json`
- Create: `vite.config.ts`
- Create: `vitest.config.ts`
- Create: `.env.example`
- Create: `index.html`
- Create: `src/server/config.ts`
- Create: `tests/setup.ts`
- Test: `tests/server/config.test.ts`

**Interfaces:**
- Produces: `parseConfig(env: NodeJS.ProcessEnv): AppConfig`
- Produces: `AppConfig` with `nodeEnv`, `host`, `port`, `databasePath`, `backupDir`, `appOrigin`, `setupSecret`, `sessionPepper`, `sessionDays`, and `timeZone`

- [ ] **Step 1: Add the package and compiler definitions**

Create `package.json` with these exact scripts and pinned dependency versions:

```json
{
  "name": "sua-learning-room",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22 <23" },
  "scripts": {
    "dev": "concurrently -k \"vite\" \"tsx watch src/server/index.ts\"",
    "build": "npm run build:client && npm run build:server",
    "build:client": "vite build",
    "build:server": "tsup src/server/index.ts src/server/backup-cli.ts --format esm --platform node --out-dir dist/server --sourcemap",
    "start": "node dist/server/index.js",
    "backup": "node dist/server/backup-cli.js",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "check": "npm run typecheck && npm test && npm run build"
  },
  "dependencies": {
    "@fastify/cookie": "11.1.1",
    "@fastify/helmet": "13.1.0",
    "@fastify/rate-limit": "11.1.0",
    "@fastify/static": "10.1.0",
    "argon2": "0.44.0",
    "better-sqlite3": "12.11.1",
    "fastify": "5.10.0",
    "idb": "8.0.3",
    "nanoid": "6.0.0",
    "react": "19.2.7",
    "react-dom": "19.2.7",
    "react-router-dom": "7.18.1",
    "zod": "4.4.3"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "6.9.1",
    "@testing-library/react": "16.3.2",
    "@testing-library/user-event": "14.6.1",
    "@types/better-sqlite3": "7.6.13",
    "@types/node": "22.20.1",
    "@types/react": "19.2.17",
    "@types/react-dom": "19.2.3",
    "@vitejs/plugin-react": "6.0.3",
    "concurrently": "10.0.3",
    "fake-indexeddb": "6.2.5",
    "jsdom": "29.1.1",
    "tsup": "8.5.1",
    "tsx": "4.23.1",
    "typescript": "7.0.2",
    "vite": "8.1.4",
    "vite-plugin-pwa": "1.3.0",
    "vitest": "4.1.10"
  }
}
```

Run `npm install` to create `package-lock.json`. Configure `tsconfig.json` with `strict: true`, `noUncheckedIndexedAccess: true`, `jsx: "react-jsx"`, `moduleResolution: "Bundler"`, and aliases for `@client/*`, `@server/*`, and `@shared/*`. Configure Vite with `root: "."`, React plugin, `build.outDir: "dist/client"`, and a development `/api` proxy to `http://127.0.0.1:8787`.

Configure Vitest with Node as the default environment and `tests/setup.ts` as `setupFiles`. Put `// @vitest-environment jsdom` at the top of every `tests/client/*.test.tsx` file. `tests/setup.ts` contains `import "@testing-library/jest-dom/vitest";`.

- [ ] **Step 2: Write the failing configuration tests**

```ts
import { describe, expect, it } from "vitest";
import { parseConfig } from "../../src/server/config";

const validEnv = {
  NODE_ENV: "test",
  HOST: "127.0.0.1",
  PORT: "8787",
  DATABASE_PATH: ":memory:",
  BACKUP_DIR: "/tmp/sua-backups",
  APP_ORIGIN: "https://sua.example.test",
  SETUP_SECRET: "s".repeat(32),
  SESSION_PEPPER: "p".repeat(32),
  SESSION_DAYS: "14",
  TIME_ZONE: "Asia/Seoul"
};

describe("parseConfig", () => {
  it("parses a complete configuration", () => {
    expect(parseConfig(validEnv)).toMatchObject({
      host: "127.0.0.1",
      port: 8787,
      databasePath: ":memory:",
      sessionDays: 14
    });
  });

  it("rejects short security secrets", () => {
    expect(() => parseConfig({ ...validEnv, SETUP_SECRET: "short" }))
      .toThrow("SETUP_SECRET");
  });

  it("rejects a non-https production origin", () => {
    expect(() => parseConfig({
      ...validEnv,
      NODE_ENV: "production",
      APP_ORIGIN: "http://sua.example.test"
    })).toThrow("APP_ORIGIN");
  });

  it("rejects an unknown time zone", () => {
    expect(() => parseConfig({ ...validEnv, TIME_ZONE: "Mars/Olympus" }))
      .toThrow("TIME_ZONE");
  });
});
```

- [ ] **Step 3: Run the test and confirm the expected failure**

Run: `npm test -- tests/server/config.test.ts`

Expected: FAIL because `src/server/config.ts` does not exist.

- [ ] **Step 4: Implement strict environment parsing**

```ts
import { z } from "zod";

const ConfigSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  DATABASE_PATH: z.string().min(1).default("/data/sua-learning.db"),
  BACKUP_DIR: z.string().min(1).default("/data/backups"),
  APP_ORIGIN: z.string().url(),
  SETUP_SECRET: z.string().min(32),
  SESSION_PEPPER: z.string().min(32),
  SESSION_DAYS: z.coerce.number().int().min(1).max(90).default(14),
  TIME_ZONE: z.string().default("Asia/Seoul")
});

export type AppConfig = {
  nodeEnv: "development" | "test" | "production";
  host: string;
  port: number;
  databasePath: string;
  backupDir: string;
  appOrigin: string;
  setupSecret: string;
  sessionPepper: string;
  sessionDays: number;
  timeZone: string;
};

export function parseConfig(env: NodeJS.ProcessEnv): AppConfig {
  const value = ConfigSchema.parse(env);
  if (value.NODE_ENV === "production" && !value.APP_ORIGIN.startsWith("https://")) {
    throw new Error("APP_ORIGIN must use https in production");
  }
  try {
    new Intl.DateTimeFormat("ko-KR", { timeZone: value.TIME_ZONE });
  } catch {
    throw new Error("TIME_ZONE is invalid");
  }
  return {
    nodeEnv: value.NODE_ENV,
    host: value.HOST,
    port: value.PORT,
    databasePath: value.DATABASE_PATH,
    backupDir: value.BACKUP_DIR,
    appOrigin: value.APP_ORIGIN,
    setupSecret: value.SETUP_SECRET,
    sessionPepper: value.SESSION_PEPPER,
    sessionDays: value.SESSION_DAYS,
    timeZone: value.TIME_ZONE
  };
}
```

In `.env.example`, list every key, leave secrets empty, set `TIME_ZONE=Asia/Seoul`, and include `openssl rand -hex 32` comments for `SETUP_SECRET` and `SESSION_PEPPER`.

- [ ] **Step 5: Verify and commit**

Run: `npm run typecheck && npm test -- tests/server/config.test.ts`

Expected: 4 tests PASS and TypeScript exits 0.

```bash
git add package.json package-lock.json tsconfig.json vite.config.ts vitest.config.ts .env.example index.html src/server/config.ts tests/setup.ts tests/server/config.test.ts
git commit -m "build: add full-stack TypeScript foundation"
```

---

### Task 2: SQLite schema, migrations, and current-content seed

**Files:**
- Create: `src/shared/learning.ts`
- Create: `src/shared/reading.ts`
- Create: `src/server/db/client.ts`
- Create: `src/server/db/migrate.ts`
- Create: `src/server/db/migrations/001-initial.ts`
- Create: `src/server/db/seed.ts`
- Test: `tests/server/db.test.ts`
- Source data: `prototype/app.js:1-283`

**Interfaces:**
- Produces: `openDatabase(path: string): Database.Database`
- Produces: `migrate(db: Database.Database): void`
- Produces: `seedInitialContent(db: Database.Database): void`
- Produces: `LearningItemPayload` discriminated by `kind: "korean-reading" | "math-story"`

- [ ] **Step 1: Define shared content contracts**

```ts
import { z } from "zod";

const BaseItem = z.object({
  id: z.string().min(1),
  subject: z.enum(["korean", "math"]),
  unit: z.string().min(1),
  title: z.string().min(1),
  level: z.string().min(1),
  readLabel: z.string().min(1),
  text: z.string().min(1),
  hint: z.string(),
  tokens: z.array(z.string().min(1)).min(1)
});

export const LearningItemPayloadSchema = z.discriminatedUnion("kind", [
  BaseItem.extend({ kind: z.literal("korean-reading") }),
  BaseItem.extend({
    kind: z.literal("math-story"),
    question: z.string().min(1),
    answer: z.number().int(),
    unitLabel: z.string(),
    checkHint: z.string().min(1)
  })
]);

export type LearningItemPayload = z.infer<typeof LearningItemPayloadSchema>;

export type ReadingResult = {
  score: number;
  passed: boolean;
  missedTokens: string[];
};
```

- [ ] **Step 2: Write failing migration and seed tests**

```ts
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "../../src/server/db/client";
import { migrate } from "../../src/server/db/migrate";
import { seedInitialContent } from "../../src/server/db/seed";

describe("database bootstrap", () => {
  const db = openDatabase(":memory:");
  afterEach(() => db.exec("DELETE FROM attempts; DELETE FROM content_versions; DELETE FROM content_items;"));

  it("runs migrations idempotently", () => {
    migrate(db);
    migrate(db);
    expect(db.prepare("select count(*) as count from schema_migrations").get())
      .toEqual({ count: 1 });
  });

  it("seeds the exact ten Korean and ten math items", () => {
    migrate(db);
    seedInitialContent(db);
    seedInitialContent(db);
    const rows = db.prepare("select subject, count(*) as count from content_items group by subject order by subject").all();
    expect(rows).toEqual([
      { subject: "korean", count: 10 },
      { subject: "math", count: 10 }
    ]);
  });
});
```

- [ ] **Step 3: Run tests and confirm missing modules**

Run: `npm test -- tests/server/db.test.ts`

Expected: FAIL because database modules do not exist.

- [ ] **Step 4: Implement the initial schema**

`001-initial.ts` must execute one SQL transaction containing these tables and constraints:

```sql
CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  role TEXT NOT NULL CHECK (role IN ('guardian','student')),
  display_name TEXT NOT NULL,
  credential_hash TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE trusted_devices (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES users(id),
  trusted_device_id TEXT REFERENCES trusted_devices(id),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE auth_failures (
  key TEXT PRIMARY KEY,
  failure_count INTEGER NOT NULL,
  locked_until TEXT,
  updated_at TEXT NOT NULL
);
CREATE TABLE curriculum_nodes (
  id TEXT PRIMARY KEY,
  parent_id TEXT REFERENCES curriculum_nodes(id),
  kind TEXT NOT NULL CHECK (kind IN ('grade','subject','unit','skill')),
  code TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  sort_order INTEGER NOT NULL
);
CREATE TABLE content_items (
  id TEXT PRIMARY KEY,
  skill_id TEXT NOT NULL REFERENCES curriculum_nodes(id),
  subject TEXT NOT NULL CHECK (subject IN ('korean','math')),
  status TEXT NOT NULL CHECK (status IN ('published','archived')) DEFAULT 'published',
  active_version INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE content_versions (
  item_id TEXT NOT NULL REFERENCES content_items(id),
  version INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (item_id, version)
);
CREATE TABLE attempts (
  id TEXT PRIMARY KEY,
  client_attempt_id TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES users(id),
  item_id TEXT NOT NULL REFERENCES content_items(id),
  content_version INTEGER NOT NULL,
  study_date TEXT NOT NULL,
  reading_score INTEGER NOT NULL CHECK (reading_score BETWEEN 0 AND 100),
  reading_pass INTEGER NOT NULL CHECK (reading_pass IN (0,1)),
  missed_tokens_json TEXT NOT NULL DEFAULT '[]',
  math_answer_json TEXT,
  math_pass INTEGER CHECK (math_pass IS NULL OR math_pass IN (0,1)),
  duration_ms INTEGER NOT NULL CHECK (duration_ms >= 0),
  difficulty_feedback TEXT CHECK (difficulty_feedback IS NULL OR difficulty_feedback IN ('easy','thinking','hard')),
  created_at TEXT NOT NULL,
  FOREIGN KEY (item_id, content_version) REFERENCES content_versions(item_id, version)
);
CREATE TABLE backup_runs (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('success','failure')),
  path TEXT,
  error_code TEXT,
  created_at TEXT NOT NULL
);
```

`migrate()` must wrap each migration in `db.transaction`, insert the version only after success, and enable `PRAGMA foreign_keys = ON` plus `PRAGMA journal_mode = WAL` for file databases.

- [ ] **Step 5: Move and seed the current content without copy changes**

Move the `PROBLEMS` values from `prototype/app.js:22-283` into a typed `INITIAL_ITEMS: LearningItemPayload[]` in `seed.ts`. Map `mode: "korean"` to `kind: "korean-reading"` and `mode: "math"` to `kind: "math-story"`; preserve every ID, Korean string, English hint, token, answer, unit and check hint exactly. Seed grade 1, Korean, math, two current units, and one skill per current mode before inserting content version 1 with `INSERT OR IGNORE`.

- [ ] **Step 6: Verify and commit**

Run: `npm run typecheck && npm test -- tests/server/db.test.ts`

Expected: migration and 20-item seed tests PASS.

```bash
git add src/shared src/server/db tests/server/db.test.ts
git commit -m "feat: add learning database and seed content"
```

---

### Task 3: Fastify application shell and HTTP security

**Files:**
- Create: `src/server/app.ts`
- Create: `src/server/index.ts`
- Create: `src/server/security/origin.ts`
- Test: `tests/server/app.test.ts`
- Test helper: `tests/helpers/app.ts`

**Interfaces:**
- Consumes: `AppConfig`, `openDatabase()`, `migrate()`, `seedInitialContent()`
- Produces: `buildApp(deps: AppDeps): Promise<FastifyInstance>`
- Produces: `AppDeps` with `config`, `db`, `now(): Date`, and `randomToken(): string`

- [ ] **Step 1: Write failing health and origin tests**

```ts
it("returns a minimal health response with security headers", async () => {
  const response = await app.inject({ method: "GET", url: "/api/health" });
  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual({ status: "ok" });
  expect(response.headers["x-content-type-options"]).toBe("nosniff");
});

it("rejects a state-changing cross-origin API request", async () => {
  app.post("/api/test-write", async () => ({ ok: true }));
  const response = await app.inject({
    method: "POST",
    url: "/api/test-write",
    headers: { origin: "https://attacker.example" }
  });
  expect(response.statusCode).toBe(403);
  expect(response.json()).toEqual({ code: "ORIGIN_NOT_ALLOWED" });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npm test -- tests/server/app.test.ts`

Expected: FAIL because `buildApp` does not exist.

- [ ] **Step 3: Implement application composition**

`buildApp` must register cookie, helmet and rate-limit plugins; add the same-origin hook to non-GET `/api/*` requests; expose only `{ status: "ok" }` at `/api/health`; and accept dependency injection for tests.

```ts
export type AppDeps = {
  config: AppConfig;
  db: Database.Database;
  now: () => Date;
  randomToken: () => string;
};

export async function buildApp(deps: AppDeps) {
  const app = Fastify({ logger: deps.config.nodeEnv !== "test" });
  await app.register(cookie);
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"]
      }
    }
  });
  await app.register(rateLimit, { max: 120, timeWindow: "1 minute" });
  app.addHook("preHandler", createOriginGuard(deps.config.appOrigin));
  app.get("/api/health", async () => ({ status: "ok" as const }));
  return app;
}
```

`index.ts` must parse config, open and migrate the database, seed content, build the app, listen on configured host and port, and close Fastify plus SQLite on `SIGTERM` and `SIGINT`.

Before parsing config, `index.ts` calls Node 22's `loadEnvFile(".env")` only when `.env` exists. `tests/helpers/app.ts` uses this cookie-preserving client and builds a migrated in-memory test app:

```ts
export class TestClient {
  private cookies = new Map<string, string>();

  constructor(private app: FastifyInstance, private origin: string) {}

  async request(method: string, url: string, payload?: unknown) {
    const cookie = [...this.cookies].map(([key, value]) => `${key}=${value}`).join("; ");
    const response = await this.app.inject({
      method,
      url,
      payload,
      headers: { origin: this.origin, ...(cookie ? { cookie } : {}) }
    });
    const values = response.headers["set-cookie"];
    for (const value of values ? (Array.isArray(values) ? values : [values]) : []) {
      const match = /^([^=]+)=([^;]*)/.exec(value);
      if (match?.[1] !== undefined && match[2] !== undefined) {
        this.cookies.set(match[1], match[2]);
      }
    }
    return response;
  }
}

export async function createTestHarness() {
  const db = openDatabase(":memory:");
  migrate(db);
  seedInitialContent(db);
  const config = parseConfig(TEST_ENV);
  let sequence = 0;
  const app = await buildApp({
    config,
    db,
    now: () => new Date("2026-07-15T03:00:00.000Z"),
    randomToken: () => `test-token-${String(++sequence).padStart(4, "0")}`
  });
  return {
    app,
    config,
    client: () => new TestClient(app, config.appOrigin),
    close: async () => { await app.close(); db.close(); }
  };
}
```

Auth and learning tests use this helper instead of undefined request wrappers.

- [ ] **Step 4: Verify and commit**

Run: `npm run typecheck && npm test -- tests/server/app.test.ts`

Expected: health and origin tests PASS.

```bash
git add src/server/app.ts src/server/index.ts src/server/security tests/helpers/app.ts tests/server/app.test.ts
git commit -m "feat: add secure Fastify application shell"
```

---

### Task 4: Guardian setup, trusted devices, and student PIN authentication

**Files:**
- Create: `src/shared/auth.ts`
- Create: `src/server/auth/password.ts`
- Create: `src/server/auth/token.ts`
- Create: `src/server/auth/repository.ts`
- Create: `src/server/auth/service.ts`
- Create: `src/server/auth/routes.ts`
- Modify: `src/server/app.ts`
- Test: `tests/server/auth.test.ts`

**Interfaces:**
- Produces: `POST /api/auth/setup`
- Produces: `POST /api/auth/guardian/login`
- Produces: `POST /api/auth/devices`
- Produces: `PUT /api/auth/student-pin`
- Produces: `POST /api/auth/student/login`
- Produces: `POST /api/auth/logout`
- Produces: `GET /api/auth/me`
- Produces: `requireRole("guardian" | "student")`

- [ ] **Step 1: Define exact request validation**

```ts
export const SetupRequest = z.object({
  setupSecret: z.string().min(32),
  guardianName: z.string().trim().min(1).max(40),
  password: z.string().min(12).max(128),
  studentName: z.string().trim().min(1).max(20)
});
export const GuardianLoginRequest = z.object({ password: z.string().min(1) });
export const RegisterDeviceRequest = z.object({ name: z.string().trim().min(1).max(60) });
export const StudentPinRequest = z.object({ pin: z.string().regex(/^\d{4}$/) });
export type CurrentUser = { id: string; role: "guardian" | "student"; displayName: string };
```

- [ ] **Step 2: Write the failing end-to-end auth test**

The test must execute this complete sequence with Fastify `inject`:

```ts
const client = harness.client();
const setup = await client.request("POST", "/api/auth/setup", {
  setupSecret: config.setupSecret,
  guardianName: "보호자",
  password: "correct horse battery staple",
  studentName: "수아"
});
expect(setup.statusCode).toBe(201);

const secondSetup = await client.request("POST", "/api/auth/setup", {
  setupSecret: config.setupSecret,
  guardianName: "다른 보호자",
  password: "another correct password",
  studentName: "다른 학생"
});
expect(secondSetup.statusCode).toBe(409);

const guardianLogin = await client.request("POST", "/api/auth/guardian/login", {
  password: "correct horse battery staple"
});
expect(guardianLogin.statusCode).toBe(204);

const register = await client.request("POST", "/api/auth/devices", { name: "수아 갤럭시 탭" });
expect(register.statusCode).toBe(201);

const setPin = await client.request("PUT", "/api/auth/student-pin", { pin: "2580" });
expect(setPin.statusCode).toBe(204);

await client.request("POST", "/api/auth/logout");
const studentLogin = await client.request("POST", "/api/auth/student/login", { pin: "2580" });
expect(studentLogin.statusCode).toBe(204);
expect(await client.request("GET", "/api/auth/me")).toMatchObject({ statusCode: 200 });
```

Add these separate assertions:

```ts
const untrusted = harness.client();
const untrustedLogin = await untrusted.request("POST", "/api/auth/student/login", { pin: "2580" });
expect(untrustedLogin.statusCode).toBe(403);
expect(untrustedLogin.json()).toEqual({ code: "DEVICE_NOT_TRUSTED" });

await client.request("POST", "/api/auth/logout");
for (let attempt = 0; attempt < 4; attempt += 1) {
  expect((await client.request("POST", "/api/auth/student/login", { pin: "0000" })).statusCode).toBe(401);
}
const locked = await client.request("POST", "/api/auth/student/login", { pin: "0000" });
expect(locked.statusCode).toBe(429);
expect(locked.json()).toEqual({ code: "AUTH_LOCKED" });

const guardianOnly = await studentClient.request("GET", "/api/auth/test-guardian-only");
expect(guardianOnly.statusCode).toBe(403);
expect(guardianOnly.json()).toEqual({ code: "ROLE_FORBIDDEN" });
```

Register `/api/auth/test-guardian-only` only inside the test app with `requireRole("guardian")`. Build `studentClient` through the successful setup, device, PIN, logout, and student-login sequence shown above.

- [ ] **Step 3: Run and confirm failure**

Run: `npm test -- tests/server/auth.test.ts`

Expected: FAIL because auth routes are not registered.

- [ ] **Step 4: Implement password, token, and session rules**

Use Argon2id with the library defaults plus `type: argon2.argon2id`. Generate 32-byte random session and device tokens, store only `sha256(token + sessionPepper)`, and set these cookies:

```ts
const sessionCookie = {
  path: "/",
  httpOnly: true,
  secure: config.nodeEnv === "production",
  sameSite: "strict" as const,
  maxAge: config.sessionDays * 86_400
};

reply.setCookie("sua_session", rawSessionToken, sessionCookie);
reply.setCookie("sua_device", rawDeviceToken, {
  ...sessionCookie,
  maxAge: 365 * 86_400
});
```

`bootstrapGuardian` must compare `setupSecret` using `timingSafeEqual`, create exactly one guardian and one student inside a transaction, and refuse all later setup calls. `loginStudent` must require a non-revoked trusted device token before checking the PIN. Record failures by `guardian:<remoteAddress>` or `student:<deviceId>` and lock for 15 minutes after five failures inside 10 minutes.

- [ ] **Step 5: Register auth routes and verify**

Run: `npm run typecheck && npm test -- tests/server/auth.test.ts`

Expected: all setup, device, PIN, lockout and role tests PASS.

```bash
git add src/shared/auth.ts src/server/auth src/server/app.ts tests/server/auth.test.ts
git commit -m "feat: add family and trusted-device authentication"
```

---

### Task 5: Today plan, idempotent attempts, and guardian progress API

**Files:**
- Create: `src/shared/daily-order.ts`
- Modify: `src/shared/learning.ts`
- Create: `src/server/learning/repository.ts`
- Create: `src/server/learning/service.ts`
- Create: `src/server/learning/routes.ts`
- Modify: `src/server/app.ts`
- Test: `tests/server/learning.test.ts`
- Source logic: `prototype/app.js:400-435, 1142-1275`

**Interfaces:**
- Produces: `GET /api/student/today?date=YYYY-MM-DD`
- Produces: `POST /api/student/attempts`
- Produces: `GET /api/guardian/progress?from=YYYY-MM-DD&to=YYYY-MM-DD`
- Produces: `getDailyItems<T extends {id: string}>(items: T[], date: string): T[]`

- [ ] **Step 1: Define attempt and progress contracts**

```ts
export const AttemptInputSchema = z.object({
  clientAttemptId: z.string().min(12).max(80),
  itemId: z.string().min(1),
  contentVersion: z.number().int().positive(),
  studyDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  readingScore: z.number().int().min(0).max(100),
  missedTokens: z.array(z.string().min(1)).max(20),
  mathAnswer: z.number().int().nullable(),
  durationMs: z.number().int().min(0).max(3_600_000),
  difficultyFeedback: z.enum(["easy", "thinking", "hard"]).nullable()
});

export type TodayPlan = {
  date: string;
  completedItemIds: string[];
  items: Array<{ id: string; version: number; payload: LearningItemPayload }>;
};

export type GuardianProgress = {
  completedItems: number;
  totalAttempts: number;
  readingPassRate: number;
  mathPassRate: number;
  recentReviewTokens: Array<{ token: string; count: number }>;
};

export type AttemptReceipt = {
  id: string;
  duplicate: boolean;
  readingPass: boolean;
  mathPass: boolean | null;
  completed: boolean;
};

export type SyncResult = { sent: number; remaining: number };
```

- [ ] **Step 2: Write failing learning integration tests**

Tests authenticate a student and perform these exact assertions:

```ts
const attemptInput = {
  clientAttemptId: "client-attempt-0001",
  itemId: "ko-01",
  contentVersion: 1,
  studyDate: "2026-07-15",
  readingScore: 100,
  missedTokens: [],
  mathAnswer: null,
  durationMs: 12_000,
  difficultyFeedback: null
};
const firstPlan = await student.request("GET", "/api/student/today?date=2026-07-15");
const secondPlan = await student.request("GET", "/api/student/today?date=2026-07-15");
expect(secondPlan.json().items.map((item: { id: string }) => item.id))
  .toEqual(firstPlan.json().items.map((item: { id: string }) => item.id));

const firstSave = await student.request("POST", "/api/student/attempts", attemptInput);
const duplicateSave = await student.request("POST", "/api/student/attempts", attemptInput);
expect(duplicateSave.json()).toMatchObject({ id: firstSave.json().id, duplicate: true });

const forbidden = await student.request("GET", "/api/guardian/progress?from=2026-07-15&to=2026-07-15");
expect(forbidden.statusCode).toBe(403);

const stale = await student.request("POST", "/api/student/attempts", { ...attemptInput, contentVersion: 999 });
expect(stale.statusCode).toBe(409);
expect(stale.json()).toEqual({ code: "CONTENT_VERSION_CONFLICT" });
```

After logging in with a separate guardian client, assert `totalAttempts` is 1 rather than 2.

- [ ] **Step 3: Run and confirm failure**

Run: `npm test -- tests/server/learning.test.ts`

Expected: FAIL because learning routes are missing.

- [ ] **Step 4: Port deterministic ordering and implement repositories**

Move `getDailyProblems`, `seededShuffle`, `hashSeed`, and `nextSeed` from `prototype/app.js:1237-1275` to `src/shared/daily-order.ts`. Remove all global state and expose this pure signature:

```ts
export function getDailyItems<T extends { id: string }>(items: readonly T[], date: string): T[] {
  return seededShuffle([...items], hashSeed(date));
}
```

`saveAttempt` must first query by `client_attempt_id`; return that row when present. Otherwise verify the requested content version equals the current active version and insert the attempt in one transaction. The server computes `readingPass` as `readingScore >= 85 && missedTokens.length === 0` and computes `mathPass` from the stored answer for math problems. PASS values are returned in the receipt and are never accepted from the client.

- [ ] **Step 5: Implement routes and guardian aggregation**

The student today route returns active content only. The guardian summary computes completed items, pass rates and missed-token counts from stored result fields; it must never return full manual transcripts because no transcript column exists.

- [ ] **Step 6: Verify and commit**

Run: `npm run typecheck && npm test -- tests/server/learning.test.ts`

Expected: deterministic ordering, idempotency, authorization and progress tests PASS.

```bash
git add src/shared src/server/learning src/server/app.ts tests/server/learning.test.ts
git commit -m "feat: add synchronized learning progress API"
```

---

### Task 6: Login experience and the 13-inch tablet A dashboard

**Files:**
- Create: `src/client/main.tsx`
- Create: `src/client/app.tsx`
- Create: `src/client/api/client.ts`
- Create: `src/client/auth/auth-context.tsx`
- Create: `src/client/auth/login-screen.tsx`
- Create: `src/client/home/student-home.tsx`
- Create: `src/client/styles/tokens.css`
- Create: `src/client/styles/layout.css`
- Create: `src/client/styles/components.css`
- Create: `src/client/styles/responsive.css`
- Copy: `prototype/assets/*` to `public/assets/`
- Modify: `src/server/app.ts`
- Create: `tests/helpers/client.ts`
- Test: `tests/client/login-and-home.test.tsx`

**Interfaces:**
- Consumes: `/api/auth/*`, `/api/student/today`
- Produces: `ApiClient` methods `me`, `setup`, `guardianLogin`, `registerDevice`, `setStudentPin`, `studentLogin`, `logout`, `today`, `saveAttempt`, `guardianProgress`, and `backupStatus`
- Produces: `AuthProvider` with `user`, `loading`, `refresh`, and auth actions

- [ ] **Step 1: Write failing login and A-dashboard component tests**

Create `tests/helpers/client.ts` with one Korean item, one math item, a fixed `todayPlan`, a fixed guardian progress result, a `backupSuccess` result, and this API factory:

```ts
export function createFakeApi(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    me: vi.fn().mockResolvedValue({ id: "student-1", role: "student", displayName: "수아" }),
    setup: vi.fn().mockResolvedValue(undefined),
    guardianLogin: vi.fn().mockResolvedValue(undefined),
    registerDevice: vi.fn().mockResolvedValue(undefined),
    setStudentPin: vi.fn().mockResolvedValue(undefined),
    studentLogin: vi.fn().mockResolvedValue(undefined),
    logout: vi.fn().mockResolvedValue(undefined),
    today: vi.fn().mockResolvedValue(todayPlan),
    saveAttempt: vi.fn().mockResolvedValue({ id: "attempt-1", duplicate: false, readingPass: true, mathPass: null, completed: true }),
    guardianProgress: vi.fn().mockResolvedValue(progress),
    backupStatus: vi.fn().mockResolvedValue({ status: "never-run", completedAt: null, filename: null }),
    ...overrides
  };
}
```

Define `koreanItem`, `mathItem`, `todayPlan`, and `progress` as exported typed constants using the exact `ko-01` and `math-01` seed payloads so every later client test imports the same fixtures.

```tsx
it("shows setup only when the server reports SETUP_REQUIRED", async () => {
  const api = createFakeApi({ me: vi.fn().mockRejectedValue(new ApiError(409, "SETUP_REQUIRED")) });
  render(<App api={api} />);
  expect(await screen.findByRole("heading", { name: "수아의 공부방 시작하기" })).toBeVisible();
});

it("renders the selected A layout for the student", async () => {
  render(<App api={createFakeApi()} />);
  expect(await screen.findByText("오늘의 학습")).toBeVisible();
  expect(screen.getByText("수아야, 오늘도 한 걸음!")).toBeVisible();
  expect(screen.getByText("국어")).toBeVisible();
  expect(screen.getByText("수학")).toBeVisible();
  expect(screen.getByRole("button", { name: "이어서 공부하기" })).toBeEnabled();
});
```

Add a CSS contract test that reads `tokens.css`, asserts it declares `--touch-min: 48px`, and reads `components.css` to assert primary buttons use `min-height: var(--touch-min)`.

- [ ] **Step 2: Run and confirm failure**

Run: `npm test -- tests/client/login-and-home.test.tsx`

Expected: FAIL because client components do not exist.

- [ ] **Step 3: Implement API and authentication state**

`ApiClient.request` must always send credentials, use JSON, and turn non-2xx bodies into a typed `ApiError`:

```ts
export class ApiError extends Error {
  constructor(public status: number, public code: string) {
    super(code);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers: { "content-type": "application/json", ...init.headers }
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ code: "REQUEST_FAILED" }));
    throw new ApiError(response.status, body.code);
  }
  return response.status === 204 ? undefined as T : response.json();
}
```

The login screen must support first setup, guardian login, current-device registration, PIN creation and student PIN login without exposing one form before its prerequisite succeeds.

- [ ] **Step 4: Implement the approved A dashboard**

Build the 13-inch landscape grid as `225px minmax(0, 1fr) 225px` with today tasks on the left, the next activity in the center and progress on the right. At widths below 950px hide the right column and place its cards after the center; below 700px use one column. Reuse the existing icon PNGs and the approved green, warm paper and yellow palette. Do not copy Khan Academy trademarks or page copy.

Because rewards are a later phase, Phase 1 must not display invented star totals. Show completed activity counts and a disabled `보상 기능 준비 중` card in the approved reward position.

In production, register `@fastify/static` in `src/server/app.ts` with root `dist/client`. Return `index.html` for non-API navigation paths and never use the SPA fallback for `/api/*`.

- [ ] **Step 5: Verify and commit**

Run: `npm run typecheck && npm test -- tests/client/login-and-home.test.tsx && npm run build:client`

Expected: component tests PASS and Vite creates `dist/client`.

```bash
git add src/client public index.html src/server/app.ts tests/helpers/client.ts tests/client/login-and-home.test.tsx
git commit -m "feat: add family login and tablet student home"
```

---

### Task 7: Port the current reading and math learning loop

**Files:**
- Create: `src/client/learning/reading-judge.ts`
- Create: `src/client/learning/speech-recognition.ts`
- Create: `src/client/learning/learning-session.tsx`
- Modify: `src/client/app.tsx`
- Modify: `src/client/home/student-home.tsx`
- Modify: `src/client/styles/components.css`
- Test: `tests/client/reading-judge.test.ts`
- Test: `tests/client/learning-session.test.tsx`
- Source logic: `prototype/app.js:436-1140`

**Interfaces:**
- Produces: `judgeReading(item: LearningItemPayload, transcript: string): ReadingResult`
- Produces: `SpeechController` with `start()`, `finish()`, `cancel()`, and `supported`
- Consumes: `ApiClient.saveAttempt(input)`

- [ ] **Step 1: Lock existing reading behavior with failing characterization tests**

Create tests for these exact behaviors:

```ts
it("passes an exact Korean reading", () => {
  const result = judgeReading(koreanItem, koreanItem.text);
  expect(result).toEqual({ score: 100, passed: true, missedTokens: [] });
});

it("fails when a required token is missing even above the score threshold", () => {
  const requiredToken = koreanItem.tokens[0]!;
  const transcriptWithoutRequiredToken = koreanItem.text.replace(requiredToken, "");
  const result = judgeReading(koreanItem, transcriptWithoutRequiredToken);
  expect(result.score).toBeGreaterThanOrEqual(85);
  expect(result.passed).toBe(false);
  expect(result.missedTokens).toContain(requiredToken);
});

it("keeps math answers locked until reading passes", async () => {
  render(<LearningSession item={mathItem} api={createFakeApi()} />);
  expect(screen.getByLabelText("답 쓰기")).toBeDisabled();
  await submitManualTranscript(mathItem.text + " " + mathItem.question);
  expect(screen.getByLabelText("답 쓰기")).toBeEnabled();
});
```

Also cover the 60-second capture limit, manual transcript fallback, wrong math answer keeping Next disabled, and correct math answer enabling Next.

- [ ] **Step 2: Run and confirm failure**

Run: `npm test -- tests/client/reading-judge.test.ts tests/client/learning-session.test.tsx`

Expected: FAIL because learning modules do not exist.

- [ ] **Step 3: Port pure reading functions before UI state**

Move and type the pure functions from `prototype/app.js`: text cleaning, best transcript window, similarity, token ranges, Korean number aliases, Hangul Jamo conversion and Levenshtein distance. Preserve the approved pass rule:

```ts
const READING_PASS_SCORE = 85;
return {
  score,
  passed: score >= READING_PASS_SCORE && missedTokens.length === 0,
  missedTokens
};
```

Do not include browser globals in `reading-judge.ts` so Node tests run without mocks.

- [ ] **Step 4: Implement speech and learning session state**

Wrap `webkitSpeechRecognition` behind `SpeechController`. Accumulate final segments, collapse overlapping repeats, restart after quiet auto-end while inside the 60-second session, and grade only when the user presses `읽기 완료` or time expires. Keep `manualTranscript` only in component state and send only score, pass state, duration and missed token identifiers to the server.

For Korean reading, enable Next only after reading pass. For math, require both reading pass and server-confirmed math pass. Use the server response rather than a client-only answer comparison as the stored result.

- [ ] **Step 5: Verify and commit**

Run: `npm run typecheck && npm test -- tests/client/reading-judge.test.ts tests/client/learning-session.test.tsx`

Expected: all reading, speech fallback and gating tests PASS.

```bash
git add src/client/learning src/client/app.tsx src/client/home src/client/styles tests/client
git commit -m "feat: port reading and math practice loop"
```

---

### Task 8: PWA app shell and offline attempt synchronization

**Files:**
- Create: `src/client/offline/db.ts`
- Create: `src/client/offline/sync.ts`
- Create: `src/client/sw.ts`
- Modify: `src/client/main.tsx`
- Modify: `src/client/api/client.ts`
- Modify: `vite.config.ts`
- Test: `tests/offline/db.test.ts`
- Test: `tests/offline/sync.test.ts`

**Interfaces:**
- Produces: `cacheTodayPlan(plan: TodayPlan): Promise<void>`
- Produces: `loadCachedTodayPlan(date: string): Promise<TodayPlan | undefined>`
- Produces: `queueAttempt(input: AttemptInput): Promise<void>`
- Produces: `flushAttempts(save: (input: AttemptInput) => Promise<AttemptReceipt>): Promise<SyncResult>`
- Produces: `clearTrustedDeviceData(): Promise<void>`

- [ ] **Step 1: Write failing IndexedDB and synchronization tests**

Use `fake-indexeddb/auto` and assert:

```ts
it("returns the cached plan for the requested date only", async () => {
  await cacheTodayPlan(todayPlan);
  expect(await loadCachedTodayPlan(todayPlan.date)).toEqual(todayPlan);
  expect(await loadCachedTodayPlan("2026-07-16")).toBeUndefined();
});

it("removes only attempts acknowledged by the server", async () => {
  await queueAttempt(first);
  await queueAttempt(second);
  const save = vi.fn()
    .mockResolvedValueOnce({ id: "server-1", duplicate: false })
    .mockRejectedValueOnce(new TypeError("offline"));
  expect(await flushAttempts(save)).toEqual({ sent: 1, remaining: 1 });
});
```

Add a test proving that enqueuing the same `clientAttemptId` twice leaves one record. A 401 preserves the plan and queue so an expired session can log in again; an explicit `DEVICE_REVOKED` response clears all trusted-device data.

- [ ] **Step 2: Run and confirm failure**

Run: `npm test -- tests/offline/db.test.ts tests/offline/sync.test.ts`

Expected: FAIL because offline modules do not exist.

- [ ] **Step 3: Implement IndexedDB stores and retry rules**

Create database `sua-learning-v1` with stores `todayPlans` keyed by date and `attemptQueue` keyed by `clientAttemptId`. `flushAttempts` sends oldest first, stops on network failure, removes 200/201 duplicate receipts, and leaves 409 records with an explicit `conflict` status for the guardian to resolve after reconnect.

When offline, the client may use the answer already contained in the cached item payload for immediate math feedback. The queued attempt remains provisional until the server recomputes PASS after synchronization.

- [ ] **Step 4: Add the PWA shell without caching authenticated API responses**

Configure `vite-plugin-pwa` in `injectManifest` mode. `sw.ts` may precache hashed build assets, icons and `index.html`; it must not cache `/api/*`, cookies, today-plan JSON or attempts. Register the worker after React mounts. Use IndexedDB, not Cache Storage, for authenticated learning data.

- [ ] **Step 5: Verify and commit**

Run: `npm run typecheck && npm test -- tests/offline && npm run build:client`

Expected: offline tests PASS and build output contains a generated service worker plus manifest.

```bash
git add src/client/offline src/client/sw.ts src/client/main.tsx src/client/api vite.config.ts tests/offline
git commit -m "feat: add offline learning sync and PWA shell"
```

---

### Task 9: Read-only guardian progress dashboard

**Files:**
- Create: `src/client/guardian/guardian-dashboard.tsx`
- Modify: `src/client/app.tsx`
- Modify: `src/client/styles/layout.css`
- Modify: `src/client/styles/components.css`
- Test: `tests/client/guardian-dashboard.test.tsx`

**Interfaces:**
- Consumes: `ApiClient.guardianProgress(from, to): Promise<GuardianProgress>`
- Produces: `/guardian` route available only to guardian sessions

- [ ] **Step 1: Write failing dashboard tests**

```tsx
it("shows progress without exposing transcripts", async () => {
  render(<GuardianDashboard api={createFakeApi()} />);
  expect(await screen.findByText("수아의 이번 주")).toBeVisible();
  expect(screen.getByText("완료한 활동")).toBeVisible();
  expect(screen.getByText("다시 볼 표현")).toBeVisible();
  expect(screen.queryByText("전체 전사문")).not.toBeInTheDocument();
});

it("shows backup status separately from learning metrics", async () => {
  const api = createFakeApi({ backupStatus: vi.fn().mockResolvedValue(backupSuccess) });
  render(<GuardianDashboard api={api} />);
  expect(await screen.findByText("어젯밤 자동 백업이 정상적으로 완료되었습니다.")).toBeVisible();
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npm test -- tests/client/guardian-dashboard.test.tsx`

Expected: FAIL because the dashboard does not exist.

- [ ] **Step 3: Implement the approved guardian summary layout**

Render date range, completed activities, reading and math pass rates, subject progress, recent missed tokens and backup status. Menu entries for later phases may be visible with `준비 중` labels but must be disabled and must not call nonexistent APIs. Student sessions that navigate to `/guardian` must be redirected to the student home.

- [ ] **Step 4: Verify and commit**

Run: `npm run typecheck && npm test -- tests/client/guardian-dashboard.test.tsx`

Expected: dashboard and role-routing tests PASS.

```bash
git add src/client/guardian src/client/app.tsx src/client/styles tests/client/guardian-dashboard.test.tsx
git commit -m "feat: add guardian progress dashboard"
```

---

### Task 10: Consistent SQLite backups and guardian backup status

**Files:**
- Create: `src/server/backup/service.ts`
- Create: `src/server/backup-cli.ts`
- Modify: `src/server/learning/routes.ts`
- Modify: `src/client/api/client.ts`
- Modify: `src/client/guardian/guardian-dashboard.tsx`
- Test: `tests/server/backup.test.ts`

**Interfaces:**
- Produces: `createBackup(db, backupDir, now): Promise<BackupRun>`
- Produces: `rotateBackups(backupDir, dailyKeep = 14, weeklyKeep = 8): Promise<void>`
- Produces: `GET /api/guardian/backup-status`

```ts
export type BackupRun = {
  id: string;
  status: "success" | "failure";
  filename: string | null;
  completedAt: string;
  errorCode: string | null;
};

export type BackupStatus =
  | { status: "never-run"; completedAt: null; filename: null }
  | { status: "success" | "failure"; completedAt: string; filename: string | null };
```

- [ ] **Step 1: Write failing backup and rotation tests**

Create a temporary file database, insert one attempt, call `createBackup`, open the returned backup with `better-sqlite3`, and assert the attempt exists. Create 16 fixtures under `backups/daily` and 10 Sunday fixtures under `backups/weekly`, call rotation, and assert 14 newest daily plus 8 newest weekly backups remain. Add a failure test by making `backupDir` point inside a regular file, then assert `backup_runs` stores `status = 'failure'` and an error code without a filesystem path containing the user's home directory.

- [ ] **Step 2: Run and confirm failure**

Run: `npm test -- tests/server/backup.test.ts`

Expected: FAIL because backup service is missing.

- [ ] **Step 3: Implement atomic backup and metadata**

Use `await db.backup(tempPath)`, verify the temporary database with `PRAGMA integrity_check`, rename it under `backups/daily` to `sua-learning-YYYY-MM-DDTHH-mm-ssZ.sqlite`, then record success. On Sunday, copy the verified file into `backups/weekly` before rotation. On error, remove the temporary file and record a normalized error code. The CLI must parse normal config, open the database, migrate it, call backup and rotation, print one JSON result line, and exit nonzero on failure.

- [ ] **Step 4: Expose and render backup status**

Protect `/api/guardian/backup-status` with guardian role. Return only status, completion timestamp and backup filename. The dashboard shows success, failure or never-run states without exposing NAS paths.

- [ ] **Step 5: Verify and commit**

Run: `npm run typecheck && npm test -- tests/server/backup.test.ts tests/client/guardian-dashboard.test.tsx`

Expected: backup, rotation, API and dashboard tests PASS.

```bash
git add src/server/backup src/server/backup-cli.ts src/server/learning/routes.ts src/client/api src/client/guardian tests/server/backup.test.ts
git commit -m "feat: add database backup and status reporting"
```

---

### Task 11: Container build, Synology deployment, migration cleanup, and Phase 1 acceptance

**Files:**
- Create: `Dockerfile`
- Create: `compose.yaml`
- Create: `scripts/smoke-container.sh`
- Create: `ops/synology/README.md`
- Modify: `README.md`
- Modify: `docs/synology-nas-deploy.md`
- Modify: `docs/android-tablet.md`
- Modify: `docs/hosting-options.md`
- Create: `docs/phase1-acceptance.md`
- Delete after parity verification: `wrangler.toml`
- Delete after parity verification: `prototype/index.html`
- Delete after parity verification: `prototype/app.js`
- Delete after parity verification: `prototype/styles.css`
- Delete after parity verification: `prototype/sw.js`
- Delete after parity verification: `prototype/manifest.webmanifest`
- Delete after parity verification: `prototype/_headers`
- Delete after asset copy verification: `prototype/assets/*`

**Interfaces:**
- Consumes: `npm run check`, `npm start`, `npm run backup`
- Produces: container health at `GET /api/health`
- Produces: host-only binding `127.0.0.1:8787:8787`

- [ ] **Step 1: Write the container smoke test before the container files**

```bash
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
```

Run: `bash scripts/smoke-container.sh`

Expected: FAIL because `Dockerfile` and `compose.yaml` do not exist.

- [ ] **Step 2: Add a reproducible multi-stage container**

Use `node:22-bookworm-slim` for build and runtime. The build stage runs `npm ci`, `npm run check`, and `npm prune --omit=dev`. The runtime stage runs as a non-root user, copies `dist`, production `node_modules`, and package metadata, declares `/data` as a volume, exposes 8787, adds a Node-based health check against `/api/health`, and starts `node dist/server/index.js`.

`compose.yaml` must use:

```yaml
services:
  app:
    build: .
    restart: unless-stopped
    env_file: .env
    environment:
      NODE_ENV: production
      HOST: 0.0.0.0
      PORT: 8787
      DATABASE_PATH: /data/sua-learning.db
      BACKUP_DIR: /data/backups
      TIME_ZONE: Asia/Seoul
    user: "1000:1000"
    ports:
      - "127.0.0.1:8787:8787"
    volumes:
      - ./data:/data
```

- [ ] **Step 3: Verify the image and full automated suite**

Run: `npm run check`

Expected: typecheck, all tests, client build and server build PASS.

Run: `bash scripts/smoke-container.sh`

Expected: container becomes healthy within 30 seconds.

- [ ] **Step 4: Write exact Synology operating steps**

`ops/synology/README.md` must include these ordered actions:

1. Install Container Manager only after action-time user confirmation.
2. Create `/volume1/docker/sua-learning` and its `data/backups` folder, then set the bind-mounted `data` tree to container UID/GID 1000 with mode 700 (`sudo chown -R 1000:1000 /volume1/docker/sua-learning/data && sudo chmod -R 700 /volume1/docker/sua-learning/data`).
3. Copy repository deployment files and create `.env` using two `openssl rand -hex 32` values. Keep `.env` readable only by the deployment owner (`chmod 600 .env`).
4. Build and start with `docker compose up -d --build`.
5. Run first-time setup through the HTTPS site, then register the Galaxy Tab and set the PIN.
6. Create Synology DDNS and obtain a Let's Encrypt certificate.
7. Create a DSM reverse proxy from the DDNS HTTPS host to `http://127.0.0.1:8787`.
8. Forward router TCP 443 only; do not forward 5001 or 8787.
9. Add a daily DSM Task Scheduler command: `cd /volume1/docker/sua-learning && docker compose exec -T app npm run backup`.
10. Verify from mobile data that the site opens, HTTPS is valid, and the NAS public IP with port 5001 is unreachable.

Document the CGNAT stop condition: if inbound 443 cannot reach the NAS after confirming router and firewall rules, stop and ask for approval before choosing a paid domain or tunnel.

- [ ] **Step 5: Run the Phase 1 acceptance checklist**

Verify these behaviors in order and record the date, device, address redacted to host name, and PASS/FAIL evidence in `docs/phase1-acceptance.md`:

1. First setup creates one guardian and one student.
2. An unregistered browser cannot use the student PIN.
3. The guardian registers the 13-inch Galaxy Tab and sets the PIN.
4. The student sees the A dashboard and the same daily order after reload.
5. Exact Korean reading passes and a missing required token fails.
6. Math answer stays locked until reading passes.
7. A failed answer keeps Next locked and a correct answer unlocks it.
8. The same attempt sent twice appears once in guardian progress.
9. An offline attempt syncs once after reconnect.
10. A second guardian device sees the same completed-item count.
11. A backup restores into a fresh temporary database and passes `PRAGMA integrity_check`.
12. Only external HTTPS 443 reaches the app; DSM 5001 and app 8787 are not externally reachable.

- [ ] **Step 6: Remove the obsolete prototype only after parity passes**

Confirm all 20 item IDs and their version-1 payload hashes match the seed. Confirm all prototype icons exist under `public/assets`. Then delete the listed `prototype/` files and `wrangler.toml`. Update `README.md` and `docs/hosting-options.md` so Synology is the active deployment and Cloudflare Pages is described only as an abandoned earlier option. Preserve the prototype in Git history rather than maintaining two live implementations.

- [ ] **Step 7: Final verification and commit**

Run: `npm run check && bash scripts/smoke-container.sh && git diff --check`

Expected: all commands exit 0, container health is `ok`, and Git reports no whitespace errors.

```bash
git add Dockerfile compose.yaml scripts ops README.md docs package.json package-lock.json public src tests
git add -u prototype wrangler.toml
git commit -m "feat: complete Synology-hosted platform foundation"
```

---

## Phase 1 Definition of Done

- The application builds from a clean clone with `npm ci && npm run check`.
- The container starts from `compose.yaml` and reports `{ "status": "ok" }`.
- The site is reachable through a valid Synology DDNS HTTPS address.
- A new device cannot use the student PIN before guardian registration.
- The registered Galaxy Tab can complete the current Korean and math learning loop.
- Attempts sync exactly once and appear on the guardian dashboard from another device.
- Offline attempts survive one disconnect and sync after reconnect.
- A daily backup can be opened and passes SQLite integrity check.
- External scans confirm only HTTPS 443 is intentionally reachable for this service.
- No database column, request payload, log, or backup metadata stores audio or full speech transcripts.

## Follow-on Plans

After Phase 1 is accepted, create separate plans in this order:

1. Content editor and versioned curriculum management
2. Weekly planning, rewards, adaptive mastery, and guardian difficulty overrides
3. GPT-5.6 Terra plus Gemini 3.5 Flash problem generation, cross-review, API key encryption, budgets, and guardian reports
4. Korean and math curriculum expansion through grade 3
