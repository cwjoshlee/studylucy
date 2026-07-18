import type Database from "better-sqlite3";
import {
  isCalculationItem,
  type LearningItemPayload
} from "../../shared/learning";
import { INITIAL_ITEMS_V1 } from "./seed-v1";

export const INITIAL_CONTENT_VERSION = 3;

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

export const INITIAL_ITEMS_V2: LearningItemPayload[] = [
  {
    id: "ko-01",
    kind: "korean-reading",
    subject: "korean",
    unit: "동화 읽기",
    title: "낱말 수첩이 풍덩",
    level: "1단계",
    readLabel: "동화 단락 읽기",
    text: "수달 또또는 새 낱말 수첩을 들고 연못가를 걸었어요. 그런데 재채기를 하자 수첩이 물에 풍덩 빠졌어요.",
    hint: "마침표에서 잠깐 쉬며 두 문장으로 읽어 봐요.",
    tokens: ["수달 또또", "낱말 수첩", "연못가", "재채기", "풍덩"],
    delight: {
      companion: "toto",
      mishap: "또또의 수첩이 수영부터 배우겠대요.",
      openingCue: "수첩보다 또또의 꼬리가 먼저 젖었대요. 낱말을 구하러 가 볼까요?",
      celebrationCue: "낱말을 모두 건졌어요! 또또가 수첩에 수건을 덮어 줬어요."
    }
  },
  {
    id: "ko-02",
    kind: "korean-reading",
    subject: "korean",
    unit: "동화 읽기",
    title: "양말을 쓴 조개",
    level: "1단계",
    readLabel: "동화 단락 읽기",
    text: "또또는 물속에서 줄무늬 조개를 만났어요. 조개는 양말을 모자로 쓰고 아주 멋지다고 뽐냈어요.",
    hint: "쉼표 없이 이어지는 짧은 문장을 천천히 읽어 봐요.",
    tokens: ["물속", "줄무늬 조개", "양말", "모자", "뽐냈어요"],
    delight: {
      companion: "toto",
      mishap: "조개가 양말을 모자라고 우기고 있어요.",
      openingCue: "조개 모자가 자꾸 발가락을 찾는대요. 무슨 일이 있었는지 읽어 봐요.",
      celebrationCue: "조개의 양말 모자가 반듯해졌어요! 또또가 박수를 쳤어요."
    }
  },
  {
    id: "ko-03",
    kind: "korean-reading",
    subject: "korean",
    unit: "동화 읽기",
    title: "콧수염이 된 미역",
    level: "2단계",
    readLabel: "동화 단락 읽기",
    text: "미역 한 줄기가 또또의 코에 착 붙었어요. 또또는 멋진 콧수염이라며 물속 거울 앞에서 빙글 돌았어요.",
    hint: "받침이 있는 낱말을 또박또박 읽어 봐요.",
    tokens: ["미역", "또또의 코", "콧수염", "물속 거울", "빙글"],
    delight: {
      companion: "toto",
      mishap: "미역이 또또의 콧수염 자리를 차지했어요.",
      openingCue: "또또의 콧수염이 바다 냄새를 폴폴 풍겨요. 천천히 따라가 봐요.",
      celebrationCue: "미역 콧수염이 찰랑 인사했어요! 어려운 낱말도 잘 읽었어요."
    }
  },
  {
    id: "ko-04",
    kind: "korean-reading",
    subject: "korean",
    unit: "동화 읽기",
    title: "거꾸로 붙은 이름표",
    level: "2단계",
    readLabel: "동화 단락 읽기",
    text: "또또는 건져 낸 낱말에 이름표를 붙였어요. 하지만 이름표를 거꾸로 붙여서 돌멩이가 멩돌이가 되었어요.",
    hint: "첫 문장과 둘째 문장의 일을 나누어 읽어 봐요.",
    tokens: ["건져 낸", "낱말", "이름표", "거꾸로", "돌멩이"],
    delight: {
      companion: "toto",
      mishap: "돌멩이 이름표가 거꾸로 매달렸어요.",
      openingCue: "멩돌이가 누구일까요? 또또와 이름표를 바로 세워 봐요.",
      celebrationCue: "이름표가 제자리를 찾았어요! 멩돌이도 다시 돌멩이가 되었어요."
    }
  },
  {
    id: "ko-05",
    kind: "korean-reading",
    subject: "korean",
    unit: "동화 읽기",
    title: "웃음 나는 우산",
    level: "3단계",
    readLabel: "동화 단락 읽기",
    text: "루미가 별 지팡이를 흔들자 작은 우산이 나타났어요. 우산은 빗방울 대신 간지러운 깃털을 내려 모두를 웃게 했어요.",
    hint: "두 문장에서 누가 무엇을 했는지 찾아 읽어 봐요.",
    tokens: ["별 지팡이", "작은 우산", "빗방울", "깃털", "웃게 했어요"],
    delight: {
      companion: "toto",
      mishap: "우산에서 비 대신 간지러운 깃털이 내려요.",
      openingCue: "루미의 우산이 날씨를 깜빡했대요. 어떤 비가 내리는지 읽어 봐요.",
      celebrationCue: "깃털 비가 멈췄어요! 루미가 웃다가 지팡이를 놓칠 뻔했어요."
    }
  },
  {
    id: "ko-06",
    kind: "korean-reading",
    subject: "korean",
    unit: "동화 읽기",
    title: "문장 기차가 덜컹",
    level: "3단계",
    readLabel: "동화 단락 읽기",
    text: "또또는 낱말 카드를 이어 문장 기차를 만들었어요. 생선 카드가 기관사 자리에 앉자 기차가 연못 쪽으로 덜컹 달렸어요.",
    hint: "긴 문장은 낱말 덩어리마다 짧게 숨을 쉬며 읽어요.",
    tokens: ["낱말 카드", "문장 기차", "생선 카드", "기관사", "덜컹"],
    delight: {
      companion: "toto",
      mishap: "생선 카드가 문장 기차의 기관사가 되었어요.",
      openingCue: "기관사 생선이 연못으로 출발했대요. 문장 기차를 놓치지 말아요.",
      celebrationCue: "문장 기차가 안전하게 도착했어요! 생선 기관사도 꾸벅 인사했어요."
    }
  },
  {
    id: "ko-07",
    kind: "korean-reading",
    subject: "korean",
    unit: "동화 읽기",
    title: "쉼표가 숨은 곳",
    level: "4단계",
    readLabel: "동화 단락 읽기",
    text: "문장 기차가 너무 빨리 달리자 쉼표가 모모의 꼬리 뒤에 숨었어요. 또또는 쉼표를 찾아 알맞은 자리에 살며시 앉혔어요.",
    hint: "쉼표가 있다고 생각되는 곳에서 잠깐 쉬어 읽어 봐요.",
    tokens: ["너무 빨리", "쉼표", "모모의 꼬리", "알맞은 자리", "살며시"],
    delight: {
      companion: "toto",
      mishap: "쉼표가 모모의 꼬리 뒤에서 숨바꼭질해요.",
      openingCue: "문장 기차가 숨도 안 쉬고 달려요. 쉼표를 찾아 천천히 읽어 봐요.",
      celebrationCue: "쉼표가 의자처럼 편히 앉았어요! 문장도 숨을 골랐어요."
    }
  },
  {
    id: "ko-08",
    kind: "korean-reading",
    subject: "korean",
    unit: "동화 읽기",
    title: "루미의 양말 주문",
    level: "4단계",
    readLabel: "동화 단락 읽기",
    text: "루미는 젖은 수첩을 말리려고 별 주문을 외웠어요. 주문을 한 글자 틀리자 하늘에서 줄무늬 양말 열 켤레가 쏟아졌어요.",
    hint: "원인과 결과가 나타나는 두 문장을 이어서 읽어 봐요.",
    tokens: ["젖은 수첩", "별 주문", "한 글자", "줄무늬 양말", "쏟아졌어요"],
    delight: {
      companion: "toto",
      mishap: "별 주문이 양말 배달 주문으로 바뀌었어요.",
      openingCue: "루미가 글자 하나를 놓쳤대요. 하늘에서 무엇이 왔는지 확인해 봐요.",
      celebrationCue: "주문을 정확히 읽었어요! 양말들은 구름 빨랫줄에 얌전히 앉았어요."
    }
  },
  {
    id: "ko-09",
    kind: "korean-reading",
    subject: "korean",
    unit: "동화 읽기",
    title: "봉봉의 비눗방울 편지",
    level: "5단계",
    readLabel: "동화 단락 읽기",
    text: "봉봉은 수첩을 말리는 불꽃을 보내려고 깊이 숨을 들이마셨어요. 입에서는 불꽃 대신 글자가 든 비눗방울이 몽글몽글 나왔어요.",
    hint: "모습이 떠오르도록 꾸며 주는 낱말에 힘을 주어 읽어 봐요.",
    tokens: ["수첩", "불꽃", "깊이", "글자가 든", "몽글몽글"],
    delight: {
      companion: "toto",
      mishap: "봉봉의 불꽃이 글자 비눗방울로 변했어요.",
      openingCue: "봉봉이 크게 숨을 들이마셨어요. 이번에는 무엇이 나올까요?",
      celebrationCue: "글자 비눗방울이 반짝 터졌어요! 봉봉은 불꽃보다 멋지다며 뿌듯해했어요."
    }
  },
  {
    id: "ko-10",
    kind: "korean-reading",
    subject: "korean",
    unit: "동화 읽기",
    title: "젖지 않는 수첩의 비밀",
    level: "5단계",
    readLabel: "동화 단락 읽기",
    text: "친구들이 모은 글자 비눗방울이 수첩 위에서 별빛으로 터졌어요. 수첩은 물에 젖지 않는 마법 수첩이 되었고 또또는 기뻐서 꼬리로 물장구를 쳤어요.",
    hint: "이야기의 마지막 장면을 떠올리며 끝까지 또박또박 읽어요.",
    tokens: ["글자 비눗방울", "별빛", "마법 수첩", "기뻐서", "물장구"],
    delight: {
      companion: "toto",
      mishap: "또또가 꼬리로 축하 물장구를 너무 크게 쳤어요.",
      openingCue: "드디어 수첩의 마지막 비밀이에요. 친구들의 글자가 어떤 마법을 만들까요?",
      celebrationCue: "마법 수첩이 완성됐어요! 또또의 물장구에 모두 다시 젖을 뻔했어요."
    }
  },
  {
    id: "math-01",
    kind: "math-story",
    subject: "math",
    unit: "숲속 수학 이야기",
    title: "포도알 주판",
    level: "1단계",
    readLabel: "수학 지문 읽기",
    text: "모모는 주판에 보라 포도알 8개를 올렸어요. 초록 포도알 7개도 더 올렸어요.",
    question: "주판 위 포도알은 모두 몇 개일까요?",
    hint: "숫자 8과 7을 먼저 찾아봐요.",
    tokens: [...MATH_TOKENS["math-01"]],
    answer: 15,
    unitLabel: "개",
    checkHint: "보라 포도알 8개와 초록 포도알 7개를 더해 봐요.",
    delight: {
      companion: "momo",
      mishap: "모모가 주판 알 대신 포도알을 올렸어요.",
      openingCue: "포도알 하나가 계산 전에 도망가려 해요. 8과 7을 잘 지켜봐요.",
      celebrationCue: "15개를 모두 찾았어요! 모모가 포도알 주판을 먹지 않고 참았어요."
    }
  },
  {
    id: "math-02",
    kind: "math-story",
    subject: "math",
    unit: "숲속 수학 이야기",
    title: "꼬리 리본 세기",
    level: "1단계",
    readLabel: "수학 지문 읽기",
    text: "친구들이 모모의 꼬리에 파란 리본 9개를 묶었어요. 노란 리본 5개도 더 묶었어요.",
    question: "모모의 꼬리에 묶인 리본은 모두 몇 개일까요?",
    hint: "파란 리본과 노란 리본의 수를 찾아봐요.",
    tokens: [...MATH_TOKENS["math-02"]],
    answer: 14,
    unitLabel: "개",
    checkHint: "파란 리본 9개와 노란 리본 5개를 더해 봐요.",
    delight: {
      companion: "momo",
      mishap: "리본이 많아져서 모모의 꼬리가 부채가 되었어요.",
      openingCue: "모모의 꼬리가 오늘따라 아주 화려해요. 리본을 세어 볼까요?",
      celebrationCue: "리본 14개를 셌어요! 모모의 꼬리가 신나서 살랑살랑 흔들려요."
    }
  },
  {
    id: "math-03",
    kind: "math-story",
    subject: "math",
    unit: "숲속 수학 이야기",
    title: "주판 알의 낮잠",
    level: "2단계",
    readLabel: "수학 지문 읽기",
    text: "주판 위에 깨어 있는 알 10개가 있었어요. 낮잠에서 깬 알 6개가 옆으로 굴러왔어요.",
    question: "깨어 있는 주판 알은 모두 몇 개일까요?",
    hint: "처음 있던 10개와 새로 온 6개를 찾아봐요.",
    tokens: [...MATH_TOKENS["math-03"]],
    answer: 16,
    unitLabel: "개",
    checkHint: "주판 알 10개와 6개를 더해 봐요.",
    delight: {
      companion: "momo",
      mishap: "주판 알들이 계산 시간에 낮잠을 잤어요.",
      openingCue: "코 고는 주판 알 6개가 이제 막 깨어났대요. 모두 몇 개가 될까요?",
      celebrationCue: "16개가 모두 깨어났어요! 모모가 주판에 작은 베개를 치웠어요."
    }
  },
  {
    id: "math-04",
    kind: "math-story",
    subject: "math",
    unit: "숲속 수학 이야기",
    title: "양말을 신은 숫자",
    level: "2단계",
    readLabel: "수학 지문 읽기",
    text: "숫자 카드 12장이 줄을 서 있었어요. 루미가 양말을 신긴 카드 4장도 더 왔어요.",
    question: "줄을 선 숫자 카드는 모두 몇 장일까요?",
    hint: "줄에 있던 12장과 더 온 4장을 찾아봐요.",
    tokens: [...MATH_TOKENS["math-04"]],
    answer: 16,
    unitLabel: "장",
    checkHint: "숫자 카드 12장과 양말 카드 4장을 더해 봐요.",
    delight: {
      companion: "momo",
      mishap: "숫자 카드 네 장이 양말을 신고 미끄러져 왔어요.",
      openingCue: "양말 신은 숫자들이 줄에서 자꾸 미끄러져요. 놓치지 말고 세어 봐요.",
      celebrationCue: "카드 16장이 줄을 섰어요! 양말 카드도 미끄럼을 멈췄어요."
    }
  },
  {
    id: "math-05",
    kind: "math-story",
    subject: "math",
    unit: "숲속 수학 이야기",
    title: "비눗방울 덧셈",
    level: "3단계",
    readLabel: "수학 지문 읽기",
    text: "봉봉이 큰 비눗방울 11개를 만들었어요. 작은 비눗방울 8개도 몽글몽글 나왔어요.",
    question: "비눗방울은 모두 몇 개일까요?",
    hint: "큰 방울 11개와 작은 방울 8개를 찾아봐요.",
    tokens: [...MATH_TOKENS["math-05"]],
    answer: 19,
    unitLabel: "개",
    checkHint: "큰 비눗방울 11개와 작은 비눗방울 8개를 더해 봐요.",
    delight: {
      companion: "momo",
      mishap: "봉봉의 비눗방울이 왕관 모양으로 줄을 섰어요.",
      openingCue: "큰 방울과 작은 방울이 서로 자기가 왕관이래요. 모두 세어 볼까요?",
      celebrationCue: "19개를 찾았어요! 마지막 방울이 봉봉 코에 톡 붙었어요."
    }
  },
  {
    id: "math-06",
    kind: "math-story",
    subject: "math",
    unit: "숲속 수학 이야기",
    title: "거꾸로 켜진 등불",
    level: "3단계",
    readLabel: "수학 지문 읽기",
    text: "파란 집에 노란 등불 13개가 켜졌어요. 모모가 초록 등불 5개를 더 켰어요.",
    question: "켜진 등불은 모두 몇 개일까요?",
    hint: "노란 등불과 초록 등불을 나누어 찾아봐요.",
    tokens: [...MATH_TOKENS["math-06"]],
    answer: 18,
    unitLabel: "개",
    checkHint: "노란 등불 13개와 초록 등불 5개를 더해 봐요.",
    delight: {
      companion: "momo",
      mishap: "모모가 등불 하나를 거꾸로 달아 바닥이 환해졌어요.",
      openingCue: "천장보다 바닥이 더 밝아졌대요. 그래도 등불 수는 정확히 셀 수 있어요.",
      celebrationCue: "등불 18개가 반짝여요! 거꾸로 등불도 제자리를 찾았어요."
    }
  },
  {
    id: "math-07",
    kind: "math-story",
    subject: "math",
    unit: "숲속 수학 이야기",
    title: "숲속 간식 배달",
    level: "4단계",
    readLabel: "수학 지문 읽기",
    text: "또또의 바구니에 조개 과자 7개가 있었어요. 루미가 당근 과자 12개를 더 가져왔어요.",
    question: "바구니 속 과자는 모두 몇 개일까요?",
    hint: "조개 과자와 당근 과자의 수를 찾아봐요.",
    tokens: [...MATH_TOKENS["math-07"]],
    answer: 19,
    unitLabel: "개",
    checkHint: "조개 과자 7개와 당근 과자 12개를 더해 봐요.",
    delight: {
      companion: "momo",
      mishap: "모모가 과자 하나를 주판 알로 쓰려 했어요.",
      openingCue: "과자는 먹기 전에 계산부터 해야 한대요. 두 바구니를 살펴봐요.",
      celebrationCue: "과자 19개를 정확히 셌어요! 모모가 주판 대신 접시를 가져왔어요."
    }
  },
  {
    id: "math-08",
    kind: "math-story",
    subject: "math",
    unit: "숲속 수학 이야기",
    title: "별 계단 세 칸",
    level: "4단계",
    readLabel: "수학 지문 읽기",
    text: "친구들이 빛나는 계단 14칸을 만들었어요. 봉봉의 재채기로 계단 3칸이 더 생겼어요.",
    question: "빛나는 계단은 모두 몇 칸일까요?",
    hint: "처음 14칸과 새로 생긴 3칸을 찾아봐요.",
    tokens: [...MATH_TOKENS["math-08"]],
    answer: 17,
    unitLabel: "칸",
    checkHint: "빛나는 계단 14칸과 3칸을 더해 봐요.",
    delight: {
      companion: "momo",
      mishap: "봉봉이 재채기할 때마다 계단이 한 칸씩 생겼어요.",
      openingCue: "봉봉이 에취에취 재채기하자 계단 세 칸이 더 생겼대요. 모두 몇 칸일까요?",
      celebrationCue: "계단 17칸을 완성했어요! 봉봉은 재채기에도 꾸벅 인사했어요."
    }
  },
  {
    id: "math-09",
    kind: "math-story",
    subject: "math",
    unit: "숲속 수학 이야기",
    title: "의자가 된 숫자 카드",
    level: "5단계",
    readLabel: "수학 지문 읽기",
    text: "광장에 작은 의자 6개가 있었어요. 숫자 카드가 접혀서 의자 13개로 더 변했어요.",
    question: "광장의 의자는 모두 몇 개일까요?",
    hint: "처음 의자 6개와 카드 의자 13개를 찾아봐요.",
    tokens: [...MATH_TOKENS["math-09"]],
    answer: 19,
    unitLabel: "개",
    checkHint: "작은 의자 6개와 카드 의자 13개를 더해 봐요.",
    delight: {
      companion: "momo",
      mishap: "숫자 카드들이 공부보다 먼저 의자에 앉았어요.",
      openingCue: "숫자 카드가 스스로 의자가 되었대요. 앉기 전에 모두 세어 봐요.",
      celebrationCue: "의자 19개를 찾았어요! 숫자 카드도 바른 자세로 앉았어요."
    }
  },
  {
    id: "math-10",
    kind: "math-story",
    subject: "math",
    unit: "숲속 수학 이야기",
    title: "우당탕 축하 모자",
    level: "5단계",
    readLabel: "수학 지문 읽기",
    text: "봉봉이 별 모자 15개를 쌓았어요. 루미의 지팡이에서 양말 모자 5개가 더 나왔어요.",
    question: "축하 모자는 모두 몇 개일까요?",
    hint: "별 모자 15개와 양말 모자 5개를 찾아봐요.",
    tokens: [...MATH_TOKENS["math-10"]],
    answer: 20,
    unitLabel: "개",
    checkHint: "별 모자 15개와 양말 모자 5개를 더해 봐요.",
    delight: {
      companion: "momo",
      mishap: "루미의 지팡이가 모자 대신 양말을 또 만들었어요.",
      openingCue: "별 모자와 양말 모자가 한 줄로 행진해요. 모두 몇 개인지 알아볼까요?",
      celebrationCue: "모자 20개를 셌어요! 봉봉은 양말 모자를 쓰고도 아주 신났어요."
    }
  }
];

const V3_KOREAN_ITEMS = INITIAL_ITEMS_V2
  .filter((item) => item.subject === "korean")
  .map((item) => JSON.parse(JSON.stringify(item)
    .replaceAll("루미", "버니")
    .replaceAll("봉봉", "밀키")) as LearningItemPayload);

type CalculationSeed = [
  id: string,
  operands: [number, number] | [number, number, number],
  operators: ["+"] | ["-"] | ["+", "+"] | ["+", "-"] | ["-", "+"] | ["-", "-"],
  layout: "horizontal" | "vertical",
  answer: number,
  mishap: string,
  openingCue: string,
  celebrationCue: string
];

const CALCULATION_ITEMS: LearningItemPayload[] = ([
  ["math-01", [13, 9, 4], ["+", "+"], "horizontal", 26,
    "숫자 카드 세 장이 기차처럼 이어졌어요.",
    "버니가 첫 카드부터 차례로 보자고 속삭였어요.",
    "세 수를 모두 더했어요! 밀키가 손뼉을 쳤어요."],
  ["math-02", [21, 2, 8], ["+", "+"], "horizontal", 31,
    "두 번째 숫자가 숨바꼭질을 하려고 숨었어요.",
    "밀키가 숨은 숫자를 찾아 제자리에 놓았어요.",
    "왼쪽부터 끝까지 계산했어요! 버니가 별을 그려 줬어요."],
  ["math-03", [17, 3, 6], ["+", "+"], "horizontal", 26,
    "더하기 표시들이 서로 먼저 가겠다고 줄을 섰어요.",
    "버니가 왼쪽 표시부터 천천히 가자고 했어요.",
    "더하기 길을 바르게 걸었어요! 밀키가 기쁨의 춤을 추었어요."],
  ["math-04", [21, 6, 9], ["+", "-"], "horizontal", 18,
    "더하기와 빼기가 한 모자를 같이 쓰려고 했어요.",
    "밀키가 표시를 하나씩 가리키며 순서를 알려 줬어요.",
    "더하고 빼는 순서를 지켰어요! 버니가 환하게 웃었어요."],
  ["math-05", [23, 7, 4], ["-", "-"], "horizontal", 12,
    "빼기 표시 하나가 뒤로 거꾸로 걸어갔어요.",
    "버니가 표시의 어깨를 톡톡 두드려 앞을 보게 했어요.",
    "두 번 빼기를 잘 해냈어요! 밀키가 작은 깃발을 흔들었어요."],
  ["math-06", [15, 5, 3], ["-", "-"], "horizontal", 7,
    "숫자 세 개가 작은 의자 하나에 함께 앉았어요.",
    "밀키가 한 칸씩 떨어져 앉으면 계산하기 편하다고 했어요.",
    "조금씩 빼서 답을 찾았어요! 버니가 의자를 반듯하게 정리했어요."],
  ["math-07", [27, 6], ["+"], "vertical", 33,
    "위의 숫자가 넘어질까 봐 바닥을 꽉 잡았어요.",
    "버니가 일의 자리부터 반듯하게 맞추어 주었어요.",
    "세로줄을 따라 합을 찾았어요! 밀키가 긴 리본을 펼쳤어요."],
  ["math-08", [44, 9], ["-"], "vertical", 35,
    "아래 숫자가 위칸을 구경하러 올라갔어요.",
    "밀키가 각 숫자를 자릿수에 맞게 다시 세웠어요.",
    "자릿수를 맞춰 빼기를 끝냈어요! 버니가 기쁨의 종을 울렸어요."],
  ["math-09", [38, 7], ["+"], "vertical", 45,
    "일의 자리 숫자들이 먼저 놀이를 시작했어요.",
    "버니가 일의 자리를 먼저 계산해 보자고 했어요.",
    "받아올림까지 잊지 않았어요! 밀키가 별 도장을 꾹 눌러 줬어요."],
  ["math-10", [56, 8], ["-"], "vertical", 48,
    "빼기 표시가 숫자 사이에서 길을 잃었어요.",
    "밀키가 표시를 제자리에 놓고 차분히 빼 보자고 했어요.",
    "세로셈 마지막 답을 찾았어요! 버니가 완성 표시를 붙였어요."]
] satisfies CalculationSeed[]).map(([
  id, operands, operators, layout, answer,
  mishap, openingCue, celebrationCue
], index) => ({
  id,
  kind: "math-story" as const,
  subject: "math" as const,
  unit: operands.length === 2 ? "받아올림과 받아내림" : "세 수의 혼합 계산",
  title: layout === "vertical" ? `세로셈 ${index - 5}` : `세 수 계산 ${index + 1}`,
  level: `${Math.ceil((index + 1) / 2)}단계`,
  readLabel: layout === "vertical" ? "세로셈 계산하기" : "식을 읽고 계산하기",
  text: operands.map(String).join(" ") + "을(를) 차례대로 계산해요.",
  hint: layout === "vertical" ? "일의 자리부터 차분히 계산해요." : "왼쪽부터 한 번씩 계산해요.",
  tokens: operands.map(String),
  question: "계산한 답은 얼마일까요?",
  answer,
  unitLabel: "",
  calculation: { operands, operators, layout },
  checkHint: "계산 순서를 다시 확인해 봐요.",
  delight: {
    companion: "momo",
    mishap,
    openingCue,
    celebrationCue
  }
}));

export const INITIAL_ITEMS: LearningItemPayload[] = [
  ...V3_KOREAN_ITEMS,
  ...CALCULATION_ITEMS
];

const CURRICULUM_NODES = [
  { id: "grade-1", parentId: null, kind: "grade", code: "grade-1", title: "1학년", sortOrder: 1 },
  { id: "subject-korean", parentId: "grade-1", kind: "subject", code: "grade-1.korean", title: "국어", sortOrder: 1 },
  { id: "subject-math", parentId: "grade-1", kind: "subject", code: "grade-1.math", title: "수학", sortOrder: 2 },
  { id: "unit-korean-reading", parentId: "subject-korean", kind: "unit", code: "grade-1.korean.reading", title: "동화 읽기", sortOrder: 1 },
  { id: "unit-math-story", parentId: "subject-math", kind: "unit", code: "grade-1.math.story", title: "숲속 수학 이야기", sortOrder: 1 },
  { id: "unit-math-calculation", parentId: "subject-math", kind: "unit", code: "grade-1.math.calculation", title: "받아올림과 받아내림", sortOrder: 2 },
  { id: "skill-korean-reading", parentId: "unit-korean-reading", kind: "skill", code: "grade-1.korean.reading.paragraph", title: "짧은 단락 읽기", sortOrder: 1 },
  { id: "skill-math-story", parentId: "unit-math-story", kind: "skill", code: "grade-1.math.story.answer", title: "지문 읽고 답하기", sortOrder: 1 },
  { id: "skill-math-calculation", parentId: "unit-math-calculation", kind: "skill", code: "grade-1.math.calculation.mixed", title: "세 수의 혼합 계산", sortOrder: 1 }
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
      (@id, @skillId, @subject, @activeVersion, @createdAt)
  `);
  const insertVersion = db.prepare(`
    INSERT OR IGNORE INTO content_versions
      (item_id, version, payload_json, created_at)
    VALUES
      (@itemId, @version, @payloadJson, @createdAt)
  `);

  const promoteInitialItem = db.prepare(`
    UPDATE content_items
    SET active_version = @version
    WHERE id = @itemId AND active_version < 3
  `);
  const promoteCalculationSkill = db.prepare(`
    UPDATE content_items
    SET skill_id = 'skill-math-calculation'
    WHERE id = @itemId AND active_version < 3
  `);

  db.transaction(() => {
    for (const node of CURRICULUM_NODES) {
      insertNode.run(node);
    }

    const createdAt = new Date().toISOString();
    for (const item of INITIAL_ITEMS) {
      const legacyItem = INITIAL_ITEMS_V1.find(({ id }) => id === item.id);
      const versionTwoItem = INITIAL_ITEMS_V2.find(({ id }) => id === item.id);
      if (!legacyItem || !versionTwoItem) {
        throw new Error(`INITIAL_CONTENT_V1_MISSING:${item.id}`);
      }
      const skillId = item.kind === "korean-reading"
        ? "skill-korean-reading"
        : isCalculationItem(item)
          ? "skill-math-calculation"
          : "skill-math-story";

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
        itemId: versionTwoItem.id,
        version: 2,
        payloadJson: JSON.stringify(versionTwoItem),
        createdAt
      });
      insertVersion.run({
        itemId: item.id,
        version: 3,
        payloadJson: JSON.stringify(item),
        createdAt
      });
      if (isCalculationItem(item)) {
        promoteCalculationSkill.run({ itemId: item.id });
      }
      promoteInitialItem.run({
        itemId: item.id,
        version: INITIAL_CONTENT_VERSION
      });
    }
  })();
}
