# Step-up Release Hardening Task 4 Fix Report

## Status

- DONE
- Scope: Task 4 guardian AI Studio review gaps only.
- `.DS_Store`, server code, deployment state, and the progress ledger were not changed.

## Fixes

- Budget and provider-rate saves now wait for both provider writes to settle. If any
  write succeeded before a later write or reload failed, the panel fetches the
  authoritative full settings view and replaces all displayed values with server
  truth. A second reload failure keeps an explicit recovery message.
- Draft edit and publish responses are accepted only when draft ID, subject, step,
  request generation, active draft status, and expected returned status all match.
  Mismatched responses remain invisible and show a guarded outcome message.
- While publication is pending, every editable draft control and item save button is
  disabled. Existing publication blocking while an item save is pending remains in
  place, closing both overlap directions.
- Failed API-key deletion clears any typed password value in `finally`.

## TDD Evidence

### RED

The focused command failed exactly five new regressions:

- no authoritative reload after partial budget save;
- typed key remained after failed deletion;
- mismatched edit response replaced the active draft;
- mismatched publish response reported success;
- item controls remained enabled during publication.

The other 67 focused tests passed.

### GREEN

```text
npx --yes -p node@22 -p npm@11.11.0 -- npm test -- tests/client/guardian-dashboard.test.tsx tests/client/api-client.test.ts
```

Result: 2 files passed, 72 tests passed, zero failures.

Additional verification:

```text
npx --yes -p node@22 -p npm@11.11.0 -- npm run typecheck
git diff --check
```

Both exited 0.

## Files

- `src/client/guardian/ai-learning-studio.tsx`
- `tests/client/guardian-dashboard.test.tsx`
- `.superpowers/sdd/hardening-task-4-fix-report.md`
