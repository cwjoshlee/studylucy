# Step-up Release Hardening Task 5 Review Fix Report

## Status

- DONE
- Scope: Task 5 P1/P2 lifecycle, focus restoration, and controlled tree-focus findings only.
- No server, deployment, NAS, push, merge, or progress-ledger state was changed.
- `.DS_Store` remained untracked and untouched.

## Root causes

- `active=false` paused only the inactivity controller and auto-next timer. It
  was not part of the shared learning-control pause state, so speech capture,
  its elapsed interval, and late transcript callbacks remained live.
- Celebration and ChanaPing components had no owner-visibility input. Their
  timers and provider promises therefore continued behind a hidden session or
  guardian break.
- Hiding a completed receipt cleared both the timer and its only scheduling
  identity. Returning to the same mounted receipt had no path to create a new
  timer.
- Break focus restoration checked DOM ancestry attributes, but not computed CSS
  visibility. A responsive floating button with `display:none` could receive
  focus instead of the visible landscape rail.
- Controlled tree selection updated the roving `tabIndex`, but the selection
  effect did not distinguish tree-owned focus from an editable field and did
  not move DOM focus when the tree owned it.

## Fixes

- Treat navigation-away and guardian break as one full learning-activity pause.
  Speech capture is cancelled/aborted, its elapsed interval is cleared, all
  late speech callbacks check a current pause ref, and controls reject hidden
  submissions.
- Pass explicit `paused` state to LearningCompanion, ChanaPingCoach, and
  StarCelebration. ChanaPing aborts and invalidates an in-flight generation;
  star play/completion timers do not start or fire until resumed. The completion
  cue also checks current activity state at callback time.
- Re-arm one normal 1.5-second auto-next when the same authoritative completed
  receipt becomes active again after navigation or break. Duplicate receipts
  remain excluded.
- Restore break focus only to a connected, enabled, focusable target whose
  element and ancestors are not inert or hidden by HTML/ARIA/computed CSS,
  including display, visibility, and opacity. Prefer the
  visible floating menu, then the active landscape rail entry, then a safe
  lesson control.
- When controlled selection changes, move focus to the new roving tree item
  only if focus was already inside the tree. An API-key or budget input outside
  the tree keeps both focus and its typed value.

## TDD evidence

### RED

The exact four-file command first produced seven intentional failures while
193 existing tests passed:

- completed receipt did not resume auto-next after navigation or break;
- late speech was not aborted after `active=false`;
- CSS-hidden floating menu still received restored focus;
- hidden celebration still played/completed;
- controlled tree focus stayed on the old item.

Two additional ChanaPing regressions then covered no request while paused and
discarding an aborted late response.

### GREEN

```text
npx --yes -p node@22 -p npm@11.11.0 -- npm test -- tests/client/learning-session.test.tsx tests/client/login-and-home.test.tsx tests/client/responsive-navigation.test.tsx tests/client/guardian-dashboard.test.tsx
```

Result: 4 files passed, 203 tests passed, zero failures.

Additional verification:

```text
npx --yes -p node@22 -p npm@11.11.0 -- npm run typecheck
git diff --check
```

Both exited 0.

## Files

- `src/client/learning/learning-session.tsx`
- `src/client/companions/learning-companion.tsx`
- `src/client/companions/chanaping.tsx`
- `src/client/delight/star-celebration.tsx`
- `src/client/guardian/ai-learning-studio.tsx`
- `tests/client/learning-session.test.tsx`
- `tests/client/guardian-dashboard.test.tsx`
- `.superpowers/sdd/hardening-task-5-fix-report.md`

The other two exact Task 5 client test files were run as regressions and did
not require changes.
