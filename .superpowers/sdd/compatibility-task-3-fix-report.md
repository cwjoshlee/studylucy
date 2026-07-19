# Compatibility Task 3 Fix Report

## Status

- DONE
- Scope: client post-completion refresh lifecycle only.
- `.DS_Store`, server code, release documents, progress ledger, deployment,
  NAS state, push, and merge were not changed.

## Implementation

- Post-completion authority refreshes now use a request generation that is
  independent from startup, user, and sync-completed background refreshes.
  A background refresh can no longer abandon a completed lesson in a
  permanently pending state.
- The existing learning-session React key is now produced by one shared helper:
  `planId:itemId:contentVersion`. A successful refresh advances only when the
  next required item has a different key. A same-key stale response keeps the
  completed session mounted, locks the consumed receipt, and exposes a
  retryable `다음 문제를 아직 준비 중이에요` state.
- A receipt-authority change during a pending completion refresh makes the
  guarded cache write return false. The completion lifecycle now settles as a
  visible retry instead of being silently discarded; the retry can then open
  the fresh keyed item without resubmitting the completed attempt.
- Successful completion refreshes now open the next keyed required item. The
  existing progress-and-stars test returns to the dashboard explicitly before
  checking the refreshed summary.
- The sync-completed publisher is exported without changing its runtime call
  sites so the exact subscription race can be exercised deterministically.

## Files

- `src/client/home/student-home.tsx`
- `src/client/learning/learning-session.tsx`
- `src/client/offline/sync.ts`
- `tests/client/login-and-home.test.tsx`

## TDD Evidence

### RED

`keeps a consumed lesson locked until refresh selects a differently keyed required item`
failed because the stale same-key response closed the learning view and no
`다음 문제 준비 상태` retry was present.

`settles a post-completion refresh when a sync refresh wins the authority race`
failed because the background refresh incremented the shared request generation.
The completion refresh was discarded, leaving neither a new keyed item nor a
retry action.

### GREEN

```text
npx --yes -p node@22 -p npm@11.11.0 -- npm test -- --run tests/client/login-and-home.test.tsx tests/client/learning-session.test.tsx
```

Result: 2 files passed, 149 tests passed, 0 failed.

```text
npx --yes -p node@22 -p npm@11.11.0 -- npm run typecheck
git diff --check
```

Both exited 0.

## Self-review

- Automatic and manual completion use the same consumed-receipt transition and
  the same post-completion refresh function; retry reuses that function after
  the receipt has already been consumed.
- Same-key and cache-authority-loss paths keep the old component mounted, so
  the answer remains visible while `다음 문제` stays disabled.
- A later response with a different `planId`, item id, or content version gets
  a different component key and is allowed to create the next session.
- Both race tests assert `saveAttempt` remains called exactly once.
