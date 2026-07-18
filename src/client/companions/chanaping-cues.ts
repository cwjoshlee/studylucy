import type { ChanaPingEvent } from "../../shared/learning";

type ChanaPingCueInput = {
  event: ChanaPingEvent;
  subject: "korean" | "math";
  retryCount: number;
  key: string;
};

const CUES: Record<ChanaPingEvent, readonly string[]> = {
  "lesson-open": ["차나핑은 베개에서 응원 중이야. 천천히 시작해."],
  "speech-start": ["오, 읽기 시작이네. 차나핑도 조용히 들을게."],
  "speech-finish": ["읽은 걸 확인 중이야. 차나핑도 숨을 고를게."],
  correct: ["오… 맞았네. 칭찬하는 것도 귀찮은데, 이건 칭찬이야."],
  retry: ["아휴, 한 번만 더 살펴보자. 차나핑이 기다릴게."],
  thinking: ["생각은 천천히 해도 돼. 차나핑은 기다릴게."],
  "idle-confirm": ["수아야, 한 번만 눌러 볼까? 차나핑도 기다리는 중이야."],
  "idle-paused": ["잠시 쉬어도 괜찮아. 돌아오면 차나핑이 있을게."],
  next: ["다음 문제도 살짝만 해 보자. 차나핑은 여기 있을게."]
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
  const cues = CUES[input.event];
  return cues[stableIndex(
    `${input.key}:${input.event}:${input.subject}:${input.retryCount}`,
    cues.length
  )]!;
}
