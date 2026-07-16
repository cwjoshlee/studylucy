// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { deleteDB } from "idb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../src/client/app";
import { ApiError } from "../../src/client/api/client";
import { TodayStars } from "../../src/client/delight/today-stars";
import {
  OFFLINE_DB_NAME,
  listQueuedAttempts,
  queueAttempt,
  removeQueuedAttempt,
  storeConfirmedStars
} from "../../src/client/offline/db";
import { syncPending } from "../../src/client/offline/sync";
import { createFakeApi } from "../helpers/client";

afterEach(cleanup);
beforeEach(async () => {
  await deleteDB(OFFLINE_DB_NAME);
});

function createAppApi(overrides: Record<string, unknown> = {}) {
  const lifecycle = {
    endSession: vi.fn().mockResolvedValue(undefined),
    listTrustedDevices: vi.fn().mockResolvedValue([]),
    revokeTrustedDevice: vi.fn()
  };
  return {
    ...createFakeApi({ ...lifecycle, ...overrides }),
    ...lifecycle,
    ...overrides
  } as ReturnType<typeof createFakeApi> & typeof lifecycle;
}

describe("가족 로그인과 학생 홈", () => {
  it("shows setup only for SETUP_REQUIRED", async () => {
    const api = createAppApi({
      me: vi.fn().mockRejectedValue(new ApiError(409, "SETUP_REQUIRED"))
    });

    render(<App api={api} />);

    expect(await screen.findByRole("heading", {
      name: "수아의 공부방 시작하기"
    })).toBeVisible();
  });

  it("does not open setup for an unrelated 409 code", async () => {
    const api = createAppApi({
      me: vi.fn().mockRejectedValue(new ApiError(409, "PLAN_LOCKED"))
    });

    render(<App api={api} />);

    expect(await screen.findByText("잠시 후 다시 시도해 주세요.")).toBeVisible();
    expect(screen.queryByRole("heading", {
      name: "수아의 공부방 시작하기"
    })).not.toBeInTheDocument();
  });

  it("reveals setup, guardian, device, PIN, and student login one step at a time", async () => {
    const user = userEvent.setup();
    const endSession = vi.fn().mockResolvedValue(undefined);
    const api = createAppApi({
      endSession,
      me: vi.fn()
        .mockRejectedValueOnce(new ApiError(409, "SETUP_REQUIRED"))
        .mockResolvedValue({ id: "student-1", role: "student", displayName: "수아" })
    });
    render(<App api={api} />);

    await screen.findByRole("heading", { name: "수아의 공부방 시작하기" });
    await user.type(screen.getByLabelText("초기 설정 비밀번호"), "s".repeat(32));
    await user.type(screen.getByLabelText("보호자 이름"), "엄마");
    await user.type(screen.getByLabelText("보호자 비밀번호"), "correct horse battery staple");
    await user.type(screen.getByLabelText("학생 이름"), "수아");
    await user.click(screen.getByRole("button", { name: "가족 공부방 만들기" }));
    expect(api.setup).toHaveBeenCalledWith({
      setupSecret: "s".repeat(32),
      guardianName: "엄마",
      password: "correct horse battery staple",
      studentName: "수아"
    });
    expect(await screen.findByRole("heading", { name: "보호자 로그인" })).toBeVisible();

    await user.type(screen.getByLabelText("보호자 비밀번호"), "correct horse battery staple");
    await user.click(screen.getByRole("button", { name: "로그인" }));
    expect(api.guardianLogin).toHaveBeenCalledWith("correct horse battery staple");
    expect(await screen.findByRole("heading", { name: "이 기기 등록하기" })).toBeVisible();

    await user.clear(screen.getByLabelText("기기 이름"));
    await user.type(screen.getByLabelText("기기 이름"), "수아 갤럭시 탭");
    await user.click(screen.getByRole("button", { name: "현재 기기 등록" }));
    expect(api.registerDevice).toHaveBeenCalledWith("수아 갤럭시 탭");
    expect(await screen.findByRole("heading", { name: "수아 PIN 만들기" })).toBeVisible();

    await user.type(screen.getByLabelText("수아의 새 4자리 PIN"), "2580");
    await user.click(screen.getByRole("button", { name: "PIN 저장하기" }));
    expect(api.setStudentPin).toHaveBeenCalledWith("2580");
    expect(await screen.findByRole("heading", { name: "수아 PIN으로 들어가기" })).toBeVisible();
    expect(endSession).toHaveBeenCalledOnce();
    expect(api.logout).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText("수아의 4자리 PIN"), "2580");
    await user.click(screen.getByRole("button", { name: "공부 시작하기" }));
    expect(await screen.findByText("수아야, 오늘도 한 걸음!")).toBeVisible();
    expect(api.studentLogin).toHaveBeenCalledWith("2580");
  });

  it("gives an authenticated guardian a clear protected entry", async () => {
    const api = createAppApi({
      me: vi.fn().mockResolvedValue({
        id: "guardian-1",
        role: "guardian",
        displayName: "보호자"
      })
    });

    render(<App api={api} />);

    expect(await screen.findByRole("heading", { name: "보호자 공간" })).toBeVisible();
    expect(screen.getByRole("tab", { name: "진도" })).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByText("별 잔액 12개")).toBeVisible();
    expect(api.getGuardianProgress).toHaveBeenCalledOnce();
    expect(api.getGuardianStars).toHaveBeenCalledOnce();
  });

  it("returns an existing guardian to the protected guardian space", async () => {
    const user = userEvent.setup();
    const api = createAppApi({
      me: vi.fn()
        .mockRejectedValueOnce(new ApiError(401, "AUTH_REQUIRED"))
        .mockResolvedValue({
          id: "guardian-1",
          role: "guardian",
          displayName: "보호자"
        })
    });
    render(<App api={api} />);

    await screen.findByRole("heading", { name: "수아 PIN으로 들어가기" });
    await user.click(screen.getByRole("button", { name: "보호자 로그인" }));
    await user.type(screen.getByLabelText("보호자 비밀번호"), "correct horse battery staple");
    await user.click(screen.getByRole("button", { name: "로그인" }));

    expect(await screen.findByRole("heading", { name: "보호자 공간" })).toBeVisible();
    expect(api.guardianLogin).toHaveBeenCalledWith("correct horse battery staple");
    expect(api.me).toHaveBeenCalledTimes(2);
    expect(api.registerDevice).not.toHaveBeenCalled();
    expect(api.setStudentPin).not.toHaveBeenCalled();
    expect(api.logout).not.toHaveBeenCalled();
  });

  it("ends the guardian session before requiring a fresh student PIN", async () => {
    const user = userEvent.setup();
    const endSession = vi.fn().mockResolvedValue(undefined);
    const studentLogin = vi.fn().mockResolvedValue(undefined);
    const api = createAppApi({
      endSession,
      studentLogin,
      me: vi.fn()
        .mockResolvedValueOnce({
          id: "guardian-1",
          role: "guardian",
          displayName: "보호자"
        })
        .mockResolvedValueOnce({
          id: "student-1",
          role: "student",
          displayName: "수아"
        })
    });
    render(<App api={api} />);

    await screen.findByRole("heading", { name: "보호자 공간" });
    await user.click(screen.getByRole("button", { name: "계정 메뉴" }));
    await user.click(screen.getByRole("button", { name: "수아 모드" }));

    expect(endSession).toHaveBeenCalledOnce();
    expect(api.me).toHaveBeenCalledOnce();
    expect(studentLogin).not.toHaveBeenCalled();
    expect(await screen.findByRole("heading", {
      name: "수아 PIN으로 들어가기"
    })).toBeVisible();

    await user.type(screen.getByLabelText("수아의 4자리 PIN"), "2580");
    await user.click(screen.getByRole("button", { name: "공부 시작하기" }));
    expect(await screen.findByText("수아야, 오늘도 한 걸음!")).toBeVisible();
    expect(studentLogin).toHaveBeenCalledWith("2580");
    expect(endSession.mock.invocationCallOrder[0])
      .toBeLessThan(studentLogin.mock.invocationCallOrder[0]!);
  });

  it("ends the student session before requiring a fresh guardian password", async () => {
    const user = userEvent.setup();
    const endSession = vi.fn().mockResolvedValue(undefined);
    const guardianLogin = vi.fn().mockResolvedValue(undefined);
    const api = createAppApi({
      endSession,
      guardianLogin,
      me: vi.fn()
        .mockResolvedValueOnce({
          id: "student-1",
          role: "student",
          displayName: "수아"
        })
        .mockResolvedValueOnce({
          id: "guardian-1",
          role: "guardian",
          displayName: "보호자"
        })
    });
    render(<App api={api} />);

    await screen.findByText("수아야, 오늘도 한 걸음!");
    await user.click(screen.getByRole("button", { name: "보호자 모드" }));

    expect(endSession).toHaveBeenCalledOnce();
    expect(api.me).toHaveBeenCalledOnce();
    expect(guardianLogin).not.toHaveBeenCalled();
    expect(await screen.findByRole("heading", { name: "보호자 로그인" })).toBeVisible();

    await user.type(
      screen.getByLabelText("보호자 비밀번호"),
      "correct horse battery staple"
    );
    await user.click(screen.getByRole("button", { name: "로그인" }));
    expect(await screen.findByRole("heading", { name: "보호자 공간" })).toBeVisible();
    expect(guardianLogin).toHaveBeenCalledWith("correct horse battery staple");
    expect(endSession.mock.invocationCallOrder[0])
      .toBeLessThan(guardianLogin.mock.invocationCallOrder[0]!);
  });

  it("uses session end for logout and returns to the normal student login", async () => {
    const user = userEvent.setup();
    const endSession = vi.fn().mockResolvedValue(undefined);
    const api = createAppApi({ endSession });
    render(<App api={api} />);

    await screen.findByText("수아야, 오늘도 한 걸음!");
    await user.click(screen.getByRole("button", { name: "로그아웃" }));

    expect(endSession).toHaveBeenCalledOnce();
    expect(await screen.findByRole("heading", {
      name: "수아 PIN으로 들어가기"
    })).toBeVisible();
  });

  it("shows the A layout, required stars, and original friend", async () => {
    render(<App api={createAppApi()} />);

    expect(await screen.findByText("오늘의 학습")).toBeVisible();
    expect(screen.getByText("수아야, 오늘도 한 걸음!")).toBeVisible();
    expect(screen.getByLabelText("별토끼 마법 친구")).toBeVisible();
    expect(screen.getByText("모은 별 7개")).toBeVisible();
    expect(screen.getAllByTestId("required-star")).toHaveLength(4);
    const optional = screen.getByRole("region", { name: "선택 학습" });
    expect(within(optional).getByText("구름 산책")).toBeVisible();
    expect(within(optional).queryByText(/\uBCC4 1\uAC1C/)).not.toBeInTheDocument();
  });

  it.each([
    ["필수", "바람과 꽃"],
    ["선택", "구름 산책"]
  ])("launches a selected %s item from the dashboard", async (_kind, title) => {
    const user = userEvent.setup();
    render(<App api={createAppApi()} />);

    await user.click(await screen.findByRole("button", { name: `${title} 시작하기` }));

    expect(screen.getByRole("region", { name: `${title} 학습` })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "오늘의 학습" })).not.toBeInTheDocument();
  });

  it("returns after a gated completion with refreshed authoritative progress and stars", async () => {
    const user = userEvent.setup();
    const api = createAppApi();
    const initialPlan = await api.getToday("2026-07-16");
    api.getToday.mockReset()
      .mockResolvedValueOnce(initialPlan)
      .mockResolvedValue({
        ...initialPlan,
        completedItemIds: ["ko-01"],
        stars: {
          balance: 8,
          earnedToday: 3,
          deductedToday: 1,
          lastReason: "필수 학습을 마쳤어요."
        }
      });
    api.getStudentStars.mockReset()
      .mockResolvedValueOnce({
        balance: 7,
        earnedToday: 2,
        deductedToday: 1,
        lastReason: "필수 학습을 마쳤어요."
      })
      .mockResolvedValue({
        balance: 8,
        earnedToday: 3,
        deductedToday: 1,
        lastReason: "필수 학습을 마쳤어요."
      });

    render(<App api={api} />);
    await user.click(await screen.findByRole("button", { name: "바람과 꽃 시작하기" }));
    await user.type(screen.getByLabelText("읽은 내용 직접 입력"), "바람과 꽃");
    await user.click(screen.getByRole("button", { name: "읽기 판정하기" }));

    expect(await screen.findByText("별 1개를 모았어요")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "다음 문제" }));

    expect(await screen.findByRole("heading", { name: "오늘의 학습" })).toBeVisible();
    expect(await screen.findByText("모은 별 8개")).toBeVisible();
    const completedCard = screen.getByRole("heading", { name: "바람과 꽃" }).closest("article");
    expect(completedCard).not.toBeNull();
    expect(within(completedCard!).getByText("완료했어요")).toBeVisible();
    expect(within(completedCard!).getByText("★ 받은 별 1개")).toBeVisible();
    expect(api.getToday).toHaveBeenCalledTimes(2);
    expect(api.getStudentStars).toHaveBeenCalledTimes(2);
  });

  it("returns with an offline attempt queued then refetches authoritative home state after sync", async () => {
    const user = userEvent.setup();
    const api = createAppApi();
    const initialPlan = await api.getToday("2026-07-16");
    const confirmedAfterSync = {
      balance: 8,
      earnedToday: 3,
      deductedToday: 1,
      lastReason: "필수 학습을 마쳤어요."
    };
    api.getToday.mockReset()
      .mockResolvedValueOnce(initialPlan)
      .mockResolvedValue({
        ...initialPlan,
        completedItemIds: ["ko-01"],
        stars: confirmedAfterSync
      });
    api.getStudentStars.mockReset()
      .mockResolvedValueOnce(initialPlan.stars)
      .mockResolvedValue(confirmedAfterSync);
    api.saveAttempt
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValue({
        id: "attempt-server-after-sync",
        duplicate: false,
        readingPass: true,
        mathPass: null,
        completed: true,
        starAward: {
          awarded: true,
          amount: 1,
          balance: 8,
          eventId: "star-after-sync"
        }
      });

    render(<App api={api} />);
    await user.click(await screen.findByRole("button", { name: "바람과 꽃 시작하기" }));
    await user.type(screen.getByLabelText("읽은 내용 직접 입력"), "바람과 꽃");
    await user.click(screen.getByRole("button", { name: "읽기 판정하기" }));

    expect(await screen.findByText("학습 기록을 동기화 대기 중이에요. 연결되면 확인할게요.")).toBeVisible();
    await expect(listQueuedAttempts()).resolves.toHaveLength(1);
    expect(screen.getByRole("button", { name: "다음 문제" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "대시보드로 돌아가기" }));

    expect(await screen.findByRole("heading", { name: "오늘의 학습" })).toBeVisible();
    expect(screen.getByText("동기화 대기 별 1개")).toBeVisible();
    expect(screen.getByText("모은 별 7개")).toBeVisible();
    await expect(listQueuedAttempts()).resolves.toHaveLength(1);

    await act(async () => {
      await syncPending(api);
    });

    expect(await screen.findByText("동기화 대기 별 0개")).toBeVisible();
    expect(await screen.findByText("모은 별 8개")).toBeVisible();
    await waitFor(() => {
      const completedCard = screen.getByRole("heading", { name: "바람과 꽃" }).closest("article");
      expect(completedCard).not.toBeNull();
      expect(within(completedCard!).getByText("완료했어요")).toBeVisible();
      expect(within(completedCard!).getByText("★ 받은 별 1개")).toBeVisible();
    });
    await expect(listQueuedAttempts()).resolves.toHaveLength(0);
    expect(api.getToday).toHaveBeenCalledTimes(2);
    expect(api.getStudentStars).toHaveBeenCalledTimes(3);
  });

  it("keeps queued stars separate from the confirmed balance", () => {
    render(<TodayStars summary={{
      balance: 7,
      earnedToday: 2,
      deductedToday: 1,
      lastReason: "필수 학습을 마쳤어요."
    }} queuedCount={3} />);

    expect(screen.getByText("모은 별 7개")).toBeVisible();
    expect(screen.queryByText("모은 별 10개")).not.toBeInTheDocument();
    const queued = screen.getByRole("status", { name: "동기화 대기 별" });
    expect(within(queued).getByText("동기화 대기 별 3개")).toBeVisible();
    expect(within(queued).getByText("확정 잔액에 포함되지 않아요.")).toBeVisible();
  });

  it("shows the authoritative balance with a separate live queued-attempt count", async () => {
    const api = createAppApi({
      getStudentStars: vi.fn().mockResolvedValue({
        balance: 5,
        earnedToday: 1,
        deductedToday: 0,
        lastReason: "필수 학습을 마쳤어요."
      })
    });
    const queuedAttempt = {
      clientAttemptId: "home-queued-attempt-0001",
      itemId: "ko-01",
      contentVersion: 1,
      studyDate: "2026-07-16",
      readingScore: 100,
      missedTokens: [],
      mathAnswer: null,
      durationMs: 30_000,
      difficultyFeedback: null
    };
    await queueAttempt(queuedAttempt);

    render(<App api={api} />);

    expect(await screen.findByText("모은 별 5개")).toBeVisible();
    expect(screen.queryByText("모은 별 6개")).not.toBeInTheDocument();
    expect(screen.getByText("동기화 대기 별 1개")).toBeVisible();

    await act(async () => {
      await queueAttempt({
        ...queuedAttempt,
        clientAttemptId: "home-queued-attempt-0002"
      });
    });

    expect(await screen.findByText("동기화 대기 별 2개")).toBeVisible();
    expect(screen.getByText("모은 별 5개")).toBeVisible();
    expect(screen.queryByText("모은 별 7개")).not.toBeInTheDocument();

    await act(async () => {
      await storeConfirmedStars({
        balance: 6,
        earnedToday: 2,
        deductedToday: 0,
        lastReason: "동기화를 마쳤어요."
      });
    });

    expect(await screen.findByText("모은 별 6개")).toBeVisible();
    expect(screen.getByText("동기화 대기 별 2개")).toBeVisible();
    expect(screen.queryByText("모은 별 8개")).not.toBeInTheDocument();

    await act(async () => {
      await removeQueuedAttempt("home-queued-attempt-0002");
    });

    expect(await screen.findByText("동기화 대기 별 1개")).toBeVisible();
    expect(screen.getByText("모은 별 6개")).toBeVisible();
  });

  it("uses completed reward copy that cannot promise another star", async () => {
    const api = createAppApi();
    const plan = await api.getToday("2026-07-16");
    api.getToday.mockResolvedValue({
      ...plan,
      completedItemIds: ["ko-01"]
    });
    render(<App api={api} />);

    const title = await screen.findByRole("heading", { name: "바람과 꽃" });
    const card = title.closest("article");
    expect(card).not.toBeNull();
    expect(within(card!).getByText("★ 받은 별 1개")).toBeVisible();
    expect(within(card!).queryByText(/완료하면 별 1개/)).not.toBeInTheDocument();
  });

  it("keeps tablet, touch, focus, and reduced-motion rules in CSS source", async () => {
    const [tokens, layout, components, responsive] = await Promise.all([
      readFile(resolve("src/client/styles/tokens.css"), "utf8"),
      readFile(resolve("src/client/styles/layout.css"), "utf8"),
      readFile(resolve("src/client/styles/components.css"), "utf8"),
      readFile(resolve("src/client/styles/responsive.css"), "utf8")
    ]);

    expect(tokens).toContain("--touch-min: 48px");
    expect(layout).toContain("225px minmax(0, 1fr) 225px");
    expect(components).toMatch(/(?:button|input)[^{]*\{[^}]*min-height:\s*var\(--touch-min\)/s);
    expect(components).toContain(":focus-visible");
    expect(layout).toContain(".student-learning-view");
    expect(components).toContain(".learning-session");
    expect(components).toMatch(/\.learning-session textarea\s*\{[^}]*min-height:\s*120px/s);
    expect(responsive).toMatch(/@media\s*\(max-width:\s*950px\)/);
    expect(responsive).toMatch(/@media\s*\(max-width:\s*700px\)/);
    expect(responsive).toContain('"left right"');
    expect(responsive).toContain('"right"');
    expect(responsive).not.toMatch(/\.student-shell__right\s*\{[^}]*display:\s*none/s);
    expect(responsive).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)/);
    expect(components).toMatch(
      /\.account-menu button,\s*\.device-management button\s*\{[^}]*min-height:\s*48px/s
    );
  });
});
