import type { ChanaPingEvent } from "../../shared/learning";

export type ChanaPingMood = "celebrate" | "grumble" | "bored" | "focus" | "rest";

export type ChanaPingCueInput = {
  event: ChanaPingEvent;
  subject: "korean" | "math";
  retryCount: number;
  key: string;
};

const EVENT_MOODS: Record<ChanaPingEvent, ChanaPingMood> = {
  "lesson-open": "rest",
  "speech-start": "focus",
  "speech-finish": "focus",
  correct: "celebrate",
  retry: "grumble",
  thinking: "bored",
  "idle-confirm": "bored",
  "idle-paused": "bored",
  next: "rest"
};

const CUES: Record<ChanaPingMood, readonly string[]> = {
  celebrate: [
    "오… 맞았네. 칭찬하는 것도 귀찮은데, 이건 칭찬이야.",
    "해냈네. 차나핑도 살짝 기분이 좋아졌어.",
    "정답이야. 이건 작은 반짝임으로 기록해 둘게."
  ],
  grumble: [
    "아휴, 한 번만 더 살펴보자. 차나핑이 기다릴게.",
    "조금 헷갈릴 수 있지. 숨 고르고 다시 보면 돼.",
    "여기까지 온 것도 잘했어. 단서부터 천천히 보자."
  ],
  bored: [
    "생각은 천천히 해도 돼. 차나핑은 기다릴게.",
    "잠깐 멈춰도 괜찮아. 준비되면 같이 이어 가자.",
    "서두르지 말자. 한 가지만 살펴보면 돼."
  ],
  focus: [
    "오, 읽기 시작이네. 차나핑도 조용히 들을게.",
    "좋아, 지금 말에 귀를 기울이고 있어.",
    "차분히 해 보자. 차나핑도 집중 중이야."
  ],
  rest: [
    "차나핑은 베개에서 응원 중이야. 천천히 시작해.",
    "다음 한 걸음만 해 보자. 차나핑은 여기 있을게.",
    "준비되면 시작하자. 차나핑도 기다리고 있어."
  ]
};

const CHANAPING_ART: Record<ChanaPingMood, string> = {
  celebrate: "/assets/companions/chanaping-celebrate.svg",
  grumble: "/assets/companions/chanaping-grumble.svg",
  bored: "/assets/companions/chanaping-bored.svg",
  focus: "/assets/companions/chanaping-focus.svg",
  rest: "/assets/companions/chanaping.svg"
};

function stableIndex(key: string, length: number): number {
  let hash = 2166136261;
  for (const character of key) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % length;
}

export function selectLocalChanaPingCue(input: ChanaPingCueInput): string {
  const cues = CUES[getChanaPingMood(input.event)];
  return cues[stableIndex(
    `${input.key}:${input.event}:${input.subject}:${input.retryCount}`,
    cues.length
  )]!;
}

export function getChanaPingMood(event: ChanaPingEvent): ChanaPingMood {
  return EVENT_MOODS[event];
}

export function getChanaPingArt(mood: ChanaPingMood): string {
  return CHANAPING_ART[mood];
}
