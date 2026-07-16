# 수아의 공부방 배포 전 권위·오프라인 강화 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` to implement this plan task-by-task with a fresh implementer and a fresh reviewer for every task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Synology 공개 배포 전에 신뢰 기기 수명주기, 서버 발급 계획·학습 세션, 인과 순서가 보존되는 오프라인 동기화와 아동 우선 별 차감 규칙을 완성한다.

**Architecture:** Fastify와 SQLite가 KST 현재 날짜, 발급 계획, 학습 세션, 활동 cursor와 별 원장의 유일한 권위가 된다. React PWA는 당일 비밀 없는 임대와 정제된 계획만 IndexedDB에 저장하고, 시도와 무반응을 하나의 시간순 저널로 보낸다. 서버는 배치를 한 즉시 트랜잭션에서 검증·정렬·적용하며 여러 기기 cursor가 충돌하면 시도는 보존하고 무반응 차감은 감사 로그와 함께 면제한다.

**Tech Stack:** Node.js 22, TypeScript 7.0, Fastify 5.10, React 19.2, Vite 8.1, SQLite 3 via better-sqlite3 12.11, Zod 4.4, IndexedDB via idb 8.0, Vitest 4.1, Testing Library 16.3, vite-plugin-pwa 1.3, Docker Compose

## Global Constraints

- 기준 설계는 `docs/superpowers/specs/2026-07-16-predeployment-authority-offline-hardening-design.md`이며 구현 중 보안·별 원장 규칙을 약화하지 않는다.
- Node 명령은 Node 22와 npm 11에서 실행한다. 호스트 버전이 다르면 저장소에서 이미 사용한 Node 22 실행 래퍼를 사용한다.
- 가족 로그인만 허용하고 공개 회원가입·게스트 학습을 추가하지 않는다.
- 학생 PIN 로그인은 활성 신뢰 기기에서만 허용하고 보호자 전환도 보호자 비밀번호 재입력 없이 수행하지 않는다.
- 서버가 `Asia/Seoul` 현재 날짜, 발급 계획·항목 버전, 확정 별과 차감을 결정한다.
- 별 원장은 append-only이고 잔액은 항상 0 이상이다. 순서가 불명확한 오프라인 이벤트는 수아에게 불리하게 처리하지 않는다.
- 인증 토큰, 기기 쿠키, PIN, 비밀번호, 음성 파일, 전체 전사문과 학습 세션 ID를 IndexedDB나 Cache Storage에 저장하지 않는다.
- 13인치 갤럭시 탭 가로 화면을 기본으로 하고 새 계정·기기·오프라인 조작의 터치 영역은 최소 48px이다.
- `/api/*`는 서비스 워커에 저장하지 않고 모든 인증·학생·보호자 API 응답에 `Cache-Control: no-store`를 사용한다.
- 각 작업은 테스트를 먼저 실패시키고 최소 구현 후 focused test, `npm run typecheck`, 관련 빌드를 실행한다.
- 각 작업 구현자는 자기 작업만 커밋하며 검토자는 읽기 전용으로 확인한다. 검토 결함은 같은 구현자에게 수정시키고 재검토한다.
- LLM 문제 생성·상호 감리, API 키 관리, 콘텐츠 편집, 주간 계획·보상 확장과 AI 보호자 보고서는 이번 계획 범위 밖이다.

---

## Shared Contracts

다음 공개 계약을 모든 작업이 공유한다. 구현 중 필드명을 임의로 바꾸지 않는다.

```ts
type StudentLoginResult = { offlineAccessUntil: string };

type TrustedDeviceView = {
  publicId: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
  status: "active" | "revoked";
  current: boolean;
};

type TodayPlan = {
  planId: string;
  planKind: "daily" | "recovery";
  recoverySourcePlanId: string | null;
  date: string;
  submitUntil: string;
  offlineEpoch: number;
  activityCursor: number;
  studentDisplayName: string;
  completedItemIds: string[];
  requiredItemIds: string[];
  stars: StudentStarSummary;
  items: Array<{ id: string; version: number; payload: LearningItemPayload }>;
};

type RecoveryPlanRequest = { sourcePlanId: string };

type AttemptInput = {
  clientAttemptId: string;
  planId: string;
  itemId: string;
  contentVersion: number;
  studyDate: string;
  occurredAt: string;
  readingScore: number;
  missedTokens: string[];
  mathAnswer: number | null;
  durationMs: number;
  difficultyFeedback: "easy" | "thinking" | "hard" | null;
};

type LearningSessionRequest = {
  planId: string;
  itemId: string;
  contentVersion: number;
};

type LearningSessionReceipt = {
  learningSessionId: string;
  activeUntil: string;
  submitUntil: string;
};

// Add `activityCursor: number` directly to the existing AttemptReceipt and
// IdleEventResult definitions; all online and batch receipts carry it.

type LegacyAttemptInput = Omit<AttemptInput, "planId" | "occurredAt">;
type LegacyIdleEventInput = Omit<
  IdleEventInput,
  "learningSessionId" | "planId" | "contentVersion"
>;

type ActivityEvent =
  | {
      kind: "attempt";
      deviceSequence: number;
      legacy: false;
      payload: AttemptInput;
    }
  | {
      kind: "attempt";
      deviceSequence: number;
      legacy: true;
      payload: LegacyAttemptInput;
    }
  | {
      kind: "idle";
      deviceSequence: number;
      legacy: false;
      payload: IdleEventInput;
    }
  | {
      kind: "idle";
      deviceSequence: number;
      legacy: true;
      payload: LegacyIdleEventInput;
    };

type WithoutDeviceSequence<T> = T extends unknown
  ? Omit<T, "deviceSequence">
  : never;

type PersistedActivity = {
  clientId: string;
  occurredAt: string;
  deviceSequence: number;
  planId: string;
  sourcePlanId: string | null;
  offlineEpoch: number;
  baseCursor: number;
  requiresRecovery: boolean;
  recoveryBlockedCode: "SOURCE_DEVICE_STILL_ACTIVE" | null;
  event: WithoutDeviceSequence<ActivityEvent>;
};

type PendingBatch = {
  clientBatchId: string;
  groupKey: string;
  planId: string;
  offlineEpoch: number;
  startCursor: number;
  orderedClientIds: string[];
  requestFingerprint: string;
};

type OfflineBatchInput = {
  clientBatchId: string;
  planId: string;
  offlineEpoch: number;
  startCursor: number;
  events: ActivityEvent[]; // 1..100
};

type ActivityReceipt = {
  clientId: string;
  kind: "attempt" | "idle";
  status: "APPLIED" | "DUPLICATE" | "REJECTED" | "ORDER_CONFLICT_WAIVED";
  code: string | null;
  attempt: AttemptReceipt | null;
  idle: IdleEventResult | null;
};

type OfflineBatchReceipt = {
  clientBatchId: string;
  duplicate: boolean;
  orderConflict: boolean;
  batchEndCursor: number;
  activityCursor: number;
  receipts: ActivityReceipt[];
  processedPlan: TodayPlan;
  currentDailyPlan: TodayPlan;
  stars: StudentStarSummary;
};
```

---

### Task 1: 권위 데이터 기반, 공통 계약과 작은 배포 결함

**Files:**
- Create: `src/server/db/migrations/003-authority-offline.ts`
- Modify: `src/server/db/migrate.ts`
- Modify: `src/shared/auth.ts`
- Create: `src/shared/study-date.ts`
- Modify: `src/server/app.ts`
- Modify: `src/client/delight/star-celebration.tsx`
- Modify: `vite.config.ts`
- Test: `tests/server/db.test.ts`
- Test: `tests/server/auth.test.ts`
- Test: `tests/server/app.test.ts`
- Test: `tests/client/learning-session.test.tsx`
- Test: `tests/offline/pwa-config.test.ts`

**Produces:** migration version 3, strict KST date helpers, additive device/auth contracts, API no-store, one-second celebration and icon precache. The final learning/star contracts in Shared Contracts are activated atomically by their owning Tasks 3–5, not by Task 1.

- [ ] **Step 1: Write failing migration and validation tests**

Add tests that migrate a version-2 database containing an active trusted device, attempt, idle event and star ledger, then assert:

- `trusted_devices.public_id` is populated and unique and `last_used_at` exists.
- `attempts.issued_plan_id` and `attempts.occurred_at` exist without rewriting existing attempts.
- `issued_daily_plans`, `issued_plan_items`, `issued_learning_sessions`, `student_activity_cursors`, `offline_batches` and `offline_activity_receipts` exist.
- `idle_events.outcome` accepts `order-conflict-waived` while existing rows remain unchanged.
- a second `migrate(db)` is idempotent.
- the existing pre-Task-2 device registration repository can still insert a device and receives an auto-filled unique public ID.

Add pure date tests for leap days, invalid month/day, and `kstStudyDate` around UTC/KST midnight. Add API tests that `/api/auth/me`, `/api/student/*`, `/api/guardian/*` and `/api/health` include `Cache-Control: no-store`. Extend component/PWA tests to require a celebration timeout of at most 1,000ms and precache patterns for `icon-192.png` and `icon-512.png` while preserving the `/api` denylist.

- [ ] **Step 2: Run the focused tests and confirm failure**

Run:

```bash
npx --yes -p node@22 -p npm@11.11.0 -- npm test -- tests/server/db.test.ts tests/server/auth.test.ts tests/server/app.test.ts tests/client/learning-session.test.tsx tests/offline/pwa-config.test.ts
```

Expected: FAIL because migration 3, strict calendar validation, no-store hook, icon patterns and one-second timeout do not exist.

- [ ] **Step 3: Implement migration 3 exactly**

`003-authority-offline.ts` must:

1. Add nullable `public_id` and `last_used_at` to `trusted_devices`, backfill every existing device with `randomUUID()`, and create a unique partial index. Until Task 2 makes repository inserts explicit, an `AFTER INSERT` compatibility trigger fills null/empty values with `lower(hex(randomblob(16)))`; a `BEFORE UPDATE` trigger rejects attempts to clear an established public ID. Task 2 removes reliance on the compatibility path and always supplies a UUID public ID.
2. Add nullable `issued_plan_id` and `occurred_at` to `attempts`; legacy rows remain readable and future repository writes require both fields at the application boundary.
3. Rebuild `idle_events` with outcome `order-conflict-waived`; copy every row before dropping the old table. `learning_session_id` is nullable only when outcome is `order-conflict-waived`, enforced by `CHECK ((outcome = 'order-conflict-waived') OR learning_session_id IS NOT NULL)`. Existing `applied`, `capped` and `no-balance` rows still require a session ID.
4. Create the authority tables with these invariants:

```sql
CREATE TABLE issued_daily_plans (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES users(id),
  trusted_device_id TEXT NOT NULL REFERENCES trusted_devices(id),
  plan_kind TEXT NOT NULL CHECK (plan_kind IN ('daily','recovery')),
  recovery_source_plan_id TEXT REFERENCES issued_daily_plans(id),
  study_date TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  submit_until TEXT NOT NULL,
  offline_epoch INTEGER NOT NULL CHECK (offline_epoch > 0),
  start_cursor INTEGER NOT NULL CHECK (start_cursor >= 0),
  CHECK ((plan_kind = 'recovery') = (recovery_source_plan_id IS NOT NULL))
);
CREATE TABLE issued_plan_items (
  plan_id TEXT NOT NULL REFERENCES issued_daily_plans(id),
  item_id TEXT NOT NULL REFERENCES content_items(id),
  content_version INTEGER NOT NULL,
  is_required INTEGER NOT NULL CHECK (is_required IN (0,1)),
  sort_order INTEGER NOT NULL,
  PRIMARY KEY (plan_id, item_id),
  FOREIGN KEY (item_id, content_version) REFERENCES content_versions(item_id, version)
);
CREATE TABLE issued_learning_sessions (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES issued_daily_plans(id),
  student_id TEXT NOT NULL REFERENCES users(id),
  trusted_device_id TEXT NOT NULL REFERENCES trusted_devices(id),
  item_id TEXT NOT NULL,
  content_version INTEGER NOT NULL,
  study_date TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  active_until TEXT NOT NULL,
  submit_until TEXT NOT NULL,
  revoked_at TEXT,
  FOREIGN KEY (plan_id, item_id) REFERENCES issued_plan_items(plan_id, item_id)
);
CREATE TABLE student_activity_cursors (
  student_id TEXT PRIMARY KEY REFERENCES users(id),
  next_epoch INTEGER NOT NULL CHECK (next_epoch > 0),
  current_cursor INTEGER NOT NULL CHECK (current_cursor >= 0),
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX issued_daily_plan_one_daily_idx
  ON issued_daily_plans(student_id, trusted_device_id, study_date)
  WHERE plan_kind = 'daily';
CREATE UNIQUE INDEX issued_daily_plan_one_recovery_idx
  ON issued_daily_plans(student_id, trusted_device_id, recovery_source_plan_id)
  WHERE plan_kind = 'recovery';
```

`offline_batches` stores `client_batch_id`, a canonical `request_fingerprint`, student/original-device/submitting-device/plan, epoch, start/end cursor, outcome, canonical `response_json` containing only immutable event receipts/processed plan/batch-end cursor, and created time, unique on `(student_id, client_batch_id)`. Fresh current plan/stars/activity cursor are never frozen in this JSON. Reusing an ID with a different fingerprint is `BATCH_ID_CONFLICT`. `offline_activity_receipts` stores `(student_id, client_event_id)` uniquely with batch, study date, item ID, kind, status, stable code, redacted `receipt_json` and created time. Its JSON may contain an attempt/idle result but never request payloads, answers, missed tokens, transcripts, cookies, tokens or learning-session IDs. Add indexes for active device sessions, issued plan lookup, active learning session lookup and guardian rejection queries.

- [ ] **Step 4: Implement additive auth schemas and strict date helpers**

Add `StudentLoginResult`, `TrustedDeviceView` and device request schemas without changing existing learning/star producers. `StudyDateSchema` must reject normalized-but-impossible dates such as `2026-02-31`; `kstStudyDate(date)` and `kstDayBounds(dateString)` are the only server date calculations used by later tasks. Do not make final authority fields optional or fill them with temporary values merely to keep Task 1 green.

- [ ] **Step 5: Add small deployment fixes**

Add one Fastify `onSend` hook before route registration that sets `Cache-Control: no-store` for paths equal to `/api` or starting with `/api/`; do not add Cache Storage logic. Change `CELEBRATION_DISPLAY_MS` to `1_000`. Include the two PWA icons in `injectManifest.globPatterns` and retain the navigation `/api` denylist.

- [ ] **Step 6: Verify and commit**

Run:

```bash
npx --yes -p node@22 -p npm@11.11.0 -- npm test -- tests/server/db.test.ts tests/server/auth.test.ts tests/server/app.test.ts tests/client/learning-session.test.tsx tests/offline/pwa-config.test.ts
npx --yes -p node@22 -p npm@11.11.0 -- npm run typecheck
npx --yes -p node@22 -p npm@11.11.0 -- npm run build:client
git diff --check
```

Commit: `feat: add authority storage and shared contracts`

---

### Task 2: 보호자 기기 수명주기와 자격 증명 기반 역할 전환

**Files:**
- Modify: `src/server/auth/repository.ts`
- Modify: `src/server/auth/service.ts`
- Modify: `src/server/auth/routes.ts`
- Modify: `src/client/api/client.ts`
- Modify: `src/client/auth/auth-context.tsx`
- Modify: `src/client/auth/login-screen.tsx`
- Modify: `src/client/app.tsx`
- Modify: `src/client/guardian/guardian-dashboard.tsx`
- Modify: `src/client/styles/components.css`
- Test: `tests/server/auth.test.ts`
- Test: `tests/client/api-client.test.ts`
- Test: `tests/client/login-and-home.test.tsx`
- Test: `tests/client/guardian-dashboard.test.tsx`

**Produces:** device list/register/revoke APIs, revoked-vs-unknown distinction, student offline lease, session end and account menu.

- [ ] **Step 1: Write failing server lifecycle tests**

Cover this exact flow:

1. guardian login on a browser without a device cookie;
2. `GET /api/guardian/devices` returns no token/hash/internal row id;
3. `POST /api/guardian/devices/current` registers and returns a `sua_device` cookie plus a `TrustedDeviceView` identified only by `publicId`;
4. student PIN login returns `200 { offlineAccessUntil }`, and the lease is the earlier of KST 23:59:59 and session expiry;
5. current authenticated requests update `lastUsedAt` at most once per five minutes;
6. revoke by `publicId` marks the device revoked, deletes its student sessions, revokes its learning sessions, and preserves guardian sessions;
7. after revocation deletes the bound student session, cold `/api/auth/me` with the old cookie still receives `DEVICE_REVOKED`; a valid student session with a missing, random, or different-device cookie receives `DEVICE_NOT_TRUSTED`, while a random cookie without a valid session receives `AUTH_REQUIRED`;
8. repeated register/revoke calls are idempotent and never disclose opaque tokens.

Also test `POST /api/auth/session/end`: it deletes only the current session and cannot accept a target role or user ID.

- [ ] **Step 2: Run server auth tests and confirm failure**

Run `npx --yes -p node@22 -p npm@11.11.0 -- npm test -- tests/server/auth.test.ts`.

Expected: FAIL because list/revoke/public IDs, lease response, revoked-device error and session-end endpoint are absent.

- [ ] **Step 3: Implement repository and service device context**

Replace `findCurrentUser` with a session context result used internally by Fastify:

```ts
type RequestAuthContext = {
  user: CurrentUser | null;
  trustedDeviceId: string | null; // server-only, never serialized
  deviceStatus: "missing" | "unknown" | "active" | "revoked";
};
```

Repository methods must list safe device views, resolve active/revoked/unknown token hashes, register the current token, throttle last-use updates, and revoke by public ID in one immediate transaction. Revocation updates `trusted_devices.revoked_at`, deletes `sessions` with the device and student user, and updates active `issued_learning_sessions.revoked_at` if the table exists. Service errors add `DEVICE_REVOKED` without converting it to generic authentication failure.

- [ ] **Step 4: Implement routes and cookies**

Add:

- `GET /api/guardian/devices`
- `POST /api/guardian/devices/current`
- `POST /api/guardian/devices/:publicId/revoke`
- `POST /api/auth/session/end`

Remove the client dependency on `/api/auth/devices`; if a compatibility route remains, it must call the same guardian-only service and tests must prove no weaker path. Student login returns the lease JSON. Add Fastify request decorations for `currentUser` and server-only `currentTrustedDeviceId`; student routes in later tasks must reject missing or inactive device context.

- [ ] **Step 5: Write failing client account-menu tests**

Test guardian post-onboarding registration, safe device listing, current/other device revoke confirmation, student-to-guardian and guardian-to-student transitions, and explicit credential re-entry. For a cold `DEVICE_REVOKED` or `DEVICE_NOT_TRUSTED`, assert the device-action screen requires a fresh guardian password before the guardian-only registration API is called, then ends the guardian session and returns to the existing student PIN login without resetting that PIN. Lost session-end responses still fail closed locally; transient registration failures remain retryable in the already authenticated guardian step. Assert no UI action directly changes `CurrentUser.role`; the flow is always `session/end` followed by the normal password or PIN screen. Assert all new buttons measure or style to at least 48px.

- [ ] **Step 6: Implement client lifecycle UI**

Extend `ClientApi` with device list/revoke and `endSession`. Put `기기 관리`, `수아 모드`, and `로그아웃` in the guardian header account menu rather than adding a sixth dashboard tab. Put `보호자 모드` and `로그아웃` in the student header. AuthContext must represent the explicit login phase after ending a session and must not reuse prior credentials.

Do not implement IndexedDB clearing here; expose callback boundaries `onSessionEnded`, `onDeviceRevoked` and `onAuthorityFailure(code)` consumed by Tasks 4 and 6 so explicit 401/device/plan errors can exit learning immediately and the offline policy remains centralized rather than duplicated.

- [ ] **Step 7: Verify and commit**

Run:

```bash
npx --yes -p node@22 -p npm@11.11.0 -- npm test -- tests/server/auth.test.ts tests/client/api-client.test.ts tests/client/login-and-home.test.tsx tests/client/guardian-dashboard.test.tsx
npx --yes -p node@22 -p npm@11.11.0 -- npm run typecheck
git diff --check
```

Commit: `feat: manage trusted device lifecycle`

---

### Task 3: 서버 발급 오늘 계획과 발급 항목에 묶인 시도

**Files:**
- Modify: `src/shared/learning.ts`
- Create: `src/server/learning/issued-plan-repository.ts`
- Modify: `src/server/learning/repository.ts`
- Modify: `src/server/learning/service.ts`
- Modify: `src/server/learning/routes.ts`
- Modify: `src/server/stars/daily-plan.ts`
- Modify: `src/client/api/client.ts`
- Modify: `src/client/home/student-home.tsx`
- Modify: `src/client/learning/learning-session.tsx`
- Modify: `src/client/offline/db.ts`
- Modify: `tests/helpers/client.ts`
- Test: `tests/server/learning.test.ts`
- Test: `tests/server/star-learning.test.ts`
- Test: `tests/client/api-client.test.ts`
- Test: `tests/offline/sync.test.ts`
- Test: `tests/client/login-and-home.test.tsx`
- Test: `tests/client/learning-session.test.tsx`

**Produces:** idempotent current-KST plan issuance and plan-bound online attempts.

This task atomically replaces the exported `TodayPlan`, `AttemptInput` and `AttemptReceipt` contracts with their final plan/cursor-bound forms and updates every producer, client consumer and test fixture in the same commit. No authority field is optional.

- [ ] **Step 1: Write failing current-date and issuance tests**

At fixed KST times, assert:

- `GET /api/student/today` accepts no client date and issues only server current KST date.
- a non-empty query such as `?date=2026-07-15` is rejected with `INVALID_REQUEST` so legacy clients cannot select arbitrary days.
- issuance fails without an active trusted device.
- repeated reads on the same student/device/date return the same `planId`, epoch, starting cursor, item versions and submit deadline.
- a second device receives a different plan and epoch but the same server-selected study date/content order.
- `submitUntil` is the end of the next KST day.
- `DailyPlanService.ensure` cannot be reached from a student-supplied arbitrary date.

- [ ] **Step 2: Write failing plan-bound attempt tests**

Require `planId` and `occurredAt`. Reject without saving an attempt or star when the plan belongs to another student/device, does not contain the item/version, `occurredAt` is outside the study day, or server receive time is after `submitUntil`. Accept an already issued yesterday plan until its deadline. Preserve `clientAttemptId` idempotency and one required-item star source key.

Add a snapshot regression: publish item v1, issue a plan containing v1, publish v2 with a different answer/text, then submit the issued v1 attempt. The server must judge with v1 payload, store `content_version = 1`, return the v1 item from repeated `TodayPlan`, and include the completion through the issued-plan snapshot even though active content is v2.

Add required-status snapshot regressions: after issuance, delete/change the mutable `daily_requirements` row and prove an item snapshotted `is_required=1` still awards exactly one star; conversely, adding a mutable requirement after issuance must not award a star for an item snapshotted `is_required=0`.

- [ ] **Step 3: Run focused tests and confirm failure**

Run `npx --yes -p node@22 -p npm@11.11.0 -- npm test -- tests/server/learning.test.ts tests/server/star-learning.test.ts`.

Expected: FAIL because the current route trusts `date` and attempts are not plan-bound.

- [ ] **Step 4: Implement issued plan allocation**

`IssuedPlanRepository.issueToday` runs in an immediate transaction and reads/writes only `plan_kind='daily'` rows. It initializes the student's cursor row when absent, allocates and increments `next_epoch` only for a new student/device/date plan, snapshots all delivered item versions and `is_required`, and returns the same row on duplicate reads. Use the server KST date and `kstDayBounds`; never derive authority from a query or browser date.

`TodayPlan` uses the snapshot in `issued_plan_items`, not current active versions, so a content publication after issuance cannot mutate an in-flight plan.

- [ ] **Step 5: Bind attempt validation and persistence**

Add `IssuedPlanRepository.validateAttempt(studentId, deviceId, input, receivedAt)`. It returns the immutable snapshot payload, version and `isRequired` flag or throws one of:

- `PLAN_NOT_ISSUED`
- `PLAN_SUBMISSION_EXPIRED`
- `CONTENT_VERSION_CONFLICT`
- `INVALID_REQUEST`

`LearningRepository.saveAttemptInTransaction` must not start its own top-level transaction and must write `issued_plan_id` and `occurred_at`. It receives the validated snapshot payload/version/`isRequired` from `IssuedPlanRepository`, must not re-query `content_items.active_version`, and passes the snapshot flag directly to star-award creation instead of querying mutable `daily_requirements`. `listCompletedItemIds(studentId, requestedPlanId)` starts from the requested plan's `issued_plan_items`, then matches any successful same-student/same-study-date attempt on the exact `(item_id, content_version)` pair; it must not require `attempts.issued_plan_id = requestedPlanId` and must not join current active content. Therefore a same-date recovery attempt marks the ordinary daily item complete only when its snapshot version matches, while a different-version recovery remains a valid historical attempt but does not falsely complete the newer item. Keep `saveAttempt` as a thin immediate-transaction wrapper for the online endpoint. The later batch service will call the transaction-aware method.

The online wrapper must advance `student_activity_cursors.current_cursor` in the same transaction only for a newly inserted attempt. A duplicate returns the current server cursor without advancing it. Add the current `activityCursor` to the online attempt receipt and update the cached plan cursor client-side; `TodayPlan.activityCursor` is the student's current cursor at response time while `issued_daily_plans.start_cursor` remains the immutable issuance snapshot. This makes subsequent offline work observe online interleaving.

- [ ] **Step 6: Update client contracts and online attempt creation**

Change `ApiClient.getToday()` to omit the date. Pass `planId` from `StudentHome` into `LearningSession`, set `occurredAt` when a reading/math result is submitted, and preserve `studyDate` only as a server-validated field. Do not add offline unlocking yet; Task 6 owns provisional behavior.

- [ ] **Step 7: Verify and commit**

Run:

```bash
npx --yes -p node@22 -p npm@11.11.0 -- npm test -- tests/server/learning.test.ts tests/server/star-learning.test.ts tests/client/api-client.test.ts tests/client/login-and-home.test.tsx tests/client/learning-session.test.tsx tests/offline/sync.test.ts
npx --yes -p node@22 -p npm@11.11.0 -- npm run typecheck
git diff --check
```

Commit: `feat: issue authoritative daily plans`

---

### Task 4: 서버 발급 학습 세션과 유효 세션에만 허용되는 무반응 차감

**Files:**
- Modify: `src/shared/learning.ts`
- Modify: `src/shared/stars.ts`
- Create: `src/server/learning/session-repository.ts`
- Modify: `src/server/learning/service.ts`
- Modify: `src/server/learning/routes.ts`
- Modify: `src/server/stars/service.ts`
- Modify: `src/server/stars/routes.ts`
- Modify: `src/client/api/client.ts`
- Modify: `src/client/learning/learning-session.tsx`
- Modify: `tests/helpers/client.ts`
- Test: `tests/server/learning.test.ts`
- Test: `tests/server/star-learning.test.ts`
- Test: `tests/client/learning-session.test.tsx`
- Test: `tests/client/inactivity-controller.test.ts`
- Test: `tests/client/api-client.test.ts`
- Test: `tests/offline/sync.test.ts`

**Produces:** six-hour server learning sessions and authenticated, bound idle deductions.

This task activates `LearningSessionRequest`, `LearningSessionReceipt`, the plan/version-bound `IdleEventInput`, and cursor-bound `IdleEventResult` while updating every direct producer/consumer in the same commit. It does not activate offline batch types yet.

- [ ] **Step 1: Write failing learning-session API tests**

For `POST /api/student/learning-sessions`, assert the requested plan/item/version must belong to the authenticated student and active device. A successful receipt has a random opaque correlation ID, `activeUntil = min(issuedAt + 6h, submitUntil)` and the plan submit deadline. A revoked device/session, wrong item/version, wrong device plan or expired plan is rejected.

- [ ] **Step 2: Write failing idle binding tests**

Reject without idle/star rows when the learning session is unknown, revoked, owned by another device/student, belongs to another item/version/date, is not yet issued, is older than six hours, has times outside the session window, has less than five minutes elapsed, or arrives after submit deadline. Keep duplicate idle idempotency and daily max two deductions. Add a positive test for an online-issued session that loses connectivity and submits within deadline.

- [ ] **Step 3: Run focused tests and confirm failure**

Run:

```bash
npx --yes -p node@22 -p npm@11.11.0 -- npm test -- tests/server/learning.test.ts tests/server/star-learning.test.ts tests/client/learning-session.test.tsx tests/client/inactivity-controller.test.ts tests/client/api-client.test.ts tests/offline/sync.test.ts
```

Expected: FAIL because browser-generated learning session IDs are currently trusted.

- [ ] **Step 4: Implement session issue and validation**

Create `LearningSessionRepository.issue` and `validateIdle`. Validation receives authenticated student and server-only device ID plus the full idle payload. Add `contentVersion` and `planId` to `IdleEventInput` so every dimension is explicit. A session ID alone grants nothing.

Extract `StarService.recordIdleEventInTransaction(studentId, deviceId, input, options?)`; the public `recordIdleEvent` wraps it in an immediate transaction. This prepares Task 5 without nested immediate transactions.

The direct online idle wrapper advances the same student activity cursor in its transaction only for a new idle event and returns the current cursor. A duplicate does not advance it. The batch service passes `advanceCursor: false` to both attempt and idle cores because its outer transaction owns cursor advancement.

- [ ] **Step 5: Implement online/offline-aware client session state**

When a problem opens, call `createLearningSession({planId,itemId,contentVersion})`. Keep the returned ID only in React memory. A network `TypeError` may enter `offline-unissued` only when the caller has already validated the current offline lease/device/cached-plan conditions; hints and confirmation remain available but deduction does not. Explicit `401`, `DEVICE_REVOKED`, `DEVICE_NOT_TRUSTED`, plan errors and other 4xx clear offline authority, invoke the auth/device-action callback and exit the learning screen. Add client tests for every branch.

At five minutes:

- `online-issued`: send the bound idle event; if the network fails during Task 4, keep it only in volatile component memory and never write the session ID to the v1 IndexedDB queue.
- `offline-unissued`: do not create an idle ID and do not call queue APIs; show `오프라인에서는 별을 차감하지 않아요` and require the same resume action.

An online-issued idle may keep `learningSessionId` only in React memory while the page remains open. Task 6 replaces this temporary volatile fallback with persistence after removing `learningSessionId` and setting `legacy: true`; it is then eligible only for an `ORDER_CONFLICT_WAIVED` audit, never a deduction. Task 4 tests explicitly prove the existing v1 `queueIdleEvent` is not called on failure.

- [ ] **Step 6: Verify and commit**

Run:

```bash
npx --yes -p node@22 -p npm@11.11.0 -- npm test -- tests/server/learning.test.ts tests/server/star-learning.test.ts tests/client/learning-session.test.tsx tests/client/inactivity-controller.test.ts tests/client/api-client.test.ts tests/offline/sync.test.ts
npx --yes -p node@22 -p npm@11.11.0 -- npm run typecheck
git diff --check
```

Commit: `feat: bind idle deductions to issued sessions`

---

### Task 5: 시간순 단일 오프라인 배치와 아동 우선 cursor 충돌 처리

**Files:**
- Modify: `src/shared/learning.ts`
- Modify: `src/shared/stars.ts`
- Create: `src/server/offline/repository.ts`
- Create: `src/server/offline/service.ts`
- Create: `src/server/offline/routes.ts`
- Modify: `src/server/app.ts`
- Modify: `src/server/learning/issued-plan-repository.ts`
- Modify: `src/server/learning/repository.ts`
- Modify: `src/server/stars/repository.ts`
- Modify: `src/server/stars/service.ts`
- Modify: `src/client/api/client.ts`
- Modify: `src/client/learning/learning-session.tsx`
- Modify: `tests/helpers/client.ts`
- Test: `tests/server/offline-batch.test.ts`
- Test: `tests/server/star-learning.test.ts`
- Test: `tests/client/api-client.test.ts`
- Test: `tests/client/learning-session.test.tsx`

**Produces:** one transactional batch endpoint, exact retry receipts and order-conflict waiver audit.

This task activates `ActivityEvent`, recovery-plan, offline-batch/rejection contracts and the `order-conflict-waived` result variant while updating every exhaustive UI/server consumer in the same commit.

- [ ] **Step 1: Write failing chronological batch tests**

Build a fixed plan at star balance 0 and submit two interleaved events in reverse array order: idle at 10:00 followed by a successful required attempt at 10:05. Assert the server derives canonical `occurredAt` and client ID from each payload, sorts `(occurredAt, deviceSequence, derivedClientId)`, records a zero-floor `NO_BALANCE_AUDIT`, then awards +1, and returns balance 1. Add cross-item interleaving, equal timestamps, daily idle cap and batches of 101 events rejected before any write. For non-legacy events, assert every payload `planId` equals the batch `planId`; mismatches reject the event and cannot influence sorting or validation. A reconciled legacy attempt uses the server batch receive time as canonical `occurredAt`; a legacy idle retains its original `occurredAt` but is always waiver-only.

- [ ] **Step 2: Write failing idempotency and conflict tests**

Assert:

- retrying the same `clientBatchId` returns the same canonical event receipts, `processedPlan` and `batchEndCursor`, changes `duplicate` to `true`, performs no writes, and attaches freshly read `activityCursor`, `currentDailyPlan` and stars so a lost first response cannot roll authority backward;
- reusing a stored `clientBatchId` with any different plan/epoch/start cursor/ordered event IDs or canonical payload fingerprint returns `409 BATCH_ID_CONFLICT` with no writes;
- a new batch containing a previously processed client event returns `DUPLICATE` for that event and does not double-apply it;
- matching `startCursor` applies attempts and eligible idles in order and advances cursor once per newly recorded event;
- stale `startCursor` preserves valid attempts, inserts every idle as `order-conflict-waived`, writes a zero-delta `NO_BALANCE_AUDIT` with reason `오프라인 순서 충돌로 차감하지 않았어요`, returns `ORDER_CONFLICT_WAIVED`, and never deducts stars;
- foreign-student, still-active-other-device, unknown-plan or mismatched-epoch input hard-rejects the complete batch with no writes; same-student expiry follows the stored terminal-receipt rule below;
- an invalid individual event gets a `REJECTED` receipt while other valid events commit; this is a business rejection, not an unexpected transaction failure.

Add revoked-device recovery coverage without weakening current-device plan binding. After guardian re-registration and a fresh student PIN login, `POST /api/student/recovery-plans` accepts an old source `planId` only when it belongs to the same student, its original device is revoked, it is still inside `submitUntil`, and the current submitting device is active. The endpoint idempotently issues a `plan_kind='recovery'` plan to the current device, copying the immutable source item/version/required snapshot, study date and submit deadline while allocating a new epoch and current start cursor. The later batch references this new current-device plan. Valid attempts are preserved; every recovered idle is forced to `ORDER_CONFLICT_WAIVED`. If the source device is still active (for example a lost cookie followed by re-registration), return stable nonterminal `SOURCE_DEVICE_STILL_ACTIVE`; do not issue or transfer a plan until the guardian explicitly revokes that source device. Unknown/foreign sources remain non-recoverable.

- [ ] **Step 3: Run focused tests and confirm failure**

Run `npx --yes -p node@22 -p npm@11.11.0 -- npm test -- tests/server/offline-batch.test.ts tests/server/star-learning.test.ts tests/client/api-client.test.ts tests/client/learning-session.test.tsx`.

Expected: FAIL because the batch route and receipt persistence do not exist.

- [ ] **Step 4: Implement transaction-aware star audit primitives**

Add a repository method that appends a `NO_BALANCE_AUDIT` event with `requested_delta = -1`, `delta = 0`, unchanged balance, unique source key and no balance update. Use it for both zero-floor and order-conflict waiver. Do not update or delete prior star rows.

`StarService.recordIdleEventInTransaction` receives `{ orderConflict: boolean, legacy: boolean }`. `orderConflict` or legacy idle always inserts `idle_events.outcome = 'order-conflict-waived'` and the audit star event; it bypasses deduction but still validates idempotency, student/plan/item/date and safe timestamp shape. A non-legacy idle still requires a valid issued learning session. The wire schema forbids `learningSessionId` on a legacy idle and requires it on a non-legacy idle.

- [ ] **Step 5: Implement one immediate batch transaction**

`OfflineBatchService.apply` must:

1. parse stored canonical event receipts/processed plan/batch-end cursor for a duplicate batch, set `duplicate: true`, recompute fresh current activity cursor/current daily plan/stars in one consistent read transaction, and perform no writes;
2. validate authenticated active device, issued plan, epoch and submit deadline;
3. derive client ID and `occurredAt` from the discriminated payload, validate the payload plan against the batch plan, stable-sort a copied event list, and never trust duplicate outer fields or input array order;
4. compare current student cursor with `startCursor` once at transaction start;
5. apply each new event through transaction-aware attempt/idle methods, catching only declared business validation errors into `REJECTED` receipts;
6. increment the current cursor for every new receipt, including a rejected or waived event, so retry order cannot stall;
7. persist event receipts, refreshed plan/star summaries, the complete batch receipt and final cursor before commit.

Every batch receipt distinguishes `processedPlan` from `currentDailyPlan`. `processedPlan` and `batchEndCursor` are canonical idempotency facts stored with the batch. `currentDailyPlan`, stars and `activityCursor` are fresh authority snapshots read for every response, including duplicates. `currentDailyPlan` is always the server-current KST day's ordinary `plan_kind='daily'` plan for the submitting device after recomputing completion/star summaries; it equals `processedPlan` only for a current-day ordinary batch. Before any sync, the client must successfully call `GET /api/student/today`, cache that response and then send batches. If KST midnight passes between that read and the batch, the server returns nonterminal `409 CURRENT_DAILY_PLAN_REQUIRED` before any batch/event write; the client preserves the reserved ID/envelope and rows, fetches the new current day, then retries the same reservation. It must never quarantine the events for this code. For recovery, `processedPlan` is sync-only. Add same-date tests for both matching version (ordinary item stays completed after refetch) and changed version (historical attempt preserved but newer item remains incomplete). Add next-day recovery and explicit 23:59:59→00:00:00 race tests where yesterday is `processedPlan`, today is `currentDailyPlan`, the reservation is reused, and only today's date-key cache is written. Add a lost-response retry test where another device advances stars/cursor before the duplicate request; canonical receipts stay identical while fresh authority never regresses. The server never asks the client to cache an old or recovery plan as today's offline learning authority.

Unexpected database/programming errors must roll back the entire transaction and produce no stored batch.

For a same-student plan that is well-formed but expired, store a terminal batch receipt whose events are `REJECTED` with `PLAN_SUBMISSION_EXPIRED` and return `200`; this lets the client stop retrying and lets the guardian read a safe rejection summary. Authentication/device failures and malformed request bodies remain HTTP failures. Recovery plans follow the constrained issuance rule in Step 2 and are always treated as an order conflict for idle events.

- [ ] **Step 6: Register API and verify**

Register `POST /api/student/recovery-plans` and `POST /api/student/offline-batches`; both require student plus active server-only device context. The recovery endpoint returns only a newly issued current-device plan, never the source device identity. Parse 1–100 batch events and return `200` for both first application and duplicate receipts. `ORDER_CONFLICT_WAIVED` is a receipt status, never an HTTP error.

Run:

```bash
npx --yes -p node@22 -p npm@11.11.0 -- npm test -- tests/server/offline-batch.test.ts tests/server/star-learning.test.ts tests/client/api-client.test.ts tests/client/learning-session.test.tsx
npx --yes -p node@22 -p npm@11.11.0 -- npm run typecheck
git diff --check
```

Commit: `feat: apply ordered offline activity batches`

---

### Task 6: IndexedDB 단일 활동 저널, 오프라인 콜드 스타트와 임시 완료

**Files:**
- Modify: `src/client/offline/db.ts`
- Modify: `src/client/offline/sync.ts`
- Modify: `src/client/auth/auth-context.tsx`
- Modify: `src/client/home/student-home.tsx`
- Modify: `src/client/learning/learning-session.tsx`
- Modify: `src/client/api/client.ts`
- Modify: `src/client/app.tsx`
- Modify: `src/client/styles/components.css`
- Test: `tests/offline/sync.test.ts`
- Create: `tests/offline/db-migration.test.ts`
- Test: `tests/client/login-and-home.test.tsx`
- Test: `tests/client/learning-session.test.tsx`

**Produces:** DB version 2 journal migration, guarded offline lease, cold start, provisional progress and transactional batch sync.

- [ ] **Step 1: Write failing IndexedDB upgrade and privacy tests**

Open a version-1 database containing cached plan, attempts, idles, confirmed stars and device state. Upgrade and assert:

- authority-complete version-2 records use `activityQueue` and preserve `planId`, `offlineEpoch`, `baseCursor`, deterministic `deviceSequence` and the original non-secret payload/client ID;
- v1 attempts and idles first move atomically to `legacyActivities` because v1 has no issued `planId`, epoch or base cursor and attempts have no trustworthy `occurredAt`; the upgrader must not invent those values;
- migrated idles have `learningSessionId` removed and can only become a waiver; migrated attempts retain their original answer/score payload only inside the local queue and never a server/guardian report;
- old queues are no longer read by sync (they may remain as read-only stores for one schema version so the upgrade transaction can migrate them atomically);
- new `meta` records hold only `offline-lease`, `next-device-sequence`, `acknowledged-cursors`, `device-state` and confirmed stars; device state is `ready`, `auth-required` or `device-action-required`;
- no cookie, token, PIN, password, full transcript or learning session ID is present in cached plan/lease metadata;
- `clearOfflineAuthority()` deletes only cached plans, lease and confirmed stars; it preserves `activityQueue`, `legacyActivities`, `rejectedActivities`, `pendingBatches`, recovery flags/source IDs, acknowledged cursors and device sequence metadata.

- [ ] **Step 2: Write failing cold-start and expiry tests**

Assert a network `TypeError` from `/api/auth/me` enters offline student mode only when role is student, lease is unexpired, device state is ready and a same-KST-date cached issued plan exists. Expired lease, missing/wrong-day plan, explicit 401, logout and `DEVICE_REVOKED` must show login/device action instead. Normal logout/session end sets `auth-required`; revoke sets `device-action-required`; both states block queue reads, writes and sync until a successful active-device student PIN login sets `ready`. A server 401 is not treated as offline.

- [ ] **Step 3: Write failing unified sync tests**

Queue interleaved attempt/idle events, select at most 100 from the oldest same-plan/same-epoch/same-base-cursor group, and in one preflight IndexedDB `readwrite` transaction reserve a random `clientBatchId`, ordered client IDs and canonical request fingerprint in `pendingBatches` before network I/O. A retry/reopen sends the exact reserved group with the same ID; newly queued events cannot join it. A single sync wake continues with a fresh reservation after each successful receipt so 101+ rows and later authority groups do not wait indefinitely for another startup/login/online event. Bound that drain by the activity count observed at wake start so concurrent producers cannot create an infinite loop. The first network/5xx, 401, device-action, terminal or recovery-blocked result stops without reserving another batch and reports all prior successful event counts in `sent`. On success, one IndexedDB `readwrite` transaction spanning `activityQueue`, `rejectedActivities`, `pendingBatches`, `todayPlans` and `meta` removes/moves rows from canonical event receipts, clears the reservation, stores `max(existingAcknowledgedCursor, receipt.activityCursor)`, writes only fresh `currentDailyPlan` and fresh stars, and ignores stale nested/event cursors and recovery `processedPlan`. Network/5xx/ambiguous failure preserves the reservation; success or terminal rejection clears it atomically. Add injected-abort/crash-and-reopen tests proving either all receipt effects become visible or none do, and a lost-response retry proving the same batch ID/envelope is reused while new events wait for a later batch.

`syncPending` first obtains and caches the authoritative current daily plan; if that read does not succeed, it sends no batch. This makes next-day ordinary/recovery submission deterministic and prevents the global `online` listener from syncing before the current plan exists. Tests cover yesterday ordinary sync and yesterday recovery sync, both leaving only today's ordinary plan as the offline-start authority.

On network/5xx keep the whole unsent batch. Any 401 from `/auth/me`, current-plan fetch, recovery or batch sync runs `clearOfflineAuthority('auth-required')`, stops, and preserves/blocks all queues including same-device pending batch reservations; it is never treated as offline or terminal rejection. On either `DEVICE_REVOKED` or `DEVICE_NOT_TRUSTED`, one IndexedDB `readwrite` transaction deletes cached plans/lease/confirmed stars, sets `device-action-required`, marks every affected authority-complete row `requiresRecovery: true`, copies its old plan to `sourcePlanId`, invalidates/deletes affected old-plan `pendingBatches`, and preserves activity/rejection/cursor records. After recovery rebinding, reserve a new client batch ID/fingerprint. If the ambiguous old batch had already committed, server event-level idempotency returns duplicates; if it had not, the recovery batch applies the events. Add both cases plus injected-abort/crash-and-reopen coverage. The unknown-device path must enter recovery after registration/PIN, receive `SOURCE_DEVICE_STILL_ACTIVE` while the old server device remains active, and never attempt a normal batch first.

When `DEVICE_REVOKED` is observed, mark affected authority-complete rows `requiresRecovery: true` while preserving their original plan as `sourcePlanId`. After guardian re-registration and fresh student PIN login, call `createRecoveryPlan(sourcePlanId)` before sync, then atomically rebind only the row authority envelope and non-legacy attempt `planId` to the returned current-device recovery plan/epoch/cursor. Sanitize all recovered idles to legacy waiver form. Never rewrite answers, scores, timestamps or client IDs.

If recovery-plan creation returns `PLAN_SUBMISSION_EXPIRED`, atomically move the entire matching `sourcePlanId` group to `rejectedActivities` with that code and stop retrying it; the guardian projection must retain the code without raw answers/session data. Network/5xx keeps the group pending, and 401/device errors remain blocked rather than terminal. Add a post-deadline re-registration test for each branch.

If the browser lost/changed its device cookie while the source device is still active, recovery-plan creation returns `SOURCE_DEVICE_STILL_ACTIVE`. Preserve the source group, set its `recoveryBlockedCode`, stop automatic retries for that group, and show `보호자 기기 관리에서 이전 기기를 해제해 주세요`; do not move it to rejected activities. After a guardian revokes the source device and the student reauthenticates, clear the block only on a successful recovery-plan response and continue the normal rebind. Add tests that distinguish this recoverable hold from terminal `PLAN_NOT_ISSUED`/expiry.

For terminal non-auth 4xx responses (`INVALID_REQUEST`, non-recoverable `PLAN_NOT_ISSUED`, invalid epoch), atomically move the submitted rows from `activityQueue` to `rejectedActivities` with the stable code instead of retrying forever. The guardian progress tab in Task 7 merges these same-browser local rejections with server rejection summaries. Never classify 401, `DEVICE_REVOKED`, `DEVICE_NOT_TRUSTED`, `CURRENT_DAILY_PLAN_REQUIRED`, `SOURCE_DEVICE_STILL_ACTIVE`, network errors or 5xx as terminal.

- [ ] **Step 4: Run focused tests and confirm failure**

Run:

```bash
npx --yes -p node@22 -p npm@11.11.0 -- npm test -- tests/offline/db-migration.test.ts tests/offline/sync.test.ts tests/client/login-and-home.test.tsx tests/client/learning-session.test.tsx
```

Expected: FAIL because DB v1 has separate queues, cached plans are unused and no offline lease/provisional flow exists.

- [ ] **Step 5: Implement the DB v2 journal and policy boundary**

Add stores:

- `activityQueue`, key `clientId`, indexes `[planId, offlineEpoch, occurredAt, deviceSequence, clientId]` and `[planId, baseCursor]`;
- `legacyActivities`, key `clientId`, for authority-incomplete v1 records pending online reconciliation;
- `rejectedActivities`, key `clientId`;
- `pendingBatches`, key `clientBatchId`, with a unique `groupKey` index and no authentication/session secrets;
- existing `todayPlans` and `meta` with expanded typed records.

Every new queue write obtains and increments one `next-device-sequence` in the same IndexedDB readwrite transaction. Never generate a fresh sequence on retry. All queue read/write/sync entry points first require `device-state='ready'`; they throw `AUTH_REQUIRED` for `auth-required` and `DEVICE_ACTION_REQUIRED` for `device-action-required` before exposing or mutating payloads.

The queue writer materializes top-level `clientId`, canonical `occurredAt` and `deviceSequence` for IndexedDB keys/indexes. It derives the first two from the validated discriminated payload (or the explicit reconciliation time for a legacy attempt) and never accepts competing caller-supplied values. Wire conversion removes the persistence-only authority/index wrapper and reconstructs `ActivityEvent.deviceSequence` from the stored top-level value. A canonical fingerprint covers plan, epoch, start cursor and the fully ordered wire events; reservation creation and group membership validation happen in one transaction. Tests must prove payload ID/time and materialized index values cannot diverge and a reservation cannot be reused with a changed envelope.

Preserve per-plan acknowledged cursors together with the journal when logout/revoke clears offline authority; they are non-secret replay metadata, not permission. A batch always selects exactly one same-plan/same-epoch/same-base-cursor group, starting with the minimum/oldest `baseCursor`; a newer acknowledged or online-receipt cursor must never hide a stale queued row. Acknowledged cursor is used only when assigning `baseCursor` to newly created rows. The wire event has no duplicate outer plan/epoch/base-cursor fields: the server validates the batch plan/epoch against the issued plan, every non-legacy payload plan against the batch plan, and `startCursor` against the current student cursor. Permission still comes only from the fresh active device cookie and student PIN session.

The persistent `activityQueue` schema accepts attempts and `legacy: true` idle records only. A non-legacy idle with a server-issued session ID exists only in memory for an immediate request/batch; when persistence is required, sanitize it to the legacy waiver form before opening the IndexedDB transaction.

After a successful online current-plan fetch, reconcile `legacyActivities` without fabrication. A v1 attempt may bind to the issued plan only when its `studyDate` is the current server plan date and its item/version is in the snapshot; use the reconciliation receive time as canonical `occurredAt` and mark it legacy. Because v1 idle rows contain no content version, they may bind by same current date and item ID only; copy the version from that single issued-plan snapshot row and keep the event waiver-only with its original idle timestamps. Move every unmatched, ambiguous or prior-date legacy record to `rejectedActivities` with `LEGACY_AUTHORITY_UNAVAILABLE`; preserve the raw local record for guardian review on that browser but never send answers or transcripts in a rejection report.

Implement `clearOfflineAuthority(reason: "auth-required")`, atomic `handleDeviceActionRequired(code: "DEVICE_REVOKED" | "DEVICE_NOT_TRUSTED")`, `markStudentAuthenticated`, `storeOfflineLease`, `loadOfflineStudentSession`, `cacheIssuedPlan`, and `applyBatchReceipt`. The device-action handler and `applyBatchReceipt` use the single multi-store transactions required in Step 3; do not split their writes across helper transactions. Wire the Task 2 auth callback boundary so logout/session end uses `auth-required`, either device error uses the atomic recovery transition, and successful active-device student PIN login is the only transition back to `ready`, while preserving all journal/rejection/recovery/cursor metadata listed in Step 1.

- [ ] **Step 6: Implement cold start and provisional learning**

Online `StudentHome` caches the issued plan and authoritative stars after a successful fetch. If authoritative fetch fails due to network and offline session validation succeeds, it renders the cached plan with an `오프라인 학습 중` banner.

For a cached/offline-opened problem:

- run the same local reading/math judge;
- enqueue an attempt with `occurredAt`, mark the item `provisional`, unlock `다음 문제`, and show `동기화 대기`;
- never add a provisional star to confirmed balance;
- never enqueue idle deduction without the in-memory server learning-session receipt;
- refresh from the returned server plan/stars after sync and remove provisional labels only from final receipts.

- [ ] **Step 7: Implement unified sync and compatibility cleanup**

Replace `syncAttempts`/`syncIdleEvents` with chronological `syncPending` batches. Preserve the existing public sync-completed subscription but publish only after receipt application. Change queue counts to `{ activities, provisionalAttempts, rejected }` and adapt `TodayStars` without showing provisional stars as confirmed.

- [ ] **Step 8: Verify and commit**

Run:

```bash
npx --yes -p node@22 -p npm@11.11.0 -- npm test -- tests/offline/db-migration.test.ts tests/offline/sync.test.ts tests/client/login-and-home.test.tsx tests/client/learning-session.test.tsx
npx --yes -p node@22 -p npm@11.11.0 -- npm run typecheck
npx --yes -p node@22 -p npm@11.11.0 -- npm run build:client
git diff --check
```

Commit: `feat: support guarded offline learning journal`

---

### Task 7: 전체 통합, 보호자 거절 가시성, 문서와 배포 전 판정

**Files:**
- Modify: `src/shared/learning.ts`
- Modify: `src/server/offline/repository.ts`
- Modify: `src/server/offline/service.ts`
- Modify: `src/server/offline/routes.ts`
- Modify: `src/client/api/client.ts`
- Modify: `src/client/offline/db.ts`
- Modify: `src/client/guardian/guardian-dashboard.tsx`
- Modify: `src/client/styles/layout.css`
- Modify: `src/client/styles/responsive.css`
- Modify: `src/client/styles/components.css`
- Modify: `src/server/learning/service.ts`
- Modify: `tests/helpers/app.ts`
- Modify: `tests/helpers/client.ts`
- Create: `tests/server/authority-integration.test.ts`
- Modify: `tests/server/offline-batch.test.ts`
- Modify: `tests/offline/db-migration.test.ts`
- Create: `tests/client/auth-offline-lifecycle.test.tsx`
- Modify: `tests/client/guardian-dashboard.test.tsx`
- Modify: `docs/phase1-acceptance.md`
- Modify: `docs/android-tablet.md`
- Modify: `ops/synology/README.md`
- Modify: `ops/synology/restore-backup.md`
- Modify: `package.json`
- Create: `scripts/restore-smoke.sh`

**Produces:** end-to-end acceptance evidence, safe guardian rejection display, truthful operational gates and restore cleanup.

- [ ] **Step 1: Write the complete authority integration test**

One server test must execute this server-only sequence across two cookie jars:

1. guardian registers Galaxy Tab A and B;
2. both log in with student PIN and receive different issued plans/epochs;
3. A opens a server learning session, goes offline and queues idle+attempt;
4. B submits a successful attempt first and advances the cursor;
5. A reconnects with a stale cursor; its attempt is preserved, its idle is `ORDER_CONFLICT_WAIVED`, no star is deducted and the guardian ledger shows the Korean waiver reason;
6. guardian revokes A; A's student and learning sessions fail with `DEVICE_REVOKED` and its old source plan cannot be submitted directly;
7. guardian re-registers A and student PIN login succeeds; the old source plan is exchanged for an idempotent current-device recovery plan, a preserved fixture attempt syncs, and every recovered idle is waiver-only;
8. B remains usable and its server-confirmed plan/stars are unchanged except for valid events.

Add boundary cases for KST midnight, yesterday submit cutoff and retry of the complete batch.

Separately, `tests/client/auth-offline-lifecycle.test.tsx` uses fake IndexedDB and a scripted API to prove the browser callbacks: logout/revoke clears only cached authority, preserves and blocks all journal stores, fresh registration plus PIN triggers recovery-plan rebinding, recovered attempts sync, recovered idles are sanitized to waiver-only, and a crash/reopen cannot reveal partial receipt state. Do not claim client cache behavior from the server cookie-jar test.

- [ ] **Step 2: Add guardian rejected-activity visibility**

Add `GET /api/guardian/offline-rejections?limit=100` backed only by redacted `offline_activity_receipts`. Its shared/client type is `{ id, studyDate, itemId, itemTitle, kind, code, createdAt }`; it never returns `receipt_json` or request payloads. Merge these server summaries with redacted projections of `rejectedActivities` from the current browser and show `동기화 확인 필요` in the existing progress tab. Order-conflict waiver belongs in the normal append-only star ledger and is not a rejection.

Server tests cover guardian success, anonymous `401`, student `403`, integer `limit` bounds 1–100, stable newest-first ordering with ID tie-break, and an adversarial stored receipt containing answer/token/session-like fields to prove none can cross the response projection. Client tests assert neither server nor local projections render `receipt_json`, answers, missed tokens, transcripts, opaque tokens or learning-session IDs.

- [ ] **Step 3: Fix restore cleanup and document truthful gates**

Create `scripts/restore-smoke.sh` from the non-destructive checks in `ops/synology/restore-backup.md`. Its trap is installed before any temporary artifact/container/database is created, it operates only on a copied candidate, and it still cleans up under `set -e`. Add `smoke:container` and `smoke:restore` package scripts and a shell/config test that asserts the trap ordering without requiring Docker.

Replace the restore guide's inline candidate-creation/cleanup block with an invocation of the tested script and a short explanation of its inputs/output. The guide must not retain a second unsafe sequence that creates a candidate before trap installation. Keep the separate, explicitly manual production replacement/rollback procedure and require the container to be stopped before that manual step.

Update docs with exact local verification commands, Galaxy Tab landscape/48px evidence fields, two-device/offline/revoke scenarios, external 443-only check, Docker smoke, backup/restore and DSM scheduled-task fields. Leave every environment-dependent item `NOT RUN` until measured on the real Synology/Galaxy Tab; do not infer PASS from unit tests.

- [ ] **Step 4: Run focused integration and regression tests**

Run:

```bash
npx --yes -p node@22 -p npm@11.11.0 -- npm test -- tests/server/authority-integration.test.ts tests/server/auth.test.ts tests/server/learning.test.ts tests/server/offline-batch.test.ts tests/server/star-learning.test.ts tests/client/login-and-home.test.tsx tests/client/learning-session.test.tsx tests/client/guardian-dashboard.test.tsx tests/offline/db-migration.test.ts tests/offline/sync.test.ts tests/server/container-smoke-config.test.ts
npx --yes -p node@22 -p npm@11.11.0 -- npm run typecheck
npx --yes -p node@22 -p npm@11.11.0 -- npm run build
git diff --check
```

Expected: all automated checks PASS. Real Synology/Galaxy Tab gates remain explicitly `NOT RUN` unless executed with captured evidence.

- [ ] **Step 5: Run the complete repository verification**

Run:

```bash
npx --yes -p node@22 -p npm@11.11.0 -- npm run check
bash -n scripts/*.sh
git status --short
```

If Docker is available, also run `npx --yes -p node@22 -p npm@11.11.0 -- npm run smoke:container`; otherwise record `NOT RUN — Docker unavailable`, not PASS.

- [ ] **Step 6: Request final whole-branch review and commit**

Ask a fresh reviewer to inspect the entire base-to-head diff against the approved design, with special attention to:

- no client-selected star date;
- no device/token leakage;
- no offline cold start after logout/revoke/expiry;
- no idle deduction without a valid issued session;
- exact transaction/idempotency/cursor behavior;
- zero-floor and order-conflict child-favorable results;
- API/PWA cache exclusion;
- Galaxy Tab interaction/accessibility regressions.

Resolve every Critical/Important finding and rerun the affected focused plus complete verification.

Commit: `test: close authority hardening acceptance`

---

## Completion Gate

Implementation is code-complete only when:

1. every task commit has a separate approval review;
2. the Node-22-wrapped `npm run check`, shell syntax and diff checks pass at the final head;
3. the whole-branch reviewer reports no Critical or Important code finding;
4. operational docs truthfully distinguish automated PASS from Synology/Galaxy Tab `NOT RUN`;
5. live deployment is still withheld until Docker, real tablet, two-device/offline, revoke, backup/restore, DSM task and external 443-only evidence are all recorded.
