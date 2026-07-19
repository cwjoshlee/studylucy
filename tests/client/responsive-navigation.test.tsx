// @vitest-environment jsdom
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ResponsiveNavigation,
  type NavigationEntry
} from "../../src/client/navigation/responsive-navigation";
import { StudentNavigation } from "../../src/client/home/student-navigation";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
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

  function installLandscapeMedia(initialMatches: boolean): {
    setMatches(matches: boolean): void;
  } {
    let matches = initialMatches;
    const listeners = new Set<(event: MediaQueryListEvent) => void>();
    const media = {
      get matches() {
        return matches;
      },
      media: "(min-width: 900px) and (orientation: landscape)",
      onchange: null,
      addEventListener: (
        _type: string,
        listener: (event: MediaQueryListEvent) => void
      ) => listeners.add(listener),
      removeEventListener: (
        _type: string,
        listener: (event: MediaQueryListEvent) => void
      ) => listeners.delete(listener),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn()
    };
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue(media));
    return {
      setMatches(nextMatches: boolean) {
        matches = nextMatches;
        act(() => {
          for (const listener of listeners) {
            listener({ matches: nextMatches } as MediaQueryListEvent);
          }
        });
      }
    };
  }

  it("makes underlying navigation and page content inert only while the compact drawer is modal", async () => {
    const user = userEvent.setup();
    installLandscapeMedia(false);
    const onLesson = vi.fn();
    const onAccount = vi.fn();
    render(
      <div className="guardian-shell">
        <header data-testid="page-header">
          <button onClick={onAccount} type="button">계정 메뉴</button>
        </header>
        <div className="responsive-shell">
          <ResponsiveNavigation
            activeId="progress"
            entries={entries}
            expandedIds={[]}
            fabLabel="메뉴 열기"
            label="보호자 메뉴"
            onSelect={vi.fn()}
            onToggle={vi.fn()}
          />
          <main data-testid="lesson-shell">
            <button onClick={onLesson} type="button">학습 시작</button>
          </main>
        </div>
      </div>
    );

    const fab = screen.getByRole("button", { name: "메뉴 열기" });
    const lesson = screen.getByRole("button", { name: "학습 시작" });
    const account = screen.getByRole("button", { name: "계정 메뉴" });
    const rail = screen.getByRole("navigation", { name: "보호자 메뉴" });
    await user.click(fab);

    const drawer = screen.getByRole("dialog", { name: "보호자 메뉴" });
    const lessonShell = screen.getByTestId("lesson-shell");
    const pageHeader = screen.getByTestId("page-header");
    expect(lessonShell).toHaveAttribute("inert");
    expect(lessonShell).toHaveAttribute("aria-hidden", "true");
    expect(pageHeader).toHaveAttribute("inert");
    expect(pageHeader).toHaveAttribute("aria-hidden", "true");
    expect(rail).toHaveAttribute("inert");
    expect(rail).toHaveAttribute("aria-hidden", "true");
    expect(drawer).not.toHaveAttribute("inert");
    expect(fab).toHaveAttribute("inert");
    expect(fab).toHaveAttribute("aria-hidden", "true");
    expect(fab).toBeDisabled();

    fab.click();
    expect(screen.getByRole("dialog", { name: "보호자 메뉴" })).toBeVisible();

    lesson.click();
    lesson.focus();
    account.click();
    expect(onLesson).not.toHaveBeenCalled();
    expect(onAccount).not.toHaveBeenCalled();
    expect(lesson).not.toHaveFocus();
    expect(within(drawer).getByRole("button", { name: "메뉴 닫기" })).toHaveFocus();

    await user.click(within(drawer).getByRole("button", { name: "메뉴 닫기" }));
    expect(lessonShell).not.toHaveAttribute("inert");
    expect(lessonShell).not.toHaveAttribute("aria-hidden");
    expect(pageHeader).not.toHaveAttribute("inert");
    expect(pageHeader).not.toHaveAttribute("aria-hidden");
    expect(rail).not.toHaveAttribute("inert");
    expect(rail).not.toHaveAttribute("aria-hidden");
    expect(fab).not.toHaveAttribute("inert");
    expect(fab).not.toHaveAttribute("aria-hidden");
    expect(fab).not.toBeDisabled();
    expect(fab).toHaveFocus();
    lesson.focus();
    lesson.click();
    expect(lesson).toHaveFocus();
    expect(onLesson).toHaveBeenCalledOnce();
  });

  it("blocks native and React background handlers while restoring them after close", async () => {
    const user = userEvent.setup();
    installLandscapeMedia(false);
    const reactFocus = vi.fn();
    const reactKeyDown = vi.fn();
    const reactPointerDown = vi.fn();
    const reactClick = vi.fn();
    const nativeFocus = vi.fn();
    const nativeKeyDown = vi.fn();
    const nativePointerDown = vi.fn();
    const nativeClick = vi.fn();
    render(
      <div className="guardian-shell">
        <div className="responsive-shell">
          <ResponsiveNavigation
            activeId="progress"
            entries={entries}
            expandedIds={[]}
            fabLabel="메뉴 열기"
            label="보호자 메뉴"
            onSelect={vi.fn()}
            onToggle={vi.fn()}
          />
          <main data-testid="background">
            <div onFocus={reactFocus} onKeyDown={reactKeyDown} onPointerDown={reactPointerDown}>
              <button onClick={reactClick} type="button">배경 동작</button>
            </div>
          </main>
        </div>
      </div>
    );

    const background = screen.getByRole("button", { name: "배경 동작" });
    background.addEventListener("focus", nativeFocus);
    background.addEventListener("keydown", nativeKeyDown);
    background.addEventListener("pointerdown", nativePointerDown);
    background.addEventListener("click", nativeClick);
    await user.click(screen.getByRole("button", { name: "메뉴 열기" }));

    background.focus();
    fireEvent.pointerDown(background);
    fireEvent.keyDown(background, { key: "Enter" });
    background.click();

    expect(nativeFocus).not.toHaveBeenCalled();
    expect(nativeKeyDown).not.toHaveBeenCalled();
    expect(nativePointerDown).not.toHaveBeenCalled();
    expect(nativeClick).not.toHaveBeenCalled();
    expect(reactFocus).not.toHaveBeenCalled();
    expect(reactKeyDown).not.toHaveBeenCalled();
    expect(reactPointerDown).not.toHaveBeenCalled();
    expect(reactClick).not.toHaveBeenCalled();
    expect(within(screen.getByRole("dialog", { name: "보호자 메뉴" }))
      .getByRole("button", { name: "메뉴 닫기" })).toHaveFocus();

    await user.click(within(screen.getByRole("dialog", { name: "보호자 메뉴" }))
      .getByRole("button", { name: "메뉴 닫기" }));
    background.focus();
    fireEvent.pointerDown(background);
    fireEvent.keyDown(background, { key: "Enter" });
    background.click();
    expect(nativeFocus).toHaveBeenCalledOnce();
    expect(nativeKeyDown).toHaveBeenCalledOnce();
    expect(nativePointerDown).toHaveBeenCalledOnce();
    expect(nativeClick).toHaveBeenCalledOnce();
    expect(reactFocus).toHaveBeenCalledOnce();
    expect(reactKeyDown).toHaveBeenCalledOnce();
    expect(reactPointerDown).toHaveBeenCalledOnce();
    expect(reactClick).toHaveBeenCalledOnce();
  });

  it("restores pre-existing modal boundary attributes across StrictMode close, reopen, and unmount", async () => {
    const user = userEvent.setup();
    installLandscapeMedia(false);
    const rendered = render(
      <StrictMode>
        <div className="guardian-shell">
          <div className="responsive-shell">
            <ResponsiveNavigation
              activeId="progress"
              entries={entries}
              expandedIds={[]}
              fabLabel="메뉴 열기"
              label="보호자 메뉴"
              onSelect={vi.fn()}
              onToggle={vi.fn()}
            />
            <main aria-hidden="false" data-testid="preserved-boundary">
              <button type="button">원래 배경</button>
            </main>
          </div>
        </div>
      </StrictMode>
    );
    const boundary = screen.getByTestId("preserved-boundary");
    boundary.setAttribute("inert", "legacy-inert");
    const addListener = vi.spyOn(boundary, "addEventListener");
    const removeListener = vi.spyOn(boundary, "removeEventListener");
    const fab = screen.getByRole("button", { name: "메뉴 열기" });

    await user.click(fab);
    expect(boundary).toHaveAttribute("inert", "");
    expect(boundary).toHaveAttribute("aria-hidden", "true");
    await user.click(within(screen.getByRole("dialog", { name: "보호자 메뉴" }))
      .getByRole("button", { name: "메뉴 닫기" }));
    expect(boundary).toHaveAttribute("inert", "legacy-inert");
    expect(boundary).toHaveAttribute("aria-hidden", "false");

    await user.click(fab);
    rendered.unmount();
    expect(boundary).toHaveAttribute("inert", "legacy-inert");
    expect(boundary).toHaveAttribute("aria-hidden", "false");
    for (const type of ["click", "pointerdown", "keydown", "focus", "focusin"]) {
      expect(addListener.mock.calls.filter(([eventType]) => eventType === type)).toHaveLength(2);
      expect(removeListener.mock.calls.filter(([eventType]) => eventType === type)).toHaveLength(2);
    }
  });

  it("defers rotation focus and cancels stale frame handoffs", () => {
    const media = installLandscapeMedia(true);
    let nextFrame = 1;
    const frames = new Map<number, FrameRequestCallback>();
    const requestFrame = vi.fn((callback: FrameRequestCallback) => {
      const frame = nextFrame++;
      frames.set(frame, callback);
      return frame;
    });
    const cancelFrame = vi.fn((frame: number) => {
      frames.delete(frame);
    });
    vi.stubGlobal("requestAnimationFrame", requestFrame);
    vi.stubGlobal("cancelAnimationFrame", cancelFrame);
    const rendered = render(
      <div className="responsive-shell">
        <ResponsiveNavigation
          activeId="progress"
          entries={entries}
          expandedIds={[]}
          fabLabel="메뉴 열기"
          label="보호자 메뉴"
          onSelect={vi.fn()}
          onToggle={vi.fn()}
        />
        <main><button type="button">외부 포커스</button></main>
      </div>
    );
    const rail = screen.getByRole("navigation", { name: "보호자 메뉴" });
    const railProgress = within(rail).getByRole("button", { name: "진도" });
    const fab = screen.getByRole("button", { name: "메뉴 열기" });
    const external = screen.getByRole("button", { name: "외부 포커스" });

    railProgress.focus();
    media.setMatches(false);
    expect(requestFrame).toHaveBeenCalledOnce();
    expect(fab).not.toHaveFocus();
    external.focus();
    expect(cancelFrame).toHaveBeenCalledOnce();
    expect(frames.size).toBe(0);
    expect(external).toHaveFocus();

    media.setMatches(true);
    railProgress.focus();
    media.setMatches(false);
    expect(frames.size).toBe(1);
    rendered.unmount();
    expect(cancelFrame).toHaveBeenCalledTimes(2);
    expect(frames.size).toBe(0);
  });

  it("clears the timeout focus fallback without leaving a delayed handoff", () => {
    vi.stubGlobal("requestAnimationFrame", undefined);
    vi.stubGlobal("cancelAnimationFrame", undefined);
    const media = installLandscapeMedia(true);
    const rendered = render(
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
    const rail = screen.getByRole("navigation", { name: "보호자 메뉴" });
    within(rail).getByRole("button", { name: "진도" }).focus();
    let nextTimer = 1;
    const timers = new Map<number, TimerHandler>();
    const setTimer = vi.spyOn(window, "setTimeout").mockImplementation((handler) => {
      const timer = nextTimer++;
      timers.set(timer, handler);
      return timer as unknown as NodeJS.Timeout;
    });
    const clearTimer = vi.spyOn(window, "clearTimeout").mockImplementation((timer) => {
      timers.delete(Number(timer));
    });
    media.setMatches(false);
    expect(setTimer).toHaveBeenCalledOnce();
    expect(timers.size).toBe(1);
    rendered.unmount();
    expect(clearTimer).toHaveBeenCalledOnce();
    expect(timers.size).toBe(0);
  });

  it("moves focus from the landscape rail to the compact trigger after portrait rotation only", async () => {
    const media = installLandscapeMedia(true);
    render(
      <div className="responsive-shell">
        <ResponsiveNavigation
          activeId="progress"
          entries={entries}
          expandedIds={[]}
          fabLabel="메뉴 열기"
          label="보호자 메뉴"
          onSelect={vi.fn()}
          onToggle={vi.fn()}
        />
        <main><button type="button">학습 시작</button></main>
      </div>
    );

    const rail = screen.getByRole("navigation", { name: "보호자 메뉴" });
    const railProgress = within(rail).getByRole("button", { name: "진도" });
    const fab = screen.getByRole("button", { name: "메뉴 열기" });
    railProgress.focus();
    media.setMatches(false);
    await waitFor(() => expect(fab).toHaveFocus());

    const lesson = screen.getByRole("button", { name: "학습 시작" });
    lesson.focus();
    media.setMatches(true);
    await Promise.resolve();
    expect(lesson).toHaveFocus();

    media.setMatches(false);
    await Promise.resolve();
    expect(lesson).toHaveFocus();
  });

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
    const drawer = screen.getByRole("dialog", { name: "보호자 메뉴" });
    expect(within(rail).getByRole("button", { name: "AI 학습실", hidden: true })).toBeInTheDocument();
    expect(within(drawer).getByRole("button", { name: "AI 학습실" })).toBeInTheDocument();
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
    const rail = screen.getByRole("navigation", { name: "보호자 메뉴" });
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

    const drawer = screen.getByRole("dialog", { name: "보호자 메뉴" });
    for (const button of [
      within(rail).getByRole("button", { name: "기기 관리", hidden: true }),
      within(drawer).getByRole("button", { name: "기기 관리" })
    ]) {
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
