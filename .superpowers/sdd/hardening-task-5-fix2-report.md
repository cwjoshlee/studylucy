# Step-up Release Hardening Task 5 Fix 2 Report

## Status

- DONE at parent HEAD `eeb5495`.
- Scope stayed within the Task 5 client lifecycle and its focused tests.
- `.DS_Store` remained untracked and untouched.

## Root causes

- Auto-next used one ref for both the armed timer and receipt identity. The timer
  cleared that ref before invoking `onNext`, so a parent render with a new
  callback identity made the still-mounted completed receipt look unhandled and
  armed it again.
- ChanaPing recorded duplicate suppression when a request started. A pause
  aborted the request but left the same input marked as recently requested, so
  resume could not retry it.
- Controlled tree selection synchronized `focusedItem` directly to the selected
  leaf even when that leaf was inside a closed group. Every rendered tree item
  then received `tabIndex=-1`, and focus could remain on a stale visible leaf.

## Implementation

- Auto-next now maintains separate armed and consumed receipt identities. It
  marks a receipt consumed before invoking `onNext`, also consumes a completed
  receipt on manual next, never re-arms the same receipt, and still allows a new
  completed receipt to advance once. Hidden and guardian-break cancellation
  continues to re-arm an unconsumed receipt only after learning resumes.
- ChanaPing now suppresses only successfully completed request inputs. Pausing
  aborts and invalidates the active generation, so resuming the same input sends
  a fresh request; a late aborted response is ignored. A successful response is
  still deduplicated across pause/resume for four minutes.
- The AI Studio tree derives a visible owner for a selected leaf in a closed
  group and guarantees one visible roving tab stop. Controlled selection moves
  tree-owned focus to that owner, while focus in API-key and other form inputs is
  preserved. Ordinary keyboard expansion keeps the current tree focus.

## TDD evidence

### RED

The exact four Task 5 client files initially produced four targeted failures:

- a completed receipt advanced twice after `onNext` identity changed;
- an aborted ChanaPing request was not retried after resume;
- a controlled hidden leaf left its visible owner at `tabIndex=-1`;
- tree-owned focus stayed on the stale leaf instead of the visible owner.

The successful-request dedupe and new-receipt tests were also added to protect
the two allowed reset boundaries.

### GREEN

```text
npx --yes -p node@22 -p npm@11.11.0 -- npm test -- tests/client/learning-session.test.tsx tests/client/login-and-home.test.tsx tests/client/responsive-navigation.test.tsx tests/client/guardian-dashboard.test.tsx
```

Result: 4 files passed, 209 tests passed, zero failures.

```text
npx --yes -p node@22 -p npm@11.11.0 -- npm run typecheck
git diff --check
```

Both exited 0.

## Files

- `src/client/learning/learning-session.tsx`
- `src/client/companions/chanaping.tsx`
- `src/client/guardian/ai-learning-studio.tsx`
- `tests/client/learning-session.test.tsx`
- `tests/client/guardian-dashboard.test.tsx`

No server, deployment, NAS, progress-ledger, push, or merge action was changed.
