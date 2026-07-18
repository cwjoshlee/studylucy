# Whole-branch review remediation report

- Date: 2026-07-18
- Base: `745e46a`
- Remediation commit: `0d87c59ca7e9dec22fa3f583df68341ed159aa6e`
- Runtime: Node `v22.23.1`, npm `11.11.0`
- External state: no GitHub or NAS operation was performed

## Result

Every Critical, Important, and requested Minor finding in `final-review-fix-brief.md` is resolved. The final whole check has zero failing files and zero failing tests: 37 files and 526 tests passed. Production and rollback remain image-only; no deployment path restores or deletes data.

The initial focused baseline reproduced five failures: the stale v2 version assertion, the duplicated v3 delight copy, one authority completion/star failure, and two offline star-balance failures. The four authority/offline/version fixture failures and the copy failure are all green in the final whole check.

## Implemented remediation

1. Active v3 calculation rows now use the legacy `kind: "math-story"` envelope with all fields required by image `455f750` and an optional strict `calculation` extension. A frozen inline copy of the `455f750` parser accepts every active v3 row. Current code uses `isCalculationItem()` to retain the expression-only board, two-digit keypad, no reading UI, calculation scoring, and exclusion from Korean reading metrics.
2. Shared parsing rejects negative or greater-than-99 operands, negative or greater-than-99 intermediate results, greater-than-99 answers, answer mismatches, invalid operator lengths, and invalid vertical layouts.
3. All ten v3 calculation rows have individually authored `mishap`, `openingCue`, and `celebrationCue` copy. All 20 active rows are distinct in each field, and the existing commercial-name audit stays green.
4. Authority, offline, and learning fixtures submit the numeric answer for both classic math stories and compatible calculation extensions. Completion and star balances returned to their asserted values.
5. Both providers receive a 64-token output cap. Each request atomically reserves and keeps one won in a SQLite immediate transaction before the network call; observed tokens update only observability columns. No post-call path can raise the charge, a request that does not fit never reaches a provider, and concurrent requests cannot exceed the application cap.
6. The one-won reservation is conservative: the fixed request is bounded below 512 input tokens; the higher official input rate among the two configured models is USD 0.10/M and both output rates are USD 0.40/M. At 64 output tokens and a deliberately conservative 2,000 KRW/USD, the bound is 0.1536 won, so one won is the smallest whole-won reservation. Pricing references: `https://ai.google.dev/gemini-api/docs/pricing` and `https://developers.openai.com/api/docs/models/gpt-5-nano`.
7. A hidden `ChanaPingCoach` starts no request, becoming hidden aborts an in-flight request, and duplicate received LLM text is not placed back in the live region during the four-minute repeat window.
8. `publish-image` now uses the `main-publish` concurrency group with `cancel-in-progress: true`. `.env.example` and both NAS runbooks require a base64 encoding of exactly 32 random bytes for `LLM_ENCRYPTION_KEY`, capture it without printing it, write it only into mode-600 `.env`, and unset the shell variable.

## TDD evidence

Each root cause was reproduced before its implementation change.

```text
Content/schema RED:
Test Files  2 failed (2)
Tests       3 failed | 48 passed (51)

Compatible client RED:
Test Files  2 failed | 2 passed (4)
Tests       7 failed | 144 passed (151)

Budget/output-cap RED:
Test Files  1 failed (1)
Tests       4 failed | 12 passed (16)

Hidden/abort/dedupe RED:
Test Files  1 failed (1)
Tests       3 failed | 16 passed (19)

Workflow/key-documentation RED:
Test Files  1 failed (1)
Tests       2 failed | 5 passed (7)
```

The same focused areas were then green before proceeding. The initial parallel focused aggregation exposed a pre-existing test-only issuance timing race. It was reproduced in the whole check and fixed by explicitly flushing the already-resolved mocked React issuance before querying; the final parallel whole check is green.

## Final verification output

Targeted content, learning, authority, offline, coach, client, deployment, and configuration tests:

```bash
npx --yes -p node@22 -p npm@11.11.0 -- npm test -- --maxWorkers=1 tests/server/content-parity.test.ts tests/server/content-delight.test.ts tests/server/db.test.ts tests/server/learning.test.ts tests/server/star-learning.test.ts tests/server/authority-integration.test.ts tests/server/offline-batch.test.ts tests/offline/sync.test.ts tests/server/coach.test.ts tests/client/companion-components.test.tsx tests/client/learning-session.test.tsx tests/client/problem-breakdown.test.tsx tests/server/automated-deploy-config.test.ts tests/server/config.test.ts
```

```text
Test Files  14 passed (14)
Tests       263 passed (263)
Duration    17.56s
Exit code   0
```

Complete Node 22 check:

```bash
npx --yes -p node@22 -p npm@11.11.0 -- npm run check
```

```text
Test Files  37 passed (37)
Tests       526 passed (526)
Duration    17.73s
vite: 128 client modules transformed; client build completed
PWA: 18 entries precached; service worker generated
tsup: ESM build success in 51ms
Exit code   0
```

The build emitted the existing non-fatal Vite chunk-size notice and `inlineDynamicImports` deprecation warning; neither is a test, typecheck, or build failure.

Separate production build:

```bash
npx --yes -p node@22 -p npm@11.11.0 -- npm run build
```

```text
vite: 128 client modules transformed; built in 132ms
PWA: 18 entries precached; service worker generated
tsup: ESM build success in 36ms
Exit code   0
```

Whitespace validation:

```bash
git diff --check
```

```text
(no output)
Exit code 0
```

## Whole-check disposition

All whole-check failures are resolved. No failure was skipped, converted to a warning, or hidden with a fallback. No secrets were added to source, documentation, logs, or this report.
