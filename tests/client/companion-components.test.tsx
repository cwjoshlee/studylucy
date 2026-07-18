// @vitest-environment jsdom
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CompanionAvatar } from "../../src/client/companions/companion-avatar";
import { COMPANION_CAST } from "../../src/client/companions/cast";
import {
  FriendStage,
  FriendTrail
} from "../../src/client/companions/friend-stage";
import { ChanaPingCoach } from "../../src/client/companions/chanaping";

afterEach(cleanup);

describe("magical companion components", () => {
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
    expect(screen.getByRole("status", { name: "차나핑 코치" })).toBeVisible();
    expect(screen.getByRole("button", { name: "차나핑 코치 숨기기" }))
      .toHaveClass("chanaping-coach__hide");
  });

  it("keeps the original local coach SVG small and free of external or executable content", async () => {
    const source = await readFile(resolve("public/assets/companions/chanaping.svg"), "utf8");

    expect(source).toContain('viewBox="0 0 240 240"');
    expect(source).toMatch(/teal|#1f9d8b/i);
    expect(source).not.toMatch(/<script|<foreignObject|onload=|(?:href|src)=["']https?:/i);
    expect(Buffer.byteLength(source)).toBeLessThanOrEqual(120_000);
  });
});
