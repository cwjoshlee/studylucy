// @vitest-environment jsdom
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GuardianDashboard } from "../../src/client/guardian/guardian-dashboard";
import { ApiError } from "../../src/client/api/client";

afterEach(cleanup);

function createGuardianApi(overrides: Record<string, unknown> = {}) {
  return {
    getGuardianProgress: vi.fn().mockResolvedValue({
      completedItems: 4,
      totalAttempts: 6,
      readingPassRate: 83,
      mathPassRate: 75,
      recentReviewTokens: [{ token: "꽃잎", count: 2 }]
    }),
    getGuardianStars: vi.fn().mockResolvedValue({
      summary: {
        balance: 12,
        earnedToday: 3,
        deductedToday: 1,
        lastReason: "5분 무반응"
      },
      events: [{
        id: "event-private-1",
        requestedDelta: -1,
        delta: -1,
        balanceAfter: 12,
        reason: "IDLE_TIMEOUT" as const,
        reasonText: "5분 무반응",
        studyDate: "2026-07-16",
        itemId: "item-private-1",
        actorType: "system" as const,
        createdAt: "2026-07-16T03:00:00.000Z",
        reversesEventId: null
      }],
      nextCursor: null
    }),
    getStarAdjustments: vi.fn().mockResolvedValue({ adjustments: [] }),
    approveStarAdjustment: vi.fn(),
    waiveStarAdjustment: vi.fn(),
    applyManualStars: vi.fn(),
    reverseStarEvent: vi.fn(),
    getGuardianDailyPlan: vi.fn().mockResolvedValue({
      studyDate: "2026-07-17",
      koreanTarget: 2,
      mathTarget: 2,
      isRestDay: false,
      requiredItemIds: ["ko-private", "math-private"]
    }),
    updateGuardianDailyPlan: vi.fn(),
    getBackupStatus: vi.fn().mockResolvedValue({ status: "never-run" as const }),
    ...overrides
  };
}

describe("GuardianDashboard", () => {
  it("shows guardian progress and star status without protected or internal data", async () => {
    const api = createGuardianApi();

    render(<GuardianDashboard api={api} />);

    expect(await screen.findByText("별 잔액 12개")).toBeVisible();
    expect(screen.getByText("5분 무반응")).toBeVisible();
    expect(screen.getByText("완료한 활동 4개")).toBeVisible();
    expect(screen.getByText("읽기 통과율 83%")).toBeVisible();
    expect(screen.getByText("수학 통과율 75%")).toBeVisible();
    expect(screen.getByText("꽃잎 · 2회")).toBeVisible();
    for (const tab of ["진도", "별 기록", "차감 승인", "학습 계획", "백업"]) {
      expect(screen.getByRole("tab", { name: tab })).toBeVisible();
    }
    expect(document.body.textContent).not.toMatch(
      /event-private|item-private|password|PIN|cookie|audio|transcript|삭제/i
    );
  });

  it("confirms a deduction approval and shows requested, approved, and applied stars", async () => {
    const user = userEvent.setup();
    const pending = {
      id: "pending-1",
      studyDate: "2026-07-15",
      itemId: "ko-private-1",
      requestedStars: 1,
      approvedStars: null,
      appliedStars: null,
      status: "pending" as const,
      note: null,
      starEventId: null,
      createdAt: "2026-07-16T03:00:00.000Z",
      processedAt: null
    };
    const approveStarAdjustment = vi.fn().mockResolvedValue({
      ...pending,
      approvedStars: 1,
      appliedStars: 1,
      status: "approved" as const,
      note: "",
      starEventId: "event-private-approved",
      processedAt: "2026-07-16T04:00:00.000Z",
      duplicate: false
    });
    const api = createGuardianApi({
      getStarAdjustments: vi.fn().mockResolvedValue({ adjustments: [pending] }),
      approveStarAdjustment
    });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<GuardianDashboard api={api} />);

    await user.click(screen.getByRole("tab", { name: "차감 승인" }));
    const card = await screen.findByRole("article", { name: "2026-07-15 차감 요청" });
    expect(within(card).getByText("요청 1개")).toBeVisible();
    expect(within(card).getByText("승인 —")).toBeVisible();
    expect(within(card).getByText("실제 적용 —")).toBeVisible();
    await user.click(within(card).getByRole("button", { name: "차감 승인" }));

    expect(confirm).toHaveBeenCalledWith("별 차감을 승인할까요?");
    await waitFor(() => expect(approveStarAdjustment).toHaveBeenCalledWith(
      "pending-1",
      { approvedStars: 1, note: "" }
    ));
    expect(await within(card).findByText("승인 1개")).toBeVisible();
    expect(within(card).getByText("실제 적용 1개")).toBeVisible();
    confirm.mockRestore();
  });

  it("requires a nonempty reason before waiving a deduction", async () => {
    const user = userEvent.setup();
    const pending = {
      id: "pending-1",
      studyDate: "2026-07-15",
      itemId: "ko-private-1",
      requestedStars: 1,
      approvedStars: null,
      appliedStars: null,
      status: "pending" as const,
      note: null,
      starEventId: null,
      createdAt: "2026-07-16T03:00:00.000Z",
      processedAt: null
    };
    const waiveStarAdjustment = vi.fn().mockResolvedValue({
      ...pending,
      approvedStars: 0,
      appliedStars: 0,
      status: "waived" as const,
      note: "아파서 쉬었어요",
      processedAt: "2026-07-16T04:00:00.000Z",
      duplicate: false
    });
    const api = createGuardianApi({
      getStarAdjustments: vi.fn().mockResolvedValue({ adjustments: [pending] }),
      waiveStarAdjustment
    });
    render(<GuardianDashboard api={api} />);

    await user.click(screen.getByRole("tab", { name: "차감 승인" }));
    const reason = await screen.findByLabelText("면제 사유");
    expect(reason).toBeRequired();
    await user.click(screen.getByRole("button", { name: "아픈 날로 면제" }));
    expect(waiveStarAdjustment).not.toHaveBeenCalled();

    await user.type(reason, "아파서 쉬었어요");
    await user.click(screen.getByRole("button", { name: "아픈 날로 면제" }));
    await waitFor(() => expect(waiveStarAdjustment).toHaveBeenCalledWith(
      "pending-1",
      { note: "아파서 쉬었어요" }
    ));
    expect(await screen.findByText("승인 0개")).toBeVisible();
    expect(screen.getByText("실제 적용 0개")).toBeVisible();
  });

  it("filters and paginates the ledger in bounded 100-row pages", async () => {
    const user = userEvent.setup();
    const getGuardianStars = vi.fn().mockResolvedValue({
      summary: {
        balance: 12,
        earnedToday: 3,
        deductedToday: 1,
        lastReason: "5분 무반응"
      },
      events: [],
      nextCursor: "cursor-private-1"
    });
    const api = createGuardianApi({ getGuardianStars });
    render(<GuardianDashboard api={api} />);

    await user.click(screen.getByRole("tab", { name: "별 기록" }));
    await user.type(await screen.findByLabelText("시작일"), "2026-07-01");
    await user.type(screen.getByLabelText("종료일"), "2026-07-16");
    await user.selectOptions(screen.getByLabelText("방향"), "deducted");
    await user.selectOptions(screen.getByLabelText("사유"), "IDLE_TIMEOUT");
    await user.click(screen.getByRole("button", { name: "필터 적용" }));
    await waitFor(() => expect(getGuardianStars).toHaveBeenLastCalledWith({
      from: "2026-07-01",
      to: "2026-07-16",
      direction: "deducted",
      reason: "IDLE_TIMEOUT"
    }));

    await user.click(screen.getByRole("button", { name: "다음 기록 100개" }));
    await waitFor(() => expect(getGuardianStars).toHaveBeenLastCalledWith({
      from: "2026-07-01",
      to: "2026-07-16",
      direction: "deducted",
      reason: "IDLE_TIMEOUT",
      cursor: "cursor-private-1"
    }));
    expect(document.body.textContent).not.toContain("cursor-private-1");
  });

  it("adds a manual guardian bonus with an idempotency command", async () => {
    const user = userEvent.setup();
    const applyManualStars = vi.fn().mockResolvedValue({
      event: {
        id: "event-private-bonus",
        requestedDelta: 2,
        delta: 2,
        balanceAfter: 14,
        reason: "GUARDIAN_BONUS" as const,
        reasonText: "약속을 잘 지켰어요",
        studyDate: "2026-07-16",
        itemId: null,
        actorType: "guardian" as const,
        createdAt: "2026-07-16T04:00:00.000Z",
        reversesEventId: null
      },
      duplicate: false
    });
    const api = createGuardianApi({ applyManualStars });
    render(<GuardianDashboard api={api} />);

    await user.click(screen.getByRole("tab", { name: "별 기록" }));
    await user.type(await screen.findByLabelText("별 수"), "2");
    await user.type(screen.getByLabelText("조정 사유"), "약속을 잘 지켰어요");
    await user.click(screen.getByRole("button", { name: "별 조정 저장" }));

    await waitFor(() => expect(applyManualStars).toHaveBeenCalledWith({
      delta: 2,
      reason: "약속을 잘 지켰어요",
      clientCommandId: expect.any(String)
    }));
  });

  it("requires explicit confirmation for a negative manual adjustment", async () => {
    const user = userEvent.setup();
    const applyManualStars = vi.fn().mockResolvedValue({
      event: {
        id: "event-private-adjustment",
        requestedDelta: -1,
        delta: -1,
        balanceAfter: 11,
        reason: "GUARDIAN_ADJUSTMENT" as const,
        reasonText: "보호자 조정",
        studyDate: "2026-07-16",
        itemId: null,
        actorType: "guardian" as const,
        createdAt: "2026-07-16T04:00:00.000Z",
        reversesEventId: null
      },
      duplicate: false
    });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const api = createGuardianApi({ applyManualStars });
    render(<GuardianDashboard api={api} />);

    await user.click(screen.getByRole("tab", { name: "별 기록" }));
    await user.type(await screen.findByLabelText("별 수"), "-1");
    await user.type(screen.getByLabelText("조정 사유"), "보호자 조정");
    await user.click(screen.getByRole("button", { name: "별 조정 저장" }));
    expect(confirm).toHaveBeenCalledWith("별을 직접 차감할까요?");
    expect(applyManualStars).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    await user.click(screen.getByRole("button", { name: "별 조정 저장" }));
    await waitFor(() => expect(applyManualStars).toHaveBeenCalledWith({
      delta: -1,
      reason: "보호자 조정",
      clientCommandId: expect.any(String)
    }));
    confirm.mockRestore();
  });

  it("reuses the manual command id when a guardian retries after a failed response", async () => {
    const user = userEvent.setup();
    const result = {
      event: {
        id: "event-private-bonus",
        requestedDelta: 2,
        delta: 2,
        balanceAfter: 14,
        reason: "GUARDIAN_BONUS" as const,
        reasonText: "약속 보너스",
        studyDate: "2026-07-16",
        itemId: null,
        actorType: "guardian" as const,
        createdAt: "2026-07-16T04:00:00.000Z",
        reversesEventId: null
      },
      duplicate: false
    };
    const applyManualStars = vi.fn()
      .mockRejectedValueOnce(new ApiError(503, "TEMPORARY_FAILURE"))
      .mockResolvedValueOnce(result);
    const api = createGuardianApi({ applyManualStars });
    render(<GuardianDashboard api={api} />);

    await user.click(screen.getByRole("tab", { name: "별 기록" }));
    await user.type(await screen.findByLabelText("별 수"), "2");
    await user.type(screen.getByLabelText("조정 사유"), "약속 보너스");
    await user.click(screen.getByRole("button", { name: "별 조정 저장" }));
    expect(await screen.findByText("별 조정을 저장하지 못했어요. 다시 시도해 주세요.")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "별 조정 저장" }));
    await waitFor(() => expect(applyManualStars).toHaveBeenCalledTimes(2));
    const firstCommandId = applyManualStars.mock.calls[0]?.[0].clientCommandId;
    const secondCommandId = applyManualStars.mock.calls[1]?.[0].clientCommandId;
    expect(firstCommandId).toEqual(expect.any(String));
    expect(secondCommandId).toBe(firstCommandId);
  });

  it("appends a confirmed reversal linked to the preserved original row", async () => {
    const user = userEvent.setup();
    const original = {
      id: "event-private-original",
      requestedDelta: 2,
      delta: 2,
      balanceAfter: 12,
      reason: "GUARDIAN_BONUS" as const,
      reasonText: "약속 보너스",
      studyDate: "2026-07-16",
      itemId: null,
      actorType: "guardian" as const,
      createdAt: "2026-07-16T03:00:00.000Z",
      reversesEventId: null
    };
    const reversal = {
      id: "event-private-reversal",
      requestedDelta: -2,
      delta: -2,
      balanceAfter: 10,
      reason: "REVERSAL" as const,
      reasonText: "잘못 입력했어요",
      studyDate: "2026-07-16",
      itemId: null,
      actorType: "guardian" as const,
      createdAt: "2026-07-16T04:00:00.000Z",
      reversesEventId: original.id
    };
    const reverseStarEvent = vi.fn().mockResolvedValue({
      event: reversal,
      duplicate: false
    });
    const api = createGuardianApi({
      getGuardianStars: vi.fn().mockResolvedValue({
        summary: {
          balance: 12,
          earnedToday: 2,
          deductedToday: 0,
          lastReason: "약속 보너스"
        },
        events: [original],
        nextCursor: null
      }),
      reverseStarEvent
    });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<GuardianDashboard api={api} />);

    await user.click(screen.getByRole("tab", { name: "별 기록" }));
    expect(await screen.findByText("약속 보너스")).toBeVisible();
    const reason = screen.getByLabelText("되돌리기 사유");
    expect(reason).toBeRequired();
    await user.type(reason, "잘못 입력했어요");
    await user.click(screen.getByRole("button", { name: "기록 되돌리기" }));

    expect(confirm).toHaveBeenCalledWith("이 별 기록을 되돌릴까요?");
    await waitFor(() => expect(reverseStarEvent).toHaveBeenCalledWith(
      "event-private-original",
      { note: "잘못 입력했어요" }
    ));
    expect(screen.getByText("약속 보너스")).toBeVisible();
    expect(await screen.findByText("잘못 입력했어요")).toBeVisible();
    expect(screen.getByText("원래 기록에 연결된 되돌리기")).toBeVisible();
    expect(screen.queryByRole("button", { name: /삭제/ })).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/event-private-original|event-private-reversal/);
    confirm.mockRestore();
  });

  it("updates future 2/2 targets and can turn the date into a rest day", async () => {
    const user = userEvent.setup();
    const plan = {
      studyDate: "2026-07-17",
      koreanTarget: 2,
      mathTarget: 2,
      isRestDay: false,
      requiredItemIds: ["ko-private", "math-private"]
    };
    const getGuardianDailyPlan = vi.fn().mockResolvedValue(plan);
    const updateGuardianDailyPlan = vi.fn().mockResolvedValue({
      ...plan,
      isRestDay: true,
      requiredItemIds: []
    });
    const api = createGuardianApi({
      getGuardianDailyPlan,
      updateGuardianDailyPlan
    });
    render(<GuardianDashboard api={api} />);

    await user.click(screen.getByRole("tab", { name: "학습 계획" }));
    const date = await screen.findByLabelText("계획 날짜");
    await user.clear(date);
    await user.type(date, "2026-07-17");
    await user.click(screen.getByRole("button", { name: "계획 불러오기" }));
    await waitFor(() => expect(getGuardianDailyPlan).toHaveBeenLastCalledWith("2026-07-17"));
    expect(screen.getByLabelText("국어 목표")).toHaveValue(2);
    expect(screen.getByLabelText("수학 목표")).toHaveValue(2);
    await user.click(screen.getByLabelText("쉬는 날"));
    await user.click(screen.getByRole("button", { name: "학습 계획 저장" }));

    await waitFor(() => expect(updateGuardianDailyPlan).toHaveBeenCalledWith(
      "2026-07-17",
      { koreanTarget: 2, mathTarget: 2, isRestDay: true }
    ));
    expect(await screen.findByText("쉬는 날 계획을 저장했어요.")).toBeVisible();
  });

  it("locks plan targets and rest-day changes after PLAN_LOCKED", async () => {
    const user = userEvent.setup();
    const plan = {
      studyDate: "2026-07-16",
      koreanTarget: 2,
      mathTarget: 2,
      isRestDay: false,
      requiredItemIds: ["ko-private", "math-private"]
    };
    const api = createGuardianApi({
      getGuardianDailyPlan: vi.fn().mockResolvedValue(plan),
      updateGuardianDailyPlan: vi.fn().mockRejectedValue(
        new ApiError(409, "PLAN_LOCKED")
      )
    });
    render(<GuardianDashboard api={api} />);

    await user.click(screen.getByRole("tab", { name: "학습 계획" }));
    await user.click(await screen.findByRole("button", { name: "계획 불러오기" }));
    await screen.findByLabelText("국어 목표");
    await user.click(screen.getByRole("button", { name: "학습 계획 저장" }));

    expect(await screen.findByText(
      "학습을 시작한 날짜와 지난 날짜의 계획은 바꿀 수 없어요."
    )).toBeVisible();
    expect(screen.getByLabelText("국어 목표")).toBeDisabled();
    expect(screen.getByLabelText("수학 목표")).toBeDisabled();
    expect(screen.getByLabelText("쉬는 날")).toBeDisabled();
    expect(screen.getByRole("button", { name: "학습 계획 저장" })).toBeDisabled();
  });

  it("loads the safe backup status only when its tab is opened", async () => {
    const user = userEvent.setup();
    const getBackupStatus = vi.fn().mockResolvedValue({
      status: "success" as const,
      finishedAt: "2026-07-16T02:00:00.000Z",
      filename: "sua-learning-2026-07-16.sqlite"
    });
    const api = createGuardianApi({ getBackupStatus });
    render(<GuardianDashboard api={api} />);

    await screen.findByText("별 잔액 12개");
    expect(getBackupStatus).not.toHaveBeenCalled();
    await user.click(screen.getByRole("tab", { name: "백업" }));

    expect(await screen.findByText("최근 백업이 정상적으로 완료되었어요.")).toBeVisible();
    expect(screen.getByText("sua-learning-2026-07-16.sqlite")).toBeVisible();
    expect(getBackupStatus).toHaveBeenCalledOnce();
    expect(document.body.textContent).not.toMatch(/\/tmp\/|\/Users\//);
  });

  it("keeps guardian form controls touch-sized in the tablet layout", async () => {
    const [components, layout, responsive] = await Promise.all([
      readFile(resolve("src/client/styles/components.css"), "utf8"),
      readFile(resolve("src/client/styles/layout.css"), "utf8"),
      readFile(resolve("src/client/styles/responsive.css"), "utf8")
    ]);

    expect(components).toMatch(
      /button,\s*input,\s*select,\s*textarea\s*\{[^}]*min-height:\s*var\(--touch-min\)/s
    );
    expect(layout).toContain(".guardian-shell");
    expect(layout).toContain(".guardian-tabs");
    expect(responsive).toMatch(/@media\s*\(max-width:\s*700px\)[\s\S]*\.guardian-shell/);
  });
});
