# ChanaPing correct-receipt fix report

- Date: 2026-07-18
- Base: `ebc04df` (`fix: deduplicate speech recognition restart`)
- Runtime: Node `v22.23.1` through `npx -p node@22 -p npm@11.11.0`
- Scope: ChanaPing event precedence for a receipt-confirmed calculation completion

## Root cause

The calculation receipt sets `attemptReceipt.completed` and schedules two UI
timers: the companion next cue at 1 second and automatic next at 1.5 seconds.
`chanaPingEvent` required `!showNextCue` to emit `"correct"`; therefore, during
the visible interval after the one-second cue and before automatic advance, it
selected `"next"` and rendered the resting art/opening-style cue instead of
the completion celebration.

## TDD evidence

Added the LearningSession integration regression `keeps ChanaPing celebrating
after a correct keypad receipt reaches the next cue`. It enters `26` on the
large keypad, submits the authoritative correct receipt, advances exactly one
second, and asserts that automatic next has not run while ChanaPing still
shows `chanaping-celebrate.svg` and a celebrate cue.

RED before the production change:

```text
Test Files  1 failed (1)
Tests       1 failed | 72 passed (73)
Received: src="/assets/companions/chanaping.svg"
Expected: src="/assets/companions/chanaping-celebrate.svg"
```

The minimal production change makes a non-duplicate completed receipt win
over the ChanaPing `next` event. It leaves the separate LearningCompanion next
cue, retries, speech/idle precedence, offline/queue behavior, automatic-next
timer, and keypad activity behavior unchanged.

## Verification

Focused regression suite:

```bash
npx --yes -p node@22 -p npm@11.11.0 -- npm test -- tests/client/learning-session.test.tsx tests/client/chanaping-cues.test.ts tests/shared/companions.test.ts
```

```text
Test Files  3 passed (3)
Tests       101 passed (101)
```

Node 22 typecheck:

```bash
npx --yes -p node@22 -p npm@11.11.0 -- npm run typecheck
```

```text
tsc --noEmit passed (exit 0)
```

Node 22 production build:

```bash
npx --yes -p node@22 -p npm@11.11.0 -- npm run build
```

```text
Vite client/PWA build and tsup server build passed (exit 0).
```

The build retained its existing non-fatal client chunk-size notice and
`inlineDynamicImports` deprecation warning.
