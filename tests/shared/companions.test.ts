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
