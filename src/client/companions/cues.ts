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
