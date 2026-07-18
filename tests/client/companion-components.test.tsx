// @vitest-environment jsdom
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CompanionAvatar } from "../../src/client/companions/companion-avatar";
import { COMPANION_CAST } from "../../src/client/companions/cast";
import {
  FriendStage,
  FriendTrail
} from "../../src/client/companions/friend-stage";
import { ChanaPingCoach } from "../../src/client/companions/chanaping";
import { LearningCompanion } from "../../src/client/companions/learning-companion";
import type { CalculationItem, KoreanDictationItem } from "../../src/shared/learning";

afterEach(cleanup);

describe("magical companion components", () => {
  it("reserves Bunny for guidance and makes Milky the calculation and dictation helper", () => {
    expect(COMPANION_CAST.lumi.role).toBe("버니 별빛 길 안내자");
    expect(COMPANION_CAST.bongbong.role).toBe("밀키 계산·받아쓰기 공부 조수");

    const calculation: CalculationItem = {
      id: "calculation-helper",
      kind: "math-story" as const,
      subject: "math" as const,
      unit: "받아올림과 받아내림",
      title: "계산 도움",
      level: "1단계",
      readLabel: "계산",
      text: "12 + 9",
      hint: "10을 먼저 만들어요.",
      tokens: ["12", "9"],
      question: "12 + 9 = ?",
      answer: 21,
      unitLabel: "",
      checkHint: "2와 9를 먼저 더해요.",
      calculation: { operands: [12, 9], operators: ["+"], layout: "vertical" },
      delight: {
        companion: "momo",
        mishap: "모모의 주판이 흔들렸어요.",
        openingCue: "모모가 계산판을 펼쳤어요.",
        celebrationCue: "계산을 끝냈어요."
      }
    };
    const dictation: KoreanDictationItem = {
      id: "dictation-helper",
      kind: "korean-dictation",
      subject: "korean",
      unit: "받아쓰기",
      title: "받아쓰기 도움",
      level: "1단계",
      readLabel: "다시 듣기",
      text: "들은 내용을 써요.",
      hint: "천천히 들어요.",
      tokens: ["봄비"],
      promptText: "봄비",
      answerText: "봄비",
      mode: "word"
    };

    const calculationView = render(<LearningCompanion
      moment="lesson-open"
      studyDate="2026-07-19"
      item={calculation}
    />);
    expect(screen.getByRole("status", { name: "마법 친구 말풍선" }))
      .toHaveTextContent("아기용 밀키");
    expect(screen.queryByText("차나핑")).not.toBeInTheDocument();
    calculationView.unmount();

    render(<LearningCompanion
      moment="retry"
      studyDate="2026-07-19"
      item={dictation}
    />);
    expect(screen.getByRole("status", { name: "마법 친구 말풍선" }))
      .toHaveTextContent("아기용 밀키");
    expect(screen.queryByText("별토끼 버니")).not.toBeInTheDocument();
    expect(screen.queryByText("차나핑")).not.toBeInTheDocument();
  });

  it("keeps generic reading transitions with Toto and uses Bunny only for an authoritative reward", () => {
    for (const moment of [
      "next", "offline", "save-wait", "idle-confirm", "idle-paused"
    ] as const) {
      const view = render(<LearningCompanion
        moment={moment}
        studyDate="2026-07-19"
        item={{
          id: "reading-role-boundary",
          kind: "korean-reading",
          subject: "korean",
          unit: "읽기",
          title: "역할 확인",
          level: "1단계",
          readLabel: "읽기",
          text: "봄비가 내려요.",
          hint: "천천히 읽어요.",
          tokens: ["봄비"]
        }}
      />);
      expect(screen.getByRole("status", { name: "마법 친구 말풍선" }))
        .toHaveTextContent("수달 또또");
      expect(screen.queryByText("별토끼 버니")).not.toBeInTheDocument();
      expect(screen.queryByText("아기용 밀키")).not.toBeInTheDocument();
      view.unmount();
    }

    render(<LearningCompanion
      moment="correct"
      studyDate="2026-07-19"
      item={{
        id: "reading-reward-boundary",
        kind: "korean-reading",
        subject: "korean",
        unit: "읽기",
        title: "보상 확인",
        level: "1단계",
        readLabel: "읽기",
        text: "봄비가 내려요.",
        hint: "천천히 읽어요.",
        tokens: ["봄비"]
      }}
      bunnyMoment="reward"
    />);
    expect(screen.getByRole("status", { name: "마법 친구 말풍선" }))
      .toHaveTextContent("별토끼 버니");
  });
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

  it("keeps Lumi current on a zero-required rest day", () => {
    render(<FriendStage
      studyDate="2026-07-17"
      itemId={null}
      subject={null}
      completedCount={0}
      totalCount={0}
    />);

    const currentFriend = screen.getByRole("listitem", { current: true });
    expect(within(currentFriend).getByText("별토끼 버니")).toBeVisible();
    expect(within(currentFriend).queryByText("아기용 밀키")).not.toBeInTheDocument();
    expect(screen.getByText("오늘은 쉬는 날이에요")).toBeVisible();
    expect(screen.getAllByRole("status", { name: "마법 친구 말풍선" }))
      .toHaveLength(1);
  });

  it("shows a unique friend trail without deriving rewards", () => {
    render(<FriendTrail
      completedCount={2}
      totalCount={4}
      metCompanions={["toto", "toto", "momo"]}
    />);

    expect(screen.getByText("오늘 함께한 친구")).toBeVisible();
    expect(screen.getByText("수달 또또")).toBeVisible();
    expect(screen.getByText("너구리 모모")).toBeVisible();
    expect(screen.getAllByText("수달 또또")).toHaveLength(1);
    expect(screen.getByText("마법 걸음 2/4")).toBeVisible();
    expect(screen.queryByText(/별/)).not.toBeInTheDocument();
  });

  it("shows an empty, incomplete friend trail on a rest day", () => {
    render(<FriendTrail
      completedCount={0}
      totalCount={0}
      metCompanions={["bongbong"]}
    />);

    expect(screen.getByText("오늘은 쉬는 날")).toBeVisible();
    expect(screen.getByRole("list")).toBeEmptyDOMElement();
    expect(screen.queryByText("아기용 밀키")).not.toBeInTheDocument();
    expect(screen.queryByText("마법 걸음 0/0")).not.toBeInTheDocument();
  });

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

  it("emits generated SVG lines without trailing whitespace", async () => {
    const sources = await Promise.all(
      (["lumi", "toto", "momo", "bongbong"] as const).map((id) =>
        readFile(resolve(`public/assets/companions/${id}.svg`), "utf8")
      )
    );

    for (const source of sources) {
      expect(source).not.toMatch(/[ \t]+$/mu);
    }
  });

  it("renders the local ChanaPing coach with Korean alt text and a 48px hide control", () => {
    render(<ChanaPingCoach
      event="lesson-open"
      subject="korean"
      retryCount={0}
      cueKey="2026-07-18:ko-01"
      hidden={false}
      onHide={() => undefined}
    />);

    expect(screen.getByRole("img", { name: "누운 차나핑 학습 코치" }))
      .toHaveAttribute("src", "/assets/companions/chanaping.svg");
    expect(screen.getByLabelText("차나핑 학습 코치"))
      .toHaveAttribute("data-chanaping-mood", "rest");
    expect(screen.getByRole("status", { name: "차나핑 코치" })).toBeVisible();
    expect(screen.getByRole("button", { name: "차나핑 코치 숨기기" }))
      .toHaveClass("chanaping-coach__hide");
  });

  it.each([
    ["correct", "chanaping-celebrate.svg"],
    ["retry", "chanaping-grumble.svg"],
    ["thinking", "chanaping-bored.svg"]
  ] as const)("shows the %s ChanaPing art for %s", (event, asset) => {
    render(<ChanaPingCoach
      event={event}
      subject="math"
      retryCount={1}
      cueKey="2026-07-18:math-01"
      hidden={false}
      onHide={() => undefined}
    />);

    expect(screen.getByRole("img", { name: "누운 차나핑 학습 코치" }))
      .toHaveAttribute("src", `/assets/companions/${asset}`);
  });

  it("does not request an AI cue while hidden", async () => {
    const requestMessage = vi.fn().mockResolvedValue({
      message: "차근차근 해 보자",
      source: "llm" as const
    });

    render(<ChanaPingCoach
      event="lesson-open"
      subject="korean"
      retryCount={0}
      cueKey="2026-07-18:ko-hidden"
      requestMessage={requestMessage}
      hidden
      onHide={() => undefined}
    />);

    await act(async () => undefined);
    expect(requestMessage).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("차나핑 학습 코치")).not.toBeInTheDocument();
  });

  it("aborts an in-flight AI cue when the coach becomes hidden", async () => {
    const requestMessage = vi.fn((_input, signal?: AbortSignal) =>
      new Promise<{ message: string; source: "llm" }>((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      })
    );
    const view = render(<ChanaPingCoach
      event="lesson-open"
      subject="math"
      retryCount={0}
      cueKey="2026-07-18:math-visible"
      requestMessage={requestMessage}
      hidden={false}
      onHide={() => undefined}
    />);
    await waitFor(() => expect(requestMessage).toHaveBeenCalledOnce());
    const signal = requestMessage.mock.calls[0]?.[1] as AbortSignal;

    view.rerender(<ChanaPingCoach
      event="lesson-open"
      subject="math"
      retryCount={0}
      cueKey="2026-07-18:math-visible"
      requestMessage={requestMessage}
      hidden
      onHide={() => undefined}
    />);

    expect(signal.aborted).toBe(true);
  });

  it("does not re-announce duplicate LLM text inside the repeat window", async () => {
    const requestMessage = vi.fn().mockResolvedValue({
      message: "한 걸음씩 해 보자",
      source: "llm" as const
    });
    const view = render(<ChanaPingCoach
      event="lesson-open"
      subject="math"
      retryCount={0}
      cueKey="2026-07-18:math-repeat"
      requestMessage={requestMessage}
      hidden={false}
      onHide={() => undefined}
    />);
    expect(await screen.findByText("한 걸음씩 해 보자")).toBeVisible();

    view.rerender(<ChanaPingCoach
      event="retry"
      subject="math"
      retryCount={1}
      cueKey="2026-07-18:math-repeat"
      requestMessage={requestMessage}
      hidden={false}
      onHide={() => undefined}
    />);

    await waitFor(() => expect(requestMessage).toHaveBeenCalledTimes(2));
    await waitFor(() => {
      expect(screen.queryByText("한 걸음씩 해 보자")).not.toBeInTheDocument();
    });
  });

  it("keeps the original local coach SVG small and free of external or executable content", async () => {
    const source = await readFile(resolve("public/assets/companions/chanaping.svg"), "utf8");

    expect(source).toContain('viewBox="0 0 240 240"');
    expect(source).toMatch(/teal|#1f9d8b/i);
    expect(source).not.toMatch(/<script|<foreignObject|onload=|(?:href|src)=["']https?:/i);
    expect(Buffer.byteLength(source)).toBeLessThanOrEqual(120_000);
  });

  it("keeps ChanaPing emotion art local, small, and inert", async () => {
    const sources = await Promise.all(
      (["celebrate", "grumble", "bored", "focus"] as const).map((mood) =>
        readFile(resolve(`public/assets/companions/chanaping-${mood}.svg`), "utf8")
      )
    );

    for (const source of sources) {
      expect(source).toContain('viewBox="0 0 240 240"');
      expect(source).toMatch(/teal|#1f9d8b/i);
      expect(source).not.toMatch(/<script|<foreignObject|on[a-z]+\s*=|(?:href|src)\s*=/i);
      expect(Buffer.byteLength(source)).toBeLessThanOrEqual(120_000);
    }
  });
});
