# Step-up Release Hardening Implementation Plan

> For agentic workers: REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Close the final release-review gaps so stage order, daily-plan authority, child privacy, AI transport and budget safety, and guardian/student UI lifecycles are enforced end-to-end.

**Architecture:** Enforce staged learning and immutable day requirements at server authority boundaries. Treat the AI budget as guardian-configured estimated KRW: reserve the worst case before a call, reconcile only complete provider usage, and retain the reservation when usage is unavailable. The React client discards stale generation responses and cancels hidden/paused timers.

**Tech Stack:** TypeScript, Fastify, better-sqlite3 immediate transactions, Zod, React 19, Vitest, Docker linux/amd64.

## Global Constraints

- Foundation then current then challenge is server-authoritative for each subject. An online wrong challenge may complete that challenge only after earlier steps.
- Once any non-recovery daily plan is issued for a student/day, guardian requirements for that day cannot change.
- API key writes require the trusted effective HTTPS protocol in production. API keys, provider raw bodies, dictation text, and key fragments never reach persistence, GET responses, logs, or offline queues.
- AI budget is estimated KRW from guardian-managed per-1K input/output rates. Usage missing from a provider response cannot lower a reservation.
- Do not push, merge, publish an image, or change NAS state. Keep .DS_Store untracked.
- Use Node 22/npm 11.11.0. Each task is red-green, independently reviewed, and committed only with its scoped files.

---

### Task 1: Server authority for staged attempts and issued-day settings

**Files:**
- Modify: src/server/learning/issued-plan-repository.ts
- Modify: src/server/learning/session-repository.ts
- Modify: src/server/learning/routes.ts
- Modify: src/server/stars/daily-plan.ts
- Test: tests/server/learning.test.ts
- Test: tests/server/star-learning.test.ts
- Test: tests/server/offline-sync.test.ts

**Interfaces:**
- IssuedPlanRepository.validateAttempt throws IssuedPlanError("STEP_LOCKED") when a prior step of the same subject in the issued snapshot lacks a completed attempt.
- DailyPlanService.updateGuardianPlan throws PLAN_LOCKED when issued_daily_plans has a daily plan for the student/date.
- Online route returns 409 STEP_LOCKED; offline sync records the same rejection without inserting attempt or star data.

- [ ] **Step 1: Write failing authority tests**

    it("rejects current and challenge before prerequisite issued steps complete", async () => {
      const plan = await issueSixStepPlan(student);
      await expect(submit(student, plan.math.current)).rejects.toMatchObject({ code: "STEP_LOCKED" });
      await expect(submit(student, plan.math.challenge)).rejects.toMatchObject({ code: "STEP_LOCKED" });
      await submit(student, plan.math.foundation);
      await expect(submit(student, plan.math.current)).resolves.toMatchObject({ completed: true });
    });

    it("locks requirement replacement after a device receives the day plan", async () => {
      await getToday(deviceA);
      const response = await guardian.put("/api/guardian/plan/" + today, changedPlan);
      expect(response.statusCode).toBe(409);
      expect(response.json()).toEqual({ code: "PLAN_LOCKED" });
    });

- [ ] **Step 2: Run red tests**

    npx --yes -p node@22 -p npm@11.11.0 -- npm test -- tests/server/learning.test.ts tests/server/star-learning.test.ts tests/server/offline-sync.test.ts

Expected: direct challenge is accepted and a newly issued day can still be rebuilt.

- [ ] **Step 3: Implement minimal authority checks**

Use the issued_plan_items rows for input.planId, ordered by explicit CASE step WHEN foundation THEN 0 WHEN current THEN 1 WHEN challenge THEN 2 END. For every earlier same-subject item, require an attempts row with plan_id, item_id, and completed = 1 before accepting the next attempt. Run this check before attempt/star writes in both normal and offline authority paths.

In updateGuardianPlan, query issued_daily_plans for student_id, study_date, plan_kind = daily before any settings or daily_requirements mutation. Keep legacy koreanTarget/mathTarget read-only response fields but document the emitted contract as six staged items.

- [ ] **Step 4: Run green tests and commit**

    npx --yes -p node@22 -p npm@11.11.0 -- npm test -- tests/server/learning.test.ts tests/server/star-learning.test.ts tests/server/offline-sync.test.ts
    npx --yes -p node@22 -p npm@11.11.0 -- npm run typecheck
    git diff --check
    git add src/server/learning src/server/stars tests/server
    git commit -m "fix: enforce staged plan authority"

Expected: no skipped stage or second requirements set can create a star.

---

### Task 2: HTTPS key transport and dictation privacy

**Files:**
- Modify: src/server/coach/routes.ts
- Modify: src/server/learning/repository.ts
- Modify: src/server/learning/service.ts
- Modify: src/server/offline/service.ts
- Modify: src/shared/learning.ts
- Test: tests/server/coach.test.ts
- Test: tests/server/ai-studio.test.ts
- Test: tests/server/learning.test.ts
- Test: tests/server/offline-sync.test.ts

**Interfaces:**
- Production key-bearing requests return 403 HTTPS_REQUIRED unless request.protocol is https after the existing trusted first-hop proxy.
- Dictation input is max 200 characters and stored only as createHmac("sha256", sessionPepper) of normalized text.
- Offline sync returns DICTATION_ONLINE_ONLY before batch/activity persistence for any dictation text.

- [ ] **Step 1: Write failing transport/privacy tests**

    it("rejects a production API-key update over HTTP", async () => {
      const response = await productionGuardian.put("/api/guardian/ai-studio/settings/openai", { apiKey: "key" });
      expect(response.statusCode).toBe(403);
      expect(response.json()).toEqual({ code: "HTTPS_REQUIRED" });
    });

    it("uses keyed dictation matching and rejects offline dictation", async () => {
      await onlineDictation("봄비");
      expect(readDictationDigest()).not.toEqual(sha256("봄비"));
      await expect(syncOfflineDictation("봄비")).rejects.toMatchObject({ code: "DICTATION_ONLINE_ONLY" });
      expect(readOfflineActivityCount()).toBe(0);
    });

- [ ] **Step 2: Run red tests**

    npx --yes -p node@22 -p npm@11.11.0 -- npm test -- tests/server/coach.test.ts tests/server/ai-studio.test.ts tests/server/learning.test.ts tests/server/offline-sync.test.ts

Expected: current routes accept HTTP key saves, direct SHA-256 exists, and server sync accepts dictation.

- [ ] **Step 3: Implement ingress boundaries**

Add a production-only guard before legacy and Studio API-key handling. Trim whitespace before validating a non-empty key. Pass AppConfig.sessionPepper to the learning service; replace direct SHA-256 with createHmac SHA-256 over normalized text. Enforce Zod max 200. Reject text-bearing offline activity before receipt/activity insert. Do not return the digest.

- [ ] **Step 4: Run green tests and commit**

    npx --yes -p node@22 -p npm@11.11.0 -- npm test -- tests/server/coach.test.ts tests/server/ai-studio.test.ts tests/server/learning.test.ts tests/server/offline-sync.test.ts
    npx --yes -p node@22 -p npm@11.11.0 -- npm run typecheck
    git diff --check
    git add src/server/coach src/server/learning src/server/offline src/shared tests/server
    git commit -m "fix: harden key and dictation boundaries"

---

### Task 3: AI protocol, cost authority, and draft concurrency

**Files:**
- Create: src/server/db/migrations/009-ai-studio-budget-rates.ts
- Modify: src/shared/learning.ts
- Modify: src/server/coach/studio-service.ts
- Modify: src/server/coach/service.ts
- Modify: src/server/coach/routes.ts
- Modify: src/client/api/client.ts
- Test: tests/server/ai-studio.test.ts
- Test: tests/server/coach.test.ts
- Test: tests/server/step-up-schema.test.ts
- Test: tests/client/api-client.test.ts

**Interfaces:**
- Studio settings return providers, monthlyBudgetWon, and monthSpentWon. Provider settings include integer inputWonPer1K and outputWonPer1K estimates.
- A provider call reserves ceil(input estimate plus output cap cost) before the request, records usage only after parsing complete usage, and never lowers cost on absent/malformed usage.
- OpenAI parser scans all output entries and joins output_text parts from message entries, independent of reasoning items/order.

- [ ] **Step 1: Write failing protocol and budget tests**

    it("accepts Responses output with reasoning followed by a message", async () => {
      fetcher.mockResolvedValue(json({
        output: [
          { type: "reasoning", summary: [] },
          { type: "message", content: [{ type: "output_text", text: JSON.stringify(validBatch) }] }
        ],
        usage: { input_tokens: 120, output_tokens: 240 }
      }));
      await expect(studio.createDraft(request)).resolves.toMatchObject({ status: "draft" });
    });

    it("enforces configured estimated budget and exposes spend", async () => {
      await studio.updateSettings(pricedSettingsWithBudget(25));
      await expect(studio.createDraft(expensiveRequest)).rejects.toMatchObject({ code: "AI_STUDIO_BUDGET_EXCEEDED" });
      expect(studio.getSettings()).toMatchObject({ monthlyBudgetWon: 25, monthSpentWon: expect.any(Number) });
    });

    it("rejects edit after a second connection publishes the draft", () => {
      expect(() => editAfterConcurrentPublish()).toThrow("AI_STUDIO_NOT_REVIEWABLE");
    });

- [ ] **Step 2: Run red tests**

    npx --yes -p node@22 -p npm@11.11.0 -- npm test -- tests/server/ai-studio.test.ts tests/server/coach.test.ts tests/server/step-up-schema.test.ts tests/client/api-client.test.ts

Expected: valid Responses objects fail, every call costs one won, settings lack budget data, and edit/publish can diverge.

- [ ] **Step 3: Implement conservative authority**

Migration 009 adds non-negative per-provider input/output estimate columns with conservative defaults. Use action caps generate 1024, review 256, report 512 rather than a universal 8192. Reserve the calculated maximum in an immediate transaction. Parse Gemini usageMetadata and OpenAI usage; reconcile only when both input/output values are finite. Validate a generated candidate before sending it to cross-review. Move updateDraftItem status read, validation, and UPDATE WHERE draft.status = draft into one immediate transaction. Derive local challengePerfect from the CHALLENGE_PERFECT ledger event. Return local empty report before any provider reservation.

- [ ] **Step 4: Run green tests and commit**

    npx --yes -p node@22 -p npm@11.11.0 -- npm test -- tests/server/ai-studio.test.ts tests/server/coach.test.ts tests/server/step-up-schema.test.ts tests/client/api-client.test.ts
    npx --yes -p node@22 -p npm@11.11.0 -- npm run typecheck
    git diff --check
    git add src/shared src/server/coach src/server/db/migrations src/client/api tests/server tests/client
    git commit -m "fix: enforce AI budget and provider protocol"

---

### Task 4: Guardian AI Studio stale-generation and budget UI

**Files:**
- Modify: src/client/guardian/ai-learning-studio.tsx
- Modify: src/client/guardian/guardian-dashboard.tsx
- Modify: src/client/styles/components.css
- Test: tests/client/guardian-dashboard.test.tsx
- Test: tests/client/api-client.test.ts

**Interfaces:**
- Generation state contains requestId, subject, step, status, and draft. Only the latest matching request can render or publish.
- Budget leaf renders authoritative monthly limit/spend and guarded integer rate controls.

- [ ] **Step 1: Write failing UI tests**

    it("drops a late math draft after guardian switches to Korean", async () => {
      const math = deferred();
      api.createAiDraft.mockReturnValueOnce(math.promise);
      await startMathDraft();
      await openKoreanBatch();
      math.resolve(mathDraft);
      expect(screen.queryByRole("button", { name: "발행" })).not.toBeInTheDocument();
    });

    it("saves visible estimated budget settings", async () => {
      await openBudgetLeaf();
      await replaceNumber("월 예산 (원)", "3000");
      await user.click(screen.getByRole("button", { name: "예산 저장" }));
      expect(api.updateAiStudioBudget).toHaveBeenCalledWith(expect.objectContaining({ monthlyBudgetWon: 3000 }));
    });

- [ ] **Step 2: Run red tests**

    npx --yes -p node@22 -p npm@11.11.0 -- npm test -- tests/client/guardian-dashboard.test.tsx tests/client/api-client.test.ts

- [ ] **Step 3: Implement request identity**

Increment a generation ref and clear the displayed draft before each subject/step request. Resolve/reject only if the current ref and request metadata still match the active panel. Key DraftPanel by matching metadata and disable publish for pending, failed, or mismatched state. Render budget/spend/rates as estimated values; never retain API-key text after save.

- [ ] **Step 4: Run green tests and commit**

    npx --yes -p node@22 -p npm@11.11.0 -- npm test -- tests/client/guardian-dashboard.test.tsx tests/client/api-client.test.ts
    npx --yes -p node@22 -p npm@11.11.0 -- npm run typecheck
    git diff --check
    git add src/client/guardian src/client/api src/client/styles tests/client
    git commit -m "fix: harden AI studio guardian lifecycle"

---

### Task 5: Hidden-session, break-focus, and tree-focus lifecycle

**Files:**
- Modify: src/client/learning/learning-session.tsx
- Modify: src/client/home/student-home.tsx
- Modify: src/client/companions/learning-companion.tsx
- Modify: src/client/guardian/ai-learning-studio.tsx
- Modify: src/client/styles/components.css
- Test: tests/client/learning-session.test.tsx
- Test: tests/client/login-and-home.test.tsx
- Test: tests/client/responsive-navigation.test.tsx
- Test: tests/client/guardian-dashboard.test.tsx

**Interfaces:**
- Receipt auto-next timeout exists only while session active and not on break.
- Break moves keyboard focus to 학습 계속, traps Tab/Shift+Tab, and restores a visible invoking control after resume.
- Controlled tree selectedLeaf updates roving tabIndex without stealing focus from a typed input.

- [ ] **Step 1: Write failing lifecycle tests**

    it("does not auto-next a hidden receipt", async () => {
      completeCorrectAnswer();
      await user.click(screen.getByRole("button", { name: "오늘 학습" }));
      await advanceTimersByTimeAsync(2000);
      expect(api.getToday).toHaveBeenCalledTimes(1);
      await reopenSameCard();
      expect(screen.getByDisplayValue("42")).toBeVisible();
    });

    it("moves focus into and out of break mode", async () => {
      const invoker = screen.getByRole("button", { name: "잠깐 쉬기" });
      await user.click(invoker);
      expect(screen.getByRole("button", { name: "학습 계속" })).toHaveFocus();
      await user.click(screen.getByRole("button", { name: "학습 계속" }));
      expect(invoker).toHaveFocus();
    });

- [ ] **Step 2: Run red tests**

    npx --yes -p node@22 -p npm@11.11.0 -- npm test -- tests/client/learning-session.test.tsx tests/client/login-and-home.test.tsx tests/client/responsive-navigation.test.tsx tests/client/guardian-dashboard.test.tsx

- [ ] **Step 3: Implement visibility-aware effects**

Cancel auto-next whenever active is false or guardian-break is active; recreate only for a visible receipt. Use refs for break resume and invoker, focus resume on open, contain Tab/Shift+Tab, then restore a visible owner target on close. Synchronize controlled tree roving state only when tree focus owns the active element or no input is focused.

- [ ] **Step 4: Run green tests and commit**

    npx --yes -p node@22 -p npm@11.11.0 -- npm test -- tests/client/learning-session.test.tsx tests/client/login-and-home.test.tsx tests/client/responsive-navigation.test.tsx tests/client/guardian-dashboard.test.tsx
    npx --yes -p node@22 -p npm@11.11.0 -- npm run typecheck
    git diff --check
    git add src/client/learning src/client/home src/client/companions src/client/guardian src/client/styles tests/client
    git commit -m "fix: preserve visible learning lifecycle"

---

### Task 6: Final release verification and NAS readiness

**Files:**
- Modify: docs/android-tablet.md
- Modify: docs/synology-nas-deploy.md
- Test: full Node 22 check, linux/amd64 Docker smoke, release regressions

- [ ] **Step 1: Add hardening acceptance checklist**

    - [ ] Direct current/challenge submission before the prior step returns STEP_LOCKED and awards no star.
    - [ ] After any device issues a plan, guardian replacement returns PLAN_LOCKED.
    - [ ] Production HTTP key update returns HTTPS_REQUIRED; no response displays key text.
    - [ ] Guardian sees estimated budget/spend; stale generation never publishes after a subject switch.
    - [ ] Hidden receipt cannot advance; break focuses 학습 계속 and restores focus on resume.

- [ ] **Step 2: Run release verification**

    npx --yes -p node@22 -p npm@11.11.0 -- npm run check
    git diff --check
    docker build --platform linux/amd64 -t sua-learning:step-up-smoke .

Expected: all tests/builds pass and no timeout/worker setting is changed.

- [ ] **Step 3: Run smoke then commit docs**

    docker run --rm -d --name sua-learning-step-up-smoke -e NODE_ENV=production -e APP_ORIGIN=https://127.0.0.1:8787 -e DATABASE_PATH=/tmp/sua-learning.sqlite -e SETUP_SECRET=ssssssssssssssssssssssssssssssss -e SESSION_PEPPER=pppppppppppppppppppppppppppppppp -e LLM_ENCRYPTION_KEY=MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY= -p 127.0.0.1:8787:8787 sua-learning:step-up-smoke
    curl --fail --silent http://127.0.0.1:8787/api/health
    docker rm -f sua-learning-step-up-smoke
    git add docs/android-tablet.md docs/synology-nas-deploy.md
    git commit -m "docs: harden step-up release acceptance"

Expected: health is exactly {"status":"ok"} and no smoke container remains. Do not push or deploy until fresh final review and release approval.

## Plan self-review

- Tasks 1 through 5 cover every P1/P2 final-review finding; Task 6 validates all new authoritative boundaries on an NAS-compatible image.
- Placeholder scan completed with no unresolved implementation markers.
- Task 3 produces the server budget interface before Task 4 consumes it.
