# Final Release Compatibility Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use \`superpowers:subagent-driven-development\` task-by-task, with a fresh implementer and independent read-only review for every task.

**Goal:** Close the final whole-branch P2 findings for legacy progress consistency, complete Gemini billed usage, PWA rolling compatibility, and post-completion refresh recovery.

**Architecture:** Public completion projection will use the same issued-plan provenance predicate as stage authority. Gemini complete usage will define billed output as candidate plus thinking tokens. The old AI Studio provider-array endpoint stays stable while a versioned full-settings endpoint serves the newer object contract. Student completion stays consumed but preserves a retryable refresh state instead of replacing the child lesson with a terminal load error.

**Tech Stack:** TypeScript, Fastify, better-sqlite3, React 19, Vitest, PWA service worker, Docker linux/amd64.

## Global Constraints

- Use Node 22/npm 11.11.0. Do not change worker counts or test timeouts.
- Do not weaken same-student/date/item/content-version/issued-item membership for public completion or stage authority.
- If complete Gemini usage is malformed, partial, negative, non-safe, or overflow-prone, retain the reservation; never release budget.
- Preserve GET /api/guardian/ai-studio/settings provider-array compatibility for installed PWA shells. Use a separate versioned full-view GET for new object fields.
- A saved child completion must never be resubmitted after refresh failure; retries refresh authoritative plan/stars only.
- Keep .DS_Store untouched. Do not push, merge, publish image, or modify NAS.
- A fresh final review and new explicit release approval are still required before deployment.

---

### Task 1: Canonical legacy completion projection and Gemini billed output

**Files:**

- Modify: src/server/learning/repository.ts
- Modify: src/server/coach/service.ts
- Modify: src/server/coach/studio-service.ts
- Test: tests/server/learning.test.ts
- Test: tests/server/authority-integration.test.ts
- Test: tests/server/coach.test.ts
- Test: tests/server/ai-studio.test.ts

**Interfaces:**

- listCompletedItemIds(studentId, studyDate) accepts a completion only when its source issued plan and issued item prove matching student/date/item/content version, matching assertIssuedStepUnlocked semantics.
- Gemini complete output token count is candidatesTokenCount + thoughtsTokenCount, where missing thoughtsTokenCount is zero; both must be nonnegative safe integers and sum safely.

- [ ] **Step 1: Add failing consistency and thinking-cost tests**

    it("does not project a legacy/corrupt attempt that cannot unlock a stage", async () => {
      const plan = await issueToday(student);
      await completeFoundation(plan.math.foundation);
      nullSourceIssuedPlanId();
      expect((await getToday()).completedItemIds).not.toContain(plan.math.foundation.id);
      await expect(openSession(plan.math.current)).rejects.toMatchObject({ code: "STEP_LOCKED" });
    });

    it("charges Gemini candidate plus thought tokens", async () => {
      fetcher.mockResolvedValue(gemini({
        candidates: [{ content: { parts: [{ text: "{\"message\":\"잘했어!\"}" }] } }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, thoughtsTokenCount: 55 }
      }));
      await coach.message(event);
      expect(readUsage()).toMatchObject({ inputTokens: 10, outputTokens: 60, estimatedWon: 60 });
    });

    it("retains reservation for overflowing Gemini candidate plus thought tokens", async () => {
      fetcher.mockResolvedValue(gemini({
        candidates: [{ content: { parts: [{ text: "{\"message\":\"잘했어!\"}" }] } }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: Number.MAX_SAFE_INTEGER, thoughtsTokenCount: 1 }
      }));
      await coach.message(event);
      expect(readUsage()).toMatchObject({ inputTokens: 0, outputTokens: 0, estimatedWon: reservedWon });
    });

- [ ] **Step 2: Verify red**

    npx --yes -p node@22 -p npm@11.11.0 -- npm test -- tests/server/learning.test.ts tests/server/authority-integration.test.ts tests/server/coach.test.ts tests/server/ai-studio.test.ts

Expected: /today projects the corrupt legacy attempt and thinking tokens are omitted/release reservation.

- [ ] **Step 3: Implement one provenance predicate and safe billed-output helper**

Mirror authority's issued-plan joins in completion projection:

    JOIN issued_daily_plans source_plan ON source_plan.id = attempts.issued_plan_id
    JOIN issued_plan_items source_item
      ON source_item.plan_id = source_plan.id
     AND source_item.item_id = attempts.item_id
     AND source_item.content_version = attempts.content_version
    WHERE source_plan.student_id = ?
      AND source_plan.study_date = ?
      AND attempts.completed = 1

For Gemini:

    function geminiOutputTokens(usage: unknown): number | null {
      const candidate = readSafeNonnegativeInteger(usage, "candidatesTokenCount");
      const thought = usageHasField(usage, "thoughtsTokenCount")
        ? readSafeNonnegativeInteger(usage, "thoughtsTokenCount")
        : 0;
      return candidate === null || thought === null || candidate > Number.MAX_SAFE_INTEGER - thought
        ? null : candidate + thought;
    }

Use it in Coach and Studio completeUsage. A null total must leave reservation and recorded observed tokens unchanged.

- [ ] **Step 4: Verify green and commit**

    npx --yes -p node@22 -p npm@11.11.0 -- npm test -- tests/server/learning.test.ts tests/server/authority-integration.test.ts tests/server/coach.test.ts tests/server/ai-studio.test.ts
    npx --yes -p node@22 -p npm@11.11.0 -- npm run typecheck
    git diff --check
    git add src/server/learning/repository.ts src/server/coach tests/server
    git commit -m "fix: align legacy completion and Gemini billed usage"

---

### Task 2: Stable AI Studio settings protocol across PWA rollout and rollback

**Files:**

- Modify: src/server/coach/routes.ts
- Modify: src/shared/learning.ts
- Modify: src/client/api/client.ts
- Modify: src/client/guardian/ai-learning-studio.tsx
- Test: tests/server/ai-studio.test.ts
- Test: tests/client/api-client.test.ts
- Test: tests/client/guardian-dashboard.test.tsx

**Interfaces:**

- GET /api/guardian/ai-studio/settings remains an AiProviderSettingsView[] for installed older shells.
- GET /api/guardian/ai-studio/settings/view returns AiStudioSettingsView with providers, monthlyBudgetWon, and monthSpentWon for the current shell.
- Current client uses only the versioned full-view endpoint; provider save/delete uses stable existing mutation routes.

- [ ] **Step 1: Add forward/rollback contract tests**

    it("keeps legacy settings GET as provider array", async () => {
      const response = await guardian.get("/api/guardian/ai-studio/settings");
      expect(response.json()).toEqual(expect.arrayContaining([
        expect.objectContaining({ provider: "gemini", hasApiKey: false })
      ]));
    });

    it("returns full settings only from versioned view endpoint", async () => {
      const response = await guardian.get("/api/guardian/ai-studio/settings/view");
      expect(response.json()).toMatchObject({ providers: expect.any(Array), monthlyBudgetWon: expect.any(Number) });
    });

    it("current API client reads versioned full settings path", async () => {
      await api.getAiStudioSettingsView();
      expect(fetchMock).toHaveBeenCalledWith("/api/guardian/ai-studio/settings/view", expect.anything());
    });

- [ ] **Step 2: Verify red**

    npx --yes -p node@22 -p npm@11.11.0 -- npm test -- tests/server/ai-studio.test.ts tests/client/api-client.test.ts tests/client/guardian-dashboard.test.tsx

Expected: unversioned endpoint returns object and current client requests it.

- [ ] **Step 3: Restore compatibility without duplicating client state**

Have routes expose both response shapes from the same service read. Keep only full-view parsing in AiLearningStudio. Do not add an array-or-object fallback to current UI; explicit endpoint versioning makes deploy/rollback behavior testable.

- [ ] **Step 4: Verify green and commit**

    npx --yes -p node@22 -p npm@11.11.0 -- npm test -- tests/server/ai-studio.test.ts tests/client/api-client.test.ts tests/client/guardian-dashboard.test.tsx
    npx --yes -p node@22 -p npm@11.11.0 -- npm run typecheck
    git diff --check
    git add src/server/coach/routes.ts src/shared/learning.ts src/client/api/client.ts src/client/guardian/ai-learning-studio.tsx tests/server tests/client
    git commit -m "fix: version AI studio settings view"

---

### Task 3: Recoverable authoritative refresh after child completion

**Files:**

- Modify: src/client/home/student-home.tsx
- Modify: src/client/learning/learning-session.tsx only if a retry callback prop is needed
- Test: tests/client/login-and-home.test.tsx
- Test: tests/client/learning-session.test.tsx

**Interfaces:**

- finishLearning preserves the completed/consumed lesson when getToday, getStudentStars, or cache refresh fails after a successful attempt.
- The child sees a retryable refresh notice/action. Retry reloads authoritative plan/stars only; it never replays completion or clears the consumed receipt until a new keyed item arrives.

- [ ] **Step 1: Add failing refresh-recovery tests**

    it("keeps completed lesson and offers retry when post-completion refresh fails", async () => {
      completeCorrectAnswer();
      api.getToday.mockRejectedValueOnce(new Error("temporary"));
      await advanceToNext();
      expect(screen.getByText("다음 문제를 준비하지 못했어요")).toBeVisible();
      expect(screen.getByRole("button", { name: "다시 불러오기" })).toBeEnabled();
      expect(screen.getByRole("button", { name: "다음 문제" })).toBeDisabled();
    });

    it("retry refreshes plan/stars without resubmitting consumed completion", async () => {
      api.getToday.mockRejectedValueOnce(new Error("temporary")).mockResolvedValue(nextPlan);
      await user.click(screen.getByRole("button", { name: "다시 불러오기" }));
      expect(api.submitAttempt).toHaveBeenCalledTimes(1);
      expect(api.getToday).toHaveBeenCalledTimes(2);
      expect(screen.getByText(nextPlan.items[0].title)).toBeVisible();
    });

- [ ] **Step 2: Verify red**

    npx --yes -p node@22 -p npm@11.11.0 -- npm test -- tests/client/login-and-home.test.tsx tests/client/learning-session.test.tsx

Expected: global startup error replaces lesson and no retry action exists.

- [ ] **Step 3: Separate startup failure from post-completion refresh failure**

Keep initial load failure behavior only before a usable plan exists. On finishLearning refresh failure, retain active session plus a local refresh-error state and retry function. Clear it only after authoritative plan/stars/cache reload succeeds. Pass retry state/action to LearningSession or render an accessible nearby status/action without reopening the receipt.

- [ ] **Step 4: Verify green and commit**

    npx --yes -p node@22 -p npm@11.11.0 -- npm test -- tests/client/login-and-home.test.tsx tests/client/learning-session.test.tsx
    npx --yes -p node@22 -p npm@11.11.0 -- npm run typecheck
    git diff --check
    git add src/client/home/student-home.tsx src/client/learning/learning-session.tsx tests/client
    git commit -m "fix: make post-completion refresh retryable"

---

### Task 4: Final verification and operational compatibility evidence

**Files:**

- Modify: docs/android-tablet.md
- Modify: docs/synology-nas-deploy.md
- Test: full Node 22 check, linux/amd64 Docker health smoke

- [ ] **Step 1: Add compatibility acceptance statements**

Add these statements to the appropriate guides:

    - Migrated attempts without trustworthy issued-plan provenance neither display complete nor unlock a later stage.
    - Gemini output budget includes candidate plus thinking tokens; malformed usage retains reservation.
    - Old PWA shells use the provider-array settings endpoint and current shells use the versioned full-view endpoint during deploy or rollback.
    - A saved completion whose refresh fails stays visible with a retry that never resubmits it.

- [ ] **Step 2: Run full verification**

    npx --yes -p node@22 -p npm@11.11.0 -- npm run check
    git diff --check
    docker build --platform linux/amd64 -t sua-learning:compatibility-smoke .

- [ ] **Step 3: Bounded smoke and docs commit**

Use the documented fixed dummy production values, loopback 127.0.0.1:8787, and bounded curl health loop. Require exact body {"status":"ok"}, remove the container under a trap, and inspect that no named smoke container remains.

    git add docs/android-tablet.md docs/synology-nas-deploy.md
    git commit -m "docs: record compatibility release acceptance"

- [ ] **Step 4: Fresh final whole-branch review and release gate**

Run fresh read-only server and client reviews at the post-verification head. Request new explicit user approval before any push, merge, image publication, or NAS deployment.

## Plan self-review

- Task 1 closes legacy completion and Gemini usage P2s.
- Task 2 closes cross-version PWA protocol P2.
- Task 3 closes child post-completion refresh P2.
- Task 4 records and verifies the integrated release state.
- Each task supplies files, interfaces, failing cases, exact commands, and commit boundary.
