# 수아의 공부방 반응형 학습·차나핑 코치·자동 배포 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Galaxy Tab에서 국어 읽기는 명확히 시작·중지·완료되고, 수학은 1학년 후반 계산과 큰 키패드로 풀며, 차나핑·신뢰 기기·NAS 자동 배포까지 안전하게 운영한다.

**Architecture:** SQLite와 Fastify는 콘텐츠 버전, 풀이 통과, 별, 기기 한도와 LLM 비용의 유일한 권위로 유지한다. React는 권위 영수증 뒤에만 자동 다음 문제·차나핑 반응을 보여 주며, 음성은 브라우저의 Web Speech 인식만 사용한다. GitHub Actions는 검증된 다중 아키텍처 이미지만 GHCR에 게시하고 NAS는 외부 수신 포트 없이 주기적으로 pull·health-check·rollback한다.

**Tech Stack:** Node.js 22, TypeScript 7, Fastify 5, React 19, Zod 4, SQLite via better-sqlite3, Vitest 4, Testing Library, Docker Compose, GitHub Actions, GHCR.

## Global Constraints

- 기준 설계는 `docs/superpowers/specs/2026-07-18-responsive-learning-coach-and-delivery-design.md`다.
- Node 명령은 `npx --yes -p node@22 -p npm@11.11.0 -- npm ...`로 실행한다.
- `korean-reading`, `math-story`, version 1/2 콘텐츠, 과거 시도, 발급 계획, 별 원장과 오프라인 큐는 계속 읽힌다. 콘텐츠 버전을 낮추거나 `data`를 초기화하지 않는다.
- 음성 파일·전체 전사문·PIN·쿠키·기기 토큰·LLM API 키를 브라우저 저장소, LLM 요청, 앱 로그, 배포 로그에 넣지 않는다.
- 수학 통과·별은 서버 영수증만 확정한다. 오프라인 통과는 `동기화 대기`로만 표시한다.
- 새 터치 대상은 최소 48px이며 Galaxy Tab 가로 1368×912/1600×900, 세로 800×1280과 200% 확대를 검증한다.
- 차나핑은 수아를 평가·비교·수치심 주거나 별 차감을 협박하지 않으며 자동 음성·자유형 채팅을 제공하지 않는다.
- LLM은 API 키와 보호자 사용 설정이 모두 있을 때만 NAS 서버에서 호출한다. 기본값·오류·상한 도달 시 로컬 문구만 쓴다.
- 외부 공개는 HTTPS 443만 유지한다. DSM 5001, SSH, Docker API, 8787, 직접 배포 webhook은 외부에 열지 않는다.
- 각 작업은 실패 테스트 → 최소 구현 → focused test → typecheck/build → `git diff --check` → 독립 커밋 순서다.

## File Structure

- `src/server/db/seed-v2.ts`: 현재 version 2 payload 보존본
- `src/shared/learning.ts`: calculation payload 및 AI coach DTO
- `src/client/learning/calculation-keypad.tsx`: 계산 전용 숫자 키패드
- `src/client/companions/chanaping-cues.ts`: 안전한 로컬 차나핑 문구
- `src/client/companions/chanaping.tsx`: 플로팅 코치 표시
- `src/server/db/migrations/005-trusted-device-types.ts`: 기기 유형 migration
- `src/server/db/migrations/006-ai-coach.ts`: AI 설정/사용량 migration
- `src/server/coach/crypto.ts`: AES-256-GCM 암복호화
- `src/server/coach/service.ts`: 키·예산·provider 경계
- `src/server/coach/routes.ts`: guardian/student coach API
- `.github/workflows/ci.yml`: 테스트·GHCR 이미지
- `ops/synology/pull-deploy.sh`: NAS lock/pull/health/rollback
- `tests/server/coach.test.ts`, `tests/server/automated-deploy-config.test.ts`: 새 운영 경계 회귀

Tasks 1–3 land before Task 4 because the coach needs final learning events. Tasks 5 and 6 have separate migrations and can be reviewed independently. Task 7 changes only build/operations artifacts and never changes live data.

---

### Task 1: Version 3 계산 콘텐츠와 서버 통과 계약

**Files:**
- Create: `src/server/db/seed-v2.ts`
- Modify: `src/shared/learning.ts`, `src/server/db/seed.ts`, `src/server/learning/repository.ts`, `src/server/learning/service.ts`, `src/client/offline/db.ts`
- Test: `tests/server/content-parity.test.ts`, `tests/server/db.test.ts`, `tests/server/learning.test.ts`, `tests/offline/sync.test.ts`

**Interfaces:**

```ts
type MathCalculationPayload = {
  kind: "math-calculation";
  subject: "math";
  unit: "받아올림과 받아내림" | "세 수의 혼합 계산";
  operands: [number, number] | [number, number, number];
  operators: ["+"] | ["-"] | ["+", "+"] | ["+", "-"] | ["-", "+"] | ["-", "-"];
  layout: "horizontal" | "vertical";
  answer: number;
  checkHint: string;
};
```

- [ ] **Step 1: Write the failing test**

Reject mismatched operator lengths, non-math calculation, answer/expression mismatch, negative intermediate result, and three-number vertical layout. Require v3 to have ten calculation items, both layouts, non-negative results, and no active-version downgrade. Test correct calculation completes/awards once; wrong calculation does not complete; calculations do not alter Korean reading rate/review tokens.

- [ ] **Step 2: Run test to verify it fails**

```bash
npx --yes -p node@22 -p npm@11.11.0 -- npm test -- tests/server/content-parity.test.ts tests/server/db.test.ts tests/server/learning.test.ts tests/offline/sync.test.ts
```

Expected: FAIL because calculation union, v3 seed, and subject-aware progress query do not exist.

- [ ] **Step 3: Write minimal implementation**

Copy current `INITIAL_ITEMS` unchanged to `seed-v2.ts` as `INITIAL_ITEMS_V2`. Make `seed.ts` insert v1/v2/v3 payloads, set version 3, and only promote with `active_version < 3`. Add math calculation curriculum nodes with `INSERT OR IGNORE`.

Use this exact v3 math sequence with Korean title/hint/cue text:

```ts
[
  ["math-01", [13, 9, 4], ["+", "+"], "horizontal", 26],
  ["math-02", [21, 2, 8], ["+", "+"], "horizontal", 31],
  ["math-03", [17, 3, 6], ["+", "+"], "horizontal", 26],
  ["math-04", [21, 6, 9], ["+", "-"], "horizontal", 18],
  ["math-05", [23, 7, 4], ["-", "-"], "horizontal", 12],
  ["math-06", [15, 5, 3], ["-", "-"], "horizontal", 7],
  ["math-07", [27, 6], ["+"], "vertical", 33],
  ["math-08", [44, 9], ["-"], "vertical", 35],
  ["math-09", [38, 7], ["+"], "vertical", 45],
  ["math-10", [56, 8], ["-"], "vertical", 48]
]
```

For calculation attempts retain the existing wire shape but enforce:

```ts
const isCalculation = payload.kind === "math-calculation";
const readingPass = isCalculation
  ? true
  : input.readingScore >= 85 && input.missedTokens.length === 0;
const mathPass = payload.kind === "math-story" || isCalculation
  ? input.mathAnswer !== null && input.mathAnswer === payload.answer
  : null;
const completed = isCalculation ? mathPass === true : readingPass && (mathPass ?? true);
```

Join `content_items` in progress query and count Korean reading metrics/review tokens only for Korean attempts. Use the same completion predicate in offline cache. Keep v1/v2 JSON unchanged, but visible v3 Korean copy changes 루미 to 버니 and 봉봉 to 밀키.

- [ ] **Step 4: Run tests and commit**

```bash
npx --yes -p node@22 -p npm@11.11.0 -- npm test -- tests/server/content-parity.test.ts tests/server/db.test.ts tests/server/learning.test.ts tests/offline/sync.test.ts
npx --yes -p node@22 -p npm@11.11.0 -- npm run typecheck
git diff --check
git add src tests
git commit -m "feat: add calculation learning content"
```

---

### Task 2: 큰 숫자 키패드와 계산 전용 화면

**Files:**
- Create: `src/client/learning/calculation-keypad.tsx`
- Modify: `src/client/learning/problem-breakdown.ts`, `src/client/learning/problem-breakdown-view.tsx`, `src/client/learning/learning-session.tsx`, `src/client/styles/components.css`, `src/client/styles/responsive.css`
- Test: `tests/client/problem-breakdown.test.tsx`, `tests/client/learning-session.test.tsx`

**Interfaces:**

```ts
export function CalculationKeypad(props: {
  value: string;
  disabled: boolean;
  onChange(value: string): void;
  onSubmit(): void;
}): JSX.Element;

export function calculationExpression(
  item: Extract<LearningItemPayload, { kind: "math-calculation" }>
): string;
```

- [ ] **Step 1: Write the failing test**

Assert a calculation has no 읽기 시작/direct transcript/word hint/story sentence/native answer textbox. Assert `13 + 9 + 4 = ?` is announced, vertical operands right-align, 0–9/지우기/답 확인 buttons exist, keys submit 26 as `mathAnswer`, first wrong answer shows `checkHint`, every key is at least 48px, and portrait stays one column.

- [ ] **Step 2: Run test to verify it fails**

```bash
npx --yes -p node@22 -p npm@11.11.0 -- npm test -- tests/client/problem-breakdown.test.tsx tests/client/learning-session.test.tsx
```

Expected: FAIL because calculations render story/reading UI and no keypad exists.

- [ ] **Step 3: Write minimal implementation**

Implement `calculationExpression` as operand/operator interleaving without browser-side result calculation. Render only `.calculation-board` for calculation: horizontal big text or right-aligned two-operand vertical stack. Keypad keys are:

```ts
const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "지우기", "0"] as const;
```

Append at most two digits, erase one, use `aria-live="polite"`, and submit only with a value. `checkCalculationAnswer()` reuses online/offline storage with a passing synthetic reading result and only locally completes when answer equals payload answer. Calculation retries show `checkHint`, then `부호를 먼저 확인해 봐요.`, then `첫 계산을 한 뒤 다음 계산을 해 봐요.`. CSS uses 56px keys, 3-column grid, 2-column answer action, static reduced-motion display.

- [ ] **Step 4: Run tests and commit**

```bash
npx --yes -p node@22 -p npm@11.11.0 -- npm test -- tests/client/problem-breakdown.test.tsx tests/client/learning-session.test.tsx
npx --yes -p node@22 -p npm@11.11.0 -- npm run build:client
git diff --check
git add src tests
git commit -m "feat: add tablet calculation keypad"
```

---

### Task 3: 명시적인 음성 인식과 한 번의 자동 다음 이동

**Files:**
- Modify: `src/client/learning/speech-recognition.ts`, `src/client/learning/learning-session.tsx`
- Test: `tests/client/speech-recognition.test.ts`, `tests/client/learning-session.test.tsx`

**Interfaces:**

```ts
type SpeechPhase = "ready" | "listening" | "finishing";
type SpeechControllerOptions = {
  onTranscript(transcript: string): void;
  onPhaseChange?(phase: SpeechPhase): void;
  onActivity?(): void;
  onNoResult?(): void;
  onUnavailable?(): void;
};
```

- [ ] **Step 1: Write the failing test**

Fake recognition emits result/end/error. Assert result plus 3,000ms silence stops/delivers once; no result at 15,000ms prompts retry; 45,000ms stops; explicit finish never restarts; permission error returns manual input. Component shows red listening indicator/elapsed time/읽기 멈추기, finishing state, and exactly one `onNext` 1,500ms after online non-duplicate or queued reading completion. Repeat-submit must cancel stale timer.

- [ ] **Step 2: Run test to verify it fails**

```bash
npx --yes -p node@22 -p npm@11.11.0 -- npm test -- tests/client/speech-recognition.test.ts tests/client/learning-session.test.tsx
```

Expected: FAIL because state is boolean, cap is 60 seconds, and no automatic next exists.

- [ ] **Step 3: Write minimal implementation**

Use `NO_RESULT_NOTICE_MS = 15_000`, `SILENCE_FINISH_MS = 3_000`, `LISTENING_LIMIT_MS = 45_000`. Each result resets silence; `complete()` clears timers, emits ready before one callback; explicit finish never restarts. Store phase/start time/one auto-next timer. Show `● 듣고 있어요 · N초`, `읽기 멈추기`, and `읽은 내용을 확인하고 있어요`. Schedule auto-next only after final receipt/queued local success, guard it by attempt generation + receipt ID, and clear in `beginAttempt`/unmount.

- [ ] **Step 4: Run tests and commit**

```bash
npx --yes -p node@22 -p npm@11.11.0 -- npm test -- tests/client/speech-recognition.test.ts tests/client/learning-session.test.tsx
npx --yes -p node@22 -p npm@11.11.0 -- npm run typecheck
git diff --check
git add src tests
git commit -m "fix: clarify reading recognition flow"
```

---

### Task 4: 버니·밀키와 로컬 차나핑 플로팅 코치

**Files:**
- Create: `src/client/companions/chanaping-cues.ts`, `src/client/companions/chanaping.tsx`, `public/assets/companions/chanaping.svg`
- Modify: `src/client/companions/cast.ts`, `src/client/companions/cues.ts`, `src/client/delight/star-bunny.tsx`, `src/client/learning/learning-session.tsx`, `src/client/styles/components.css`, `src/client/styles/responsive.css`
- Test: `tests/shared/companions.test.ts`, `tests/client/companion-components.test.tsx`, `tests/client/learning-session.test.tsx`, `tests/server/content-delight.test.ts`

**Interfaces:**

```ts
export type ChanaPingEvent =
  | "lesson-open" | "speech-start" | "speech-finish" | "correct"
  | "retry" | "thinking" | "idle-confirm" | "idle-paused" | "next";

// Define and export this shared event type from src/shared/learning.ts.
// chanaping-cues.ts imports it; server coach DTOs never import client code.

export function selectLocalChanaPingCue(input: {
  event: ChanaPingEvent;
  subject: "korean" | "math";
  retryCount: number;
  key: string;
}): string;
```

- [ ] **Step 1: Write the failing test**

Assert visible labels use 별토끼 버니/아기용 밀키 while IDs remain valid. ChanaPing copy is Korean, ≤45 characters/≤2 sentences, excludes `바보|느려|게으르|벌|별.*차감|못하|틀렸잖`, updates after correct/retry/2-minute inactivity but never each keypad digit, has Korean alt/48px hide control/no audio/no reduced-motion transform.

- [ ] **Step 2: Run test to verify it fails**

```bash
npx --yes -p node@22 -p npm@11.11.0 -- npm test -- tests/shared/companions.test.ts tests/client/companion-components.test.tsx tests/client/learning-session.test.tsx tests/server/content-delight.test.ts
```

Expected: FAIL because names and a separate coach do not exist.

- [ ] **Step 3: Write minimal implementation**

Keep IDs. Create original local SVG under 120KB with teal swooped hair, pale round face, half-lidded eyes, dark-green ribbon, sleepy pillow; do not embed/copy supplied frames or external assets. Local cue examples: `오… 맞았네. 칭찬하는 것도 귀찮은데, 이건 칭찬이야. 차나~!`, `아휴, 부호부터 다시 보자. 차나핑이 누워 있기 전에!`, `수아야, 나보다 더 가만히 있으면 어떡해… 한 번만 눌러 보자.`. Component receives event/subject/retry/hidden, repeats no same cue in 4 min, uses one polite live region, never claims star, and accepts only receipt-confirmed or existing idle/speech transitions. CSS is bottom-right/max 340px below dialogs, static full-width below 700px, session-only hide.

- [ ] **Step 4: Run tests and commit**

```bash
npx --yes -p node@22 -p npm@11.11.0 -- npm test -- tests/shared/companions.test.ts tests/client/companion-components.test.tsx tests/client/learning-session.test.tsx tests/server/content-delight.test.ts
npx --yes -p node@22 -p npm@11.11.0 -- npm run typecheck
git diff --check
git add src public tests
git commit -m "feat: add chanaping learning coach"
```

---

### Task 5: 유형별 신뢰 기기 한도

**Files:**
- Create: `src/server/db/migrations/005-trusted-device-types.ts`
- Modify: `src/server/db/migrate.ts`, `src/shared/auth.ts`, `src/server/auth/repository.ts`, `src/server/auth/service.ts`, `src/server/auth/routes.ts`, `src/client/api/client.ts`, `src/client/auth/auth-context.tsx`, `src/client/auth/login-screen.tsx`, `src/client/guardian/guardian-dashboard.tsx`, `src/client/styles/components.css`
- Test: `tests/server/db.test.ts`, `tests/server/auth.test.ts`, `tests/client/api-client.test.ts`, `tests/client/login-and-home.test.tsx`, `tests/client/guardian-dashboard.test.tsx`

**Interfaces:**

```ts
export const DeviceTypeSchema = z.enum(["tablet", "phone", "mac", "windows"]);
export const DEVICE_TYPE_LIMITS = { tablet: 3, phone: 3, mac: 1, windows: 2 } as const;
type TrustedDeviceView = { /* existing fields */ deviceType: DeviceType | null };
type RegisterDeviceRequest = { name: string; deviceType: DeviceType };
type UpdateDeviceTypeRequest = { deviceType: DeviceType };
```

- [ ] **Step 1: Write the failing test**

Migrate active old devices and assert null types still authenticate. Test 3 tablets/3 phones/1 Mac/2 Windows; the next type returns 409 `DEVICE_TYPE_LIMIT_REACHED`, no row/cookie; revoke frees capacity; existing token registration is idempotent. Active unclassified legacy device blocks new registration with `DEVICE_TYPE_CLASSIFICATION_REQUIRED` until guardian classification. UI shows counts/type choice/legacy classification/exact tablet message.

- [ ] **Step 2: Run test to verify it fails**

```bash
npx --yes -p node@22 -p npm@11.11.0 -- npm test -- tests/server/db.test.ts tests/server/auth.test.ts tests/client/api-client.test.ts tests/client/login-and-home.test.tsx tests/client/guardian-dashboard.test.tsx
```

Expected: FAIL because devices have no type and registration accepts only name.

- [ ] **Step 3: Write minimal implementation**

Migration 5 adds nullable checked `device_type`/active-type index; never guess old types. Repository adds `countActiveDevicesByType`, `hasActiveUnclassifiedDevice`, `setTrustedDeviceType`. `registerDevice` returns active token row before checking new-device limits. Add 409 codes and guardian `PUT /api/guardian/devices/:publicId/type`. `suggestDeviceType(navigator.userAgent)` only preselects locally. Guardian list shows type/count/limit/legacy action and no token/hash/internal ID. Tablet error is `태블릿은 최대 3대예요. 사용하지 않는 기기를 먼저 해제해 주세요.`.

- [ ] **Step 4: Run tests and commit**

```bash
npx --yes -p node@22 -p npm@11.11.0 -- npm test -- tests/server/db.test.ts tests/server/auth.test.ts tests/client/api-client.test.ts tests/client/login-and-home.test.tsx tests/client/guardian-dashboard.test.tsx
npx --yes -p node@22 -p npm@11.11.0 -- npm run typecheck
git diff --check
git add src tests
git commit -m "feat: enforce typed trusted device limits"
```

---

### Task 6: 차나핑 LLM API 키·비용 가드레일·보호자 설정

**Files:**
- Create: `src/server/db/migrations/006-ai-coach.ts`, `src/server/coach/crypto.ts`, `src/server/coach/service.ts`, `src/server/coach/routes.ts`, `tests/server/coach.test.ts`
- Modify: `src/server/db/migrate.ts`, `src/server/config.ts`, `src/server/app.ts`, `src/shared/learning.ts`, `src/client/api/client.ts`, `src/client/guardian/guardian-dashboard.tsx`, `src/client/learning/learning-session.tsx`
- Test: `tests/server/config.test.ts`, `tests/server/db.test.ts`, `tests/server/app.test.ts`, `tests/client/guardian-dashboard.test.tsx`, `tests/client/learning-session.test.tsx`

**Interfaces:**

```ts
type AiCoachProvider = "gemini" | "openai";
type AiCoachSettingsView = {
  enabled: boolean; provider: AiCoachProvider; model: string;
  monthlyBudgetWon: number; monthSpentWon: number; hasApiKey: boolean;
};
type CoachMessageRequest = {
  event: ChanaPingEvent; subject: "korean" | "math";
  retryCount: number; hintStage: "none" | "first" | "step";
};
type CoachMessageResponse = { message: string; source: "llm" | "local" };
```

- [ ] **Step 1: Write the failing test**

Test optional base64 32-byte `LLM_ENCRYPTION_KEY`, rejected enabled/key-save when unavailable, AES-GCM randomized ciphertext/tamper rejection, key-free views. Defaults: disabled, Gemini `gemini-2.5-flash-lite`, 1,000 won, no key. Provider mock receives only event/subject/retry/hint + fixed persona, never name/PIN/transcript/answer/cookie/device/plan/key. Invalid/unsafe/long result, timeout, disabled, no key, budget cap return local. Gemini uses `generateContent`; OpenAI uses `/v1/responses` and `gpt-5-nano`; exhausted cap makes no request.

- [ ] **Step 2: Run test to verify it fails**

```bash
npx --yes -p node@22 -p npm@11.11.0 -- npm test -- tests/server/config.test.ts tests/server/db.test.ts tests/server/app.test.ts tests/server/coach.test.ts tests/client/guardian-dashboard.test.tsx tests/client/learning-session.test.tsx
```

Expected: FAIL because encrypted settings/provider adapter/routes do not exist.

- [ ] **Step 3: Write minimal implementation**

Migration 6 creates singleton `ai_coach_settings` ciphertext/iv/tag and append-only `ai_coach_usage` month/provider/model/tokens/estimated won. Use only Node crypto:

```ts
const cipher = createCipheriv("aes-256-gcm", key, randomBytes(12));
const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
const tag = cipher.getAuthTag();
```

Parse/store binary values base64; decrypt only during call. Reserve 1 won before call, store actual estimate after, fall back locally below reserve. Parse only JSON `{ message }`, filter Korean/45 chars/two sentences/forbidden language, never persist completion. Add guardian GET/PUT `/api/guardian/ai-coach-settings` and student POST `/api/student/coach-message`. Guardian AI tab has enable/provider/blank-after-save key/cap 0–10000/estimate/delete. Child uses `AbortController`, keeps local copy pending, accepts current event generation only, never auto-retries, and keeps 4-min cooldown.

- [ ] **Step 4: Run tests and commit**

```bash
npx --yes -p node@22 -p npm@11.11.0 -- npm test -- tests/server/config.test.ts tests/server/db.test.ts tests/server/app.test.ts tests/server/coach.test.ts tests/client/guardian-dashboard.test.tsx tests/client/learning-session.test.tsx
npx --yes -p node@22 -p npm@11.11.0 -- npm run build
git diff --check
git add src tests
git commit -m "feat: add bounded ai coach settings"
```

---

### Task 7: GHCR 이미지와 NAS pull 자동 배포

**Files:**
- Create: `.github/workflows/ci.yml`, `ops/synology/pull-deploy.sh`, `tests/server/automated-deploy-config.test.ts`
- Modify: `Dockerfile`, `compose.yaml`, `ops/synology/README.md`, `docs/synology-nas-deploy.md`, `tests/server/container-smoke-config.test.ts`

- [ ] **Step 1: Write the failing test**

Assert workflow runs `npm run check` for PR/main, only main gets packages-write, builds amd64/arm64, tags main + SHA. Production Compose uses image/no build, preserves data mount/loopback 8787; smoke stays build/isolated. Dockerfile healthchecks health. Script uses mkdir lock/trap, backup-before-replace, image comparison, Docker+HTTP health, rollback, and contains no rm/data delete/port bind/webhook/.env print.

- [ ] **Step 2: Run test to verify it fails**

```bash
npx --yes -p node@22 -p npm@11.11.0 -- npm test -- tests/server/container-smoke-config.test.ts tests/server/automated-deploy-config.test.ts
```

Expected: FAIL because CI/pull script are absent and production Compose builds locally.

- [ ] **Step 3: Write minimal implementation**

Workflow checks out, Node 22, npm ci/check, Buildx/GHCR login/build-push only on main, amd64/arm64, main + immutable SHA tags, OCI revision/source labels. Dockerfile uses Node-fetch healthcheck; Compose uses an APP_IMAGE environment interpolation with default GHCR main tag.

`pull-deploy.sh` atomically creates deployment lock, pulls, compares `docker inspect --format '{{.Image}}'`, skips unchanged, backs up with `docker compose exec -T app npm run backup`, replaces app, polls Docker health + loopback API twelve times at five-second intervals. Failure overrides APP_IMAGE to prior image ID, starts prior app, checks once, and never restores/deletes data.

- [ ] **Step 4: Document, test, and commit**

Document mode-600 APP_IMAGE, optional GHCR login, script mode 700, DSM Task Scheduler every five minutes, retained daily backup/maintenance, and required SHA/health/rollback/closed-port proof.

```bash
npx --yes -p node@22 -p npm@11.11.0 -- npm test -- tests/server/container-smoke-config.test.ts tests/server/automated-deploy-config.test.ts
npx --yes -p node@22 -p npm@11.11.0 -- npm run check
git diff --check
git add .github Dockerfile compose.yaml ops docs tests
git commit -m "ci: add pull based nas deployment"
```

---

## Final integration and release gate

- [ ] Run `git status -sb`, then full `npm run check`, `npm run smoke:container`, `git diff --check`, and status again using Node 22.
- [ ] Use Playwright at 1368×912, 1600×900, 800×1280 and 200% zoom to capture reading/stop/auto-next, keypad, ChanaPing, device management, and AI settings. No production PIN/API key appears in evidence.
- [ ] Push existing branch and update PR only after local tests are green. Merge and NAS installation remain a separate approved gate.
- [ ] On NAS, use the guide and separately prove HTTPS 443, closed DSM/SSH/8787, health, backup, and controlled pull rollback.
