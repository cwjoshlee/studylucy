# 수아의 공부방 별 원장과 어린이 경험 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 완료된 플랫폼 Task 1~5 위에 누적 별 원장, 필수 일일 학습, 5분 무반응 차감, 미완료 차감 승인, 오리지널 동물 마법 경험과 NAS 운영을 완성한다.

**Architecture:** Fastify와 SQLite가 필수 학습 선정, 풀이별 별 적립, 차감 상한, append-only 원장과 보호자 승인을 권위 있게 처리한다. React PWA는 13인치 갤럭시 탭에 별토끼 안내와 축하를 표시하고 활동 타이머·오프라인 대기열을 관리하며 서버 응답으로 모든 기기의 잔액을 정규화한다. 이 계획은 기존 `2026-07-15-platform-foundation.md`의 남은 Task 6~11을 대체한다.

**Tech Stack:** Node.js 22, TypeScript 7.0, Fastify 5.10, React 19.2, Vite 8.1, SQLite via better-sqlite3 12.11, Zod 4.4, Vitest 4.1, Testing Library 16.3, IndexedDB via idb 8.0, Docker Compose

## Global Constraints

- 서비스명과 모든 사용자용 기본 문구는 `수아의 공부방`을 사용한다.
- 전체 사이트는 가족 로그인 뒤에만 보이며 공개 회원가입과 게스트 학습을 제공하지 않는다.
- 등록된 기기에서만 수아의 4자리 PIN 로그인을 허용한다.
- 13인치 갤럭시 탭 가로 화면과 최소 48px 터치 영역을 기본으로 한다.
- 기본 필수 학습은 한국 날짜별 국어 2개와 수학 2개다.
- 필수 학습 1개를 최초 완료하면 별 1개를 지급하고 같은 날짜·항목에는 다시 지급하지 않는다.
- 무반응 안내는 2분, 확인은 4분, 자동 차감은 5분이며 하루 최대 2개다.
- 앱이 숨김·백그라운드·잠금·서버 대기·축하 상태일 때 무반응 시간을 세지 않는다.
- 전날 미완료 후보는 `Asia/Seoul` 오전 6시에 만들고 실제 차감은 보호자가 승인한다.
- 별 잔액은 0 아래로 내려가지 않으며 적용·0원 감사·취소를 포함한 모든 변동을 삭제하지 않는 원장에 남긴다.
- 학생은 현재 잔액과 직전 사유만 보고 보호자는 전체 원장과 승인·면제·취소를 본다.
- 카메라, 시선 추적, 음성 파일, 전체 음성 전사문, 비밀번호, PIN과 원문 토큰을 저장하지 않는다.
- 오리지널 파스텔 동물 마법 친구를 사용하고 기존 상업 캐릭터를 복제하지 않는다.
- `prefers-reduced-motion`에서는 이동 애니메이션 없이 색상·아이콘·문구로 결과를 전달한다.
- 외부에는 HTTPS 443만 공개하고 DSM 5001, 앱 포트, SQLite와 백업 경로는 공개하지 않는다.
- npm과 기존 고정 버전 및 `package-lock.json`을 유지한다.
- 호스트 기본 Node가 22가 아니면 검증 명령을 `npx --yes -p node@22 -p npm@11.11.0 -- npm ...`으로 실행한다.

---

## File Map

- `src/shared/stars.ts`: 별 사유, 원장, 잔액, 무반응, 차감 후보와 보호자 명령 스키마
- `src/server/db/migrations/002-star-ledger.ts`: 별 잔액, 원장, 일일 계획, 무반응과 승인 후보
- `src/server/stars/repository.ts`: 원장 append, 잔액 하한, 중복 제거와 조회
- `src/server/stars/daily-plan.ts`: 과목별 필수 항목 선정과 계획 고정
- `src/server/stars/service.ts`: 학생 별 요약, 무반응, 보호자 조정·취소
- `src/server/stars/routes.ts`: 학생·보호자 별 API
- `src/server/stars/maintenance.ts`: 미완료 후보 생성
- `src/server/daily-maintenance-cli.ts`: 오전 6시 DSM 명령
- `src/client/delight/*`: 오리지널 별토끼, 별 요약과 축하
- `src/client/learning/*`: 읽기·수학 루프와 2/4/5분 상태기계
- `src/client/offline/*`: 오늘 계획, 풀이와 무반응 대기열
- `src/client/guardian/guardian-dashboard.tsx`: 진도, 원장, 승인과 백업
- `src/server/backup/*`: 별 원장을 포함한 백업과 상태
- `ops/synology/*`: DDNS, 프록시, 유지보수, 백업과 복원

---

### Task 1: Append-only star ledger and atomic balance

**Files:**
- Create: `src/shared/stars.ts`
- Create: `src/server/db/migrations/002-star-ledger.ts`
- Modify: `src/server/db/migrate.ts`
- Create: `src/server/stars/repository.ts`
- Test: `tests/server/star-ledger.test.ts`

**Interfaces:**
- Produces: `StarReason`, `StarEvent`, `StudentStarSummary`, `AppliedStarResult`
- Produces: `StarRepository.apply(input): AppliedStarResult`
- Produces: `StarRepository.reverse(eventId, guardianId, note, now): AppliedStarResult`

- [ ] **Step 1: Define exact shared contracts**

```ts
export const StarReasonSchema = z.enum([
  "REQUIRED_ITEM_COMPLETED", "IDLE_TIMEOUT", "MISSED_DAILY_PLAN",
  "GUARDIAN_BONUS", "GUARDIAN_ADJUSTMENT", "REWARD_REDEMPTION",
  "REVERSAL", "NO_BALANCE_AUDIT"
]);
export type StarReason = z.infer<typeof StarReasonSchema>;
export type StarEvent = {
  id: string; requestedDelta: number; delta: number;
  balanceAfter: number; reason: StarReason;
  reasonText: string; studyDate: string; itemId: string | null;
  actorType: "system" | "guardian"; createdAt: string;
  reversesEventId: string | null;
};
export type StudentStarSummary = {
  balance: number; earnedToday: number; deductedToday: number;
  lastReason: string | null;
};
export type AppliedStarResult = { event: StarEvent; duplicate: boolean };
```

- [ ] **Step 2: Write ledger RED tests**

Create a family fixture, apply source `required:student-1:2026-07-16:ko-01` twice, and assert one `+1` event. Apply `-2` at balance 1 and assert requested `-2`, actual `-1`, balance 0. Apply another negative request and assert a zero `NO_BALANCE_AUDIT` event. Reverse an earn when only part of its value remains and assert requested versus actual deltas, a linked `REVERSAL`, and that the second reversal throws `EVENT_ALREADY_REVERSED`.

- [ ] **Step 3: Run RED**

Run: `npm test -- tests/server/star-ledger.test.ts`

Expected: FAIL because migration 2 and `StarRepository` do not exist.

- [ ] **Step 4: Add migration 2**

Create these exact tables in one migration transaction:

```sql
CREATE TABLE student_star_balances (
  student_id TEXT PRIMARY KEY REFERENCES users(id),
  balance INTEGER NOT NULL CHECK (balance >= 0), updated_at TEXT NOT NULL
);
CREATE TABLE daily_plan_settings (
  student_id TEXT NOT NULL REFERENCES users(id), study_date TEXT NOT NULL,
  korean_target INTEGER NOT NULL DEFAULT 2 CHECK (korean_target BETWEEN 0 AND 10),
  math_target INTEGER NOT NULL DEFAULT 2 CHECK (math_target BETWEEN 0 AND 10),
  is_rest_day INTEGER NOT NULL DEFAULT 0 CHECK (is_rest_day IN (0,1)),
  updated_by TEXT REFERENCES users(id), updated_at TEXT NOT NULL,
  PRIMARY KEY (student_id, study_date)
);
CREATE TABLE daily_requirements (
  student_id TEXT NOT NULL REFERENCES users(id), study_date TEXT NOT NULL,
  item_id TEXT NOT NULL REFERENCES content_items(id),
  subject TEXT NOT NULL CHECK (subject IN ('korean','math')),
  sort_order INTEGER NOT NULL, created_at TEXT NOT NULL,
  PRIMARY KEY (student_id, study_date, item_id)
);
CREATE TABLE star_events (
  id TEXT PRIMARY KEY, student_id TEXT NOT NULL REFERENCES users(id),
  delta INTEGER NOT NULL, balance_after INTEGER NOT NULL CHECK (balance_after >= 0),
  reason_code TEXT NOT NULL CHECK (reason_code IN (
    'REQUIRED_ITEM_COMPLETED','IDLE_TIMEOUT','MISSED_DAILY_PLAN',
    'GUARDIAN_BONUS','GUARDIAN_ADJUSTMENT','REWARD_REDEMPTION',
    'REVERSAL','NO_BALANCE_AUDIT'
  )),
  reason_text TEXT NOT NULL, study_date TEXT NOT NULL,
  item_id TEXT REFERENCES content_items(id), attempt_id TEXT REFERENCES attempts(id),
  idle_event_id TEXT, pending_adjustment_id TEXT,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('system','guardian')),
  actor_user_id TEXT REFERENCES users(id), source_key TEXT NOT NULL UNIQUE,
  reverses_event_id TEXT UNIQUE REFERENCES star_events(id), created_at TEXT NOT NULL
);
CREATE TABLE idle_events (
  id TEXT PRIMARY KEY, student_id TEXT NOT NULL REFERENCES users(id),
  study_date TEXT NOT NULL, item_id TEXT NOT NULL REFERENCES content_items(id),
  learning_session_id TEXT NOT NULL, idle_started_at TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('applied','capped','no-balance')),
  star_event_id TEXT REFERENCES star_events(id), created_at TEXT NOT NULL,
  UNIQUE (student_id, id)
);
CREATE TABLE pending_star_adjustments (
  id TEXT PRIMARY KEY, student_id TEXT NOT NULL REFERENCES users(id),
  study_date TEXT NOT NULL, item_id TEXT NOT NULL REFERENCES content_items(id),
  requested_stars INTEGER NOT NULL CHECK (requested_stars BETWEEN 1 AND 2),
  approved_stars INTEGER CHECK (approved_stars BETWEEN 0 AND 2),
  applied_stars INTEGER CHECK (applied_stars BETWEEN 0 AND 2),
  status TEXT NOT NULL CHECK (status IN ('pending','approved','waived')),
  processed_by TEXT REFERENCES users(id), note TEXT,
  star_event_id TEXT REFERENCES star_events(id), created_at TEXT NOT NULL,
  processed_at TEXT, UNIQUE (student_id, study_date, item_id)
);
```

Add indexes on `star_events(student_id, study_date, created_at)` and `pending_star_adjustments(student_id,status,study_date)`, then register version 2 after version 1.

- [ ] **Step 5: Implement atomic repository behavior**

`apply()` uses one SQLite transaction: return an existing source event; insert balance 0 if absent; clamp a negative delta to `-balance`; record requested and actual deltas separately; use `NO_BALANCE_AUDIT` when an ordinary requested negative becomes zero; update balance; insert event and return it. `reverse()` requests `-original.delta` using source `reversal:<eventId>` and `reverses_event_id` without deleting the original. It always records a linked `REVERSAL`, including partial or zero actual deductions, and consumes the original event's single reversal opportunity.

- [ ] **Step 6: Verify and commit**

Run: `npm run typecheck && npm test -- tests/server/star-ledger.test.ts`

Expected: tests PASS and TypeScript exits 0.

```bash
git add src/shared/stars.ts src/server/db src/server/stars/repository.ts tests/server/star-ledger.test.ts
git commit -m "feat: add append-only star ledger"
```

---

### Task 2: Required daily plan and attempt-linked star awards

**Files:**
- Modify: `src/shared/learning.ts`
- Create: `src/server/stars/daily-plan.ts`
- Modify: `src/server/learning/repository.ts`
- Modify: `src/server/learning/service.ts`
- Modify: `src/server/learning/routes.ts`
- Test: `tests/server/star-learning.test.ts`

**Interfaces:**
- Produces: `DailyPlanService.ensure(studentId, studyDate): RequiredPlan`
- Extends: `TodayPlan.requiredItemIds`, `TodayPlan.stars`
- Extends: `AttemptReceipt.starAward`

- [ ] **Step 1: Extend learning contracts**

```ts
export type StarAwardReceipt = {
  awarded: boolean; amount: number; balance: number; eventId: string | null;
};
// Add to TodayPlan:
requiredItemIds: string[];
stars: StudentStarSummary;
// Add to AttemptReceipt:
starAward: StarAwardReceipt;
```

- [ ] **Step 2: Write RED integration tests**

Assert the same date yields exactly two Korean and two math required IDs. Complete one required item and expect `{awarded:true,amount:1,balance:1}`. Submit a fresh attempt for the same date/item and expect `{awarded:false,amount:0,balance:1}` with one ledger event. Assert failed required and passing optional attempts award zero, and a second device reads balance 1.

- [ ] **Step 3: Run RED**

Run: `npm test -- tests/server/star-learning.test.ts`

Expected: FAIL because plans and receipts do not contain star data.

- [ ] **Step 4: Implement deterministic requirements**

Load or create settings with default 2/2. For a rest day write no requirements. Otherwise use existing `getDailyItems`, take the configured count per payload subject, assign stable sort order and insert with `INSERT OR IGNORE`. Once a required-completion event exists for a date, changes to that date return `409 PLAN_LOCKED`.

- [ ] **Step 5: Award within the new-attempt transaction**

Before saving any new attempt, `LearningService` calls `DailyPlanService.ensure(studentId, studyDate)` so a direct attempt cannot bypass requirement materialization. After a new completed attempt, check `daily_requirements`. Apply source `required:<studentId>:<studyDate>:<itemId>` before commit. Duplicates and later attempts return the existing event with `awarded:false`; failed and optional attempts return current balance and null event. Preserve the approved same-client-attempt-ID early lookup, now including the stored `starAward` receipt.

- [ ] **Step 6: Verify and commit**

Run: `npm run typecheck && npm test -- tests/server/learning.test.ts tests/server/star-learning.test.ts`

Expected: existing learning tests and star awards PASS.

```bash
git add src/shared src/server/learning src/server/stars/daily-plan.ts tests/server/star-learning.test.ts tests/server/learning.test.ts
git commit -m "feat: award stars for required learning"
```

---

### Task 3: Idle deductions and 06:00 missed-plan approvals

**Files:**
- Modify: `src/shared/stars.ts`
- Create: `src/server/stars/service.ts`
- Create: `src/server/stars/routes.ts`
- Create: `src/server/stars/maintenance.ts`
- Create: `src/server/daily-maintenance-cli.ts`
- Modify: `src/server/app.ts`
- Modify: `src/server/index.ts`
- Modify: `package.json`
- Test: `tests/server/star-maintenance.test.ts`

**Interfaces:**
- Produces: `POST /api/student/idle-events`, `GET /api/student/stars`
- Produces: `GET /api/guardian/stars`, `GET /api/guardian/star-adjustments`
- Produces: `POST /api/guardian/star-adjustments/:id/approve`, `POST /api/guardian/star-adjustments/:id/waive`
- Produces: `POST /api/guardian/stars/manual`, `POST /api/guardian/stars/:eventId/reverse`
- Produces: `GET /api/guardian/daily-plans/:date`, `PUT /api/guardian/daily-plans/:date`
- Produces: `generateMissedPlanCandidates(db, targetDate, now): number`

- [ ] **Step 1: Add request schemas**

```ts
export const IdleEventInputSchema = z.object({
  clientIdleEventId: z.string().min(12).max(80),
  learningSessionId: z.string().min(12).max(80), itemId: z.string().min(1),
  studyDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  idleStartedAt: z.string().datetime(), occurredAt: z.string().datetime()
});
export const ManualStarInputSchema = z.object({
  delta: z.number().int().min(-100).max(100).refine((value) => value !== 0),
  reason: z.string().trim().min(1).max(200),
  clientCommandId: z.string().min(12).max(80)
});
export const ApprovalInputSchema = z.object({
  approvedStars: z.number().int().min(0).max(2),
  note: z.string().trim().max(200).default("")
});
```

- [ ] **Step 2: Write RED server tests**

Assert 4:59 idle is invalid; 5:00 debits one; same ID is duplicate; second fresh event debits; third caps; balance zero records `NO_BALANCE_AUDIT`. Create four missed requirements, run 06:00 generation twice and assert exactly two pending rows. Approve one twice and assert one debit; waive the other and assert no debit.

- [ ] **Step 3: Run RED**

Run: `npm test -- tests/server/star-maintenance.test.ts`

Expected: FAIL because routes and maintenance do not exist.

- [ ] **Step 4: Implement idle authority**

Reject intervals below 300,000ms, times over five minutes in the future, unknown/unpublished items, and mismatched KST study dates. Insert each event once. Count `applied` and `no-balance` toward the daily maximum two; store a third as `capped`. Apply source `idle:<studentId>:<clientIdleEventId>` with a Korean `5분` reason.

- [ ] **Step 5: Implement maintenance and guardian commands**

Sort missing requirements by plan order and insert at most two candidates with `INSERT OR IGNORE`. Approval applies at most once in the same transaction; waiver stores guardian and required note without a ledger event. Manual commands use `guardian:<guardianId>:<clientCommandId>`. Add `daily-maintenance` script and a third tsup entry. Startup checks the previous seven dates whose 06:00 cutoff passed.

- [ ] **Step 6: Verify and commit**

Run: `npm run typecheck && npm test -- tests/server/star-ledger.test.ts tests/server/star-learning.test.ts tests/server/star-maintenance.test.ts`

Expected: all star server tests PASS.

```bash
git add src/shared/stars.ts src/server/stars src/server/app.ts src/server/index.ts src/server/daily-maintenance-cli.ts package.json package-lock.json tests/server/star-maintenance.test.ts
git commit -m "feat: add star deductions and approvals"
```

---

### Task 4: Family login, A dashboard, original mascot, and star summary

**Files:**
- Create: `src/client/main.tsx`
- Create: `src/client/app.tsx`
- Create: `src/client/api/client.ts`
- Create: `src/client/auth/auth-context.tsx`
- Create: `src/client/auth/login-screen.tsx`
- Create: `src/client/home/student-home.tsx`
- Create: `src/client/delight/star-bunny.tsx`
- Create: `src/client/delight/today-stars.tsx`
- Create: `src/client/styles/tokens.css`
- Create: `src/client/styles/layout.css`
- Create: `src/client/styles/components.css`
- Create: `src/client/styles/responsive.css`
- Create: `tests/helpers/client.ts`
- Test: `tests/client/login-and-home.test.tsx`
- Modify: `src/server/app.ts`
- Copy: `prototype/assets/*` to `public/assets/`

**Interfaces:**
- Produces: `ApiClient` for auth, learning, stars and backup routes
- Produces: `AuthProvider`, `StudentHome`, `StarBunny`, `TodayStars`

- [ ] **Step 1: Write client RED tests**

```tsx
it("shows setup only for SETUP_REQUIRED", async () => {
  const api = createFakeApi({
    me: vi.fn().mockRejectedValue(new ApiError(409, "SETUP_REQUIRED"))
  });
  render(<App api={api} />);
  expect(await screen.findByRole("heading", {
    name: "수아의 공부방 시작하기"
  })).toBeVisible();
});

it("shows the A layout, required stars, and original friend", async () => {
  render(<App api={createFakeApi()} />);
  expect(await screen.findByText("오늘의 학습")).toBeVisible();
  expect(screen.getByText("수아야, 오늘도 한 걸음!")).toBeVisible();
  expect(screen.getByLabelText("별토끼 마법 친구")).toBeVisible();
  expect(screen.getByText("모은 별 7개")).toBeVisible();
  expect(screen.getAllByTestId("required-star")).toHaveLength(4);
});
```

The CSS source assertion checks `--touch-min: 48px`, primary `min-height: var(--touch-min)`, and `@media (prefers-reduced-motion: reduce)`.

- [ ] **Step 2: Run RED**

Run: `npm test -- tests/client/login-and-home.test.tsx`

Expected: FAIL because client modules do not exist.

- [ ] **Step 3: Implement API and auth state**

Every request uses `credentials: "same-origin"` and JSON. Non-2xx bodies become `ApiError(status, code)`; 204 returns `undefined`; other successes parse JSON. Reveal one login prerequisite at a time: initial setup, guardian login, current-device registration, PIN set, then student PIN.

- [ ] **Step 4: Build the tablet A layout**

Use `225px minmax(0, 1fr) 225px`; hide the right column below 950px and use one column below 700px. Build `StarBunny` from semantic HTML and CSS circles, ears, cape and star-wand shapes without importing or tracing a commercial character. `TodayStars` shows confirmed balance and a separate queued count. Required items show one star; optional items make no award claim.

- [ ] **Step 5: Serve the production client**

Register `@fastify/static` at `dist/client`. Serve `index.html` for non-API navigation only and keep `/api/*` misses as JSON 404. Copy current icons to `public/assets`.

- [ ] **Step 6: Verify and commit**

Run: `npm run typecheck && npm test -- tests/client/login-and-home.test.tsx && npm run build:client`

Expected: client tests PASS and `dist/client` exists.

```bash
git add public src/client src/server/app.ts tests/client/login-and-home.test.tsx tests/helpers/client.ts
git commit -m "feat: add tablet dashboard and star friend"
```

---

### Task 5: Learning loop, one-time celebration, and 2/4/5-minute controller

**Files:**
- Create: `src/client/learning/reading-judge.ts`
- Create: `src/client/learning/speech-recognition.ts`
- Create: `src/client/learning/learning-session.tsx`
- Create: `src/client/learning/inactivity-controller.ts`
- Create: `src/client/delight/star-celebration.tsx`
- Test: `tests/client/reading-judge.test.ts`
- Test: `tests/client/inactivity-controller.test.ts`
- Test: `tests/client/learning-session.test.tsx`

**Interfaces:**
- Produces: `judgeReading(target, transcript): ReadingResult`
- Produces: `InactivityController` events `hint`, `confirm`, `deduct`, `active`
- Consumes: attempt `starAward` and `POST /api/student/idle-events`

- [ ] **Step 1: Write reading characterization tests**

Lock exact, punctuation-normalized, missing-token and threshold cases from `prototype/app.js`. Reading passes only at score at least 85 with no required token missing.

- [ ] **Step 2: Write fake-timer inactivity RED tests**

```ts
it("moves through 2, 4, and 5 minutes only while active", () => {
  const events: string[] = [];
  const controller = createInactivityController({
    onEvent: (event) => events.push(event.type)
  });
  controller.start();
  vi.advanceTimersByTime(120_000);
  expect(events).toEqual(["hint"]);
  vi.advanceTimersByTime(120_000);
  expect(events).toEqual(["hint", "confirm"]);
  controller.pause("document-hidden");
  vi.advanceTimersByTime(600_000);
  expect(events).toEqual(["hint", "confirm"]);
  controller.resume();
  vi.advanceTimersByTime(60_000);
  expect(events).toEqual(["hint", "confirm", "deduct"]);
});
```

Add reset cases for touch, keyboard, answer, speech-result, hint and `생각 중이에요`; add pause cases for hidden, lock, server-wait and celebration.

- [ ] **Step 3: Run RED**

Run: `npm test -- tests/client/reading-judge.test.ts tests/client/inactivity-controller.test.ts tests/client/learning-session.test.tsx`

Expected: FAIL because learning modules do not exist.

- [ ] **Step 4: Implement gated learning and idle requests**

Reading must pass before math unlocks. Incorrect math keeps Next locked; correct math saves the attempt. Use one `learningSessionId` per problem view and one `clientIdleEventId` per timeout. A deduction pauses learning, sends the idle event, displays applied/capped/no-balance server text, and requires explicit resume.

- [ ] **Step 5: Implement celebration once**

Play only for `starAward.awarded === true`. Keep an event-ID set so rerenders and duplicate receipts never replay it. Under reduced motion show `별 1개를 모았어요` with no transform or particle animation. Never auto-play audio.

- [ ] **Step 6: Verify and commit**

Run: `npm run typecheck && npm test -- tests/client/reading-judge.test.ts tests/client/inactivity-controller.test.ts tests/client/learning-session.test.tsx`

Expected: reading, lock, timer, pause and celebration tests PASS.

```bash
git add src/client/learning src/client/delight/star-celebration.tsx tests/client
git commit -m "feat: add learning loop and inactivity guidance"
```

---

### Task 6: PWA shell and offline attempt plus idle-event synchronization

**Files:**
- Create: `src/client/offline/db.ts`
- Create: `src/client/offline/sync.ts`
- Create: `src/client/sw.ts`
- Modify: `src/client/main.tsx`
- Modify: `vite.config.ts`
- Test: `tests/offline/sync.test.ts`

**Interfaces:**
- Produces: IndexedDB stores `todayPlans`, `attemptQueue`, `idleEventQueue`, `meta`
- Produces: `syncPending(api): Promise<{ attempts: SyncResult; idleEvents: SyncResult }>`

- [ ] **Step 1: Write offline RED tests**

Using `fake-indexeddb`, queue the same attempt and idle event twice and assert one row each. Simulate success and assert removal; return 401 and assert both remain; return `DEVICE_REVOKED` and assert queues remain while meta becomes `device-action-required`. Assert cached plans contain no session, PIN or token.

- [ ] **Step 2: Run RED**

Run: `npm test -- tests/offline/sync.test.ts`

Expected: FAIL because offline modules do not exist.

- [ ] **Step 3: Implement idempotent queues**

Use `clientAttemptId` and `clientIdleEventId` as key paths. Sync attempts before idle events, stop on auth failure, retry network/5xx, remove successful or duplicate responses, and refresh `/api/student/stars` after sent events. Show confirmed and queued stars separately and never calculate a spendable local balance.

- [ ] **Step 4: Configure PWA cache boundaries**

Cache only hashed static assets, manifest, icons and navigation shell. Do not runtime-cache `/api/*`, cookies or JSON auth responses. Register the service worker from `main.tsx`.

- [ ] **Step 5: Verify and commit**

Run: `npm run typecheck && npm test -- tests/offline/sync.test.ts && npm run build:client`

Expected: offline tests PASS and the build emits a service worker and manifest.

```bash
git add src/client/offline src/client/sw.ts src/client/main.tsx vite.config.ts tests/offline/sync.test.ts
git commit -m "feat: sync learning and star events offline"
```

---

### Task 7: Guardian progress, ledger, plan settings, and approvals

**Files:**
- Create: `src/client/guardian/guardian-dashboard.tsx`
- Modify: `src/client/api/client.ts`
- Modify: `src/client/app.tsx`
- Modify: `src/server/stars/routes.ts`
- Modify: `src/server/stars/service.ts`
- Modify: `src/server/stars/daily-plan.ts`
- Test: `tests/client/guardian-dashboard.test.tsx`
- Test: `tests/server/star-maintenance.test.ts`

**Interfaces:**
- Consumes: guardian progress, ledger, pending adjustments, manual, reverse and backup APIs
- Produces: read/write guardian star administration with explicit confirmation

- [ ] **Step 1: Write guardian component RED tests**

```tsx
expect(await screen.findByText("별 잔액 12개")).toBeVisible();
expect(screen.getByText("5분 무반응")).toBeVisible();
await user.click(screen.getByRole("button", { name: "차감 승인" }));
expect(api.approveStarAdjustment).toHaveBeenCalledWith("pending-1", {
  approvedStars: 1, note: ""
});
await user.click(screen.getByRole("button", { name: "아픈 날로 면제" }));
expect(screen.getByLabelText("면제 사유")).toBeRequired();
```

Also test manual bonus, negative adjustment confirmation, reversal reason, future-date targets 2/2, rest day, `PLAN_LOCKED`, and absence of delete controls.

- [ ] **Step 2: Run RED**

Run: `npm test -- tests/client/guardian-dashboard.test.tsx`

Expected: FAIL because guardian dashboard does not exist.

- [ ] **Step 3: Complete guardian APIs**

Add `GET/PUT /api/guardian/daily-plans/:date`. Future dates accept targets 0..10 and rest day. Current date accepts changes only before a required-completion event. Past and locked current plans return `409 PLAN_LOCKED`. An accepted PUT updates settings, deletes that date's unlocked `daily_requirements`, and regenerates them in one transaction so future student devices see the same list. Ledger list accepts `from`, `to`, `direction`, `reason`, cursor and a hard page limit 100. Require nonempty notes for waiver and reversal.

- [ ] **Step 4: Build guardian UI**

Use tabs `진도`, `별 기록`, `차감 승인`, `학습 계획`, `백업`. Require confirmation for negative manual adjustments, approval and reversal. Show requested, approved and actual applied stars. Link reversal to the original row; never replace or delete the original. Do not display password, PIN, cookies, audio, transcripts or raw internal identifiers.

- [ ] **Step 5: Verify and commit**

Run: `npm run typecheck && npm test -- tests/client/guardian-dashboard.test.tsx tests/server/star-maintenance.test.ts`

Expected: guardian UI and API tests PASS.

```bash
git add src/client/guardian src/client/api/client.ts src/client/app.tsx src/server/stars/routes.ts tests/client/guardian-dashboard.test.tsx tests/server/star-maintenance.test.ts
git commit -m "feat: add guardian star controls"
```

---

### Task 8: Consistent backup and maintenance operations

**Files:**
- Create: `src/server/backup/service.ts`
- Create: `src/server/backup/routes.ts`
- Create: `src/server/backup-cli.ts`
- Modify: `src/server/app.ts`
- Modify: `package.json`
- Test: `tests/server/backup.test.ts`
- Create: `ops/synology/restore-backup.md`

**Interfaces:**
- Produces: `createBackup`, `rotateBackups(dailyKeep=14, weeklyKeep=8)`
- Produces: `GET /api/guardian/backup-status`
- Consumes: `npm run backup`, `npm run daily-maintenance`

- [ ] **Step 1: Write backup RED tests**

Create a file DB containing one attempt, balance, star event and pending adjustment. Back it up, open the copy, assert all four exist and `PRAGMA integrity_check` returns `ok`. Create 16 daily and 10 weekly fixtures and assert 14/8 remain. Force a path failure and assert the stored error contains only a normalized code.

- [ ] **Step 2: Run RED**

Run: `npm test -- tests/server/backup.test.ts`

Expected: FAIL because backup service does not exist.

- [ ] **Step 3: Implement verified backup**

Use `await db.backup(tempPath)`, open the temp DB, run integrity check, rename atomically into `backups/daily`, copy Sunday backups into `backups/weekly`, and rotate. Record success/failure without home paths. The restore guide copies to a new filename, checks integrity and star balance versus ledger sum, then replaces production only while the container is stopped.

- [ ] **Step 4: Expose safe guardian status**

Return `never-run` or latest success/failure time and filename only. Keep backup and daily maintenance as separate DSM commands.

- [ ] **Step 5: Verify and commit**

Run: `npm run typecheck && npm test -- tests/server/backup.test.ts`

Expected: backup, rotation, integrity and normalized-error tests PASS.

```bash
git add src/server/backup src/server/backup-cli.ts src/server/app.ts package.json package-lock.json tests/server/backup.test.ts ops/synology/restore-backup.md
git commit -m "feat: back up learning and star records"
```

---

### Task 9: Container, Synology deployment, acceptance, and prototype retirement

**Files:**
- Create: `Dockerfile`
- Create: `compose.yaml`
- Create: `scripts/smoke-container.sh`
- Create: `ops/synology/README.md`
- Create: `docs/phase1-acceptance.md`
- Modify: `README.md`
- Modify: `docs/hosting-options.md`
- Delete after parity: `prototype/*`, `wrangler.toml`

**Interfaces:**
- Produces: container health at `GET /api/health`
- Produces: host-only `127.0.0.1:8787:8787`
- Consumes: `npm run check`, `npm run backup`, `npm run daily-maintenance`

- [ ] **Step 1: Write the container smoke test first**

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

Expected: FAIL because container files do not exist.

- [ ] **Step 2: Add a reproducible non-root Node 22 image**

Build with `npm ci && npm run check`, copy production modules and `dist`, run as UID/GID 1000, mount `/data`, and use:

```yaml
services:
  app:
    build: .
    restart: unless-stopped
    env_file: .env
    user: "1000:1000"
    environment:
      NODE_ENV: production
      HOST: 0.0.0.0
      PORT: 8787
      DATABASE_PATH: /data/sua-learning.db
      BACKUP_DIR: /data/backups
      TIME_ZONE: Asia/Seoul
    ports:
      - "127.0.0.1:8787:8787"
    volumes:
      - ./data:/data
```

- [ ] **Step 3: Document and perform approved NAS operations**

The user authorized Container Manager installation, `/volume1/docker/sua-learning`, deployment, Synology DDNS, Let's Encrypt certificate, DSM reverse proxy, and router TCP 443 only. Set data ownership 1000:1000/mode 700 and `.env` mode 600. Never forward 5001 or 8787. Stop for CGNAT rather than adding an unapproved tunnel.

Create DSM tasks with these commands and times:

```text
03:00  cd /volume1/docker/sua-learning && docker compose exec -T app npm run backup
06:00  cd /volume1/docker/sua-learning && docker compose exec -T app npm run daily-maintenance
```

- [ ] **Step 4: Run full acceptance**

Record device, date, redacted host and PASS/FAIL evidence for:

1. first setup and trusted Galaxy Tab PIN;
2. A dashboard, original star friend and four required items;
3. required completion awards one star once on two devices;
4. 2/4/5-minute sequence and hidden-tab pause;
5. first two idle events debit, third caps and balance never goes negative;
6. 06:00 candidates appear and guardian approve/waive logs remain;
7. offline attempt and idle event sync once;
8. backup restore preserves attempts, ledger, balance and pending rows;
9. restart catch-up stays idempotent;
10. external HTTPS works while 5001/8787 do not;
11. no audio, transcript, PIN, raw token or private path is stored or logged.

- [ ] **Step 5: Retire the prototype after parity**

Verify all 20 payload hashes and icons, then delete prototype and `wrangler.toml`. Update hosting docs so Synology is active and Cloudflare Pages is historical only.

- [ ] **Step 6: Final verification and commit**

Run: `npm run check && bash scripts/smoke-container.sh && git diff --check`

Expected: typecheck, all tests, client/server build, health and whitespace checks PASS.

```bash
git add Dockerfile compose.yaml scripts ops README.md docs package.json package-lock.json public src tests
git add -u prototype wrangler.toml
git commit -m "feat: complete star-enabled Synology learning room"
```

---

## Definition of Done

- Clean clone builds with Node 22 using `npm ci && npm run check`.
- Registered Galaxy Tab shows the A layout, original star friend and four required items.
- Required completion, duplicate retry, idle deduction, cap, zero balance, reversal and guardian approval preserve ledger invariants.
- Multiple devices show the same confirmed balance; queued offline stars are visibly separate.
- The 2/4/5-minute controller pauses in every approved non-active state and has reduced-motion coverage.
- 06:00 maintenance and startup catch-up produce at most two candidates without duplication.
- Backups restore attempts, plans, ledger, cached balance and pending approvals with integrity checks.
- Synology DDNS HTTPS exposes only 443; DSM 5001 and app 8787 remain external-inaccessible.
- No protected character asset, camera/eye data, audio, full transcript, PIN, raw token or private path is stored or logged.
