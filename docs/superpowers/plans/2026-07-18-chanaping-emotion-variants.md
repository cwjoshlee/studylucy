# 차나핑 감정 표현 확장 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 차나핑이 정답·재도전·지루함·집중·일반 대기에 맞춰 서로 다른 표정과 복수의 말풍선을 표시한다.

**Architecture:** 학습 화면은 기존의 공유 `ChanaPingEvent`만 전달하고, `chanaping-cues.ts`가 이벤트를 `ChanaPingMood`로 순수하게 변환한다. 코치는 mood별 로컬 SVG와 안정적으로 선택한 45자 이하 문구를 렌더링하며, 학습 결과·별·네트워크 권한에는 관여하지 않는다.

**Tech Stack:** React 18, TypeScript, Vitest/Testing Library, 로컬 SVG, CSS.

## Global Constraints

- mood는 `celebrate`, `grumble`, `bored`, `focus`, `rest` 다섯 개뿐이다.
- 오답/재시도에는 `grumble`, 정답에는 `celebrate`, 2분 멈춤에는 `bored`를 사용한다.
- 키패드 한 자리 입력에는 cue/mood를 바꾸지 않는다.
- 각 mood에는 45자 이하의 안전한 한국어 문구가 세 개 이상 있어야 한다.
- `grumble`은 “아… 그건 아니잖아. 다시 천천히 해보자, 차나~!” 수준의 툴툴거림만 허용하고 모욕·능력평가·벌·별 차감·포기 유도 표현을 포함하지 않는다.
- SVG는 자체 제작한 로컬 파일이며 외부 URL, 실행 가능한 SVG 콘텐츠, 사용자 제공 프랜차이즈 원본을 포함하지 않는다.
- 화면에는 하나의 polite 상태 알림만 남기고, 기존 확인 대화상자가 열리면 코치를 렌더링하지 않는다.

## File Map

- `src/client/companions/chanaping-cues.ts`: `ChanaPingEvent`를 mood와 여러 안전 문구로 변환한다.
- `src/client/companions/chanaping.tsx`: mood asset과 상태 속성을 렌더링한다.
- `public/assets/companions/chanaping-{celebrate,grumble,bored,focus}.svg`: 독립 원본 표정 asset이다.
- `src/client/styles/components.css`: mood별 가벼운 움직임과 reduced-motion 규칙을 둔다.
- `tests/client/chanaping-cues.test.ts`, `tests/client/companion-components.test.tsx`, `tests/client/learning-session.test.tsx`: 매핑·asset·키패드 비갱신을 검증한다.

### Task 1: 표정별 차나핑 코치

**Files:**
- Create: `public/assets/companions/chanaping-celebrate.svg`, `public/assets/companions/chanaping-grumble.svg`, `public/assets/companions/chanaping-bored.svg`, `public/assets/companions/chanaping-focus.svg`, `tests/client/chanaping-cues.test.ts`
- Modify: `src/client/companions/chanaping-cues.ts`, `src/client/companions/chanaping.tsx`, `src/client/styles/components.css`, `tests/client/companion-components.test.tsx`, `tests/client/learning-session.test.tsx`

**Interfaces:**
- Consumes: `ChanaPingEvent` from `src/shared/learning.ts`; existing `ChanaPingCoach` props and its `hidden` dialog guard.
- Produces: `export type ChanaPingMood = "celebrate" | "grumble" | "bored" | "focus" | "rest"`; `getChanaPingMood(event: ChanaPingEvent): ChanaPingMood`; `selectLocalChanaPingCue(input): string`; `getChanaPingArt(mood): string`.

- [ ] **Step 1: Write the failing test**

Add a unit table that maps `correct` to `celebrate`, `retry` to `grumble`, `thinking` to `bored`, `speech-start` to `focus`, and `lesson-open` to `rest`. Vary retry count from zero through five and assert the retry selector returns at least three distinct strings and none matches `바보|느려|게으르|별|차감|벌|포기|못하`.

Add component assertions that `correct`, `retry`, and `thinking` select `chanaping-celebrate.svg`, `chanaping-grumble.svg`, and `chanaping-bored.svg`. Extend the calculation learning-session test so a keypad digit leaves both cue and image source unchanged; a rejected `답 확인` changes the source to grumble.

- [ ] **Step 2: Run test to verify it fails**

Run `npx --yes -p node@22 -p npm@11.11.0 -- npm test -- tests/client/chanaping-cues.test.ts tests/client/companion-components.test.tsx tests/client/learning-session.test.tsx`.

Expected: FAIL because mood helpers and mood-specific assets do not exist.

- [ ] **Step 3: Write minimal implementation**

Define `CHANAPING_ART` as a record from the five moods to `/assets/companions/chanaping-{mood}.svg`, retaining the original `chanaping.svg` for `rest`. Map `correct` to celebrate; retry to grumble; thinking/idle-confirm/idle-paused to bored; speech-start/speech-finish to focus; all remaining events to rest. Give every mood three or more concise cue strings. Keep the stable hash and include event, retry count, and cue key so a keypad digit cannot alter a cue but a later retry can.

Compute mood once in `ChanaPingCoach`, use its asset as the image source, and add `data-chanaping-mood={mood}`. Retain one `role="status"` with `aria-live="polite"`, the same Korean alt text, and the existing hidden guard.

Create four independently drawn, under-120KB SVG files with rounded teal-haired coach styling: joyful sparkle for celebrate, crossed arms/raised brow for grumble, yawn/drooped posture for bored, attentive ear-forward pose for focus. Do not include script, foreignObject, event attributes, or external href/src. Add CSS animation only to celebrate and grumble art, and disable it in `prefers-reduced-motion`.

- [ ] **Step 4: Run tests and commit**

Run the selected test suite, `npm run typecheck`, `npm run build:client`, and `git diff --check`; all must pass. Then commit source, assets, and tests with `feat: add chanaping emotion variants`.
