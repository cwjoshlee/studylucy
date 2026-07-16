import { describe, expect, it } from "vitest";
import { collapseSpeechSegments } from "../../src/client/learning/speech-recognition";

describe("speech transcript buffer", () => {
  it("drains source parts while preserving the transcript for callback delivery", () => {
    const committedParts = ["작은 씨앗이", "씨앗이 해를 보았어요"];

    const transcript = collapseSpeechSegments(committedParts);

    expect(transcript).toBe("작은 씨앗이 해를 보았어요");
    expect(committedParts).toEqual([]);
  });
});
