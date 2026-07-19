# AI 학습실·스텝업 숙제·반응형 화면 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** 보호자가 두 AI 제공자의 키·예산·문제 초안·보고서를 관리하고, 수아가 가로 화면에서는 왼쪽 메뉴로, 세로 화면에서는 플로팅 메뉴로 국어·수학의 기초 → 현재 수준 → 도전 숙제를 완주하게 한다.

**Architecture:** SQLite/Fastify가 AI 키·초안·발행 상태·단계 완료·보너스 별의 유일한 권위가 된다. React는 서버가 발행한 계획과 영수증만 표시하며, 회전할 때도 동일한 React 상태를 보존하는 CSS 기반 두 내비게이션 셸을 사용한다. 기존 AI 코치 암호화와 학습/오프라인 계약을 확장하되 API 키·원시 음성·전사 결과는 영속 저장소와 화면에 남기지 않는다.

**Tech Stack:** Node.js 22, TypeScript, Fastify, React, Zod, SQLite via better-sqlite3, Vitest, Testing Library, CSS media queries.

## Global Constraints

- 기준 설계는 docs/superpowers/specs/2026-07-18-ai-learning-studio-step-up-design.md다.
- Node 명령은 npx --yes -p node@22 -p npm@11.11.0 -- npm ...로 실행한다.
- 큰 가로 화면은 정확히 @media (min-width: 900px) and (orientation: landscape)이며, 그 밖의 모든 화면은 플로팅 메뉴를 사용한다.
- 새 메뉴는 48px 이상의 터치 대상과 키보드 접근성을 제공하며, 화면 회전 중 답안·선택 패널·열린 AI 트리를 잃지 않는다.
- 기존 korean-reading, math-story, version 1–3 콘텐츠, 발행 계획, 별 원장, 신뢰 기기, 오프라인 큐를 계속 읽고 동기화한다. SQLite 데이터를 초기화하거나 콘텐츠 버전을 내리지 않는다.
- 수학 기본 출제는 두 자리 덧셈·뺄셈, 받아올림·받아내림, 세 수 혼합 계산이며 곱셈은 기본 일일 숙제에 넣지 않는다.
- 받아쓰기는 낱말에서 짧은 문장으로 진행하며 녹음·Web Speech·음성 전사에 의존하지 않는다.
- API 키는 HTTPS 요청에서만 받고 LLM_ENCRYPTION_KEY로 AES-256-GCM 암호화한다. GET/오류/로그/클라이언트 상태에 키 원문·일부 문자열을 넣지 않는다.
- AI 문제 생성은 두 제공자가 활성화되고 키가 저장된 경우에만 반씩 생성하고 서로 감리한다. 생성물은 보호자가 발행하기 전까지 초안이다.
- AI 호출 실패·예산 초과·감리 실패는 기존 숙제·진도·별을 바꾸지 않고 오류 코드로 끝난다. 보고서는 같은 데이터의 로컬 결정론적 요약으로 대체한다.
- 도전 문제는 오답이어도 시도 완료로 넘어가지만, 도전 전부 정답인 경우에만 과목별 보너스 별을 한 번 지급한다. 기본 보너스는 2, 보호자 조절 범위는 0–5다.
- 버니는 홈/오늘 목표/보상/도전 만점 축하, 밀키는 계산·받아쓰기 힌트/다시 듣기/재시도, 차나핑은 풀이 중 반응만 담당한다.
- Node 22 컨테이너, SQLite 볼륨, GitHub 이미지 발행, NAS 5분 pull 배포는 유지한다. 배포 전 전체 검사와 빌드를 통과한다.

---

## File Structure

- src/shared/learning.ts: 단계, 받아쓰기, AI 스튜디오 DTO와 기존 시도/계획의 호환 스키마.
- src/shared/stars.ts: 도전 만점 별 사유와 보호자별 보너스 설정 DTO.
- src/server/db/migrations/007-step-up-ai-studio.ts: 기존 계획/시도/별 원장을 보존하는 단계·AI 초안 테이블과 열 추가.
- src/server/stars/daily-plan.ts: 오늘의 세 단계 선택, 약점 우선 선택, 보호자 난이도/보너스 설정.
- src/server/learning/issued-plan-repository.ts, repository.ts, service.ts: 단계 스냅샷, 도전 오답 완료, 만점 보너스 영수증.
- src/server/coach/service.ts, studio-service.ts, routes.ts: 제공자별 암호화 설정, 생성/상호 감리/초안/로컬 보고서.
- src/client/guardian/guardian-dashboard.tsx, ai-learning-studio.tsx: AI 트리, 키/모델/예산, 배치 초안과 발행, 보고서, 난이도/보너스 설정.
- src/client/home/student-home.tsx, student-navigation.tsx: 단계 잠금/진도와 학생용 메뉴.
- src/client/learning/learning-session.tsx, dictation-panel.tsx: 받아쓰기 입력, 도전 오답 다음 진행, 밀키 도움.
- src/client/navigation/responsive-navigation.tsx: 가로 레일과 세로 FAB에 공통으로 쓰는 접근 가능한 메뉴.
- tests/server/step-up-schema.test.ts, learning.test.ts, star-learning.test.ts, ai-studio.test.ts: 마이그레이션, 권위, 별 영수증, AI 경계.
- tests/client/guardian-dashboard.test.tsx, learning-session.test.tsx, login-and-home.test.tsx, responsive-navigation.test.tsx: 가시성, 잠금, 메뉴, 입력 보존.

---

### Task 1: 호환 가능한 단계·받아쓰기·AI 초안 데이터 계약

**Files:**
- Create: src/server/db/migrations/007-step-up-ai-studio.ts, tests/server/step-up-schema.test.ts
- Modify: src/server/db/migrate.ts, src/shared/learning.ts, src/shared/stars.ts, tests/server/db.test.ts, tests/offline/db-migration.test.ts

**Interfaces:**

~~~ts
export const LearningStepSchema = z.enum(["foundation", "current", "challenge"]);
export type LearningStep = z.infer<typeof LearningStepSchema>;

export type PlanItem = {
  id: string;
  version: number;
  step: LearningStep;
  payload: LearningItemPayload;
};

export type KoreanDictationItem = BaseItem & {
  kind: "korean-dictation";
  promptText: string;
  answerText: string;
  mode: "word" | "sentence";
};

export type AiProviderSettingsView = {
  provider: "gemini" | "openai";
  enabled: boolean;
  model: string;
  hasApiKey: boolean;
};
~~~

- [ ] **Step 1: Write the failing test**

Add a schema test proving legacy TodayPlan items parse with step current, a dictation item accepts only a word/sentence target, and raw dictationText is request-only. Add a migration test starting at schema 6 with rows in daily_requirements, issued_plan_items, attempts, star_events, and ai_coach_settings. After migration, assert all old IDs and legacy pass values remain.

~~~ts
it("keeps legacy daily and issued rows readable as current-step rows", () => {
  migrate(db);
  expect(db.prepare("SELECT step FROM daily_requirements WHERE item_id = ?")
    .get("math-01")).toEqual({ step: "current" });
  expect(db.prepare("SELECT completed FROM attempts WHERE id = ?")
    .get("legacy-attempt")).toEqual({ completed: 1 });
});
~~~

- [ ] **Step 2: Run test to verify it fails**

Run:

~~~bash
npx --yes -p node@22 -p npm@11.11.0 -- npm test -- tests/server/step-up-schema.test.ts tests/server/db.test.ts tests/offline/db-migration.test.ts
~~~

Expected: FAIL because LearningStepSchema and migration 007 do not exist.

- [ ] **Step 3: Write minimal implementation**

Add both step columns with default current, attempts.completed, attempts.dictation_pass, subject step settings, provider settings, drafts and draft item tables. Migration must add CHALLENGE_PERFECT by rebuilding the star_events CHECK table while preserving every old column, ID, source key and append-only trigger.

~~~sql
ALTER TABLE daily_requirements ADD COLUMN step TEXT NOT NULL DEFAULT 'current'
  CHECK (step IN ('foundation', 'current', 'challenge'));
ALTER TABLE issued_plan_items ADD COLUMN step TEXT NOT NULL DEFAULT 'current'
  CHECK (step IN ('foundation', 'current', 'challenge'));
ALTER TABLE attempts ADD COLUMN completed INTEGER NOT NULL DEFAULT 0
  CHECK (completed IN (0, 1));
ALTER TABLE attempts ADD COLUMN dictation_pass INTEGER
  CHECK (dictation_pass IS NULL OR dictation_pass IN (0, 1));
UPDATE attempts SET completed = CASE
  WHEN reading_pass = 1 AND (math_pass IS NULL OR math_pass = 1) THEN 1 ELSE 0 END;

CREATE TABLE daily_step_settings (
  student_id TEXT NOT NULL REFERENCES users(id), study_date TEXT NOT NULL,
  subject TEXT NOT NULL CHECK (subject IN ('korean', 'math')),
  difficulty INTEGER NOT NULL DEFAULT 3 CHECK (difficulty BETWEEN 1 AND 5),
  challenge_bonus_stars INTEGER NOT NULL DEFAULT 2 CHECK (challenge_bonus_stars BETWEEN 0 AND 5),
  PRIMARY KEY (student_id, study_date, subject)
);
CREATE TABLE ai_provider_settings (
  provider TEXT PRIMARY KEY CHECK (provider IN ('gemini', 'openai')),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)), model TEXT NOT NULL,
  api_key_ciphertext TEXT, api_key_iv TEXT, api_key_tag TEXT, updated_at TEXT NOT NULL
);
CREATE TABLE ai_generation_drafts (
  id TEXT PRIMARY KEY, subject TEXT NOT NULL CHECK (subject IN ('korean', 'math')),
  step TEXT NOT NULL CHECK (step IN ('foundation', 'current', 'challenge')),
  requested_count INTEGER NOT NULL CHECK (requested_count BETWEEN 2 AND 40),
  difficulty INTEGER NOT NULL CHECK (difficulty BETWEEN 1 AND 5), weak_topics_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft', 'failed', 'published')),
  created_at TEXT NOT NULL, published_at TEXT
);
CREATE TABLE ai_generation_items (
  id TEXT PRIMARY KEY, draft_id TEXT NOT NULL REFERENCES ai_generation_drafts(id),
  source_provider TEXT NOT NULL CHECK (source_provider IN ('gemini', 'openai')),
  payload_json TEXT NOT NULL, review_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('accepted', 'rejected', 'edited', 'published')),
  sort_order INTEGER NOT NULL
);
~~~

Define KoreanDictationItemSchema; never persist AttemptInput.dictationText, only dictation_pass. Add step with default current to plan item parsing and add CHALLENGE_PERFECT to StarReasonSchema.

- [ ] **Step 4: Run tests and commit**

~~~bash
npx --yes -p node@22 -p npm@11.11.0 -- npm test -- tests/server/step-up-schema.test.ts tests/server/db.test.ts tests/offline/db-migration.test.ts
npx --yes -p node@22 -p npm@11.11.0 -- npm run typecheck
git diff --check
git add src/server/db src/shared tests/server tests/offline
git commit -m "feat: add step-up learning data contracts"
~~~

Expected: focused tests and typecheck PASS.

---

### Task 2: 서버 권위의 세 단계 발행·도전 완료·만점 보너스

**Files:**
- Modify: src/server/db/seed.ts, src/server/stars/daily-plan.ts, src/server/learning/issued-plan-repository.ts, src/server/learning/repository.ts, src/server/learning/service.ts, src/server/stars/service.ts, src/server/stars/routes.ts, src/shared/learning.ts, src/shared/stars.ts
- Test: tests/server/learning.test.ts, tests/server/star-learning.test.ts, tests/server/content-parity.test.ts

**Interfaces:**

~~~ts
export type SubjectStepSettings = { difficulty: number; challengeBonusStars: number };
export type GuardianDailyPlan = {
  studyDate: string;
  isRestDay: boolean;
  subjectSettings: Record<"korean" | "math", SubjectStepSettings>;
  requiredItemIds: string[];
};
export type ChallengeBonusReceipt = { eligible: boolean; awarded: boolean; amount: number };
~~~

- [ ] **Step 1: Write the failing test**

Use published fixture content with three math calculations and Korean word dictation/reading/sentence dictation. Assert each subject issues foundation, current, challenge in order and stage locks depend on server completedItemIds. Submit a wrong challenge answer and assert completed true, exercise pass false, normal completion star once, no bonus. Submit all challenge items correctly and repeat the same request ID; assert exactly one CHALLENGE_PERFECT event and configured bonus.

~~~ts
expect(today.items.filter((item) => item.payload.subject === "math")
  .map((item) => item.step)).toEqual(["foundation", "current", "challenge"]);
expect(wrongChallenge).toMatchObject({ completed: true, mathPass: false,
  challengeBonus: { eligible: false, awarded: false, amount: 0 } });
expect(perfectChallenge.challengeBonus).toEqual({ eligible: true, awarded: true, amount: 4 });
expect(countReason("CHALLENGE_PERFECT")).toBe(1);
~~~

- [ ] **Step 2: Run test to verify it fails**

~~~bash
npx --yes -p node@22 -p npm@11.11.0 -- npm test -- tests/server/learning.test.ts tests/server/star-learning.test.ts tests/server/content-parity.test.ts
~~~

Expected: FAIL because plans have no steps and all math answers must be correct.

- [ ] **Step 3: Write minimal implementation**

In DailyPlanService.ensureInTransaction, upsert both settings and issue one distinct item per step per subject. Pick candidates in order: latest failed unit/mode, nearest numeric level to guardian difficulty, stable date shuffle. Store/copy stage through daily_requirements and issued_plan_items; never trust client stage.

Promote seed content only forward to version 4. Keep every version 1–3 payload byte-for-byte compatible and add published Korean dictation content for at least one word foundation item, one word current item, and one short-sentence challenge item. Add calculation candidates for all three math steps using the existing calculation extension and only plus/minus expressions. The seed must use INSERT OR IGNORE and active_version < 4 promotion so an existing NAS database is never downgraded.

~~~ts
const STEPS: readonly LearningStep[] = ["foundation", "current", "challenge"];
for (const subject of ["korean", "math"] as const) {
  for (const step of STEPS) {
    const item = chooseItem({ subject, step, difficulty: settings[subject].difficulty,
      weakUnits: recentWeakUnits(subject), excludedIds });
    insertRequirement.run(studentId, studyDate, item.id, subject, step, sortOrder++, createdAt);
    excludedIds.add(item.id);
  }
}
~~~

Carry step in ValidatedAttemptSnapshot. Normalize Korean text with NFC and collapsed whitespace and return dictationPass; do not write submitted text. For challenge only, set completed true after a valid submission even if the exercise pass is false. Persist completed and use it for listCompletedItemIds. Perfect bonus requires every challenge item to have at least one completed and passed attempt; award with one stable source key.

~~~ts
function normalizeHangul(value: string): string {
  return value.normalize("NFC").replace(/\s+/g, "").trim();
}
function existingExercisePass(payload: Exclude<LearningItemPayload, KoreanDictationItem>, input: AttemptInput): boolean {
  return payload.kind === "math-story"
    ? input.mathAnswer === payload.answer
    : input.readingScore >= 85 && input.missedTokens.length === 0;
}
const exercisePassed = payload.kind === "korean-dictation"
  ? normalizeHangul(input.dictationText ?? "") === normalizeHangul(payload.answerText)
  : existingExercisePass(payload, input);
const completed = snapshot.step === "challenge" ? true : exercisePassed;
const bonus = allPerfect ? challengeBonusFor(subject) : 0;
const sourceKey = ["challenge-perfect", studentId, studyDate, subject].join(":");
~~~

Extend DailyPlanInputSchema with subjectSettings; retain legacy target parsing but issue the six canonical staged requirements when settings are present. Rest days issue no requirements and can never become bonus eligible.

- [ ] **Step 4: Run tests and commit**

~~~bash
npx --yes -p node@22 -p npm@11.11.0 -- npm test -- tests/server/learning.test.ts tests/server/star-learning.test.ts tests/server/content-parity.test.ts
npx --yes -p node@22 -p npm@11.11.0 -- npm run typecheck
git diff --check
git add src/server src/shared tests/server
git commit -m "feat: issue step-up daily learning plans"
~~~

Expected: focused server tests PASS, including repeat-request idempotency.

---

### Task 3: 제공자별 AI 설정, 반반 생성, 상호 감리, 초안 발행과 보고서

**Files:**
- Create: src/server/coach/studio-service.ts, tests/server/ai-studio.test.ts
- Modify: src/server/coach/service.ts, src/server/coach/routes.ts, src/shared/learning.ts, src/server/app.ts
- Test: tests/server/coach.test.ts, tests/server/ai-studio.test.ts, tests/server/app.test.ts

**Interfaces:**

~~~ts
export const AiBatchRequestSchema = z.object({
  subject: z.enum(["korean", "math"]), step: LearningStepSchema,
  count: z.number().int().min(2).max(40), difficulty: z.number().int().min(1).max(5),
  weakTopics: z.array(z.string().trim().min(1).max(40)).max(8)
}).strict();
export type AiDraftView = { id: string; status: "draft" | "failed" | "published";
  items: Array<{ id: string; sourceProvider: AiCoachProvider; payload: LearningItemPayload;
    review: { accepted: boolean; reasons: string[] };
    status: "accepted" | "rejected" | "edited" | "published" }> };
export type GuardianAiReport = { source: "llm" | "local"; summary: string;
  completionRate: number; commonMistakes: string[]; challengePerfect: boolean };
~~~

- [ ] **Step 1: Write the failing test**

Fake both provider fetches. With encrypted keys, request 7 math items and assert Gemini generates 4, OpenAI 3, and reviewers inspect only the other provider's candidates. Reject a duplicate answer in review and assert it stays rejected and cannot publish. Assert configured model values, never hard-coded models, are sent; API key text is absent from public payloads; no-key/budget/timeout failures leave published content and daily plans unchanged; no-key report uses local source.

~~~ts
expect(generationCalls.map((call) => call.count)).toEqual([4, 3]);
expect(reviewCalls.every((call) => call.reviewer !== call.author)).toBe(true);
expect(saved.items.find((item) => item.id === rejectedId)?.status).toBe("rejected");
expect(JSON.stringify(publicResponses)).not.toContain("provider-secret-never-rendered");
~~~

- [ ] **Step 2: Run test to verify it fails**

~~~bash
npx --yes -p node@22 -p npm@11.11.0 -- npm test -- tests/server/ai-studio.test.ts tests/server/coach.test.ts tests/server/app.test.ts
~~~

Expected: FAIL because settings are single-provider coach settings and no draft API exists.

- [ ] **Step 3: Write minimal implementation**

Keep existing AiCoachService local fallback, but create AiStudioService for provider settings/drafts. Migrate old settings into the matching provider record. Provider update accepts enabled, a model matching /^[A-Za-z0-9._:-]{2,120}$/, optional key replacement/deletion and returns only hasApiKey.

~~~ts
function otherProvider(provider: AiCoachProvider): AiCoachProvider {
  return provider === "gemini" ? "openai" : "gemini";
}
const halves: Record<AiCoachProvider, number> = {
  gemini: Math.ceil(input.count / 2), openai: Math.floor(input.count / 2)
};
const generated = await Promise.all((Object.keys(halves) as AiCoachProvider[])
  .map((provider) => this.generate(provider, halves[provider], input, signal)));
const reviews = await Promise.all(generated.flatMap(({ provider, items }) =>
  items.map((candidate) => this.review(otherProvider(provider), candidate, input, signal))));
~~~

Pre/post validate every candidate. Math must parse as calculation math-story with only plus/minus, non-negative intermediates and a computed answer. Korean must parse as korean-dictation; foundation/current require word mode, challenge permits only a short sentence. Reject duplicate normalized title/question/answer, wrong grade level, unsafe text or failed review. Reserve budget before each 10-second abortable call, use store false for OpenAI, and keep keys only in server headers.

Add guardian-only GET settings, PUT provider, POST/GET/PATCH draft, POST publish, and GET report routes under /api/guardian/ai-studio. Publish revalidates accepted/edited items, inserts a content version/promotes active version atomically, then marks draft/items published. Build report data locally first; call AI only when configured/budgeted, otherwise return Korean local summary.

- [ ] **Step 4: Run tests and commit**

~~~bash
npx --yes -p node@22 -p npm@11.11.0 -- npm test -- tests/server/ai-studio.test.ts tests/server/coach.test.ts tests/server/app.test.ts
npx --yes -p node@22 -p npm@11.11.0 -- npm run typecheck
git diff --check
git add src/server/coach src/server/app.ts src/shared tests/server
git commit -m "feat: add reviewed AI learning drafts"
~~~

Expected: split, cross-review, no-key, budget and fallback tests PASS.

---

### Task 4: 보호자 AI 학습실 트리와 난이도·발행 화면

**Files:**
- Create: src/client/guardian/ai-learning-studio.tsx
- Modify: src/client/api/client.ts, src/client/guardian/guardian-dashboard.tsx, src/client/styles/components.css
- Test: tests/client/guardian-dashboard.test.tsx, tests/client/api-client.test.ts

**Interfaces:**

~~~ts
export type AiStudioPanel = "settings" | "generate-math" | "generate-korean" |
  "today-report" | "weekly-report";
export function AiLearningStudio(props: {
  api: Pick<ApiClient, "getAiStudioSettings" | "updateAiStudioProvider" |
    "createAiDraft" | "getAiDraft" | "updateAiDraftItem" | "publishAiDraft" |
    "getGuardianAiReport">;
  panel: AiStudioPanel;
  onPanelChange(panel: AiStudioPanel): void;
}): JSX.Element;
~~~

- [ ] **Step 1: Write the failing test**

Assert guardian sees AI 학습실 without tab clipping, expands the exact tree, saves each provider model/key state with blanked input, makes a subject batch with count/difficulty/weak topics, sees rejected items non-publishable, edits an accepted item then publishes it, and saves Korean/math difficulty 1–5 plus perfect bonus 0–5.

~~~tsx
await user.click(screen.getByRole("button", { name: "AI 학습실" }));
await user.click(screen.getByRole("button", { name: "문제 생성" }));
await user.click(screen.getByRole("treeitem", { name: "수학 문제 배치" }));
await user.click(screen.getByRole("button", { name: "초안 만들기" }));
await waitFor(() => expect(createAiDraft).toHaveBeenCalledWith({
  subject: "math", step: "current", count: 8, difficulty: 4, weakTopics: ["받아올림"]
}));
~~~

- [ ] **Step 2: Run test to verify it fails**

~~~bash
npx --yes -p node@22 -p npm@11.11.0 -- npm test -- tests/client/guardian-dashboard.test.tsx tests/client/api-client.test.ts
~~~

Expected: FAIL because AI 코치 is a clipped tab and no AI studio client API exists.

- [ ] **Step 3: Write minimal implementation**

Replace visible AI 코치 with AI 학습실 while retaining dashboard selection state. Render an accessible tree with leaf labels 제공자·모델 선택, API 키 관리, 월 예산·사용량, 수학 문제 배치, 국어·받아쓰기 배치, 오늘의 학습 요약, 주간 변화. Store open tree IDs and selected leaf in React state. Render two provider cards, no key prefill, stored/not-stored state and clear disabled condition until both providers are enabled with keys. Draft cards render provider/review result, schema-validated edit controls and separate publish. Update daily plan panel with Korean/math difficulty and bonus selects.

~~~tsx
<button role="treeitem" onClick={() => onPanelChange("generate-math")}>
  수학 문제 배치
</button>
<label>수학 난이도
  <select value={math.difficulty} onChange={changeMathDifficulty}>
    {[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value}</option>)}
  </select>
</label>
~~~

- [ ] **Step 4: Run tests and commit**

~~~bash
npx --yes -p node@22 -p npm@11.11.0 -- npm test -- tests/client/guardian-dashboard.test.tsx tests/client/api-client.test.ts
npx --yes -p node@22 -p npm@11.11.0 -- npm run typecheck
git diff --check
git add src/client/api src/client/guardian src/client/styles tests/client
git commit -m "feat: add guardian AI learning studio"
~~~

Expected: tests PASS without API key text in DOM snapshots.

---

### Task 5: 학생 스텝업 숙제, 받아쓰기, 친구 역할과 도전 진행

**Files:**
- Create: src/client/learning/dictation-panel.tsx
- Modify: src/client/home/student-home.tsx, src/client/learning/learning-session.tsx, src/client/companions/cast.ts, src/client/companions/cues.ts, src/client/companions/learning-companion.tsx, src/client/styles/components.css
- Test: tests/client/learning-session.test.tsx, tests/client/login-and-home.test.tsx, tests/client/companion-components.test.tsx

**Interfaces:**

~~~ts
export function DictationPanel(props: {
  item: KoreanDictationItem; disabled: boolean;
  onSubmit(text: string): void; onReplay(): void;
}): JSX.Element;
export type StepStatus = "locked" | "available" | "complete";
export function stepStatus(items: readonly PlanItem[], completedItemIds: readonly string[],
  item: PlanItem): StepStatus;
~~~

- [ ] **Step 1: Write the failing test**

Render six daily items. Assert only foundation starts in each subject, later stages unlock from server receipts, dictation exposes replay/large Korean input/no microphone, a wrong challenge says 도전 시도 완료 and advances, while wrong non-challenge remains retryable. Assert Bunny only appears on home/goal/reward/perfect challenge, Milky in calculation/dictation help, and ChanaPing is not the explanatory companion.

~~~tsx
expect(screen.getByRole("button", { name: /현재 수준.*시작하기/ })).toBeDisabled();
await user.type(screen.getByLabelText("받아쓰기 답"), "봄 비");
await user.click(screen.getByRole("button", { name: "받아쓰기 확인" }));
expect(saveAttempt).toHaveBeenCalledWith(expect.objectContaining({ dictationText: "봄 비" }));
expect(screen.getByText("도전 시도 완료")).toBeVisible();
~~~

- [ ] **Step 2: Run test to verify it fails**

~~~bash
npx --yes -p node@22 -p npm@11.11.0 -- npm test -- tests/client/learning-session.test.tsx tests/client/login-and-home.test.tsx tests/client/companion-components.test.tsx
~~~

Expected: FAIL because required cards are flat and no dictation UI exists.

- [ ] **Step 3: Write minimal implementation**

Group required cards by subject and emitted step order. Step status unlocks foundation, current, challenge only after all earlier subject steps are in canonical completedItemIds. For challenge, LearningSession advances on online receipt.completed regardless of exercise pass; it never fabricates a wrong challenge offline completion.

~~~ts
export function stepStatus(items, completedItemIds, item): StepStatus {
  const subjectItems = items.filter((candidate) => candidate.payload.subject === item.payload.subject);
  const ordered = ["foundation", "current", "challenge"] as const;
  const position = ordered.indexOf(item.step);
  if (completedItemIds.includes(item.id)) return "complete";
  return subjectItems.filter((candidate) => ordered.indexOf(candidate.step) < position)
    .every((candidate) => completedItemIds.includes(candidate.id)) ? "available" : "locked";
}
~~~

DictationPanel only calls speechSynthesis.speak after direct replay with lang ko-KR; its input has lang ko, 200-character max, no autocorrect and no browser persistence. buildAttempt supplies dictationText only to network and offline queue strips it. Set roles to 버니 별빛 길 안내자 and Milky 계산·받아쓰기 공부 조수; reserve ChaNaPing for its existing reactive floating component. Display bonus only from receipt.challengeBonus.awarded.

- [ ] **Step 4: Run tests and commit**

~~~bash
npx --yes -p node@22 -p npm@11.11.0 -- npm test -- tests/client/learning-session.test.tsx tests/client/login-and-home.test.tsx tests/client/companion-components.test.tsx
npx --yes -p node@22 -p npm@11.11.0 -- npm run typecheck
git diff --check
git add src/client/home src/client/learning src/client/companions src/client/styles tests/client
git commit -m "feat: add student step-up dictation flow"
~~~

Expected: client flow tests PASS with no microphone dependency and no typed dictation retained offline.

---

### Task 6: 같은 상태를 공유하는 가로 레일과 세로 플로팅 메뉴

**Files:**
- Create: src/client/navigation/responsive-navigation.tsx, src/client/home/student-navigation.tsx, tests/client/responsive-navigation.test.tsx
- Modify: src/client/guardian/guardian-dashboard.tsx, src/client/home/student-home.tsx, src/client/learning/learning-session.tsx, src/client/styles/layout.css, src/client/styles/responsive.css, src/client/styles/components.css
- Test: tests/client/responsive-navigation.test.tsx, tests/client/guardian-dashboard.test.tsx, tests/client/login-and-home.test.tsx, tests/client/learning-session.test.tsx

**Interfaces:**

~~~ts
export type NavigationEntry = { id: string; label: string; children?: readonly NavigationEntry[] };
export function ResponsiveNavigation(props: {
  label: string; entries: readonly NavigationEntry[]; activeId: string;
  expandedIds: readonly string[]; onSelect(id: string): void; onToggle(id: string): void;
  fabLabel: string;
}): JSX.Element;
~~~

- [ ] **Step 1: Write the failing test**

Render shared navigation and assert desktop rail/mobile FAB have identical entries/callbacks. Guardian needs 진도, 별 기록, 차감 승인, 학습 계획, AI 학습실, 백업 and separate 기기 관리. Student needs 뒤로, 오늘 학습, 도움말, 잠깐 쉬기; back preserves input and break pauses inactivity without deducting a star.

~~~tsx
render(<ResponsiveNavigation {...props} />);
await user.click(screen.getByRole("button", { name: "메뉴 열기" }));
expect(screen.getAllByRole("button", { name: "AI 학습실" })).toHaveLength(2);
await user.click(screen.getByRole("button", { name: "수학 문제 배치" }));
expect(onSelect).toHaveBeenCalledWith("ai/generate-math");
~~~

- [ ] **Step 2: Run test to verify it fails**

~~~bash
npx --yes -p node@22 -p npm@11.11.0 -- npm test -- tests/client/responsive-navigation.test.tsx tests/client/guardian-dashboard.test.tsx tests/client/login-and-home.test.tsx tests/client/learning-session.test.tsx
~~~

Expected: FAIL because navigation is independent tabs/account popovers and student has no menu FAB.

- [ ] **Step 3: Write minimal implementation**

Render rail and FAB drawer from one entries/active/open state source. Do not branch on JavaScript width; CSS alone reveals the right shell so rotation preserves mounted panels and answer inputs.

~~~css
.responsive-nav__rail { display: none; }
.responsive-nav__fab { position: fixed; z-index: 30; right: 20px; bottom: 20px; }
@media (min-width: 900px) and (orientation: landscape) {
  .responsive-shell { display: grid; grid-template-columns: minmax(248px, 300px) minmax(0, 1fr); }
  .responsive-nav__rail { display: grid; position: sticky; top: 16px; align-self: start; }
  .responsive-nav__fab, .responsive-nav__drawer { display: none; }
  .responsive-shell__content { min-width: 0; max-width: 1120px; }
}
~~~

Guardian moves its menu/tree to landscape rail and exposes the same tree plus 기기 관리 from portrait FAB. StudentNavigation invokes onExit, onToday, onHelp and onPauseForBreak; LearningSession pauses controller with guardian-break and only resumes after explicit 학습 계속. No navigation callback clears math/transcript/dictation state.

- [ ] **Step 4: Run tests and commit**

~~~bash
npx --yes -p node@22 -p npm@11.11.0 -- npm test -- tests/client/responsive-navigation.test.tsx tests/client/guardian-dashboard.test.tsx tests/client/login-and-home.test.tsx tests/client/learning-session.test.tsx
npx --yes -p node@22 -p npm@11.11.0 -- npm run check
git diff --check
git add src/client tests/client
git commit -m "feat: add responsive navigation shells"
~~~

Expected: focused UI tests and npm run check PASS.

---

### Task 7: 통합 회귀 검증과 NAS 자동 배포 인수

**Files:**
- Modify: docs/android-tablet.md, docs/synology-nas-deploy.md
- Test: full test suite, production build, isolated container health check

- [ ] **Step 1: Add acceptance checks**

Add the following tester checklist to the tablet guide before updating deployment docs.

~~~md
- [ ] 1368×912 landscape: left navigation rail visible, floating menu hidden.
- [ ] 800×1280 portrait: floating menu visible, left navigation rail hidden.
- [ ] Resize/rotation keeps the current typed answer and AI menu leaf.
- [ ] Wrong challenge response shows 도전 시도 완료 and next item opens.
- [ ] All challenge responses correct: exactly one CHALLENGE_PERFECT ledger event appears.
- [ ] A typed dictation can finish with the keyboard only.
- [ ] An API key is never shown after saving.
~~~

- [ ] **Step 2: Run full verification**

~~~bash
npx --yes -p node@22 -p npm@11.11.0 -- npm run check
git diff --check
git status --short
~~~

Expected: typecheck, all Vitest suites, production client build, and server build PASS; only intended docs are uncommitted.

- [ ] **Step 3: Build production image without publishing**

~~~bash
docker build --platform linux/amd64 -t sua-learning:step-up-smoke .
docker run --rm -d --name sua-learning-step-up-smoke -e NODE_ENV=production \
  -e APP_ORIGIN=http://127.0.0.1:8787 -e DATABASE_PATH=/tmp/sua-learning.sqlite \
  -e SETUP_SECRET=smoke-secret -e LLM_ENCRYPTION_KEY=01234567890123456789012345678901 \
  -p 127.0.0.1:8787:8787 sua-learning:step-up-smoke
curl --fail --silent http://127.0.0.1:8787/api/health
docker rm -f sua-learning-step-up-smoke
~~~

Expected: health output is {"status":"ok"} and the smoke container is removed.

- [ ] **Step 4: Commit docs and request release approval**

~~~bash
git add docs/android-tablet.md docs/synology-nas-deploy.md
git commit -m "docs: add step-up deployment acceptance"
git status --short --branch
~~~

Expected: branch is clean except for unrelated user files. Do not push, merge, or trigger NAS deployment until the user separately approves the tested release.
