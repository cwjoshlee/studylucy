import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { INITIAL_ITEMS_V1 } from "../../src/server/db/seed-v1";
import { INITIAL_ITEMS_V2 } from "../../src/server/db/seed-v2";
import {
  INITIAL_CONTENT_VERSION,
  INITIAL_ITEMS
} from "../../src/server/db/seed";
import {
  isCalculationItem,
  LearningItemPayloadSchema
} from "../../src/shared/learning";

const LegacyKoreanChildCueSchema455f750 = z.string()
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
      context.addIssue({ code: "custom", message: "AT_MOST_TWO_SENTENCES" });
    }
  });
const LegacyDelightSchema455f750 = z.object({
  companion: z.enum(["lumi", "toto", "momo", "bongbong"]),
  mishap: LegacyKoreanChildCueSchema455f750,
  openingCue: LegacyKoreanChildCueSchema455f750,
  celebrationCue: LegacyKoreanChildCueSchema455f750
}).strict();
const LegacyBaseItemSchema455f750 = z.object({
  id: z.string().min(1),
  subject: z.enum(["korean", "math"]),
  unit: z.string().min(1),
  title: z.string().min(1),
  level: z.string().min(1),
  readLabel: z.string().min(1),
  text: z.string().min(1),
  hint: z.string(),
  tokens: z.array(z.string().min(1)).min(1),
  delight: LegacyDelightSchema455f750.optional()
});
const LegacyLearningItemPayloadSchema455f750 = z.discriminatedUnion("kind", [
  LegacyBaseItemSchema455f750.extend({ kind: z.literal("korean-reading") }),
  LegacyBaseItemSchema455f750.extend({
    kind: z.literal("math-story"),
    question: z.string().min(1),
    answer: z.number().int(),
    unitLabel: z.string(),
    checkHint: z.string().min(1)
  })
]);

const PAYLOAD_HASHES = {
  "ko-01": "add18e0a89b8d54bf5ffbbf9190fad68f3a6b4ee20647dbdc48997221b2ed694",
  "ko-02": "3f12ea37e1869eee983f3a60655de2f6889901184456e761c4afef4312aeca36",
  "ko-03": "24f6828631b9d87986cd4069e85507315b3df40b9d4c84a9e3796c51ad1c9c68",
  "ko-04": "6336aa769b4376a04de6ede7ac4609a963a517039b1509ca313be75154a88a58",
  "ko-05": "1a7f8af228f81c9328ee0158e4ad2bf4ccffa080dea70170b2e0efe83ac3aa64",
  "ko-06": "05a204a0d11d60fcaa8c2d35902c05d2895876ff93b0f176ad3ef8b62b19baca",
  "ko-07": "eb6dcb59483dd5bfc3813720f8f91009aa1f9d2d62c592557ab0a5f213587d66",
  "ko-08": "dab4528141397e4f30d022159037d0258515825b8398d4963114c86db744748a",
  "ko-09": "80f0837782393ab7c4e9e2eade6b22dba14432382301dbf11f0c8a2df58b2b23",
  "ko-10": "5c7df0653e562753f199772b400e8266d4ae5868671778fdec8eca6f4b610b25",
  "math-01": "0ada28fab5aaa1fd857e28f1016888d073cb47689944b9a8e0da039e1cdf45ec",
  "math-02": "bee95fc4e89ede4a4f6eee196aa6a1ea4551f333f48fe6a12654552bab1aacb4",
  "math-03": "c7c874195b14ee19d2281e5b63a858496531dcdae1628bae838b6c8c4e83c05e",
  "math-04": "32c400e326f512abda82b05900eaf3e31aabd1eb27a346cdd3c709639357527d",
  "math-05": "7bb684c418a1a223b66e4f6e97041e717c9c66b5ee42b5dd41d68b72ffdb8ff6",
  "math-06": "9ec4d1c6ff5a993f64fc16be57befda4187b386133da91934609ea6b71247701",
  "math-07": "c6532946ac828bf7dde484a5ef31a04df48d0a049b1e4258b3a2f05811e7e780",
  "math-08": "5a3aef20f32997e80dca6280aae4e348b663ad878a779ee9203bd79009c3565b",
  "math-09": "3f2de65a6fe0b391b3b492fd50ad5794716de06760b2505dcb6f1ca940f3413b",
  "math-10": "91fd61fb875ea1c03e20e08a3f4cc299cd9ce1b31ba0dfcbd944c3077d074f70"
} as const;

const ICON_HASHES = {
  "apple-touch-icon.png": "f596d9540331a5203c2355eac41ed00b47a3e5c610ae09865a269f52305a6664",
  "icon-192.png": "c5c8d5cc37e0bb7964ce1914c1fe858a048454d7a0d84338693b944bd1629505",
  "icon-512.png": "310f185a0b3493e47f08dd2134bd7709276fc364cee95400d72a021f3903313b",
  "study-desk.png": "7f88d5d04ead8d5bc1854d14d1d19702c089e122f836dafdbfa37edf9bb0cd2d"
} as const;

const APPROVED_V2_IDS = [
  "ko-01", "ko-02", "ko-03", "ko-04", "ko-05",
  "ko-06", "ko-07", "ko-08", "ko-09", "ko-10",
  "math-01", "math-02", "math-03", "math-04", "math-05",
  "math-06", "math-07", "math-08", "math-09", "math-10"
] as const;

const APPROVED_V2_TITLES = [
  "낱말 수첩이 풍덩",
  "양말을 쓴 조개",
  "콧수염이 된 미역",
  "거꾸로 붙은 이름표",
  "웃음 나는 우산",
  "문장 기차가 덜컹",
  "쉼표가 숨은 곳",
  "루미의 양말 주문",
  "봉봉의 비눗방울 편지",
  "젖지 않는 수첩의 비밀",
  "포도알 주판",
  "꼬리 리본 세기",
  "주판 알의 낮잠",
  "양말을 신은 숫자",
  "비눗방울 덧셈",
  "거꾸로 켜진 등불",
  "숲속 간식 배달",
  "별 계단 세 칸",
  "의자가 된 숫자 카드",
  "우당탕 축하 모자"
] as const;

function canonical(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) =>
      `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

describe("retired prototype parity manifest", () => {
  it("preserves all 20 normalized learning payload hashes", () => {
    const actual = Object.fromEntries(INITIAL_ITEMS_V1.map((item) => [
      item.id,
      sha256(canonical(item))
    ]));

    expect(INITIAL_ITEMS_V1).toHaveLength(20);
    expect(actual).toEqual(PAYLOAD_HASHES);
  });

  it("preserves every migrated prototype icon hash", async () => {
    const actual = Object.fromEntries(await Promise.all(
      Object.keys(ICON_HASHES).map(async (filename) => [
        filename,
        sha256(await readFile(resolve("public/assets", filename)))
      ])
    ));

    expect(actual).toEqual(ICON_HASHES);
  });
});

describe("approved version 2 content contract", () => {
  it("preserves the version 2 payload JSON byte-for-byte", () => {
    expect(sha256(JSON.stringify(INITIAL_ITEMS_V2)))
      .toBe("1f4949569376f0c8119a9bd5267c78bde99af97097c490caccadd4c457d98c80");
    expect(INITIAL_ITEMS_V2.map(({ id }) => id)).toEqual(APPROVED_V2_IDS);
    expect(INITIAL_ITEMS_V2.map(({ title }) => title)).toEqual(APPROVED_V2_TITLES);
  });

  it("publishes ten legacy-parseable calculation extensions as active version 3", () => {
    const calculations = INITIAL_ITEMS.filter(
      isCalculationItem
    );
    expect(INITIAL_CONTENT_VERSION).toBe(3);
    expect(calculations).toHaveLength(10);
    expect(calculations.map((item) => [
      item.id,
      item.kind,
      item.calculation?.operands,
      item.calculation?.operators,
      item.calculation?.layout,
      item.answer
    ])).toEqual([
      ["math-01", "math-story", [13, 9, 4], ["+", "+"], "horizontal", 26],
      ["math-02", "math-story", [21, 2, 8], ["+", "+"], "horizontal", 31],
      ["math-03", "math-story", [17, 3, 6], ["+", "+"], "horizontal", 26],
      ["math-04", "math-story", [21, 6, 9], ["+", "-"], "horizontal", 18],
      ["math-05", "math-story", [23, 7, 4], ["-", "-"], "horizontal", 12],
      ["math-06", "math-story", [15, 5, 3], ["-", "-"], "horizontal", 7],
      ["math-07", "math-story", [27, 6], ["+"], "vertical", 33],
      ["math-08", "math-story", [44, 9], ["-"], "vertical", 35],
      ["math-09", "math-story", [38, 7], ["+"], "vertical", 45],
      ["math-10", "math-story", [56, 8], ["-"], "vertical", 48]
    ]);
    expect(calculations.map((item) => item.calculation?.layout))
      .toEqual(expect.arrayContaining(["horizontal", "vertical"]));
    for (const item of calculations) {
      expect(LegacyLearningItemPayloadSchema455f750.safeParse(item).success, item.id)
        .toBe(true);
    }
    expect(JSON.stringify(INITIAL_ITEMS.filter((item) => item.subject === "korean")))
      .not.toMatch(/루미|봉봉/);
  });

  it("rejects invalid calculation payloads and round-trips every approved v3 payload", () => {
    const calculation = {
      id: "calculation-contract",
      kind: "math-story",
      subject: "math",
      unit: "세 수의 혼합 계산",
      title: "계산해 봐요",
      level: "1단계",
      readLabel: "식을 읽어 봐요",
      text: "13 더하기 9 더하기 4예요.",
      hint: "왼쪽부터 계산해요.",
      tokens: ["13", "9", "4"],
      question: "계산한 답은 얼마일까요?",
      answer: 26,
      unitLabel: "",
      calculation: {
        operands: [13, 9, 4],
        operators: ["+", "+"],
        layout: "horizontal"
      },
      checkHint: "13과 9를 더한 뒤 4를 더해요."
    };
    expect(LearningItemPayloadSchema.safeParse(calculation).success).toBe(true);
    for (const invalid of [
      { ...calculation, calculation: { ...calculation.calculation, operators: ["+"] } },
      { ...calculation, subject: "korean" },
      { ...calculation, answer: 25 },
      { ...calculation, calculation: { ...calculation.calculation, operands: [-1, 9, 4] } },
      { ...calculation, calculation: { ...calculation.calculation, operands: [4, 9, 1], operators: ["-", "+"] }, answer: -4 },
      { ...calculation, calculation: { operands: [90, 20], operators: ["+"], layout: "horizontal" }, answer: 110 },
      { ...calculation, calculation: { operands: [90, 20, 20], operators: ["+", "-"], layout: "horizontal" }, answer: 90 },
      { ...calculation, calculation: { ...calculation.calculation, layout: "vertical" } }
    ]) {
      expect(LearningItemPayloadSchema.safeParse(invalid).success).toBe(false);
    }
    const roundTripped = INITIAL_ITEMS.map((item) =>
      LearningItemPayloadSchema.parse(JSON.parse(JSON.stringify(item))));

    expect(roundTripped).toEqual(INITIAL_ITEMS);
  });
});
