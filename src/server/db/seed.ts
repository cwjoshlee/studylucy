import type Database from "better-sqlite3";
import type { LearningItemPayload } from "../../shared/learning";

export const INITIAL_ITEMS: LearningItemPayload[] = [
  {
    id: "ko-01",
    kind: "korean-reading",
    subject: "korean",
    unit: "동화 읽기",
    title: "숲속 작은 등불 1",
    level: "1단계",
    readLabel: "동화 단락 읽기",
    text: "수아는 작은 숲길에서 반짝이는 돌멩이를 보았어요. 돌멩이는 별빛처럼 조용히 빛나며 수아의 손바닥을 따뜻하게 해 주었어요.",
    hint: "Read one sentence at a time. You can pause at the period.",
    tokens: ["수아", "숲길", "반짝이는", "돌멩이", "손바닥"]
  },
  {
    id: "ko-02",
    kind: "korean-reading",
    subject: "korean",
    unit: "동화 읽기",
    title: "숲속 작은 등불 2",
    level: "1단계",
    readLabel: "동화 단락 읽기",
    text: "수아는 돌멩이를 손에 올리고 천천히 걸었어요. 길 끝에는 낮은 문과 둥근 창문이 있는 파란 집이 조용히 서 있었어요.",
    hint: "Slow reading is good reading.",
    tokens: ["돌멩이", "천천히", "낮은 문", "둥근 창문", "파란 집"]
  },
  {
    id: "ko-03",
    kind: "korean-reading",
    subject: "korean",
    unit: "동화 읽기",
    title: "숲속 작은 등불 3",
    level: "2단계",
    readLabel: "동화 단락 읽기",
    text: "문 앞에는 은빛 종이 매달려 있었어요. 수아가 종을 살짝 치자 집 안에서 따뜻한 불빛이 켜지고 작은 발소리가 들렸어요.",
    hint: "Look carefully at final consonants.",
    tokens: ["은빛 종", "매달려", "살짝", "따뜻한 불빛", "발소리"]
  },
  {
    id: "ko-04",
    kind: "korean-reading",
    subject: "korean",
    unit: "동화 읽기",
    title: "숲속 작은 등불 4",
    level: "2단계",
    readLabel: "동화 단락 읽기",
    text: "파란 집의 할머니는 길을 잃은 별을 찾고 있었어요. 수아는 손바닥의 돌멩이가 별의 조각일지도 모른다고 조심스럽게 말했어요.",
    hint: "Read to the end before checking meaning.",
    tokens: ["할머니", "길을 잃은 별", "손바닥", "별의 조각", "조심스럽게"]
  },
  {
    id: "ko-05",
    kind: "korean-reading",
    subject: "korean",
    unit: "동화 읽기",
    title: "숲속 작은 등불 5",
    level: "3단계",
    readLabel: "동화 단락 읽기",
    text: "할머니는 수아에게 별빛 씨앗을 담은 작은 주머니를 주었어요. 씨앗은 흔들릴 때마다 딸랑딸랑 소리를 내며 길을 알려 주었어요.",
    hint: "Two sentences. Pause once, then continue.",
    tokens: ["할머니", "별빛 씨앗", "작은 주머니", "딸랑딸랑", "길"]
  },
  {
    id: "ko-06",
    kind: "korean-reading",
    subject: "korean",
    unit: "동화 읽기",
    title: "숲속 작은 등불 6",
    level: "3단계",
    readLabel: "동화 단락 읽기",
    text: "수아는 주머니를 들고 이끼가 폭신한 길을 지나갔어요. 나뭇잎 사이에서는 초록 반딧불이 하나둘 깨어나 수아를 따라왔어요.",
    hint: "Notice the feeling in the final sentence.",
    tokens: ["주머니", "이끼", "폭신한 길", "나뭇잎", "반딧불"]
  },
  {
    id: "ko-07",
    kind: "korean-reading",
    subject: "korean",
    unit: "동화 읽기",
    title: "숲속 작은 등불 7",
    level: "4단계",
    readLabel: "동화 단락 읽기",
    text: "숲 가운데에는 별빛이 사라진 작은 다리가 있었어요. 수아는 다리 위에 씨앗을 하나씩 놓으며 어두운 널빤지를 환하게 밝혔어요.",
    hint: "Longer paragraph. Keep your eyes on each word.",
    tokens: ["숲 가운데", "작은 다리", "씨앗", "널빤지", "환하게"]
  },
  {
    id: "ko-08",
    kind: "korean-reading",
    subject: "korean",
    unit: "동화 읽기",
    title: "숲속 작은 등불 8",
    level: "4단계",
    readLabel: "동화 단락 읽기",
    text: "다리 아래의 물결은 별빛을 받아 은색 리본처럼 반짝였어요. 수아는 겁이 조금 났지만 발끝을 보며 천천히 건넜어요.",
    hint: "Pause after the first sentence.",
    tokens: ["물결", "은색 리본", "반짝였어요", "겁", "천천히"]
  },
  {
    id: "ko-09",
    kind: "korean-reading",
    subject: "korean",
    unit: "동화 읽기",
    title: "숲속 작은 등불 9",
    level: "5단계",
    readLabel: "동화 단락 읽기",
    text: "다리를 건너자 작은 별들이 둥근 광장에 모여 있었어요. 별들은 제자리를 찾으려고 서로의 빛을 맞추며 조용히 기다렸어요.",
    hint: "Read calmly. The story is almost done.",
    tokens: ["다리", "작은 별들", "둥근 광장", "제자리", "기다렸어요"]
  },
  {
    id: "ko-10",
    kind: "korean-reading",
    subject: "korean",
    unit: "동화 읽기",
    title: "숲속 작은 등불 10",
    level: "5단계",
    readLabel: "동화 단락 읽기",
    text: "수아가 마지막 씨앗을 하늘로 올리자 숲 전체가 부드러운 빛으로 물들었어요. 집으로 돌아오는 길에 수아의 마음에도 작은 등불이 오래도록 켜져 있었어요.",
    hint: "Finish the ending slowly.",
    tokens: ["마지막 씨앗", "하늘", "숲 전체", "부드러운 빛", "작은 등불"]
  },
  {
    id: "math-01",
    kind: "math-story",
    subject: "math",
    unit: "숲속 수학 이야기",
    title: "별빛 씨앗 주머니",
    level: "1단계",
    readLabel: "수학 지문 읽기",
    text: "할머니는 수아에게 별빛 씨앗 8개를 주었어요. 수아는 문 앞 상자에서 별빛 씨앗 7개를 더 찾았어요.",
    question: "수아가 가진 별빛 씨앗은 모두 몇 개일까요?",
    hint: "Find both numbers before adding.",
    tokens: ["할머니", "수아", "별빛 씨앗", "8개", "7개", "모두"],
    answer: 15,
    unitLabel: "개",
    checkHint: "별빛 씨앗 8개와 7개를 더해보자."
  },
  {
    id: "math-02",
    kind: "math-story",
    subject: "math",
    unit: "숲속 수학 이야기",
    title: "반딧불 친구들",
    level: "1단계",
    readLabel: "수학 지문 읽기",
    text: "숲길 왼쪽에서 반딧불 9마리가 날아왔어요. 오른쪽 풀숲에서도 반딧불 5마리가 더 날아왔어요.",
    question: "수아를 따라온 반딧불은 모두 몇 마리일까요?",
    hint: "This is an adding problem.",
    tokens: ["숲길", "반딧불", "9마리", "5마리", "더", "모두"],
    answer: 14,
    unitLabel: "마리",
    checkHint: "왼쪽 9마리와 오른쪽 5마리를 합쳐보자."
  },
  {
    id: "math-03",
    kind: "math-story",
    subject: "math",
    unit: "숲속 수학 이야기",
    title: "다리의 널빤지",
    level: "2단계",
    readLabel: "수학 지문 읽기",
    text: "별빛 다리에는 밝은 널빤지 10개가 있었어요. 수아가 씨앗을 놓자 널빤지 6개가 더 밝아졌어요.",
    question: "밝아진 널빤지는 모두 몇 개일까요?",
    hint: "Add the bright boards.",
    tokens: ["별빛 다리", "밝은 널빤지", "10개", "6개", "더", "모두"],
    answer: 16,
    unitLabel: "개",
    checkHint: "밝은 널빤지 10개와 더 밝아진 6개를 더해보자."
  },
  {
    id: "math-04",
    kind: "math-story",
    subject: "math",
    unit: "숲속 수학 이야기",
    title: "은색 리본 물결",
    level: "2단계",
    readLabel: "수학 지문 읽기",
    text: "다리 아래 물결에는 은색 빛 12줄이 반짝였어요. 별빛 씨앗이 떨어지자 은색 빛 4줄이 더 생겼어요.",
    question: "은색 빛은 모두 몇 줄일까요?",
    hint: "A two-digit number can be added too.",
    tokens: ["물결", "은색 빛", "12줄", "4줄", "더", "모두"],
    answer: 16,
    unitLabel: "줄",
    checkHint: "은색 빛 12줄과 4줄을 더해보자."
  },
  {
    id: "math-05",
    kind: "math-story",
    subject: "math",
    unit: "숲속 수학 이야기",
    title: "둥근 광장의 별",
    level: "3단계",
    readLabel: "수학 지문 읽기",
    text: "둥근 광장에는 작은 별 11개가 기다리고 있었어요. 하늘에서 작은 별 8개가 더 내려왔어요.",
    question: "광장에 모인 작은 별은 모두 몇 개일까요?",
    hint: "Read both numbers carefully.",
    tokens: ["둥근 광장", "작은 별", "11개", "8개", "더", "모두"],
    answer: 19,
    unitLabel: "개",
    checkHint: "기다리던 별 11개와 내려온 별 8개를 더해보자."
  },
  {
    id: "math-06",
    kind: "math-story",
    subject: "math",
    unit: "숲속 수학 이야기",
    title: "파란 집 창문",
    level: "3단계",
    readLabel: "수학 지문 읽기",
    text: "파란 집의 둥근 창문에는 노란 불빛 13개가 켜졌어요. 할머니가 초록 불빛 5개를 더 켰어요.",
    question: "창문에 켜진 불빛은 모두 몇 개일까요?",
    hint: "Add yellow lights and green lights.",
    tokens: ["파란 집", "둥근 창문", "노란 불빛", "13개", "5개", "모두"],
    answer: 18,
    unitLabel: "개",
    checkHint: "노란 불빛 13개와 초록 불빛 5개를 더해보자."
  },
  {
    id: "math-07",
    kind: "math-story",
    subject: "math",
    unit: "숲속 수학 이야기",
    title: "이끼 길의 발자국",
    level: "4단계",
    readLabel: "수학 지문 읽기",
    text: "이끼 길에 수아의 발자국 7개가 남았어요. 별빛 고양이의 작은 발자국 12개도 옆에 생겼어요.",
    question: "이끼 길의 발자국은 모두 몇 개일까요?",
    hint: "The story has two kinds of footprints.",
    tokens: ["이끼 길", "수아", "발자국", "7개", "12개", "모두"],
    answer: 19,
    unitLabel: "개",
    checkHint: "수아의 발자국 7개와 고양이 발자국 12개를 더해보자."
  },
  {
    id: "math-08",
    kind: "math-story",
    subject: "math",
    unit: "숲속 수학 이야기",
    title: "하늘 사다리",
    level: "4단계",
    readLabel: "수학 지문 읽기",
    text: "별들이 하늘로 올라가려고 빛 사다리 14칸을 만들었어요. 수아가 씨앗을 놓자 빛 사다리 3칸이 더 생겼어요.",
    question: "빛 사다리는 모두 몇 칸일까요?",
    hint: "Add the ladder steps.",
    tokens: ["별들", "빛 사다리", "14칸", "3칸", "더", "모두"],
    answer: 17,
    unitLabel: "칸",
    checkHint: "처음 14칸과 더 생긴 3칸을 더해보자."
  },
  {
    id: "math-09",
    kind: "math-story",
    subject: "math",
    unit: "숲속 수학 이야기",
    title: "별빛 편지",
    level: "5단계",
    readLabel: "수학 지문 읽기",
    text: "할머니는 수아에게 별빛 편지 6장을 보여 주었어요. 별들도 고마운 마음을 담아 편지 13장을 더 보냈어요.",
    question: "별빛 편지는 모두 몇 장일까요?",
    hint: "Find 6 and 13, then add.",
    tokens: ["할머니", "수아", "별빛 편지", "6장", "13장", "모두"],
    answer: 19,
    unitLabel: "장",
    checkHint: "할머니의 편지 6장과 별들이 보낸 13장을 더해보자."
  },
  {
    id: "math-10",
    kind: "math-story",
    subject: "math",
    unit: "숲속 수학 이야기",
    title: "마지막 등불",
    level: "5단계",
    readLabel: "수학 지문 읽기",
    text: "숲길에는 작은 등불 15개가 켜져 있었어요. 수아가 마지막 씨앗을 놓자 등불 5개가 더 켜졌어요.",
    question: "숲길의 등불은 모두 몇 개일까요?",
    hint: "This one reaches twenty.",
    tokens: ["숲길", "작은 등불", "15개", "5개", "마지막 씨앗", "모두"],
    answer: 20,
    unitLabel: "개",
    checkHint: "처음 등불 15개와 더 켜진 5개를 더해보자."
  }
];

const CURRICULUM_NODES = [
  { id: "grade-1", parentId: null, kind: "grade", code: "grade-1", title: "1학년", sortOrder: 1 },
  { id: "subject-korean", parentId: "grade-1", kind: "subject", code: "grade-1.korean", title: "국어", sortOrder: 1 },
  { id: "subject-math", parentId: "grade-1", kind: "subject", code: "grade-1.math", title: "수학", sortOrder: 2 },
  { id: "unit-korean-reading", parentId: "subject-korean", kind: "unit", code: "grade-1.korean.reading", title: "동화 읽기", sortOrder: 1 },
  { id: "unit-math-story", parentId: "subject-math", kind: "unit", code: "grade-1.math.story", title: "숲속 수학 이야기", sortOrder: 1 },
  { id: "skill-korean-reading", parentId: "unit-korean-reading", kind: "skill", code: "grade-1.korean.reading.paragraph", title: "짧은 단락 읽기", sortOrder: 1 },
  { id: "skill-math-story", parentId: "unit-math-story", kind: "skill", code: "grade-1.math.story.answer", title: "지문 읽고 답하기", sortOrder: 1 }
] as const;

export function seedInitialContent(db: Database.Database): void {
  const insertNode = db.prepare(`
    INSERT OR IGNORE INTO curriculum_nodes
      (id, parent_id, kind, code, title, sort_order)
    VALUES
      (@id, @parentId, @kind, @code, @title, @sortOrder)
  `);
  const insertItem = db.prepare(`
    INSERT OR IGNORE INTO content_items
      (id, skill_id, subject, active_version, created_at)
    VALUES
      (@id, @skillId, @subject, 1, @createdAt)
  `);
  const insertVersion = db.prepare(`
    INSERT OR IGNORE INTO content_versions
      (item_id, version, payload_json, created_at)
    VALUES
      (@itemId, 1, @payloadJson, @createdAt)
  `);

  db.transaction(() => {
    for (const node of CURRICULUM_NODES) {
      insertNode.run(node);
    }

    const createdAt = new Date().toISOString();
    for (const item of INITIAL_ITEMS) {
      const skillId = item.kind === "korean-reading"
        ? "skill-korean-reading"
        : "skill-math-story";

      insertItem.run({
        id: item.id,
        skillId,
        subject: item.subject,
        createdAt
      });
      insertVersion.run({
        itemId: item.id,
        payloadJson: JSON.stringify(item),
        createdAt
      });
    }
  })();
}
