# 수아의 마법 동물 학습 친구와 유머 경험 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 수아가 국어와 수학을 친한 마법 동물 친구와 함께 푸는 느낌을 받도록, 오리지널 캐릭터·결정적 유머 반응·인지 부담 완화·한국어 유머 콘텐츠를 현재 학생 학습 흐름에 완성한다.

**Architecture:** 공유 Zod 스키마에 선택적 `delight` 메타데이터를 추가하고, React나 네트워크에 의존하지 않는 캐릭터/cue/문제 분절 계층을 먼저 만든다. 표현 계층은 이 순수 계층만 소비하며, 기존 `StudentHome`과 `LearningSession`이 계속 학습 권위·저장·별·오프라인 상태를 소유한다. 초기 콘텐츠는 기존 version 1을 덮어쓰지 않고 version 2로 추가·활성화한다.

**Tech Stack:** Node.js 22, npm 11.11.0, TypeScript 7, React 19, Zod 4, Vitest 4, Testing Library, Vite PWA, SVG, Playwright CLI

## Global Constraints

- 기준 설계는 `docs/superpowers/specs/2026-07-17-magical-animal-learning-companions-design.md`다.
- 기존 상업 캐릭터의 이름, 상표, 얼굴, 색 배치, 소품, 고유 실루엣과 세계관을 복제하지 않는다.
- 웃음의 대상은 캐릭터의 엉뚱한 행동뿐이며 수아의 오답, 발음, 읽기 속도, 외모, 능력, 가족과 감정을 농담 소재로 사용하지 않는다.
- `retry`, `save-wait`, `idle-confirm`, `idle-paused`에서는 유머를 금지한다.
- 아이 화면에서 LLM, 자동 음성, 광고, 외부 추적과 자유형 AI 채팅을 호출하지 않는다.
- 서버의 `AttemptReceipt`, `starAward`, 학습 세션, 오프라인 권위와 별 원장만 결과의 권위다. 친구 UI는 완료나 별을 추측하지 않는다.
- 새 `delight`는 선택 필드여야 하며 기존 version 1 콘텐츠, 복구 계획, 백업과 오프라인 캐시를 계속 읽어야 한다.
- 초기 새 콘텐츠는 version 2다. 기존 version 1 payload는 수정하지 않고 active version 1만 2로 올리며, active version 3 이상은 절대 낮추지 않는다.
- 모든 어린이용 새 문구는 자연스러운 한국어이고 한 말풍선은 최대 두 문장, 한 필드는 1~120자다.
- 핵심 터치 대상은 최소 48px, `prefers-reduced-motion: reduce`에서는 이동·회전·입자를 제거한다.
- 13인치 Galaxy Tab 검증 뷰포트는 가로 1368×912와 1600×900, 세로 800×1280, 확대 200%다.
- 네 캐릭터 SVG 전체는 600KB 이하, 파일당 180KB 이하이며 PWA 앱 셸에 precache한다.
- 모든 제품 코드 변경은 실패 테스트를 먼저 확인한 뒤 최소 구현하고 관련 테스트와 전체 회귀를 실행한다.
- 검증 명령은 `npx --yes -p node@22 -p npm@11.11.0 -- npm ...` 형태로 Node 22/npm 11.11.0을 고정한다.

---

## 파일 구조

새 파일:

- `src/shared/companions.ts`: 캐릭터 ID와 `LearningDelight` Zod 스키마
- `src/client/companions/cast.ts`: 네 친구의 표시 메타데이터
- `src/client/companions/cues.ts`: 상태별 cue와 결정적 선택 함수
- `src/client/companions/companion-avatar.tsx`: SVG 이미지와 실패 대체 배지
- `src/client/companions/friend-stage.tsx`: 홈의 친구 쉼터와 오늘의 흔적
- `src/client/companions/learning-companion.tsx`: 학습 상태별 한 친구·한 말풍선
- `src/client/learning/problem-breakdown.ts`: 표시 전용 문장·숫자 분절 순수 함수
- `src/client/learning/problem-breakdown-view.tsx`: 국어·수학 이해 보조 컴포넌트
- `src/server/db/seed-v1.ts`: 기존 초기 payload 20개의 변경 없는 version 1 보존본
- `scripts/generate-companion-assets.mjs`: 네 오리지널 SVG의 재현 가능한 생성기
- `public/assets/companions/lumi.svg`
- `public/assets/companions/toto.svg`
- `public/assets/companions/momo.svg`
- `public/assets/companions/bongbong.svg`
- `tests/shared/companions.test.ts`
- `tests/server/content-delight.test.ts`
- `tests/client/companion-components.test.tsx`
- `tests/client/problem-breakdown.test.tsx`
- `docs/magical-companion-acceptance.md`

수정 파일:

- `src/shared/learning.ts`: `BaseItem.delight?`
- `src/server/db/seed.ts`: 유머 콘텐츠 v2와 안전한 활성 버전 승격
- `tests/server/content-parity.test.ts`: 은퇴 프로토타입 payload hash 대신 승인된 v2 콘텐츠 계약
- `tests/server/db.test.ts`: v1 보존, v2 승격, v3 비강등
- `tests/helpers/client.ts`: 유머 메타데이터가 있는 실제적인 fake plan
- `src/client/home/student-home.tsx`: 친구 무대, 우당탕 카드, 오늘의 흔적
- `src/client/learning/learning-session.tsx`: 친구 상태, 한국어 피드백, 이해 보조, 접힌 수동 입력
- `src/client/delight/star-celebration.tsx`: 봉봉 축하 cue와 기존 event idempotency 결합
- `src/client/styles/tokens.css`
- `src/client/styles/components.css`
- `src/client/styles/layout.css`
- `src/client/styles/responsive.css`
- `vite.config.ts`: 중첩 companion SVG precache
- `tests/client/login-and-home.test.tsx`
- `tests/client/learning-session.test.tsx`
- `tests/offline/pwa-config.test.ts`
- `.gitignore`: `output/playwright/`

---

### Task 1: 공유 캐릭터 계약과 결정적 cue 엔진

**Files:**

- Create: `src/shared/companions.ts`
- Create: `src/client/companions/cast.ts`
- Create: `src/client/companions/cues.ts`
- Modify: `src/shared/learning.ts:10-31`
- Test: `tests/shared/companions.test.ts`

**Interfaces:**

- Produces: `CompanionId`, `CompanionIdSchema`, `LearningDelight`, `LearningDelightSchema`
- Produces: `COMPANION_CAST`, `CompanionMoment`, `CompanionCue`, `selectCompanionCue(input)`
- Consumes later: Tasks 2-6 import these exact names; no task redefines character IDs or cue tones.

- [ ] **Step 1: Write failing schema and cue tests**

Create `tests/shared/companions.test.ts` with the following behaviors:

```ts
import { describe, expect, it } from "vitest";
import {
  CompanionIdSchema,
  LearningDelightSchema
} from "../../src/shared/companions";
import { LearningItemPayloadSchema } from "../../src/shared/learning";
import { COMPANION_CAST } from "../../src/client/companions/cast";
import {
  selectCompanionCue,
  type CompanionMoment
} from "../../src/client/companions/cues";

const delight = {
  companion: "toto" as const,
  mishap: "또또의 수첩이 수영부터 배우겠대요.",
  openingCue: "또또의 꼬리가 수첩보다 먼저 젖었대요.",
  celebrationCue: "낱말을 모두 건졌어요!"
};

describe("magical companion contracts", () => {
  it("accepts the four closed companion ids and rejects unknown ids", () => {
    expect(["lumi", "toto", "momo", "bongbong"].map((id) =>
      CompanionIdSchema.parse(id))).toHaveLength(4);
    expect(() => CompanionIdSchema.parse("commercial-character"))
      .toThrow();
  });

  it("requires one-line Korean child copy of at most 120 characters", () => {
    expect(LearningDelightSchema.parse(delight)).toEqual(delight);
    expect(() => LearningDelightSchema.parse({
      ...delight,
      openingCue: "Read this carefully."
    })).toThrow();
    expect(() => LearningDelightSchema.parse({
      ...delight,
      mishap: `또${"가".repeat(121)}`
    })).toThrow();
    expect(() => LearningDelightSchema.parse({
      ...delight,
      celebrationCue: "첫 줄\n둘째 줄"
    })).toThrow();
    expect(() => LearningDelightSchema.parse({
      ...delight,
      openingCue: "천천히 Read 해 봐요."
    })).toThrow();
    expect(() => LearningDelightSchema.parse({
      ...delight,
      openingCue: "첫 문장이에요. 둘째 문장이에요. 셋째 문장이에요."
    })).toThrow();
  });

  it("keeps delight optional for legacy payloads", () => {
    const legacy = LearningItemPayloadSchema.parse({
      id: "ko-legacy",
      kind: "korean-reading",
      subject: "korean",
      unit: "읽기",
      title: "옛 문장",
      level: "1단계",
      readLabel: "읽어 보기",
      text: "옛 문장을 읽어요.",
      hint: "천천히 읽어 봐요.",
      tokens: ["옛 문장"]
    });
    expect(legacy).not.toHaveProperty("delight");
  });

  it("defines four unique original friends with Korean alt text", () => {
    expect(Object.keys(COMPANION_CAST)).toEqual([
      "lumi", "toto", "momo", "bongbong"
    ]);
    expect(new Set(Object.values(COMPANION_CAST).map((friend) => friend.name)).size)
      .toBe(4);
    expect(Object.values(COMPANION_CAST).every((friend) =>
      /[가-힣]/.test(friend.alt) && friend.asset.startsWith("/assets/companions/")
    )).toBe(true);
  });

  it("selects the same cue for the same stable key", () => {
    const input = {
      moment: "home-welcome" as const,
      key: "2026-07-17:ko-01",
      subject: "korean" as const
    };
    expect(selectCompanionCue(input)).toEqual(selectCompanionCue(input));
  });

  it("uses content opening and celebration cues only in their matching moments", () => {
    expect(selectCompanionCue({
      moment: "lesson-open",
      key: "ko-01",
      subject: "korean",
      delight
    })).toMatchObject({ companion: "toto", text: delight.openingCue, tone: "humor" });
    expect(selectCompanionCue({
      moment: "correct",
      key: "ko-01",
      subject: "korean",
      delight
    })).toMatchObject({ companion: "bongbong", text: delight.celebrationCue, tone: "humor" });
  });

  it.each([
    "retry", "save-wait", "idle-confirm", "idle-paused"
  ] satisfies CompanionMoment[])("never emits humor for %s", (moment) => {
    expect(selectCompanionCue({
      moment,
      key: `ko-01:${moment}`,
      subject: "korean",
      delight
    }).tone).not.toBe("humor");
  });

  it("falls back to the moment pool when a preferred friend has no cue", () => {
    expect(selectCompanionCue({
      moment: "thinking",
      key: "math-01:thinking",
      subject: "math",
      preferredCompanion: "bongbong"
    })).toMatchObject({ companion: "momo", tone: "humor" });
  });
});
```

- [ ] **Step 2: Run the new tests and confirm RED**

Run:

```bash
npx --yes -p node@22 -p npm@11.11.0 -- npm test -- tests/shared/companions.test.ts
```

Expected: FAIL because `src/shared/companions.ts`, `cast.ts` and `cues.ts` do not exist and `LearningItemPayloadSchema` has no `delight` field.

- [ ] **Step 3: Implement the shared schema**

Create `src/shared/companions.ts`:

```ts
import { z } from "zod";

export const CompanionIdSchema = z.enum([
  "lumi", "toto", "momo", "bongbong"
]);

export type CompanionId = z.infer<typeof CompanionIdSchema>;

const KoreanChildCueSchema = z.string()
  .trim()
  .min(1)
  .max(120)
  .regex(/[가-힣]/, "KOREAN_TEXT_REQUIRED")
  .regex(/^[^A-Za-z\r\n]+$/, "LATIN_OR_NEWLINE_FORBIDDEN")
  .superRefine((value, context) => {
    const sentenceCount = value.split(/[.!?]+/u)
      .map((part) => part.trim())
      .filter(Boolean)
      .length;
    if (sentenceCount > 2) {
      context.addIssue({
        code: "custom",
        message: "AT_MOST_TWO_SENTENCES"
      });
    }
  });

export const LearningDelightSchema = z.object({
  companion: CompanionIdSchema,
  mishap: KoreanChildCueSchema,
  openingCue: KoreanChildCueSchema,
  celebrationCue: KoreanChildCueSchema
}).strict();

export type LearningDelight = z.infer<typeof LearningDelightSchema>;
```

Import `LearningDelightSchema` in `src/shared/learning.ts` and add
`delight: LearningDelightSchema.optional()` to `BaseItem`.

- [ ] **Step 4: Implement cast metadata and cue selection**

Create `src/client/companions/cast.ts`:

```ts
import type { CompanionId } from "../../shared/companions";

export type CompanionProfile = {
  id: CompanionId;
  name: string;
  role: string;
  alt: string;
  asset: string;
  accent: string;
};

export const COMPANION_CAST: Record<CompanionId, CompanionProfile> = {
  lumi: {
    id: "lumi",
    name: "별토끼 루미",
    role: "다정한 길잡이",
    alt: "작은 망토와 별 지팡이를 든 크림색 토끼 루미",
    asset: "/assets/companions/lumi.svg",
    accent: "lilac"
  },
  toto: {
    id: "toto",
    name: "수달 또또",
    role: "국어와 낱말 친구",
    alt: "낱말 수첩과 조개 연필을 든 수달 또또",
    asset: "/assets/companions/toto.svg",
    accent: "mint"
  },
  momo: {
    id: "momo",
    name: "너구리 모모",
    role: "수학과 문장제 친구",
    alt: "숫자 가방과 포도알 주판을 든 너구리 모모",
    asset: "/assets/companions/momo.svg",
    accent: "sky"
  },
  bongbong: {
    id: "bongbong",
    name: "아기용 봉봉",
    role: "축하와 쉬는 시간 친구",
    alt: "별가루 비눗방울을 내뿜는 복숭아색 아기용 봉봉",
    asset: "/assets/companions/bongbong.svg",
    accent: "peach"
  }
};
```

Create `src/client/companions/cues.ts` with these exported contracts:

```ts
import type { LearningDelight, CompanionId } from "../../shared/companions";

export type CompanionMoment =
  | "home-welcome" | "home-return" | "lesson-open" | "thinking"
  | "correct" | "next" | "offline" | "retry" | "save-wait"
  | "idle-confirm" | "idle-paused";

export type CompanionCue = {
  companion: CompanionId;
  text: string;
  tone: "humor" | "support" | "status";
};

type CueInput = {
  moment: CompanionMoment;
  key: string;
  subject: "korean" | "math";
  preferredCompanion?: CompanionId;
  delight?: LearningDelight;
};

const CUES: Record<CompanionMoment, readonly CompanionCue[]> = {
  "home-welcome": [
    { companion: "lumi", text: "루미의 지팡이가 딸꾹! 별 대신 양말 한 짝이 나왔어요.", tone: "humor" },
    { companion: "toto", text: "또또의 낱말 수첩이 물안경부터 챙겼어요. 오늘도 함께 읽어 봐요.", tone: "humor" },
    { companion: "momo", text: "모모의 포도알 주판이 간식 시간인 줄 알았대요. 숫자를 지켜 주세요.", tone: "humor" },
    { companion: "bongbong", text: "봉봉이 불을 뿜으려다 비눗방울 왕관을 만들었어요.", tone: "humor" }
  ],
  "home-return": [
    { companion: "lumi", text: "돌아왔구나! 루미가 양말 별자리를 완성하는 중이래요.", tone: "humor" },
    { companion: "toto", text: "또또가 읽은 낱말에 수건을 덮어 주고 있어요. 젖지 않았는데도요.", tone: "humor" },
    { companion: "momo", text: "모모가 해결한 숫자마다 포도알을 하나씩 놓았대요. 먹지는 않았대요.", tone: "humor" },
    { companion: "bongbong", text: "봉봉의 왕관이 또 거꾸로예요. 그래도 아주 당당해요.", tone: "humor" }
  ],
  "lesson-open": [
    { companion: "toto", text: "또또가 낱말과 생선 간식에 이름표를 붙였대요. 이번에는 안 바뀌었을까요?", tone: "humor" },
    { companion: "momo", text: "모모의 주판에 포도알 하나가 슬쩍 앉았어요. 숫자만 찾아볼까요?", tone: "humor" }
  ],
  thinking: [
    { companion: "toto", text: "또또도 낱말 수첩을 천천히 넘기는 중이에요. 힌트를 살짝 열어도 괜찮아요.", tone: "humor" },
    { companion: "momo", text: "모모가 꼬리 줄무늬를 다시 세는 중이에요. 우리도 천천히 단서를 찾아봐요.", tone: "humor" }
  ],
  correct: [
    { companion: "bongbong", text: "정답이에요! 봉봉의 축하 불꽃이 비눗방울로 변했어요.", tone: "humor" },
    { companion: "bongbong", text: "함께 해결했어요! 봉봉의 왕관이 기뻐서 한 바퀴 돌았대요.", tone: "humor" }
  ],
  next: [
    { companion: "lumi", text: "다음 마법 걸음으로 가요. 루미가 도망간 양말을 잡아 둘게요.", tone: "humor" }
  ],
  offline: [
    { companion: "lumi", text: "지금은 오프라인이에요. 기록은 이 기기에 안전하게 기다리고 있어요.", tone: "status" }
  ],
  retry: [
    { companion: "toto", text: "괜찮아요. 놓친 낱말부터 한 번 더 천천히 읽어 봐요.", tone: "support" },
    { companion: "momo", text: "괜찮아요. 숫자 단서와 무엇을 구하는지부터 다시 살펴봐요.", tone: "support" }
  ],
  "save-wait": [
    { companion: "lumi", text: "학습 기록을 확인하고 있어요. 결과가 올 때까지 잠깐 기다려 주세요.", tone: "status" }
  ],
  "idle-confirm": [
    { companion: "lumi", text: "계속할 수 있을까요? 생각 중이라면 그렇게 알려 주세요.", tone: "support" }
  ],
  "idle-paused": [
    { companion: "lumi", text: "학습을 잠시 멈췄어요. 준비되면 다시 시작할 수 있어요.", tone: "support" }
  ]
};

function stableIndex(key: string, length: number): number {
  let hash = 2166136261;
  for (const character of key) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % length;
}

export function selectCompanionCue(input: CueInput): CompanionCue {
  if (input.moment === "lesson-open" && input.delight !== undefined) {
    return { companion: input.delight.companion, text: input.delight.openingCue, tone: "humor" };
  }
  if (input.moment === "correct" && input.delight !== undefined) {
    return { companion: "bongbong", text: input.delight.celebrationCue, tone: "humor" };
  }
  const subjectCompanion = input.subject === "korean" ? "toto" : "momo";
  const requiredCompanion = input.preferredCompanion ?? (
    input.moment === "lesson-open" ||
    input.moment === "thinking" ||
    input.moment === "retry"
      ? subjectCompanion
      : undefined
  );
  const preferredCandidates = requiredCompanion === undefined
    ? CUES[input.moment]
    : CUES[input.moment].filter((cue) => cue.companion === requiredCompanion);
  const subjectCandidates = CUES[input.moment]
    .filter((cue) => cue.companion === subjectCompanion);
  const candidates = preferredCandidates.length > 0
    ? preferredCandidates
    : subjectCandidates.length > 0
      ? subjectCandidates
      : CUES[input.moment];
  return candidates[stableIndex(`${input.key}:${input.moment}`, candidates.length)]!;
}
```

- [ ] **Step 5: Run Task 1 tests and typecheck**

```bash
npx --yes -p node@22 -p npm@11.11.0 -- npm test -- tests/shared/companions.test.ts
npx --yes -p node@22 -p npm@11.11.0 -- npm run typecheck
```

Expected: new tests PASS and typecheck PASS.

- [ ] **Step 6: Commit Task 1**

```bash
git add src/shared/companions.ts src/shared/learning.ts src/client/companions/cast.ts src/client/companions/cues.ts tests/shared/companions.test.ts
git commit -m "feat: add magical companion cue contracts"
```

---

### Task 2: 한국어 유머 콘텐츠 v2와 안전한 seed 승격

**Files:**

- Modify: `src/server/db/seed.ts:1-335`
- Create: `src/server/db/seed-v1.ts`
- Modify: `tests/server/content-parity.test.ts:1-75`
- Modify: `tests/server/db.test.ts:35-75`
- Create: `tests/server/content-delight.test.ts`

**Interfaces:**

- Consumes: `LearningItemPayload.delight?` from Task 1
- Produces: `INITIAL_CONTENT_VERSION = 2`, `INITIAL_ITEMS` as the approved v2 payloads
- Preserves: every existing version 1 `content_versions` row and active version 3+ row; a fresh database receives the canonical unchanged v1 rows as well as active v2 rows.

- [ ] **Step 1: Write failing content quality tests**

Create `tests/server/content-delight.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  INITIAL_CONTENT_VERSION,
  INITIAL_ITEMS
} from "../../src/server/db/seed";

const ENGLISH_INSTRUCTION = /\b(?:read|look|find|add|slow|pause|sentence|number|finish)\b/i;
const FORBIDDEN_NAMES = /마이\s*리틀\s*포니|티니핑|시나모롤/i;
const CHILD_SHAMING = /바보|못하|틀렸잖|왜 이것도|느려|벌 받아/;

describe("approved magical companion seed content", () => {
  it("publishes exactly ten Korean and ten math v2 items", () => {
    expect(INITIAL_CONTENT_VERSION).toBe(2);
    expect(INITIAL_ITEMS.filter((item) => item.subject === "korean")).toHaveLength(10);
    expect(INITIAL_ITEMS.filter((item) => item.subject === "math")).toHaveLength(10);
  });

  it("gives every item distinct Korean delight copy and no commercial names", () => {
    const delight = INITIAL_ITEMS.map((item) => item.delight);
    expect(delight.every(Boolean)).toBe(true);
    expect(new Set(delight.map((entry) => entry!.mishap)).size).toBe(20);
    for (const item of INITIAL_ITEMS) {
      const childCopy = JSON.stringify({
        title: item.title,
        text: item.text,
        hint: item.hint,
        delight: item.delight,
        checkHint: item.kind === "math-story" ? item.checkHint : undefined
      });
      expect(childCopy).toMatch(/[가-힣]/);
      expect(childCopy).not.toMatch(ENGLISH_INSTRUCTION);
      expect(childCopy).not.toMatch(FORBIDDEN_NAMES);
      expect(childCopy).not.toMatch(CHILD_SHAMING);
      expect(childCopy).not.toMatch(/\bPASS\b|\bFAIL\b/);
    }
  });

  it("keeps every math answer, unit and scaffold internally consistent", () => {
    for (const item of INITIAL_ITEMS) {
      if (item.kind !== "math-story") continue;
      expect(item.text.match(/\d+/g)).toHaveLength(2);
      expect(item.question).toContain("몇");
      expect(item.unitLabel.length).toBeGreaterThan(0);
      expect(item.checkHint).toMatch(/[가-힣]/);
      expect(Number.isInteger(item.answer)).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Add failing version-promotion database tests**

In `tests/server/db.test.ts`, add tests that:

```ts
it("activates initial content version 2 without rewriting an existing v1", () => {
  const upgrade = openDatabase(":memory:");
  try {
    migrate(upgrade);
    seedInitialContent(upgrade);
    const v1Before = upgrade.prepare(`
      SELECT payload_json AS payloadJson FROM content_versions
      WHERE item_id = 'ko-01' AND version = 1
    `).get() as { payloadJson: string };
    const v2 = upgrade.prepare(`
      SELECT payload_json AS payloadJson FROM content_versions
      WHERE item_id = 'ko-01' AND version = 2
    `).get() as { payloadJson: string };

    upgrade.prepare("UPDATE content_items SET active_version = 1 WHERE id = 'ko-01'").run();
    upgrade.prepare("DELETE FROM content_versions WHERE item_id = 'ko-01' AND version = 2").run();

    seedInitialContent(upgrade);

    expect(upgrade.prepare(`
      SELECT active_version AS activeVersion FROM content_items WHERE id = 'ko-01'
    `).get()).toEqual({ activeVersion: 2 });
    expect(upgrade.prepare(`
      SELECT payload_json AS payloadJson FROM content_versions
      WHERE item_id = 'ko-01' AND version = 1
    `).get()).toEqual({ payloadJson: v1Before.payloadJson });
    expect(upgrade.prepare(`
      SELECT payload_json AS payloadJson FROM content_versions
      WHERE item_id = 'ko-01' AND version = 2
    `).get()).toEqual({ payloadJson: v2.payloadJson });
  } finally {
    upgrade.close();
  }
});

it("never downgrades guardian-authored active version 3", () => {
  const edited = openDatabase(":memory:");
  try {
    migrate(edited);
    seedInitialContent(edited);
    const v2 = edited.prepare(`
      SELECT payload_json AS payloadJson FROM content_versions
      WHERE item_id = 'ko-01' AND version = 2
    `).get() as { payloadJson: string };
    edited.prepare(`
      INSERT INTO content_versions (item_id, version, payload_json, created_at)
      VALUES ('ko-01', 3, ?, '2026-07-17T00:00:00.000Z')
    `).run(v2.payloadJson);
    edited.prepare("UPDATE content_items SET active_version = 3 WHERE id = 'ko-01'").run();

    seedInitialContent(edited);

    expect(edited.prepare(`
      SELECT active_version AS activeVersion FROM content_items WHERE id = 'ko-01'
    `).get()).toEqual({ activeVersion: 3 });
  } finally {
    edited.close();
  }
});
```

The first test removes only v2 and proves a repeated seed restores v2 while the canonical v1 bytes remain unchanged.

- [ ] **Step 3: Run the content tests and confirm RED**

```bash
npx --yes -p node@22 -p npm@11.11.0 -- npm test -- tests/server/content-delight.test.ts tests/server/db.test.ts tests/server/content-parity.test.ts
```

Expected: FAIL because `INITIAL_CONTENT_VERSION` and v2 delight copy do not exist and seed still creates active version 1.

- [ ] **Step 4: Replace the initial content with the exact approved story matrix**

Set `INITIAL_CONTENT_VERSION = 2`. Preserve IDs `ko-01..ko-10` and
`math-01..math-10`. For each ID, copy `kind`, `subject`, `unit`, `readLabel`
and `level` unchanged from its `INITIAL_ITEMS_V1` row; the ordered levels are
exactly `1단계, 1단계, 2단계, 2단계, 3단계, 3단계, 4단계, 4단계, 5단계,
5단계`. Replace only the table fields
below and add `delight` from the Mishap/Opening/Celebration columns. Set
`delight.companion` to `"toto"` for every `ko-*` row and `"momo"` for every
`math-*` row; celebration rendering still switches to Bongbong through the cue
engine and does not change this content owner field.

Korean items:

| ID | Title | Text | Hint | Tokens | Mishap | Opening | Celebration |
|---|---|---|---|---|---|---|---|
| ko-01 | 낱말 수첩이 풍덩 | 수달 또또는 새 낱말 수첩을 들고 연못가를 걸었어요. 그런데 재채기를 하자 수첩이 물에 풍덩 빠졌어요. | 마침표에서 잠깐 쉬며 두 문장으로 읽어 봐요. | 수달 또또, 낱말 수첩, 연못가, 재채기, 풍덩 | 또또의 수첩이 수영부터 배우겠대요. | 수첩보다 또또의 꼬리가 먼저 젖었대요. 낱말을 구하러 가 볼까요? | 낱말을 모두 건졌어요! 또또가 수첩에 수건을 덮어 줬어요. |
| ko-02 | 양말을 쓴 조개 | 또또는 물속에서 줄무늬 조개를 만났어요. 조개는 양말을 모자로 쓰고 아주 멋지다고 뽐냈어요. | 쉼표 없이 이어지는 짧은 문장을 천천히 읽어 봐요. | 물속, 줄무늬 조개, 양말, 모자, 뽐냈어요 | 조개가 양말을 모자라고 우기고 있어요. | 조개 모자가 자꾸 발가락을 찾는대요. 무슨 일이 있었는지 읽어 봐요. | 조개의 양말 모자가 반듯해졌어요! 또또가 박수를 쳤어요. |
| ko-03 | 콧수염이 된 미역 | 미역 한 줄기가 또또의 코에 착 붙었어요. 또또는 멋진 콧수염이라며 물속 거울 앞에서 빙글 돌았어요. | 받침이 있는 낱말을 또박또박 읽어 봐요. | 미역, 또또의 코, 콧수염, 물속 거울, 빙글 | 미역이 또또의 콧수염 자리를 차지했어요. | 또또의 콧수염이 바다 냄새를 폴폴 풍겨요. 천천히 따라가 봐요. | 미역 콧수염이 찰랑 인사했어요! 어려운 낱말도 잘 읽었어요. |
| ko-04 | 거꾸로 붙은 이름표 | 또또는 건져 낸 낱말에 이름표를 붙였어요. 하지만 이름표를 거꾸로 붙여서 돌멩이가 멩돌이가 되었어요. | 첫 문장과 둘째 문장의 일을 나누어 읽어 봐요. | 건져 낸, 낱말, 이름표, 거꾸로, 돌멩이 | 돌멩이 이름표가 거꾸로 매달렸어요. | 멩돌이가 누구일까요? 또또와 이름표를 바로 세워 봐요. | 이름표가 제자리를 찾았어요! 멩돌이도 다시 돌멩이가 되었어요. |
| ko-05 | 웃음 나는 우산 | 루미가 별 지팡이를 흔들자 작은 우산이 나타났어요. 우산은 빗방울 대신 간지러운 깃털을 내려 모두를 웃게 했어요. | 두 문장에서 누가 무엇을 했는지 찾아 읽어 봐요. | 별 지팡이, 작은 우산, 빗방울, 깃털, 웃게 했어요 | 우산에서 비 대신 간지러운 깃털이 내려요. | 루미의 우산이 날씨를 깜빡했대요. 어떤 비가 내리는지 읽어 봐요. | 깃털 비가 멈췄어요! 루미가 웃다가 지팡이를 놓칠 뻔했어요. |
| ko-06 | 문장 기차가 덜컹 | 또또는 낱말 카드를 이어 문장 기차를 만들었어요. 생선 카드가 기관사 자리에 앉자 기차가 연못 쪽으로 덜컹 달렸어요. | 긴 문장은 낱말 덩어리마다 짧게 숨을 쉬며 읽어요. | 낱말 카드, 문장 기차, 생선 카드, 기관사, 덜컹 | 생선 카드가 문장 기차의 기관사가 되었어요. | 기관사 생선이 연못으로 출발했대요. 문장 기차를 놓치지 말아요. | 문장 기차가 안전하게 도착했어요! 생선 기관사도 꾸벅 인사했어요. |
| ko-07 | 쉼표가 숨은 곳 | 문장 기차가 너무 빨리 달리자 쉼표가 모모의 꼬리 뒤에 숨었어요. 또또는 쉼표를 찾아 알맞은 자리에 살며시 앉혔어요. | 쉼표가 있다고 생각되는 곳에서 잠깐 쉬어 읽어 봐요. | 너무 빨리, 쉼표, 모모의 꼬리, 알맞은 자리, 살며시 | 쉼표가 모모의 꼬리 뒤에서 숨바꼭질해요. | 문장 기차가 숨도 안 쉬고 달려요. 쉼표를 찾아 천천히 읽어 봐요. | 쉼표가 의자처럼 편히 앉았어요! 문장도 숨을 골랐어요. |
| ko-08 | 루미의 양말 주문 | 루미는 젖은 수첩을 말리려고 별 주문을 외웠어요. 주문을 한 글자 틀리자 하늘에서 줄무늬 양말 열 켤레가 쏟아졌어요. | 원인과 결과가 나타나는 두 문장을 이어서 읽어 봐요. | 젖은 수첩, 별 주문, 한 글자, 줄무늬 양말, 쏟아졌어요 | 별 주문이 양말 배달 주문으로 바뀌었어요. | 루미가 글자 하나를 놓쳤대요. 하늘에서 무엇이 왔는지 확인해 봐요. | 주문을 정확히 읽었어요! 양말들은 구름 빨랫줄에 얌전히 앉았어요. |
| ko-09 | 봉봉의 비눗방울 편지 | 봉봉은 수첩을 말리는 불꽃을 보내려고 깊이 숨을 들이마셨어요. 입에서는 불꽃 대신 글자가 든 비눗방울이 몽글몽글 나왔어요. | 모습이 떠오르도록 꾸며 주는 낱말에 힘을 주어 읽어 봐요. | 수첩, 불꽃, 깊이, 글자가 든, 몽글몽글 | 봉봉의 불꽃이 글자 비눗방울로 변했어요. | 봉봉이 크게 숨을 들이마셨어요. 이번에는 무엇이 나올까요? | 글자 비눗방울이 반짝 터졌어요! 봉봉은 불꽃보다 멋지다며 뿌듯해했어요. |
| ko-10 | 젖지 않는 수첩의 비밀 | 친구들이 모은 글자 비눗방울이 수첩 위에서 별빛으로 터졌어요. 수첩은 물에 젖지 않는 마법 수첩이 되었고 또또는 기뻐서 꼬리로 물장구를 쳤어요. | 이야기의 마지막 장면을 떠올리며 끝까지 또박또박 읽어요. | 글자 비눗방울, 별빛, 마법 수첩, 기뻐서, 물장구 | 또또가 꼬리로 축하 물장구를 너무 크게 쳤어요. | 드디어 수첩의 마지막 비밀이에요. 친구들의 글자가 어떤 마법을 만들까요? | 마법 수첩이 완성됐어요! 또또의 물장구에 모두 다시 젖을 뻔했어요. |

Math items:

| ID | Title | Text | Question | Hint | Answer/Unit | Check hint | Mishap | Opening | Celebration |
|---|---|---|---|---|---|---|---|---|---|
| math-01 | 포도알 주판 | 모모는 주판에 보라 포도알 8개를 올렸어요. 초록 포도알 7개도 더 올렸어요. | 주판 위 포도알은 모두 몇 개일까요? | 숫자 8과 7을 먼저 찾아봐요. | 15개 | 보라 포도알 8개와 초록 포도알 7개를 더해 봐요. | 모모가 주판 알 대신 포도알을 올렸어요. | 포도알 하나가 계산 전에 도망가려 해요. 8과 7을 잘 지켜봐요. | 15개를 모두 찾았어요! 모모가 포도알 주판을 먹지 않고 참았어요. |
| math-02 | 꼬리 리본 세기 | 친구들이 모모의 꼬리에 파란 리본 9개를 묶었어요. 노란 리본 5개도 더 묶었어요. | 모모의 꼬리에 묶인 리본은 모두 몇 개일까요? | 파란 리본과 노란 리본의 수를 찾아봐요. | 14개 | 파란 리본 9개와 노란 리본 5개를 더해 봐요. | 리본이 많아져서 모모의 꼬리가 부채가 되었어요. | 모모의 꼬리가 오늘따라 아주 화려해요. 리본을 세어 볼까요? | 리본 14개를 셌어요! 모모의 꼬리가 신나서 살랑살랑 흔들려요. |
| math-03 | 주판 알의 낮잠 | 주판 위에 깨어 있는 알 10개가 있었어요. 낮잠에서 깬 알 6개가 옆으로 굴러왔어요. | 깨어 있는 주판 알은 모두 몇 개일까요? | 처음 있던 10개와 새로 온 6개를 찾아봐요. | 16개 | 주판 알 10개와 6개를 더해 봐요. | 주판 알들이 계산 시간에 낮잠을 잤어요. | 코 고는 주판 알 6개가 이제 막 깨어났대요. 모두 몇 개가 될까요? | 16개가 모두 깨어났어요! 모모가 주판에 작은 베개를 치웠어요. |
| math-04 | 양말을 신은 숫자 | 숫자 카드 12장이 줄을 서 있었어요. 루미가 양말을 신긴 카드 4장도 더 왔어요. | 줄을 선 숫자 카드는 모두 몇 장일까요? | 줄에 있던 12장과 더 온 4장을 찾아봐요. | 16장 | 숫자 카드 12장과 양말 카드 4장을 더해 봐요. | 숫자 카드 네 장이 양말을 신고 미끄러져 왔어요. | 양말 신은 숫자들이 줄에서 자꾸 미끄러져요. 놓치지 말고 세어 봐요. | 카드 16장이 줄을 섰어요! 양말 카드도 미끄럼을 멈췄어요. |
| math-05 | 비눗방울 덧셈 | 봉봉이 큰 비눗방울 11개를 만들었어요. 작은 비눗방울 8개도 몽글몽글 나왔어요. | 비눗방울은 모두 몇 개일까요? | 큰 방울 11개와 작은 방울 8개를 찾아봐요. | 19개 | 큰 비눗방울 11개와 작은 비눗방울 8개를 더해 봐요. | 봉봉의 비눗방울이 왕관 모양으로 줄을 섰어요. | 큰 방울과 작은 방울이 서로 자기가 왕관이래요. 모두 세어 볼까요? | 19개를 찾았어요! 마지막 방울이 봉봉 코에 톡 붙었어요. |
| math-06 | 거꾸로 켜진 등불 | 파란 집에 노란 등불 13개가 켜졌어요. 모모가 초록 등불 5개를 더 켰어요. | 켜진 등불은 모두 몇 개일까요? | 노란 등불과 초록 등불을 나누어 찾아봐요. | 18개 | 노란 등불 13개와 초록 등불 5개를 더해 봐요. | 모모가 등불 하나를 거꾸로 달아 바닥이 환해졌어요. | 천장보다 바닥이 더 밝아졌대요. 그래도 등불 수는 정확히 셀 수 있어요. | 등불 18개가 반짝여요! 거꾸로 등불도 제자리를 찾았어요. |
| math-07 | 숲속 간식 배달 | 또또의 바구니에 조개 과자 7개가 있었어요. 루미가 당근 과자 12개를 더 가져왔어요. | 바구니 속 과자는 모두 몇 개일까요? | 조개 과자와 당근 과자의 수를 찾아봐요. | 19개 | 조개 과자 7개와 당근 과자 12개를 더해 봐요. | 모모가 과자 하나를 주판 알로 쓰려 했어요. | 과자는 먹기 전에 계산부터 해야 한대요. 두 바구니를 살펴봐요. | 과자 19개를 정확히 셌어요! 모모가 주판 대신 접시를 가져왔어요. |
| math-08 | 별 계단 세 칸 | 친구들이 빛나는 계단 14칸을 만들었어요. 봉봉의 재채기로 계단 3칸이 더 생겼어요. | 빛나는 계단은 모두 몇 칸일까요? | 처음 14칸과 새로 생긴 3칸을 찾아봐요. | 17칸 | 빛나는 계단 14칸과 3칸을 더해 봐요. | 봉봉이 재채기할 때마다 계단이 한 칸씩 생겼어요. | 봉봉이 에취에취 재채기하자 계단 세 칸이 더 생겼대요. 모두 몇 칸일까요? | 계단 17칸을 완성했어요! 봉봉은 재채기에도 꾸벅 인사했어요. |
| math-09 | 의자가 된 숫자 카드 | 광장에 작은 의자 6개가 있었어요. 숫자 카드가 접혀서 의자 13개로 더 변했어요. | 광장의 의자는 모두 몇 개일까요? | 처음 의자 6개와 카드 의자 13개를 찾아봐요. | 19개 | 작은 의자 6개와 카드 의자 13개를 더해 봐요. | 숫자 카드들이 공부보다 먼저 의자에 앉았어요. | 숫자 카드가 스스로 의자가 되었대요. 앉기 전에 모두 세어 봐요. | 의자 19개를 찾았어요! 숫자 카드도 바른 자세로 앉았어요. |
| math-10 | 우당탕 축하 모자 | 봉봉이 별 모자 15개를 쌓았어요. 루미의 지팡이에서 양말 모자 5개가 더 나왔어요. | 축하 모자는 모두 몇 개일까요? | 별 모자 15개와 양말 모자 5개를 찾아봐요. | 20개 | 별 모자 15개와 양말 모자 5개를 더해 봐요. | 루미의 지팡이가 모자 대신 양말을 또 만들었어요. | 별 모자와 양말 모자가 한 줄로 행진해요. 모두 몇 개인지 알아볼까요? | 모자 20개를 셌어요! 봉봉은 양말 모자를 쓰고도 아주 신났어요. |

Use these exact math token arrays:

```ts
const MATH_TOKENS = {
  "math-01": ["모모", "보라 포도알", "8개", "초록 포도알", "7개", "모두"],
  "math-02": ["모모의 꼬리", "파란 리본", "9개", "노란 리본", "5개", "모두"],
  "math-03": ["주판", "깨어 있는 알", "10개", "낮잠", "6개", "모두"],
  "math-04": ["숫자 카드", "12장", "양말", "4장", "줄", "모두"],
  "math-05": ["봉봉", "큰 비눗방울", "11개", "작은 비눗방울", "8개", "모두"],
  "math-06": ["파란 집", "노란 등불", "13개", "초록 등불", "5개", "모두"],
  "math-07": ["또또", "조개 과자", "7개", "당근 과자", "12개", "모두"],
  "math-08": ["빛나는 계단", "14칸", "봉봉", "재채기", "3칸", "모두"],
  "math-09": ["광장", "작은 의자", "6개", "숫자 카드", "13개", "모두"],
  "math-10": ["봉봉", "별 모자", "15개", "양말 모자", "5개", "모두"]
} as const;
```

For every Korean row use the exact five token phrases in its table.

- [ ] **Step 5: Implement version 2 insertion and monotonic promotion**

In `src/server/db/seed.ts`:

```ts
export const INITIAL_CONTENT_VERSION = 2;
```

Move the current pre-Task-2 `INITIAL_ITEMS` array byte-for-byte into
`src/server/db/seed-v1.ts` as `INITIAL_ITEMS_V1`. Do not edit its English hints
because the file is an immutable historical payload, not active child copy.
`src/server/db/seed.ts` imports both `INITIAL_ITEMS_V1` and the new
`INITIAL_ITEMS`.

Change `insertItem` to use `@activeVersion`, change `insertVersion` to use
`@version`, and add:

```ts
const promoteInitialItem = db.prepare(`
  UPDATE content_items
  SET active_version = @version
  WHERE id = @itemId AND active_version = 1
`);
```

Inside the existing transaction, for each new v2 item, find its same-ID v1
entry and run in this exact order:

```ts
insertItem.run({
  id: item.id,
  skillId,
  subject: item.subject,
  activeVersion: INITIAL_CONTENT_VERSION,
  createdAt
});
insertVersion.run({
  itemId: legacyItem.id,
  version: 1,
  payloadJson: JSON.stringify(legacyItem),
  createdAt
});
insertVersion.run({
  itemId: item.id,
  version: INITIAL_CONTENT_VERSION,
  payloadJson: JSON.stringify(item),
  createdAt
});
promoteInitialItem.run({
  itemId: item.id,
  version: INITIAL_CONTENT_VERSION
});
```

Throw `INITIAL_CONTENT_V1_MISSING:<itemId>` when an ID has no canonical v1
entry. `INSERT OR IGNORE` remains mandatory for both item and version. Do not update
`content_versions.payload_json` and do not use `INSERT OR REPLACE`.

- [ ] **Step 6: Extend the preserved v1 payload manifest with a v2 contract**

Keep the icon hashes and the 20 old payload hashes in
`tests/server/content-parity.test.ts`, but compute the old hashes from
`INITIAL_ITEMS_V1`. Add assertions for the exact ordered v2 IDs, active content
version 2, exact titles from the tables, and `LearningItemPayloadSchema.parse`
round trips. This preserves the retired prototype as canonical v1 while making
the approved humorous copy canonical v2.

- [ ] **Step 7: Run Task 2 tests and affected server suites**

```bash
npx --yes -p node@22 -p npm@11.11.0 -- npm test -- \
  tests/server/content-delight.test.ts \
  tests/server/content-parity.test.ts \
  tests/server/db.test.ts \
  tests/server/learning.test.ts \
  tests/server/star-learning.test.ts \
  tests/server/star-maintenance.test.ts \
  tests/server/backup.test.ts
```

Expected: all listed suites PASS. If an assertion hard-codes version 1 for
fresh seed content, update it to `INITIAL_CONTENT_VERSION`; do not change tests
for deliberately constructed historical v1 plans or attempts.

- [ ] **Step 8: Commit Task 2**

```bash
git add src/server/db/seed.ts src/server/db/seed-v1.ts tests/server/content-delight.test.ts tests/server/content-parity.test.ts tests/server/db.test.ts tests/server/learning.test.ts tests/server/star-learning.test.ts tests/server/star-maintenance.test.ts tests/server/backup.test.ts
git commit -m "feat: publish humorous Korean and math content v2"
```

---

### Task 3: 오리지널 SVG 자산과 접근 가능한 친구 컴포넌트

**Files:**

- Create: `public/assets/companions/lumi.svg`
- Create: `public/assets/companions/toto.svg`
- Create: `public/assets/companions/momo.svg`
- Create: `public/assets/companions/bongbong.svg`
- Create: `scripts/generate-companion-assets.mjs`
- Create: `src/client/companions/companion-avatar.tsx`
- Create: `src/client/companions/friend-stage.tsx`
- Modify: `vite.config.ts:23-45`
- Modify: `tests/offline/pwa-config.test.ts`
- Create: `tests/client/companion-components.test.tsx`
- Modify: `src/client/styles/tokens.css`
- Modify: `src/client/styles/components.css`

**Interfaces:**

- Consumes: `CompanionId`, `COMPANION_CAST`, `selectCompanionCue`
- Produces: `<CompanionAvatar id size />`, `<FriendStage ... />`, `<FriendTrail ... />`
- Produces static paths already declared in `COMPANION_CAST`.

- [ ] **Step 1: Write failing asset and component tests**

Create `tests/client/companion-components.test.tsx` in jsdom. Tests must:

```ts
// @vitest-environment jsdom
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  cleanup,
  fireEvent,
  render,
  screen
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CompanionAvatar } from "../../src/client/companions/companion-avatar";
import { COMPANION_CAST } from "../../src/client/companions/cast";
import { FriendStage } from "../../src/client/companions/friend-stage";

afterEach(cleanup);

it.each(["lumi", "toto", "momo", "bongbong"] as const)(
  "renders accessible original art and a text fallback for %s",
  async (id) => {
    const { container } = render(<CompanionAvatar id={id} size="large" />);
    const image = screen.getByRole("img", { name: COMPANION_CAST[id].alt });
    expect(image).toHaveAttribute("src", COMPANION_CAST[id].asset);
    fireEvent.error(image);
    expect(container.querySelector(`[data-companion-fallback="${id}"]`))
      .toBeVisible();
    expect(screen.getByRole("img", { name: COMPANION_CAST[id].alt }))
      .toHaveAttribute("data-companion-fallback", id);
  }
);

it("renders four friends but only one active speech bubble", () => {
  render(<FriendStage
    studyDate="2026-07-17"
    itemId="ko-01"
    subject="korean"
    completedCount={0}
    totalCount={4}
  />);
  expect(screen.getAllByRole("img")).toHaveLength(4);
  expect(screen.getAllByRole("status", { name: "마법 친구 말풍선" }))
    .toHaveLength(1);
  expect(screen.getByText("국어와 낱말 친구")).toBeVisible();
});
```

Add a Node test that reads every SVG and asserts:

```ts
it("keeps local SVG art inside the approved security and byte budgets", async () => {
  const sources = await Promise.all(
    (["lumi", "toto", "momo", "bongbong"] as const).map((id) =>
      readFile(resolve(`public/assets/companions/${id}.svg`), "utf8")
    )
  );
  for (const source of sources) {
    expect(source).toContain('viewBox="0 0 240 240"');
    expect(source).not.toMatch(
      /<script|<foreignObject|onload=|(?:href|src)=["']https?:/i
    );
    expect(Buffer.byteLength(source)).toBeLessThanOrEqual(180_000);
  }
  expect(sources.reduce(
    (total, source) => total + Buffer.byteLength(source),
    0
  )).toBeLessThanOrEqual(600_000);
});
```

In `tests/offline/pwa-config.test.ts`, replace the old landscape-only manifest
test with a RED assertion for `orientation: "any"` and an assertion that
`orientation: "landscape"` is absent. This makes the installable PWA honor both
approved Galaxy Tab orientations.

- [ ] **Step 2: Run Task 3 tests and confirm RED**

```bash
npx --yes -p node@22 -p npm@11.11.0 -- npm test -- tests/client/companion-components.test.tsx tests/offline/pwa-config.test.ts
```

Expected: FAIL because assets and components do not exist and the PWA glob does
not include nested companion SVGs.

- [ ] **Step 3: Create the reproducible original SVG generator and run it**

Create `scripts/generate-companion-assets.mjs` exactly as follows, then run it.
The abstract notebook marks are paths rather than embedded text and every asset
uses only local SVG geometry.

```js
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const outline = "#5a4a6f";
const wrap = (body) => `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240">
  <g stroke="${outline}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">
    ${body}
  </g>
</svg>\n`;

const assets = {
  lumi: wrap(`
    <path fill="#a98bd7" d="M62 217c5-47 29-72 58-72s53 25 58 72z"/>
    <ellipse fill="#fff1dc" cx="120" cy="126" rx="61" ry="57"/>
    <ellipse fill="#f7eaff" cx="87" cy="58" rx="22" ry="48" transform="rotate(-10 87 58)"/>
    <ellipse fill="#ffd9d1" cx="87" cy="58" rx="9" ry="32" transform="rotate(-10 87 58)"/>
    <ellipse fill="#f7eaff" cx="151" cy="55" rx="21" ry="47" transform="rotate(12 151 55)"/>
    <ellipse fill="#ffd9d1" cx="151" cy="55" rx="9" ry="31" transform="rotate(12 151 55)"/>
    <circle fill="#5a4a6f" stroke="none" cx="98" cy="124" r="5"/>
    <circle fill="#5a4a6f" stroke="none" cx="142" cy="124" r="5"/>
    <path fill="none" d="M108 143q12 12 24 0"/>
    <path fill="#ffd96a" d="m194 89 7 14 16 2-12 11 3 16-14-8-14 8 3-16-12-11 16-2z"/>
    <path fill="none" d="m190 127-27 75"/>
    <path fill="#d8f2ff" d="M184 39q19-8 29 6l-8 18q-18-3-31 8l-8-17q9-10 18-15z"/>
    <path fill="none" d="m177 49 27 7m-31 4 27 7"/>
  `),
  toto: wrap(`
    <path fill="#9a6248" d="M60 209q-17-33 6-57l31 20-8 42z"/>
    <ellipse fill="#a96f4f" cx="124" cy="154" rx="61" ry="67"/>
    <circle fill="#b87d59" cx="120" cy="90" r="57"/>
    <circle fill="#b87d59" cx="75" cy="55" r="18"/><circle fill="#b87d59" cx="165" cy="55" r="18"/>
    <ellipse fill="#f4d5b8" cx="120" cy="107" rx="40" ry="29"/>
    <circle fill="#5a4a6f" stroke="none" cx="98" cy="84" r="5"/>
    <circle fill="#5a4a6f" stroke="none" cx="142" cy="84" r="5"/>
    <ellipse fill="#5a4a6f" stroke="none" cx="120" cy="103" rx="7" ry="5"/>
    <path fill="none" d="M109 113q11 11 22 0"/>
    <rect fill="#bcebd9" x="102" y="145" width="76" height="61" rx="8"/>
    <path fill="none" d="M120 163h22m-22 14h34m-34 14h26"/>
    <path fill="#ef9b8f" d="M175 173l25-28 10 9-27 26z"/>
    <path fill="#ffd4a3" d="m200 145 8-11 5 14z"/>
  `),
  momo: wrap(`
    <path fill="#8c7c82" d="M172 153q53 7 42 44-8 29-53 11 30-9 16-27-9-12-29-12z"/>
    <path fill="none" d="M178 166q19 4 30 18m-38 1q20 2 34 18"/>
    <ellipse fill="#94868b" cx="116" cy="158" rx="59" ry="65"/>
    <circle fill="#a4999d" cx="116" cy="91" r="57"/>
    <path fill="#625b68" d="M72 78q23-31 44-7-18 30-45 25z"/>
    <path fill="#625b68" d="M160 78q-23-31-44-7 18 30 45 25z"/>
    <path fill="#a4999d" d="m72 50 10-30 28 28zm88 0-10-30-28 28z"/>
    <circle fill="#fff" cx="94" cy="82" r="10"/><circle fill="#fff" cx="138" cy="82" r="10"/>
    <circle fill="#5a4a6f" stroke="none" cx="94" cy="82" r="5"/><circle fill="#5a4a6f" stroke="none" cx="138" cy="82" r="5"/>
    <ellipse fill="#5a4a6f" stroke="none" cx="116" cy="105" rx="7" ry="5"/>
    <path fill="none" d="M105 116q11 10 22 0"/>
    <path fill="#a6dcf5" d="M65 154h84v58H65z"/>
    <path fill="#ffd96a" d="M76 162h60v30H76z"/>
    <path fill="none" d="M86 168v18m20-18v18m20-18v18"/>
    <circle fill="#9b65b5" cx="86" cy="174" r="7"/><circle fill="#9b65b5" cx="106" cy="181" r="7"/><circle fill="#9b65b5" cx="126" cy="173" r="7"/>
  `),
  bongbong: wrap(`
    <path fill="#6fd0c2" d="M72 145q-39-16-47 20 24-7 45 19zm96 0q39-16 47 20-24-7-45 19z"/>
    <ellipse fill="#f4a78e" cx="120" cy="158" rx="58" ry="65"/>
    <circle fill="#ffb39c" cx="120" cy="92" r="55"/>
    <path fill="#fff1dc" d="m78 52 6-29 21 26zm84 0-6-29-21 26z"/>
    <circle fill="#5a4a6f" stroke="none" cx="99" cy="87" r="5"/><circle fill="#5a4a6f" stroke="none" cx="141" cy="87" r="5"/>
    <path fill="none" d="M108 110q12 12 24 0"/>
    <path fill="#ffd96a" d="m87 41 8-28 25 17 24-17 9 28-33-8z" transform="rotate(12 120 30)"/>
    <circle fill="#d7f4ff" fill-opacity=".72" cx="183" cy="75" r="21"/>
    <circle fill="#e9ddff" fill-opacity=".72" cx="208" cy="112" r="14"/>
    <circle fill="#fff2b9" fill-opacity=".8" cx="178" cy="125" r="11"/>
    <path fill="#ffd96a" d="m182 66 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z" stroke-width="2"/>
  `)
};

const output = resolve("public/assets/companions");
await mkdir(output, { recursive: true });
await Promise.all(Object.entries(assets).map(([id, svg]) =>
  writeFile(resolve(output, `${id}.svg`), svg, "utf8")
));
```

Run:

```bash
npx --yes -p node@22 -- node scripts/generate-companion-assets.mjs
```

Expected: four deterministic SVG files are created under
`public/assets/companions/` and satisfy the asset tests.

- [ ] **Step 4: Implement `CompanionAvatar`**

```tsx
import { useState } from "react";
import type { CompanionId } from "../../shared/companions";
import { COMPANION_CAST } from "./cast";

export function CompanionAvatar({
  id,
  size = "medium",
  decorative = false
}: {
  id: CompanionId;
  size?: "small" | "medium" | "large";
  decorative?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const friend = COMPANION_CAST[id];
  if (failed) {
    return <span
      className={`companion-avatar companion-avatar--${size} companion-avatar--${friend.accent}`}
      role={decorative ? undefined : "img"}
      aria-hidden={decorative || undefined}
      aria-label={decorative ? undefined : friend.alt}
      data-companion-fallback={id}
    >{friend.name.slice(-2, -1)}</span>;
  }
  return <img
    className={`companion-avatar companion-avatar--${size}`}
    src={friend.asset}
    alt={decorative ? "" : friend.alt}
    onError={() => setFailed(true)}
  />;
}
```

- [ ] **Step 5: Implement `FriendStage` and `FriendTrail`**

`FriendStage` uses this exact interface:

```ts
export function FriendStage({
  studyDate,
  itemId,
  subject,
  completedCount,
  totalCount
}: {
  studyDate: string;
  itemId: string | null;
  subject: "korean" | "math" | null;
  completedCount: number;
  totalCount: number;
}): JSX.Element
```

It chooses `lumi` when `totalCount === 0`, `toto` for Korean, `momo` for math
and `bongbong` only when `totalCount > 0 && completedCount >= totalCount`.
Use this exact selection expression:

```ts
const activeCompanion: CompanionId = totalCount === 0
  ? "lumi"
  : completedCount >= totalCount
    ? "bongbong"
    : subject === "math"
      ? "momo"
      : "toto";
```

Pass that ID as `preferredCompanion` to `selectCompanionCue`, using
`subject ?? "korean"` only as its required technical fallback and
`${studyDate}:${itemId ?? "rest-day"}` as the stable key. Render all four
avatars in a list, mark one item with `aria-current="true"`, and render one
`role="status" aria-label="마법 친구 말풍선"`. Use `home-welcome` when
completedCount is 0, otherwise `home-return`. On a zero-required rest day also
render `오늘은 쉬는 날이에요` outside the single speech bubble; never label
Bongbong current for `0/0`.

`FriendTrail` has this exact interface:

```ts
export function FriendTrail({
  completedCount,
  totalCount,
  metCompanions
}: {
  completedCount: number;
  totalCount: number;
  metCompanions: CompanionId[];
}): JSX.Element
```

It displays `오늘 함께한 친구`, unique character names, and
`마법 걸음 ${completedCount}/${totalCount}` without deriving stars. When
`totalCount === 0`, it displays `오늘은 쉬는 날` and an empty met-companion
list without treating the day as completed.

- [ ] **Step 6: Add styles and PWA precache**

Add tokens `--sky`, `--coral`, `--grape`, `--companion-outline`. Add CSS for
`.friend-stage`, `.friend-stage__cast`, `.friend-stage__speaker`,
`.companion-avatar`, `.companion-bubble`, `.friend-trail`. Every cast button-like
surface is noninteractive unless it has an action; do not create fake buttons.

In `vite.config.ts` add:

```ts
"assets/companions/*.svg",
```

to `injectManifest.globPatterns`. Update the PWA test to require this exact
pattern. Change the manifest from `orientation: "landscape"` to
`orientation: "any"`; the PWA test must require `any` and reject the old fixed
landscape value.

- [ ] **Step 7: Run Task 3 tests and builds**

```bash
npx --yes -p node@22 -p npm@11.11.0 -- npm test -- tests/client/companion-components.test.tsx tests/offline/pwa-config.test.ts
npx --yes -p node@22 -p npm@11.11.0 -- npm run build:client
```

Expected: tests PASS, companion SVGs appear in the PWA precache output, and the
combined asset budget test passes.

- [ ] **Step 8: Commit Task 3**

```bash
git add scripts/generate-companion-assets.mjs public/assets/companions src/client/companions/companion-avatar.tsx src/client/companions/friend-stage.tsx src/client/styles/tokens.css src/client/styles/components.css vite.config.ts tests/client/companion-components.test.tsx tests/offline/pwa-config.test.ts
git commit -m "feat: add original magical animal friend stage"
```

---

### Task 4: 학생 홈의 친구 쉼터와 우당탕 학습 카드

**Files:**

- Modify: `src/client/home/student-home.tsx:1-305`
- Modify: `src/client/delight/today-stars.tsx`
- Modify: `tests/helpers/client.ts:1-100`
- Modify: `tests/client/login-and-home.test.tsx`
- Modify: `src/client/styles/components.css`
- Modify: `src/client/styles/layout.css`
- Modify: `src/client/styles/responsive.css`

**Interfaces:**

- Consumes: `FriendStage`, `FriendTrail`, `CompanionAvatar`, optional payload `delight`
- Preserves: `StudentHome` owns plan, star, queue, recovery and selected-item state.

- [ ] **Step 1: Write failing home experience tests**

Add tests to `tests/client/login-and-home.test.tsx` that authenticate with the
existing fake API and assert:

```ts
expect(await screen.findByRole("heading", { name: "오늘의 학습" })).toBeVisible();
expect(screen.getByRole("complementary", { name: "마법 친구 쉼터" })).toBeVisible();
expect(screen.getByText("별토끼 루미")).toBeVisible();
expect(screen.getByText("수달 또또")).toBeVisible();
expect(screen.getByText("너구리 모모")).toBeVisible();
expect(screen.getByText("아기용 봉봉")).toBeVisible();
expect(screen.getAllByRole("status", { name: "마법 친구 말풍선" })).toHaveLength(1);
```

For a delighted Korean card assert `오늘의 우당탕 사건`, its exact `mishap`,
`수달 또또`, the existing star copy and the start button. For a legacy card
without delight assert it still renders with the subject default companion and
without crashing. For all-completed required items assert Bongbong is current,
`마법 걸음 4/4` and `함께 해결했어요` appear without a second star promise.
Add a rest-day plan with `requiredItemIds: []`; assert the home does not crash,
Lumi is current, `오늘은 쉬는 날이에요` and `마법 걸음 0/0` are visible, and
Bongbong is not current.

Update the CSS source test to require:

```ts
expect(layout).toMatch(/grid-template-columns:\s*260px\s+minmax\(0,\s*1fr\)\s+240px/);
expect(layout).toMatch(/\.student-shell__main[^{]*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+240px/s);
expect(responsive).toContain(".friend-stage__cast");
expect(responsive).not.toMatch(/\.friend-stage\s*\{[^}]*display:\s*none/s);
expect(responsive).toMatch(/max-width:\s*850px/);
```

- [ ] **Step 2: Run home tests and confirm RED**

```bash
npx --yes -p node@22 -p npm@11.11.0 -- npm test -- tests/client/login-and-home.test.tsx
```

Expected: new friend-stage, mishap and trail assertions FAIL.

- [ ] **Step 3: Make the fake plan carry one delighted Korean and math item**

In `tests/helpers/client.ts`, keep legacy optional items but give `ko-01` a
`toto` delight and `math-01` a `momo` delight. Use the exact v2 phrases from
Task 2 so component tests exercise the production schema rather than a weaker
shape.

- [ ] **Step 4: Integrate the friend stage in `StudentHome`**

Derive:

```ts
const completedRequiredCount = requiredItems.filter((item) =>
  data.plan.completedItemIds.includes(item.id)
).length;
const nextRequired = requiredItems.find((item) =>
  !data.plan.completedItemIds.includes(item.id)
) ?? requiredItems[0] ?? null;
const metCompanions = Array.from(new Set(data.plan.completedItemIds.flatMap((id) => {
  const item = data.plan.items.find((candidate) => candidate.id === id);
  return item === undefined
    ? []
    : [item.payload.delight?.companion ?? (item.payload.subject === "korean" ? "toto" : "momo")];
}))) as CompanionId[];
```

Replace `StarBunny` with `FriendStage` in the left aside. Pass the plan date,
`nextRequired?.id ?? null`, `nextRequired?.payload.subject ?? null`, completed
count and required count. Render `FriendTrail` below `TodayStars` in the right
aside.

Each study card renders a small decorative `CompanionAvatar`, the companion
name and, only when `delight` exists, a block labelled `오늘의 우당탕 사건` with
`mishap`. Completed cards show `함께 해결했어요`; keep existing
`★ 받은 별 1개` and never render `완료하면 별 1개` on completed cards.

- [ ] **Step 5: Implement 13-inch and portrait layout**

Change the outer desktop columns to `260px minmax(0, 1fr) 240px` and let
`.student-shell__main` span the center and right outer columns. Move the single
real `student-shell__right` aside inside `<main>`, between the required and
optional sections in DOM order. Make main a nested grid with columns
`minmax(0, 1fr) 240px`: intro/required/optional occupy column one and the right
aside occupies column two. This preserves one accessible star summary while
giving portrait the required DOM order without duplicate hidden markup.

The desktop grid skeleton is:

```css
.student-shell {
  grid-template-columns: 260px minmax(0, 1fr) 240px;
  grid-template-areas: "header header header" "left main main";
}
.student-shell__main {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 240px;
  grid-template-areas:
    "intro right"
    "required right"
    "optional right";
  gap: 22px;
}
```

At max-width 950px, keep the left friend rail and change the nested main to one
column ordered intro, required, right, optional. At max-width 850px, and also
for `(orientation: portrait) and (max-width: 1000px)`, use one outer column and
place the friend stage as a horizontal strip above main instead of hiding it:

```css
.student-shell {
  grid-template-areas: "header" "left" "main";
}
.student-shell__left { display: block; position: static; }
.student-shell__main {
  grid-template-columns: minmax(0, 1fr);
  grid-template-areas: "intro" "required" "right" "optional";
}
.friend-stage__cast { grid-template-columns: repeat(4, minmax(0, 1fr)); }
```

Give the intro wrapper, required section, right aside and optional section those
exact grid-area names. Ensure long bubbles wrap with `overflow-wrap: anywhere`
and no fixed height. This exact rule must activate for the 800×1280 QA viewport
so its visual and DOM order is header, friend strip, required, star/trail,
optional.

- [ ] **Step 6: Run Task 4 tests and related offline home tests**

```bash
npx --yes -p node@22 -p npm@11.11.0 -- npm test -- \
  tests/client/login-and-home.test.tsx \
  tests/client/auth-offline-lifecycle.test.tsx \
  tests/client/companion-components.test.tsx
```

Expected: all pass, including existing queue/star/authority assertions.

- [ ] **Step 7: Commit Task 4**

```bash
git add src/client/home/student-home.tsx src/client/delight/today-stars.tsx tests/helpers/client.ts tests/client/login-and-home.test.tsx src/client/styles/components.css src/client/styles/layout.css src/client/styles/responsive.css
git commit -m "feat: make the student home a magical friend room"
```

---

### Task 5: 국어·수학 문제 분절과 단계별 도움

**Files:**

- Create: `src/client/learning/problem-breakdown.ts`
- Create: `src/client/learning/problem-breakdown-view.tsx`
- Create: `tests/client/problem-breakdown.test.tsx`
- Modify: `src/client/styles/components.css`

**Interfaces:**

- Produces: `splitKoreanSentences(text)`, `extractNumberClues(text)`, `mathScaffold(item, retryCount)`
- Produces: `<ProblemBreakdown item mathRetryCount showMathScaffold />`
- Preserves: original `item.text`, `tokens`, `answer` and `question` passed to server and reading judge.

- [ ] **Step 1: Write failing pure and component tests**

Create `tests/client/problem-breakdown.test.tsx`:

```ts
// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ProblemBreakdown } from "../../src/client/learning/problem-breakdown-view";
import {
  extractNumberClues,
  mathScaffold,
  splitKoreanSentences
} from "../../src/client/learning/problem-breakdown";
import type { LearningItemPayload } from "../../src/shared/learning";

afterEach(cleanup);

const mathItem: Extract<LearningItemPayload, { kind: "math-story" }> = {
  id: "math-test",
  kind: "math-story",
  subject: "math",
  unit: "덧셈",
  title: "등불을 세어요",
  level: "2단계",
  readLabel: "수학 이야기를 읽어요",
  text: "파란 집에 노란 등불 13개가 있어요. 초록 등불 5개도 켰어요.",
  hint: "두 수를 먼저 찾아봐요.",
  tokens: ["파란 집", "노란 등불", "13개", "초록 등불", "5개", "모두"],
  question: "불이 켜진 등불은 모두 몇 개일까요?",
  answer: 18,
  unitLabel: "개",
  checkHint: "노란 등불 13개와 초록 등불 5개를 더해 봐요."
};

const koreanItem: Extract<LearningItemPayload, { kind: "korean-reading" }> = {
  id: "ko-test",
  kind: "korean-reading",
  subject: "korean",
  unit: "문장 읽기",
  title: "양말을 쓴 조개",
  level: "1단계",
  readLabel: "두 문장을 읽어요",
  text: "또또는 줄무늬 조개를 만났어요. 조개는 양말을 모자로 썼어요.",
  hint: "마침표에서 잠깐 쉬어요.",
  tokens: ["또또", "줄무늬 조개", "양말", "모자"]
};

describe("problem breakdown", () => {
  it("splits sentences, extracts repeated numbers and advances math help", () => {
    expect(splitKoreanSentences("첫 문장이에요. 둘째 문장인가요? 좋아요!"))
      .toEqual(["첫 문장이에요.", "둘째 문장인가요?", "좋아요!"]);
    expect(splitKoreanSentences("문장부호가 없어도 한 문장이에요"))
      .toEqual(["문장부호가 없어도 한 문장이에요"]);
    expect(extractNumberClues("13개와 5개, 다시 13개"))
      .toEqual(["13", "5", "13"]);
    expect(mathScaffold(mathItem, 1)).toBe(mathItem.checkHint);
    expect(mathScaffold(mathItem, 2))
      .toBe("두 수 13과 5를 찾아 표시해 봐요.");
    expect(mathScaffold(mathItem, 3))
      .toBe("어떤 계산을 할지 말해 봐요.");
    expect(mathScaffold(mathItem, 4))
      .toBe("말한 방법으로 차근차근 계산해 봐요.");
  });

  it("renders Korean sentence cards without changing the original story", () => {
    render(<ProblemBreakdown
      item={koreanItem}
      mathRetryCount={0}
      showMathScaffold={false}
    />);
    const story = screen.getByRole("group", { name: "이야기 문장" });
    const sentences = within(story).getAllByTestId("story-sentence");
    expect(sentences).toHaveLength(2);
    expect(sentences.map((node) => node.textContent).join(" "))
      .toBe(koreanItem.text);
    expect(screen.getByRole("group", { name: "오늘 만날 낱말" }))
      .toHaveTextContent("줄무늬 조개");
  });

  it("renders math clues, question, unit and the first scaffold", () => {
    render(<ProblemBreakdown
      item={mathItem}
      mathRetryCount={1}
      showMathScaffold
    />);
    const clues = screen.getByRole("group", { name: "숫자 단서" });
    expect(within(clues).getByText("13")).toBeVisible();
    expect(within(clues).getByText("5")).toBeVisible();
    expect(screen.getByRole("heading", { name: "무엇을 구할까?" }))
      .toBeVisible();
    expect(screen.getByText(mathItem.question)).toBeVisible();
    expect(screen.getByLabelText("답의 단위 개")).toBeVisible();
    expect(screen.getByRole("status", { name: "수학 도움" }))
      .toHaveTextContent(mathItem.checkHint);
  });
});
```

The component therefore exposes the exact accessible region labels and
`data-testid="story-sentence"` hooks used above. It must not mutate either
fixture or rebuild the story passed to the server.

- [ ] **Step 2: Run Task 5 tests and confirm RED**

```bash
npx --yes -p node@22 -p npm@11.11.0 -- npm test -- tests/client/problem-breakdown.test.tsx
```

Expected: FAIL because both modules are missing.

- [ ] **Step 3: Implement pure breakdown functions**

```ts
import type { LearningItemPayload } from "../../shared/learning";

export function splitKoreanSentences(text: string): string[] {
  return (text.match(/[^.!?]+[.!?]?/g) ?? [text])
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

export function extractNumberClues(text: string): string[] {
  return [...text.matchAll(/-?\d+(?:,\d{3})*/g)].map((match) => match[0]!);
}

export function mathScaffold(
  item: Extract<LearningItemPayload, { kind: "math-story" }>,
  retryCount: number
): string {
  const numbers = extractNumberClues(item.text);
  if (retryCount <= 1) return item.checkHint;
  if (retryCount === 2 && numbers.length > 0) {
    return `두 수 ${numbers.join("과 ")}를 찾아 표시해 봐요.`;
  }
  if (retryCount === 3) return "어떤 계산을 할지 말해 봐요.";
  return "말한 방법으로 차근차근 계산해 봐요.";
}
```

- [ ] **Step 4: Implement `ProblemBreakdown`**

For both subjects render sentence cards from `splitKoreanSentences(item.text)`
and token chips under `오늘 만날 낱말`. For math also render number chips from
`extractNumberClues`, an `aria-labelledby` question card headed
`무엇을 구할까?`, and a unit badge. Render scaffold only when
`showMathScaffold` is true. Do not edit or reconstruct the item passed to the
server.

- [ ] **Step 5: Style for reading clarity and 200% zoom**

Add `.story-sentences`, `.story-sentence`, `.learning-clues`,
`.number-clues`, `.question-focus`, `.unit-badge`. Use `font-size:
clamp(1.12rem, 2vw, 1.45rem)`, `line-height: 1.75`, CSS grid with
`minmax(0, 1fr)`, wrapping chips and no fixed content height.

- [ ] **Step 6: Run Task 5 tests and typecheck**

```bash
npx --yes -p node@22 -p npm@11.11.0 -- npm test -- tests/client/problem-breakdown.test.tsx
npx --yes -p node@22 -p npm@11.11.0 -- npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit Task 5**

```bash
git add src/client/learning/problem-breakdown.ts src/client/learning/problem-breakdown-view.tsx src/client/styles/components.css tests/client/problem-breakdown.test.tsx
git commit -m "feat: break down Korean and math stories clearly"
```

---

### Task 6: 학습 세션 친구 반응, 오답 안전과 봉봉 축하

**Files:**

- Create: `src/client/companions/learning-companion.tsx`
- Modify: `src/client/learning/learning-session.tsx:1-530`
- Modify: `src/client/delight/star-celebration.tsx:1-90`
- Modify: `src/client/styles/components.css`
- Modify: `src/client/styles/layout.css`
- Modify: `src/client/styles/responsive.css`
- Modify: `tests/client/learning-session.test.tsx`
- Modify: `tests/client/login-and-home.test.tsx`

**Interfaces:**

- Consumes: `selectCompanionCue`, `ProblemBreakdown`, existing `AttemptReceipt`, `IdleUi`
- Produces: visible `CompanionMoment` derived only from existing authoritative state
- Preserves: all learning-session issuance, reading judge, attempt payload, offline queue, idle deduction and star event behavior.

- [ ] **Step 1: Write failing companion state tests**

Add focused tests to `tests/client/learning-session.test.tsx`:

1. Initial Korean lesson shows Toto and exact `openingCue`; math shows Momo.
2. Reading failure shows `한 번 더 읽어 볼 낱말이 있어요`, missed tokens,
   `retry` tone and no strings matching `딸꾹|양말|포도알|비눗방울|우당탕`.
3. First through fourth wrong math attempts show, in order, the existing Korean
   `checkHint`, two-number search, operation naming and calculation stages from
   Task 5; every stage contains no humor regex.
4. A passing attempt with `completed: true`, `starAward.awarded: true` shows
   Bongbong, `celebrationCue`, existing `별 1개를 모았어요` once, then removes
   celebration at one second and changes the single bubble to the exact `next`
   cue `다음 마법 걸음으로 가요. 루미가 도망간 양말을 잡아 둘게요.`.
5. `starAward.awarded: false` may show a completion cue only when
   `receipt.completed && !receipt.duplicate`; it must not show the star claim.
6. Network queueing shows `학습 기록이 아직 여행 중이에요. 연결되면 확인할게요.`,
   keeps `data-cue-tone="status"` after the rejected promise and local queue
   preservation have both settled, and does not say `저장했어요`,
   `별을 받았어요` or any humor-regex phrase. Cover both a locally complete
   Korean attempt and an incorrect math answer preserved to the queue.
   Add a third case where `preserveFailedAttempt` returns false: the companion
   stays non-humorous with `학습 기록을 안전하게 보관하지 못했어요. 다시 시도해
   주세요.` after `waiting` settles, rather than returning to `lesson-open`.
7. 2-minute idle maps to `thinking`; 4-minute confirm and 5-minute paused
   states contain no humor regex.
8. Existing explicit 4xx still exits without leaving a friend overlay behind.
9. Manual transcript input is inside `details` named `직접 입력으로 확인하기`.
10. Student-facing reading result contains neither `PASS` nor `FAIL`.
11. `낱말 힌트` is reachable immediately without waiting for idle; it starts
    collapsed with `aria-expanded="false"`, reveals only `item.hint` and token
    chips on click, and changes to `aria-expanded="true"`.

- [ ] **Step 2: Run Task 6 tests and confirm RED**

```bash
npx --yes -p node@22 -p npm@11.11.0 -- npm test -- tests/client/learning-session.test.tsx
```

Expected: new companion, scaffold and Korean result assertions FAIL while
existing behavior remains the baseline.

- [ ] **Step 3: Implement `LearningCompanion`**

Use this exact interface:

```tsx
export function LearningCompanion({
  moment,
  studyDate,
  item,
  saveState
}: {
  moment: CompanionMoment;
  studyDate: string;
  item: LearningItemPayload;
  saveState?: "saving" | "queued" | "failed";
})
```

Build the stable key as `${studyDate}:${item.id}:${moment}`. Render one
`CompanionAvatar`, friend name and one `role="status" aria-label="마법 친구
말풍선"`. Add `data-cue-tone={cue.tone}` so tests can enforce the humor
boundary without parsing copy. For `save-wait`, keep tone `status` and replace
only the visible text by `saveState`:

```ts
const SAVE_STATUS_TEXT = {
  saving: "학습 기록을 확인하고 있어요. 잠깐 기다려 주세요.",
  queued: "학습 기록이 아직 여행 중이에요. 연결되면 확인할게요.",
  failed: "학습 기록을 안전하게 보관하지 못했어요. 다시 시도해 주세요."
} as const;
```

When `saveState` is undefined, use the normal cue-engine text. This status
override never changes companion ID or tone and never claims a save completed.

- [ ] **Step 4: Derive the moment inside `LearningSession`**

Add `mathRetryCount`, `saveUiState` and `showNextCue` state, where
`saveUiState` is `"idle" | "saving" | "queued" | "failed"`. Set it to
`saving` at the start of each attempt save, `idle` on an authoritative server
receipt, `queued` only when `preserveFailedAttempt` returns true, and `failed`
when preservation returns false or throws. Both `queued` and `failed` remain
after `waiting` becomes false, so neither local preservation nor total local
save failure falls back to a humorous lesson/retry cue. A deliberate retry
sets it to `saving` again.

When a nonduplicate completed receipt arrives, keep `showNextCue` false and
start one cleanup-safe 1,000ms timer keyed by receipt ID. Set it true at the
timer boundary; clear the timer on receipt change or unmount. Duplicate or
incomplete receipts never start it. Derive moment in this priority order:

```ts
const companionMoment: CompanionMoment =
  idleUi?.phase === "paused" ? "idle-paused" :
  idleUi?.phase === "confirm" ? "idle-confirm" :
  idleUi?.phase === "hint" ? "thinking" :
  waiting || saveUiState !== "idle" ? "save-wait" :
  attemptReceipt?.completed && !attemptReceipt.duplicate && !showNextCue ? "correct" :
  nextUnlocked && showNextCue ? "next" :
  readingResult !== null && !readingResult.passed ? "retry" :
  mathRetryCount > 0 && !nextUnlocked ? "retry" :
  authority.phase === "offline-unissued" ? "offline" :
  "lesson-open";
```

Render `LearningCompanion` after the back button and before the subject chip.
Pass `saveState={saveUiState === "idle" ? undefined : saveUiState}`; when an
unrelated idle deduction makes `waiting` true with state idle, the regular
`save-wait` cue is used.
Render `ProblemBreakdown` instead of the raw `<p>{item.text}</p>` and duplicate
question paragraph.

- [ ] **Step 5: Make feedback supportive and progressive**

- Replace `읽기 PASS` with `읽기가 잘 도착했어요`.
- Replace `읽기 FAIL` with `한 번 더 읽어 볼 낱말이 있어요`.
- On math failure increment `mathRetryCount`; on pass preserve the count but
  hide scaffold because `nextUnlocked` is true.
- Show `ProblemBreakdown` scaffold when `mathRetryCount > 0 && !nextUnlocked`.
- Add an always-visible `낱말 힌트` button after `ProblemBreakdown`, bound to
  the existing `showHint` state with `aria-expanded`. When open, render one
  `role="region" aria-label="낱말 힌트"` containing `item.hint` and the
  existing `item.tokens`; do not reveal the answer. The 2-minute idle hint
  action opens this same region rather than a second copy.
- Wrap the manual textarea form in:

```tsx
<details className="manual-reading-check">
  <summary>직접 입력으로 확인하기</summary>
  {/* existing form */}
</details>
```

- Change queued-copy to `학습 기록이 아직 여행 중이에요. 연결되면 확인할게요.`
  but keep the existing queue and provisional state exactly. The visible
  companion status must stay `save-wait` for both queued and failed save
  states; only a new authoritative receipt may return it to idle.

- [ ] **Step 6: Connect Bongbong to existing idempotent celebration**

Add a decorative small `CompanionAvatar id="bongbong"` to `StarCelebration`.
Do not add or pass a second celebration message: `LearningCompanion` owns the
single `correct` cue and speech bubble. The existing `celebratedEventIds`, event
ID, one-second timer, reduced-motion and `onPlay`/`onComplete` semantics remain,
and the visible star text remains driven solely by `starAward.awarded`.

- [ ] **Step 7: Style the learning companion without obscuring content**

Use a compact two-column companion strip whose avatar is at most 104px on
desktop and 72px on portrait. The strip precedes content but has lower heading
size and contrast than the problem title. `data-cue-tone="support"` and
`status` use calm mint/cream backgrounds; only `humor` may use decorative
stars. Reduced-motion removes all transforms and particles.

- [ ] **Step 8: Run Task 6 and full student-client suites**

```bash
npx --yes -p node@22 -p npm@11.11.0 -- npm test -- \
  tests/client/learning-session.test.tsx \
  tests/client/problem-breakdown.test.tsx \
  tests/client/login-and-home.test.tsx \
  tests/client/inactivity-controller.test.ts \
  tests/client/reading-judge.test.ts \
  tests/client/speech-recognition.test.ts \
  tests/offline/sync.test.ts
```

Expected: all pass with no weakened queue, authority, idle or star assertions.

- [ ] **Step 9: Commit Task 6**

```bash
git add src/client/companions/learning-companion.tsx src/client/learning/learning-session.tsx src/client/delight/star-celebration.tsx src/client/styles/components.css src/client/styles/layout.css src/client/styles/responsive.css tests/client/learning-session.test.tsx tests/client/login-and-home.test.tsx
git commit -m "feat: add supportive humorous learning companions"
```

---

### Task 7: 정적 어린이 문구 감사와 전체 회귀

**Files:**

- Modify: `tests/server/content-delight.test.ts`
- Modify: `tests/client/login-and-home.test.tsx`
- Modify: `tests/client/learning-session.test.tsx`
- Modify: `.gitignore`
- Modify: `README.md`
- Create: `docs/magical-companion-acceptance.md`

**Interfaces:**

- Consumes: complete Tasks 1-6 behavior
- Produces: automated evidence that approved copy, copyright boundary, accessibility and regressions are closed before browser QA.

- [ ] **Step 1: Add a failing static child-copy audit helper test**

Read these source files and all `INITIAL_ITEMS` fields in a test:

```ts
const CHILD_UI_FILES = [
  "src/client/home/student-home.tsx",
  "src/client/learning/learning-session.tsx",
  "src/client/learning/problem-breakdown-view.tsx",
  "src/client/companions/cast.ts",
  "src/client/companions/cues.ts",
  "src/client/companions/companion-avatar.tsx",
  "src/client/companions/friend-stage.tsx",
  "src/client/companions/learning-companion.tsx",
  "src/client/delight/star-celebration.tsx",
  "src/client/delight/today-stars.tsx"
];

const PURE_DISPLAY_FILES = [
  "src/client/companions/cast.ts",
  "src/client/companions/cues.ts",
  "src/client/learning/problem-breakdown.ts"
];
```

First call a not-yet-existing `auditChildCopy(["Read this, 바보야"])` helper
and assert it reports both `ENGLISH_INSTRUCTION` and `CHILD_SHAMING`. This is
the mandatory RED proof for the audit itself. The production audit then asserts
no commercial names, shaming regex, `읽기 PASS`, `읽기 FAIL`, or English
instruction patterns. Use the TypeScript compiler AST and collect only:

1. nonblank `JsxText`;
2. text literals inside `JsxExpressionContainer`;
3. JSX attribute values for `aria-label`, `alt`, `title` and `placeholder`;
4. object-property values named `text`, `message`, `name`, `role`, `alt`,
   `mishap`, `openingCue`, `celebrationCue` or `hint`;
5. string descendants of variables whose names end in `_TEXT`; and
6. string arguments/descendants passed to setters whose names end in
   `Feedback`, `Message`, `Guidance` or `Text`.

Explicitly exclude import/export module specifiers and JSX attributes
`className`, `id`, `role`, `data-testid`, all other `data-*` hooks and event
props. Thus bare JSX such as `<strong>읽기 PASS</strong>` is audited while
technical strings such as `story-sentence` and `number-clues` are not. Add a
fixture containing both those class names and visible `Read this` JSX text;
assert the audit reports only the visible English instruction. Apply the same
audit to all active `INITIAL_ITEMS` child-copy fields. Do not scan test
descriptions, TypeScript identifier names or the immutable `seed-v1.ts`.
Assert each restricted cue moment has `tone !== "humor"` through the exported
function.

Scan every `CHILD_UI_FILES` source and reject `fetch(`, `new Audio`, `<audio`,
`speechSynthesis`, analytics/tracking SDK imports and OpenAI/Gemini/other LLM
provider imports. Separately scan `PURE_DISPLAY_FILES` and reject React,
IndexedDB/`idb`, network, audio, analytics and LLM imports or calls. Existing
API orchestration inside `StudentHome` and `LearningSession` remains covered by
its behavioral tests; the new display modules themselves stay side-effect
free.

- [ ] **Step 2: Run the audit and confirm RED against any remaining old copy**

```bash
npx --yes -p node@22 -p npm@11.11.0 -- npm test -- tests/server/content-delight.test.ts tests/client/learning-session.test.tsx
```

Expected: FAIL because `auditChildCopy` does not exist. After implementing the
helper, the fixture test passes and the production scan still fails if any old
`PASS`/`FAIL` or English child hint remains.

- [ ] **Step 3: Remove only audited user-facing violations**

Replace remaining child-visible English or evaluation labels with the exact
Korean support copy from the design. Do not rename API error codes, TypeScript
types, test descriptions or protocol fields such as `mathPass`.

- [ ] **Step 4: Update the README with the shipped child experience**

In `README.md`, replace the old `읽기 PASS, 수학 정답 PASS` bullet with:

```md
- 읽기 도움과 수학 정답 확인 뒤 완료되는 학습 잠금
```

Add this exact bullet directly below it:

```md
- 오리지널 마법 동물 친구, 상태별 어린이 안전 유머와 국어·수학 단계별 도움
```

- [ ] **Step 5: Document the acceptance matrix**

Create `docs/magical-companion-acceptance.md` with this exact starting table.
Change a `PENDING` row to `PASS` only after its named evidence has been executed
or read:

```md
# 마법 동물 학습 친구 인수 기록

| 설계 | 요구사항 | 자동 증거 | 상태 |
|---|---|---|---|
| 1 | 목적과 성공 경험 | `tests/client/login-and-home.test.tsx`; `tests/client/learning-session.test.tsx` | PENDING |
| 2 | 범위와 비범위 | `tests/server/content-delight.test.ts` 정적 모듈 감사 | PENDING |
| 3 | 저작권과 어린이 안전 | `tests/server/content-delight.test.ts` 문구 감사 | PENDING |
| 4 | 네 오리지널 친구 | `tests/client/companion-components.test.tsx` | PENDING |
| 5 | 상태별 유머 계약 | `tests/shared/companions.test.ts`; `tests/client/learning-session.test.tsx` | PENDING |
| 6 | 홈·학습·반응형 화면 | `tests/client/login-and-home.test.tsx`; `tests/client/learning-session.test.tsx` | PENDING |
| 7 | 국어·수학 인지 부담 완화 | `tests/client/problem-breakdown.test.tsx` | PENDING |
| 8 | 선택형 delight 콘텐츠 모델 | `tests/shared/companions.test.ts`; `tests/server/content-delight.test.ts` | PENDING |
| 9 | 순수 데이터와 표현 경계 | `tests/server/content-delight.test.ts` 순수 모듈 네트워크 감사 | PENDING |
| 10 | 서버 권위 데이터 흐름 | `tests/client/learning-session.test.tsx`; `tests/server/star-learning.test.ts` | PENDING |
| 11 | 오류와 대체 동작 | `tests/client/companion-components.test.tsx`; `tests/client/auth-offline-lifecycle.test.tsx` | PENDING |
| 12 | 성능·오프라인·PWA | `tests/client/companion-components.test.tsx`; `tests/offline/pwa-config.test.ts` | PENDING |
| 13 | 자동·브라우저 인수 기준 | Node 22 `npm run check`; Task 8 localhost 브라우저 | PENDING |
| 14 | 완료 판단 | 이 표의 자동·localhost 행과 최종 clean-tree 검사 | PENDING |

| 실행 환경 | 증거 | 상태 |
|---|---|---|
| localhost 자동 검사 | Node 22 `npm run check` | PENDING |
| localhost 브라우저 | Task 8 실행 뒤 기록 | NOT RUN |
| 실제 Galaxy Tab | 실제 기기 확인 필요 | NOT RUN |
| Synology NAS | NAS 배포 뒤 확인 필요 | NOT RUN |
| 외부 HTTPS·DDNS·443 | 외부망 확인 필요 | NOT RUN |
| DSM 운영 게이트 | DSM에서 확인 필요 | NOT RUN |
```

Do not infer physical device or NAS results from jsdom or localhost.

Append `output/playwright/` to `.gitignore` here, before the Task 7 clean commit,
so Task 8 can start from an actually clean implementation head.

- [ ] **Step 6: Run the complete Node 22 pre-commit check**

```bash
npx --yes -p node@22 -p npm@11.11.0 -- npm run check
bash -n scripts/*.sh
git diff --check
git diff --check 05804ed..HEAD
git status --short
```

Expected: all tests, typecheck, client build, server build, shell syntax and
diff check PASS. Before the commit, `git status --short` lists only the
intentional Task 7 files plus already committed Task 1-6 state. Existing
nonblocking Vite chunk-size and PWA `inlineDynamicImports` warnings may remain
but must be recorded accurately in the acceptance document.

- [ ] **Step 7: Promote only executed automated evidence to PASS**

After Step 6 succeeds, change design rows 1-12 and `localhost 자동 검사` from
`PENDING` to `PASS`. Keep design rows 13-14 `PENDING`, `localhost 브라우저`
`NOT RUN`, and all physical/NAS/external rows `NOT RUN`. Record the executed
Node version and any nonblocking build warnings, then run:

```bash
git diff --check
rg -n '\| (PENDING|PASS|NOT RUN) \|' docs/magical-companion-acceptance.md
```

Expected: rows 1-12 and localhost automatic are PASS; rows 13-14 are the only
design PENDING rows.

- [ ] **Step 8: Commit Task 7**

```bash
git add .gitignore tests/server/content-delight.test.ts tests/client/login-and-home.test.tsx tests/client/learning-session.test.tsx README.md docs/magical-companion-acceptance.md
git commit -m "test: audit child-safe magical companion copy"
```

- [ ] **Step 9: Confirm the committed Task 7 tree is clean**

```bash
git status --short
git log -1 --oneline
```

Expected: `git status --short` prints nothing and the latest commit is
`test: audit child-safe magical companion copy`.

---

### Task 8: Galaxy Tab 크기 브라우저 시각·상호작용 검증

**Files:**

- Modify: `docs/magical-companion-acceptance.md`
- Runtime artifacts: `output/playwright/` (ignored, not committed)

**Interfaces:**

- Consumes: production Vite client and Fastify server from final Task 7 head
- Produces: localhost browser screenshots and exact PASS/FAIL/NOT RUN evidence
- Does not prove: physical Galaxy Tab, Synology, DDNS, external 443 or DSM gates.

- [ ] **Step 1: Capture the clean implementation head and verify ignore setup**

```bash
test -z "$(git status --porcelain)"
TESTED_IMPLEMENTATION_HEAD="$(git rev-parse HEAD)"
mkdir -p output/playwright
git check-ignore -q output/playwright/probe.png
test -z "$(git status --porcelain)"
```

Expected: Task 7 left a clean tree, the runtime evidence path is ignored, and
creating it does not dirty the tree.

- [ ] **Step 2: Verify Playwright CLI prerequisite**

```bash
command -v npx >/dev/null 2>&1
export CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
export PWCLI="$CODEX_HOME/skills/playwright/scripts/playwright_cli.sh"
"$PWCLI" --help
```

Expected: all commands exit 0.

- [ ] **Step 3: Start an isolated local QA server**

Refuse to reuse occupied ports:

```bash
for port in 5173 8787; do
  if lsof -nP -iTCP:"$port" -sTCP:LISTEN | grep -q LISTEN; then
    echo "QA_PORT_IN_USE:$port" >&2
    exit 1
  fi
done
```

Do not kill or reuse the process that owns an occupied port. Resolve the
conflict with the user, then rerun the fixed 5173/8787 checks; the checked-in
Vite proxy targets 8787, so this plan does not silently substitute another
pair.

Use a fresh ignored DB, fixed development-only secrets and Vite strict-port
mode:

```bash
QA_RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)-$$"
QA_DIR="$PWD/.local/magical-companion-qa/$QA_RUN_ID"
test ! -e "$QA_DIR"
mkdir -p "$QA_DIR/backups" output/playwright
NODE_ENV=development \
HOST=127.0.0.1 \
PORT=8787 \
DATABASE_PATH="$QA_DIR/sua.db" \
BACKUP_DIR="$QA_DIR/backups" \
APP_ORIGIN=http://127.0.0.1:5173 \
SETUP_SECRET=ssssssssssssssssssssssssssssssss \
SESSION_PEPPER=pppppppppppppppppppppppppppppppp \
SESSION_DAYS=14 \
TIME_ZONE=Asia/Seoul \
npx --yes -p node@22 -p npm@11.11.0 -- sh -c \
  'exec ./node_modules/.bin/concurrently -k \
  "./node_modules/.bin/vite --host 127.0.0.1 --port 5173 --strictPort" \
  "./node_modules/.bin/tsx watch src/server/index.ts"'
```

Keep the PTY session ID and terminate only that session after QA. Confirm:

```bash
curl --fail --silent http://127.0.0.1:8787/api/health
curl --fail --silent http://127.0.0.1:5173/ | grep -F "수아의 공부방"
```

Expected: health returns `{"status":"ok"}`, the strict 5173 client contains
the expected title, the new database did not exist before this run, and the
saved PTY owns both listener processes. Never reuse or copy forward an earlier
QA run directory after a failure.

- [ ] **Step 4: Complete fresh family setup and student login**

Open headed Chromium at `http://127.0.0.1:5173`, snapshot, then use current
snapshot refs to:

1. enter the 32-character setup secret above;
2. enter guardian name `보호자`, password `local guardian password`, student
   name `수아`;
3. log in as guardian;
4. register `수아 Galaxy Tab QA`;
5. set student PIN `2580`;
6. log in as student.

Never put these development-only credentials in committed screenshots or docs.

- [ ] **Step 5: Capture landscape home at 1368×912 and 1600×900**

For each viewport, snapshot and assert visually and semantically:

- four distinct friends are visible;
- exactly one active friend and one speech bubble;
- required cards show companion, mishap, star state and 48px start button;
- right rail shows confirmed stars and `마법 걸음`;
- no overlap, clipping, accidental horizontal scroll or hidden text.

Save screenshots as:

```text
output/playwright/home-1368x912.png
output/playwright/home-1600x900.png
```

Use `"$PWCLI" resize 1368 912` and `"$PWCLI" resize 1600 900`, taking a new
snapshot after each resize. Save the named artifacts with:

```bash
"$PWCLI" run-code "await page.screenshot({ path: 'output/playwright/home-1368x912.png' })"
"$PWCLI" run-code "await page.screenshot({ path: 'output/playwright/home-1600x900.png' })"
```

- [ ] **Step 6: Capture Korean and math interaction states**

Open a Korean item, capture lesson-open, submit an intentionally incomplete
manual transcript to capture retry, then submit the full text to capture
correct. Before each transcript submission, open the `details` control named
`직접 입력으로 확인하기`; do not use a hidden textarea ref. Before the first
submission, click `낱말 힌트`, confirm its expanded state and Korean hint/token
content, then collapse it. Return home, open a math item, open the same
`details`, submit full reading text, enter a wrong answer four times to capture
the checkHint, number search, operation naming and calculation stages, then
enter the correct answer. Save:

```text
output/playwright/korean-open.png
output/playwright/korean-retry.png
output/playwright/korean-correct.png
output/playwright/math-open.png
output/playwright/math-retry-1.png
output/playwright/math-retry-2.png
output/playwright/math-retry-3.png
output/playwright/math-retry-4.png
output/playwright/math-correct.png
```

At retry states confirm `data-cue-tone` is not `humor`. At correct confirm
Bongbong and the star claim appear only according to the server receipt.
Because the correct/star state lasts one second, take its screenshot in the
same Playwright call that submits the already-filled correct answer. This is
the documented exception to the normal ref-only CLI flow:

```bash
"$PWCLI" run-code "await (async () => {
  await page.getByRole('button', { name: '읽기 판정하기' }).click();
  await page.getByRole('status', { name: '별 보상' }).waitFor({ state: 'visible' });
  await page.screenshot({ path: 'output/playwright/korean-correct.png' });
})()"
"$PWCLI" run-code "await (async () => {
  await page.getByRole('button', { name: '답 확인' }).click();
  await page.getByRole('status', { name: '별 보상' }).waitFor({ state: 'visible' });
  await page.screenshot({ path: 'output/playwright/math-correct.png' });
})()"
```

Run it only after a fresh snapshot and after filling the exact correct answer
through the current snapshot ref. Then wait 1,050ms and assert the single
friend bubble changed to the `next` cue.

- [ ] **Step 7: Capture portrait, 200% zoom and reduced motion**

At 800×1280 confirm visual order: header, horizontal friend strip, required
learning, star/trail, optional learning. For the 200% desktop-zoom equivalent,
make the 1368×912 physical window reflow through a 684×456 CSS viewport at
device scale 2; confirm the 850px breakpoint is active and all core text and
buttons remain reachable. This tests the layout effect of 200% browser zoom
instead of using pinch/page-scale, which does not recalculate media queries.
Emulate reduced motion, complete a new eligible item, and confirm no star
particles or transform animation.

Use these exact browser controls:

```bash
"$PWCLI" resize 800 1280
"$PWCLI" snapshot
"$PWCLI" run-code "await page.screenshot({ path: 'output/playwright/home-portrait-800x1280.png' })"
"$PWCLI" resize 1368 912
"$PWCLI" run-code "const cdp = await page.context().newCDPSession(page); await cdp.send('Emulation.setDeviceMetricsOverride', { width: 684, height: 456, deviceScaleFactor: 2, mobile: false, screenWidth: 1368, screenHeight: 912 }); const width = await page.evaluate(() => window.innerWidth); if (width !== 684) throw new Error('ZOOM_EQUIVALENT_WIDTH:' + width); const narrow = await page.evaluate(() => matchMedia('(max-width: 850px)').matches); if (!narrow) throw new Error('ZOOM_EQUIVALENT_BREAKPOINT');"
"$PWCLI" snapshot
"$PWCLI" run-code "await page.screenshot({ path: 'output/playwright/home-zoom-200.png' })"
"$PWCLI" run-code "const cdp = await page.context().newCDPSession(page); await cdp.send('Emulation.clearDeviceMetricsOverride'); await page.setViewportSize({ width: 1368, height: 912 }); await page.emulateMedia({ reducedMotion: 'reduce' });"
```

For the reduced-motion completion, fill a fresh eligible answer, then use one
`run-code` call:

```bash
"$PWCLI" run-code "await (async () => {
  await page.getByRole('button', { name: '답 확인' }).click();
  const reward = page.getByRole('status', { name: '별 보상' });
  await reward.waitFor({ state: 'visible' });
  if (await page.locator('[data-star-particle]').count() !== 0) throw new Error('REDUCED_MOTION_PARTICLES');
  const transform = await reward.evaluate((node) => getComputedStyle(node).transform);
  if (transform !== 'none') throw new Error('REDUCED_MOTION_TRANSFORM:' + transform);
  await page.screenshot({ path: 'output/playwright/correct-reduced-motion.png' });
})()"
```

Run it only after a fresh snapshot and filling the new exact answer by its
current ref. A thrown assertion triggers the Step 8 failure gate.

Save:

```text
output/playwright/home-portrait-800x1280.png
output/playwright/home-zoom-200.png
output/playwright/correct-reduced-motion.png
```

- [ ] **Step 8: Apply the browser acceptance gate and stop only the QA server**

Update `docs/magical-companion-acceptance.md` with viewport, screenshot path,
observed result and `TESTED_IMPLEMENTATION_HEAD` labelled `검증한 구현 HEAD`.
Label the 684×456/device-scale-2 result `200% 확대 등가 reflow`; do not claim
that Playwright manipulated Chrome's browser-chrome zoom control.
Do not call it the final Task 8 commit hash: the evidence commit cannot cite
itself. Mark `localhost browser` PASS only when every state above was exercised.
When the automatic and localhost rows are both PASS, update design rows 13 and
14 from PENDING to PASS. Keep physical device/NAS/external gates `NOT RUN`.

If any semantic or visual assertion fails, do not mark localhost, rows 13/14 or
Task 8 PASS and do not make the Task 8 commit. Terminate the saved PTY, return
to the relevant Task 1-7 behavior with a failing automated regression test,
make the smallest fix, rerun Node 22 `npm run check`, record the new clean
`TESTED_IMPLEMENTATION_HEAD`, and repeat all of Task 8 on a fresh QA DB.

On either success or failure, terminate only the saved PTY session and confirm
ports 5173 and 8787 no longer belong to that process. Do not kill unrelated
development servers.

- [ ] **Step 9: Commit Task 8 evidence metadata**

```bash
git add docs/magical-companion-acceptance.md
git commit -m "test: record magical companion tablet acceptance"
```

Artifacts under `output/playwright/` remain ignored local evidence.

- [ ] **Step 10: Read back the evidence commit without creating a hash loop**

```bash
git status --short
git rev-parse HEAD
git show --stat --oneline --summary HEAD
```

Expected: the tree is clean and the commit contains only the acceptance
document. Report this evidence commit hash in the handoff; do not write it back
into its own document.

---

## Plan self-review checklist

- [x] Every design section 1-14 maps to at least one Task 1-8 test or acceptance step.
- [x] No deferred placeholder or unspecified error-handling step remains.
- [x] Character IDs are exactly `lumi | toto | momo | bongbong` in every task.
- [x] Cue moments and tones match Task 1 in every later task.
- [x] `LearningDelight` names match shared schema and content tables.
- [x] Content version 2 never rewrites version 1 or downgrades version 3+.
- [x] UI components receive display-only props and never own server authority or star calculations.
- [x] Every production behavior starts with a RED test and ends with focused verification and a commit.
- [x] Final verification distinguishes localhost browser evidence from physical Galaxy Tab and Synology gates.
