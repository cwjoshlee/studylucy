// @vitest-environment jsdom
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ResponsiveNavigation,
  type NavigationEntry
} from "../../src/client/navigation/responsive-navigation";
import { StudentNavigation } from "../../src/client/home/student-navigation";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ResponsiveNavigation", () => {
  const entries: readonly NavigationEntry[] = [
    { id: "progress", label: "진도" },
    {
      id: "ai",
      label: "AI 학습실",
      children: [
        {
          id: "ai/generation",
          label: "문제 생성",
          children: [
            { id: "ai/generate-math", label: "수학 문제 배치" }
          ]
        }
      ]
    },
    { id: "devices", label: "기기 관리" }
  ];

  it("renders one controlled tree in both mounted shells and shares callbacks", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onToggle = vi.fn();
    render(
      <ResponsiveNavigation
        activeId="ai/generate-math"
        entries={entries}
        expandedIds={["ai", "ai/generation"]}
        fabLabel="메뉴 열기"
        label="보호자 메뉴"
        onSelect={onSelect}
        onToggle={onToggle}
      />
    );

    const rail = screen.getByRole("navigation", { name: "보호자 메뉴" });
    await user.click(within(rail).getByRole("button", { name: "수학 문제 배치" }));
    expect(onSelect).toHaveBeenLastCalledWith("ai/generate-math");

    await user.click(screen.getByRole("button", { name: "메뉴 열기" }));
    expect(screen.getAllByRole("button", { name: "AI 학습실" })).toHaveLength(2);
    const drawer = screen.getByRole("dialog", { name: "보호자 메뉴" });
    await user.click(within(drawer).getByRole("button", { name: "수학 문제 배치" }));
    expect(onSelect).toHaveBeenLastCalledWith("ai/generate-math");

    await user.click(within(rail).getByRole("button", { name: "문제 생성" }));
    expect(onToggle).toHaveBeenLastCalledWith("ai/generation");
  });

  it("marks the active entry in both shells without owning active or expanded state", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <ResponsiveNavigation
        activeId="progress"
        entries={entries}
        expandedIds={[]}
        fabLabel="메뉴 열기"
        label="보호자 메뉴"
        onSelect={vi.fn()}
        onToggle={vi.fn()}
      />
    );

    expect(screen.getByRole("button", { name: "진도" })).toHaveAttribute(
      "aria-current",
      "page"
    );
    await user.click(screen.getByRole("button", { name: "메뉴 열기" }));
    rerender(
      <ResponsiveNavigation
        activeId="devices"
        entries={entries}
        expandedIds={["ai"]}
        fabLabel="메뉴 열기"
        label="보호자 메뉴"
        onSelect={vi.fn()}
        onToggle={vi.fn()}
      />
    );

    expect(screen.getAllByRole("button", { name: "기기 관리" })).toHaveLength(2);
    for (const button of screen.getAllByRole("button", { name: "기기 관리" })) {
      expect(button).toHaveAttribute("aria-current", "page");
    }
    expect(screen.getByRole("dialog", { name: "보호자 메뉴" })).toBeVisible();
  });

  it("contains drawer focus, closes by keyboard or selection, and returns focus safely after rotation", async () => {
    const user = userEvent.setup();
    let landscape = false;
    const listeners = new Set<(event: MediaQueryListEvent) => void>();
    vi.stubGlobal("matchMedia", vi.fn().mockImplementation((query: string) => ({
      matches: landscape,
      media: query,
      onchange: null,
      addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
        listeners.add(listener);
      },
      removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
        listeners.delete(listener);
      },
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn()
    })));
    render(
      <ResponsiveNavigation
        activeId="progress"
        entries={entries}
        expandedIds={["ai", "ai/generation"]}
        fabLabel="메뉴 열기"
        label="보호자 메뉴"
        onSelect={vi.fn()}
        onToggle={vi.fn()}
      />
    );

    const fab = screen.getByRole("button", { name: "메뉴 열기" });
    await user.click(fab);
    const drawer = screen.getByRole("dialog", { name: "보호자 메뉴" });
    expect(within(drawer).getByRole("button", { name: "메뉴 닫기" })).toHaveFocus();

    await user.tab({ shift: true });
    expect(within(drawer).getByRole("button", { name: "기기 관리" })).toHaveFocus();
    await user.tab();
    expect(within(drawer).getByRole("button", { name: "메뉴 닫기" })).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "보호자 메뉴" })).not.toBeInTheDocument();
    expect(fab).toHaveFocus();

    await user.click(fab);
    await user.click(within(screen.getByRole("dialog", { name: "보호자 메뉴" }))
      .getByRole("button", { name: "진도" }));
    expect(fab).toHaveFocus();

    await user.click(fab);
    landscape = true;
    act(() => {
      for (const listener of listeners) {
        listener({ matches: true } as MediaQueryListEvent);
      }
    });
    expect(screen.queryByRole("dialog", { name: "보호자 메뉴" })).not.toBeInTheDocument();
    expect(within(screen.getByRole("navigation", { name: "보호자 메뉴" }))
      .getByRole("button", { name: "진도" })).toHaveFocus();
  });

  it("dispatches every student navigation action without replacing its mounted source", async () => {
    const user = userEvent.setup();
    const onExit = vi.fn();
    const onToday = vi.fn();
    const onHelp = vi.fn();
    const onPauseForBreak = vi.fn();
    render(
      <StudentNavigation
        onExit={onExit}
        onHelp={onHelp}
        onPauseForBreak={onPauseForBreak}
        onToday={onToday}
      />
    );

    await user.click(screen.getByRole("button", { name: "뒤로" }));
    await user.click(screen.getByRole("button", { name: "오늘 학습" }));
    await user.click(screen.getByRole("button", { name: "도움말" }));
    await user.click(screen.getByRole("button", { name: "잠깐 쉬기" }));

    expect(onExit).toHaveBeenCalledOnce();
    expect(onToday).toHaveBeenCalledOnce();
    expect(onHelp).toHaveBeenCalledOnce();
    expect(onPauseForBreak).toHaveBeenCalledOnce();
  });

  it("uses the landscape media query instead of JavaScript width branching", async () => {
    const [source, responsiveCss] = await Promise.all([
      readFile(resolve("src/client/navigation/responsive-navigation.tsx"), "utf8"),
      readFile(resolve("src/client/styles/responsive.css"), "utf8")
    ]);

    expect(source).not.toMatch(/innerWidth|addEventListener\(["']resize/);
    expect(responsiveCss).toContain("@media (min-width: 900px) and (orientation: landscape)");
    expect(responsiveCss).toContain("grid-template-columns: minmax(248px, 300px) minmax(0, 1fr)");
  });
});
