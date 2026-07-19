# Final Release Review Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use \`superpowers:subagent-driven-development\` task-by-task. Each task has a fresh implementer and independent read-only review.

**Goal:** Close the eight P2 findings from the fresh whole-branch review without weakening staged-learning, child-privacy, AI-budget, or responsive-accessibility guarantees.

**Architecture:** Server stage authority and public completion projection will share one canonical completed-attempt identity, while provider adapters normalize every text fragment before JSON parsing. The client will serialize conflicting draft mutations, discard stale settings reads, treat auto-next/manual-next as one receipt transition, and make speech/navigation modality follow the visible-session lifecycle.

**Tech Stack:** TypeScript, Fastify, better-sqlite3, React 19, Vitest, Web Speech API, CSS media queries, Docker linux/amd64.

## Global Constraints

- Use Node 22 and npm 11.11.0; do not raise worker counts or relax timeouts.
- A plan item remains locked until earlier same-subject item has a completed canonical attempt for the same student, study date, item ID, and content version.
- Offline dictation remains rejected before any batch/activity/attempt persistence; dictation text remains HMAC-only.
- No API key, raw provider response, or child dictation text may enter UI state, logs, GET responses, or docs.
- Keep .DS_Store untracked and untouched. Do not push, merge, publish an image, or change NAS state.
- A fresh whole-branch review and a fresh user release approval remain required before deployment.

---

### Task 1: Canonical cross-device stage authority and Gemini text extraction

**Files:**

- Modify: src/server/learning/issued-plan-repository.ts
- Modify: src/server/coach/service.ts
- Modify: src/server/coach/studio-service.ts
- Test: tests/server/authority-integration.test.ts
- Test: tests/server/coach.test.ts
- Test: tests/server/ai-studio.test.ts

**Interfaces:**

- IssuedPlanRepository.validateAttempt(input) accepts prerequisite completion from another same-day issued or recovery plan only when student, study date, item ID, content version, and completed=1 match the public completion identity.
- Gemini text extraction joins every string candidates[0].content.parts[*].text in order. Empty/no-string content remains provider failure.

- [ ] **Step 1: Write failing tests**

    it("unlocks device B current after device A completes same-day foundation", async () => {
      const a = await issueToday(deviceA);
      const b = await issueToday(deviceB);
      await submit(deviceA, a.math.foundation);
      expect((await issueToday(deviceB)).completedItemIds).toContain(b.math.foundation.id);
      await expect(openSession(deviceB, b.math.current)).resolves.toMatchObject({ itemId: b.math.current.id });
    });

    it("parses Gemini JSON split across text parts", async () => {
      fetcher.mockResolvedValue(gemini({
        candidates: [{ content: { parts: [{ text: "{\"message\":" }, { text: "\"잘했어!\"}" }] } }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 }
      }));
      await expect(coach.message(event)).resolves.toMatchObject({ source: "llm" });
    });

- [ ] **Step 2: Verify red**

    npx --yes -p node@22 -p npm@11.11.0 -- npm test -- tests/server/authority-integration.test.ts tests/server/coach.test.ts tests/server/ai-studio.test.ts

Expected: B displays completed foundation but gets STEP_LOCKED; split Gemini text falls back/fails.

- [ ] **Step 3: Implement minimal shared predicate and adapter**

Use target plan earlier issued_plan_items and query a completed attempts row joined to its issued plan by student/date/item/version, rather than matching only attempts.issued_plan_id = input.planId. Retain current-plan membership and earlier-stage ordering.

    function geminiText(body: unknown): string | null {
      const parts = (body as { candidates?: Array<{ content?: { parts?: unknown[] } }> })
        .candidates?.[0]?.content?.parts;
      if (!Array.isArray(parts)) return null;
      const text = parts.flatMap((part) =>
        part !== null && typeof part === "object" && typeof (part as { text?: unknown }).text === "string"
          ? [(part as { text: string }).text] : []).join("");
      return text.trim().length > 0 ? text : null;
    }

Do not alter provider usage charging; a complete usage pair still reconciles once.

- [ ] **Step 4: Verify green and commit**

    npx --yes -p node@22 -p npm@11.11.0 -- npm test -- tests/server/authority-integration.test.ts tests/server/coach.test.ts tests/server/ai-studio.test.ts
    npx --yes -p node@22 -p npm@11.11.0 -- npm run typecheck
    git diff --check
    git add src/server/learning/issued-plan-repository.ts src/server/coach tests/server
    git commit -m "fix: align shared stage completion and Gemini parsing"

---

### Task 2: Guardian Studio mutation and settings-read ordering

**Files:**

- Modify: src/client/guardian/ai-learning-studio.tsx
- Test: tests/client/guardian-dashboard.test.tsx

**Interfaces:**

- A draft item mutation has one active UI mutation token; pending item mutation disables every item editor and publish.
- A full-settings reconciliation has an increasing request token; only newest token calls onSettingsReloaded.

- [ ] **Step 1: Write failing tests**

    it("does not roll back newer visible draft when saves resolve out of order", async () => {
      const first = deferred<AiDraftView>();
      const second = deferred<AiDraftView>();
      api.updateAiDraftItem.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
      await startFirstEdit();
      expect(secondEditorSave()).toBeDisabled();
      first.resolve(latestServerDraft);
      expect(await screen.findByText("최신 내용")).toBeVisible();
    });

    it("drops older settings read after a newer save reconciliation", async () => {
      const oldRead = deferred<AiStudioSettingsView>();
      const newRead = deferred<AiStudioSettingsView>();
      api.getAiStudioSettingsView.mockReturnValueOnce(oldRead.promise).mockReturnValueOnce(newRead.promise);
      await saveBudget();
      await saveProviderRates();
      newRead.resolve(newerSettings);
      oldRead.resolve(olderSettings);
      expect(await screen.findByText("새 사용액")).toBeVisible();
      expect(screen.queryByText("옛 사용액")).not.toBeInTheDocument();
    });

- [ ] **Step 2: Verify red**

    npx --yes -p node@22 -p npm@11.11.0 -- npm test -- tests/client/guardian-dashboard.test.tsx

Expected: old whole-draft or settings snapshots replace newer visible state.

- [ ] **Step 3: Serialize and tag responses**

    const draftMutationRef = useRef(0);
    const settingsReadRef = useRef(0);

    async function reconcileSettings() {
      const token = ++settingsReadRef.current;
      const value = await api.getAiStudioSettingsView();
      if (token === settingsReadRef.current) onSettingsReloaded(value);
    }

Before item request increment draftMutationRef, set one savingDraftItemId, pass disabled={savingDraftItemId !== null || publishing} to every editor, and apply only matching token/current request/draft identity response. Preserve existing id/subject/step/status/requestId guards.

- [ ] **Step 4: Verify green and commit**

    npx --yes -p node@22 -p npm@11.11.0 -- npm test -- tests/client/guardian-dashboard.test.tsx
    npx --yes -p node@22 -p npm@11.11.0 -- npm run typecheck
    git diff --check
    git add src/client/guardian/ai-learning-studio.tsx tests/client/guardian-dashboard.test.tsx
    git commit -m "fix: serialize guardian studio state updates"

---

### Task 3: Student next-transition and dictation speech lifecycle

**Files:**

- Modify: src/client/learning/learning-session.tsx
- Modify: src/client/learning/dictation-panel.tsx
- Test: tests/client/learning-session.test.tsx

**Interfaces:**

- advanceReceipt(receiptId) returns without onNext when automatic or manual transition already consumed that receipt.
- DictationPanel receives paused and cancels speech synthesis when paused/unmounted and before new playback.

- [ ] **Step 1: Write failing tests**

    it("does not manually advance receipt already consumed by auto-next", async () => {
      completeCorrectAnswer();
      await advanceTimersByTimeAsync(1500);
      await user.click(screen.getByRole("button", { name: "다음 문제" }));
      expect(onNext).toHaveBeenCalledTimes(1);
    });

    it("cancels dictation playback while hidden, on break, and on unmount", async () => {
      await user.click(screen.getByRole("button", { name: "다시 듣기" }));
      await user.click(screen.getByRole("button", { name: "잠깐 쉬기" }));
      expect(window.speechSynthesis.cancel).toHaveBeenCalled();
      unmount();
      expect(window.speechSynthesis.cancel).toHaveBeenCalledTimes(2);
    });

- [ ] **Step 2: Verify red**

    npx --yes -p node@22 -p npm@11.11.0 -- npm test -- tests/client/learning-session.test.tsx

Expected: manual next invokes onNext twice and speech continues after lifecycle change.

- [ ] **Step 3: Share transition and cancel speech**

Both timer and button call one function that checks automaticNextConsumedReceiptRef before setting it and calling onNext. Disable the shown receipt's manual button when consumed/pending.

    useEffect(() => () => window.speechSynthesis?.cancel(), []);
    useEffect(() => { if (paused) window.speechSynthesis?.cancel(); }, [paused]);
    const replay = () => {
      window.speechSynthesis?.cancel();
      window.speechSynthesis?.speak(utterance);
    };

Pass paused={!active || guardianBreak} from LearningSession. Guard missing browser API.

- [ ] **Step 4: Verify green and commit**

    npx --yes -p node@22 -p npm@11.11.0 -- npm test -- tests/client/learning-session.test.tsx
    npx --yes -p node@22 -p npm@11.11.0 -- npm run typecheck
    git diff --check
    git add src/client/learning/learning-session.tsx src/client/learning/dictation-panel.tsx tests/client/learning-session.test.tsx
    git commit -m "fix: unify next transition and dictation lifecycle"

---

### Task 4: Modal mobile drawer and responsive focus handoff

**Files:**

- Modify: src/client/navigation/responsive-navigation.tsx
- Modify: src/client/styles/components.css only if a stable modal backdrop selector is required
- Test: tests/client/responsive-navigation.test.tsx

**Interfaces:**

- Compact drawer makes all app siblings outside drawer inert and aria-hidden; close restores prior state and invoking FAB focus.
- Landscape-to-portrait transition moves focus from hidden rail entry to visible compact-menu trigger.

- [ ] **Step 1: Write failing tests**

    it("makes content inert while compact drawer is modal", async () => {
      await openCompactMenu();
      expect(screen.getByTestId("lesson-shell")).toHaveAttribute("inert");
      expect(screen.getByTestId("lesson-shell")).toHaveAttribute("aria-hidden", "true");
    });

    it("moves focus from hidden landscape rail to compact menu after portrait rotation", () => {
      focusLandscapeRail("오늘 학습");
      mediaQuery.setMatches(false);
      expect(screen.getByRole("button", { name: "메뉴 열기" })).toHaveFocus();
    });

- [ ] **Step 2: Verify red**

    npx --yes -p node@22 -p npm@11.11.0 -- npm test -- tests/client/responsive-navigation.test.tsx

Expected: content remains interactive and focus stays in hidden rail.

- [ ] **Step 3: Apply modality and handoff**

Use a scoped app-content ref or data-responsive-page-content boundary; never inert drawer/portal. On open preserve invoker, apply inert and aria-hidden to content, and remove them on close/cleanup. On media transition true to false, if active element belongs to landscape rail, schedule focus to visible floating menu after commit.

- [ ] **Step 4: Verify green and commit**

    npx --yes -p node@22 -p npm@11.11.0 -- npm test -- tests/client/responsive-navigation.test.tsx
    npx --yes -p node@22 -p npm@11.11.0 -- npm run typecheck
    git diff --check
    git add src/client/navigation/responsive-navigation.tsx src/client/styles/components.css tests/client/responsive-navigation.test.tsx
    git commit -m "fix: enforce responsive drawer modality"

---

### Task 5: Final verification and release-evidence update

**Files:**

- Modify: docs/android-tablet.md
- Modify: docs/synology-nas-deploy.md
- Test: full Node 22 check and linux/amd64 Docker health smoke

- [ ] **Step 1: Extend acceptance text**

Add these verifiable statements:

    - Device A completion unlocks the same canonical item on device B without a STEP_LOCKED contradiction.
    - Gemini multipart text is parsed before JSON validation and budget reconciliation.
    - A late Studio item/settings response cannot replace newer visible state.
    - Automatic and manual next share one receipt transition; dictation speech stops when hidden or paused.
    - Compact drawer modality makes underlying lesson controls inert and rotation restores focus to visible menu.

- [ ] **Step 2: Run complete verification**

    npx --yes -p node@22 -p npm@11.11.0 -- npm run check
    git diff --check
    docker build --platform linux/amd64 -t sua-learning:final-remediation-smoke .

- [ ] **Step 3: Smoke and commit docs**

Run the existing bounded loopback smoke with the same safe dummy variables, replacing image/container name with sua-learning:final-remediation-smoke and sua-learning-final-remediation-smoke. Confirm exact health body {"status":"ok"} and cleanup, then:

    git add docs/android-tablet.md docs/synology-nas-deploy.md
    git commit -m "docs: record final remediation acceptance"

- [ ] **Step 4: Final whole-branch review**

Run fresh read-only server and client reviews from post-remediation HEAD, then request fresh release approval. Do not push, merge, publish, or deploy before that approval.

## Plan self-review

- Task 1 closes both server P2s; Task 2 closes both Guardian Studio P2s; Task 3 closes receipt/speech P2s; Task 4 closes drawer/rotation P2s; Task 5 proves integrated result.
- No task weakens staged, privacy, budget, or release-authority constraints.
- Exact files, test commands, interfaces, and commit boundaries are specified.
