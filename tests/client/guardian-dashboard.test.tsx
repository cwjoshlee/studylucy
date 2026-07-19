// @vitest-environment jsdom
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GuardianDashboard } from "../../src/client/guardian/guardian-dashboard";
import { ApiError } from "../../src/client/api/client";
import type { GuardianOfflineRejection } from "../../src/shared/learning";
import type {
  AppliedStarResult,
  ProcessedStarAdjustment
} from "../../src/shared/stars";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function createGuardianApi(overrides: Record<string, unknown> = {}) {
  const studioSettings = {
    monthlyBudgetWon: 3000,
    monthSpentWon: 1250,
    providers: [
      {
        provider: "gemini" as const,
        enabled: true,
        model: "gemini-2.5-flash",
        hasApiKey: true,
        inputWonPer1K: 2,
        outputWonPer1K: 8
      },
      {
        provider: "openai" as const,
        enabled: true,
        model: "gpt-5-mini",
        hasApiKey: true,
        inputWonPer1K: 3,
        outputWonPer1K: 12
      }
    ]
  };
  return {
    getGuardianProgress: vi.fn().mockResolvedValue({
      completedItems: 4,
      totalAttempts: 6,
      readingPassRate: 83,
      mathPassRate: 75,
      recentReviewTokens: [{ token: "꽃잎", count: 2 }]
    }),
    getGuardianOfflineRejections: vi.fn().mockResolvedValue({ rejections: [] }),
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
        reversesEventId: null,
        isReversed: false
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
      subjectSettings: {
        korean: { difficulty: 3, challengeBonusStars: 1 },
        math: { difficulty: 3, challengeBonusStars: 1 }
      },
      requiredItemIds: ["ko-private", "math-private"]
    }),
    updateGuardianDailyPlan: vi.fn(),
    getBackupStatus: vi.fn().mockResolvedValue({ status: "never-run" as const }),
    getAiCoachSettings: vi.fn().mockResolvedValue({
      enabled: false,
      provider: "gemini" as const,
      model: "gemini-2.5-flash-lite",
      monthlyBudgetWon: 1000,
      monthSpentWon: 0,
      hasApiKey: false
    }),
    updateAiCoachSettings: vi.fn(),
    getAiStudioSettings: vi.fn().mockResolvedValue(studioSettings.providers),
    getAiStudioSettingsView: vi.fn().mockResolvedValue(studioSettings),
    updateAiStudioBudget: vi.fn().mockResolvedValue(studioSettings),
    updateAiStudioProvider: vi.fn(),
    createAiDraft: vi.fn(),
    getAiDraft: vi.fn(),
    updateAiDraftItem: vi.fn(),
    publishAiDraft: vi.fn(),
    getGuardianAiReport: vi.fn(),
    registerDevice: vi.fn().mockResolvedValue({
      publicId: "public-current",
      name: "현재 태블릿",
      createdAt: "2026-07-15T03:00:00.000Z",
      lastUsedAt: null,
      deviceType: "tablet" as const,
      status: "active" as const,
      current: true
    }),
    listTrustedDevices: vi.fn().mockResolvedValue([]),
    revokeTrustedDevice: vi.fn(),
    updateTrustedDeviceType: vi.fn(),
    ...overrides
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

describe("GuardianDashboard", () => {
  it("exposes the guardian sections, AI hierarchy, and separate device management in responsive navigation", async () => {
    const user = userEvent.setup();
    render(<GuardianDashboard api={createGuardianApi()} />);

    for (const label of [
      "진도", "별 기록", "차감 승인", "학습 계획", "AI 학습실", "백업", "기기 관리"
    ]) {
      expect(screen.getByRole("button", { name: label })).toBeVisible();
    }

    const navigation = screen.getByRole("navigation", { name: "보호자 메뉴" });
    await user.click(within(navigation).getByRole("button", { name: "AI 학습실" }));
    await user.click(within(navigation).getByRole("button", { name: "문제 생성" }));
    await user.click(within(navigation).getByRole("button", { name: "수학 문제 배치" }));
    expect(screen.getByRole("heading", { name: "수학 문제 배치" })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "기기 관리" }));
    expect(await screen.findByRole("heading", { name: "기기 관리" })).toBeVisible();
  });

  it("labels guardian content as the main landmark without orphaned tabpanel semantics", async () => {
    render(<GuardianDashboard api={createGuardianApi()} />);

    expect(await screen.findByRole("main", { name: "진도" })).toBeVisible();
    expect(screen.queryByRole("tabpanel")).not.toBeInTheDocument();
  });

  it("expands the exact AI learning studio tree and blanks each saved provider key", async () => {
    const user = userEvent.setup();
    const updateAiStudioProvider = vi.fn(async (
      provider: "gemini" | "openai",
      input: { enabled?: boolean; model?: string; apiKey?: string }
    ) => ({
      provider,
      enabled: input.enabled ?? false,
      model: input.model ?? "model",
      hasApiKey: input.apiKey !== undefined
    }));
    const api = createGuardianApi({
      getAiStudioSettingsView: vi.fn().mockResolvedValue({
        monthlyBudgetWon: 3000,
        monthSpentWon: 0,
        providers: [
          {
            provider: "gemini", enabled: false, model: "gemini-2.5-flash",
            hasApiKey: false, inputWonPer1K: 2, outputWonPer1K: 8
          },
          {
            provider: "openai", enabled: false, model: "gpt-5-mini",
            hasApiKey: false, inputWonPer1K: 3, outputWonPer1K: 12
          }
        ]
      }),
      updateAiStudioProvider
    });
    render(<GuardianDashboard api={api} />);

    const studioTab = screen.getByRole("button", { name: "AI 학습실" });
    expect(studioTab).toBeVisible();
    await user.click(studioTab);
    await user.click(within(screen.getByRole("tree", { name: "AI 학습실 메뉴" }))
      .getByRole("button", { name: "문제 생성" }));
    await user.click(within(screen.getByRole("tree", { name: "AI 학습실 메뉴" }))
      .getByRole("button", { name: "보고서" }));
    for (const label of [
      "제공자·모델 선택", "API 키 관리", "월 예산·사용량",
      "수학 문제 배치", "국어·받아쓰기 배치", "오늘의 학습 요약", "주간 변화"
    ]) {
      expect(screen.getByRole("treeitem", { name: label })).toBeVisible();
    }

    await user.click(screen.getByRole("treeitem", { name: "수학 문제 배치" }));
    expect(screen.getByRole("button", { name: "초안 만들기" })).toBeDisabled();
    expect(screen.getByText(
      "Gemini와 OpenAI를 모두 켜고 두 API 키를 저장해야 초안을 만들 수 있어요."
    )).toBeVisible();

    await user.click(screen.getByRole("treeitem", { name: "제공자·모델 선택" }));
    expect(screen.getAllByText("API 키 저장되지 않음")).toHaveLength(2);
    await user.click(screen.getByLabelText("Gemini 사용"));
    const geminiKey = screen.getByLabelText("Gemini API 키");
    await user.type(geminiKey, "gemini-secret-never-rendered");
    await user.click(screen.getByRole("button", { name: "Gemini 설정 저장" }));
    await waitFor(() => expect(updateAiStudioProvider).toHaveBeenCalledWith("gemini", {
      enabled: true,
      model: "gemini-2.5-flash",
      apiKey: "gemini-secret-never-rendered"
    }));
    expect(geminiKey).toHaveValue("");

    await user.click(screen.getByLabelText("OpenAI 사용"));
    const openAiKey = screen.getByLabelText("OpenAI API 키");
    await user.type(openAiKey, "openai-secret-never-rendered");
    await user.click(screen.getByRole("button", { name: "OpenAI 설정 저장" }));
    await waitFor(() => expect(updateAiStudioProvider).toHaveBeenCalledWith("openai", {
      enabled: true,
      model: "gpt-5-mini",
      apiKey: "openai-secret-never-rendered"
    }));
    expect(openAiKey).toHaveValue("");
    expect(screen.getAllByText("API 키 저장됨")).toHaveLength(2);
    expect(document.body.textContent).not.toMatch(/gemini-secret|openai-secret/);
    expect(document.documentElement.outerHTML).not.toMatch(/gemini-secret|openai-secret/);
  });

  it("saves authoritative estimated budget and provider rates then reloads server truth", async () => {
    const user = userEvent.setup();
    const initial = {
      monthlyBudgetWon: 3000,
      monthSpentWon: 1250,
      providers: [
        {
          provider: "gemini" as const, enabled: true, model: "gemini-2.5-flash",
          hasApiKey: true, inputWonPer1K: 2, outputWonPer1K: 8
        },
        {
          provider: "openai" as const, enabled: true, model: "gpt-5-mini",
          hasApiKey: true, inputWonPer1K: 3, outputWonPer1K: 12
        }
      ]
    };
    const refreshed = {
      monthlyBudgetWon: 5000,
      monthSpentWon: 1300,
      providers: [
        { ...initial.providers[0], inputWonPer1K: 4, outputWonPer1K: 10 },
        { ...initial.providers[1], inputWonPer1K: 5, outputWonPer1K: 14 }
      ]
    };
    const getAiStudioSettingsView = vi.fn()
      .mockResolvedValueOnce(initial)
      .mockResolvedValueOnce(refreshed);
    const updateAiStudioBudget = vi.fn().mockResolvedValue(refreshed);
    const updateAiStudioProvider = vi.fn().mockImplementation(async (
      provider: "gemini" | "openai",
      input: { inputWonPer1K: number; outputWonPer1K: number }
    ) => ({
      ...initial.providers.find((value) => value.provider === provider)!,
      ...input
    }));
    render(<GuardianDashboard api={createGuardianApi({
      getAiStudioSettingsView,
      updateAiStudioBudget,
      updateAiStudioProvider
    })} />);

    await user.click(screen.getByRole("button", { name: "AI 학습실" }));
    await user.click(screen.getByRole("treeitem", { name: "월 예산·사용량" }));
    expect(await screen.findByText("이번 달 사용 1,250원")).toBeVisible();
    expect(screen.getByText("남은 예상 예산 1,750원")).toBeVisible();

    await user.clear(screen.getByLabelText("월 예산 (원)"));
    await user.type(screen.getByLabelText("월 예산 (원)"), "5000");
    await user.clear(screen.getByLabelText("Gemini 예상 입력 요금 (원/1K 토큰)"));
    await user.type(screen.getByLabelText("Gemini 예상 입력 요금 (원/1K 토큰)"), "4");
    await user.clear(screen.getByLabelText("Gemini 예상 출력 요금 (원/1K 토큰)"));
    await user.type(screen.getByLabelText("Gemini 예상 출력 요금 (원/1K 토큰)"), "10");
    await user.clear(screen.getByLabelText("OpenAI 예상 입력 요금 (원/1K 토큰)"));
    await user.type(screen.getByLabelText("OpenAI 예상 입력 요금 (원/1K 토큰)"), "5");
    await user.clear(screen.getByLabelText("OpenAI 예상 출력 요금 (원/1K 토큰)"));
    await user.type(screen.getByLabelText("OpenAI 예상 출력 요금 (원/1K 토큰)"), "14");
    await user.click(screen.getByRole("button", { name: "예산 저장" }));

    await waitFor(() => expect(updateAiStudioBudget).toHaveBeenCalledWith({
      monthlyBudgetWon: 5000
    }));
    expect(updateAiStudioProvider).toHaveBeenCalledWith("gemini", {
      inputWonPer1K: 4,
      outputWonPer1K: 10
    });
    expect(updateAiStudioProvider).toHaveBeenCalledWith("openai", {
      inputWonPer1K: 5,
      outputWonPer1K: 14
    });
    await waitFor(() => expect(getAiStudioSettingsView).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("이번 달 사용 1,300원")).toBeVisible();
    expect(screen.getByLabelText("월 예산 (원)")).toHaveValue(5000);
  });

  it("clears an API key entry even when the save request fails", async () => {
    const user = userEvent.setup();
    const updateAiStudioProvider = vi.fn().mockRejectedValue(new Error("save failed"));
    render(<GuardianDashboard api={createGuardianApi({ updateAiStudioProvider })} />);

    await user.click(screen.getByRole("button", { name: "AI 학습실" }));
    const apiKey = await screen.findByLabelText("Gemini API 키");
    await user.type(apiKey, "key-that-must-not-stay");
    await user.click(screen.getByRole("button", { name: "Gemini 설정 저장" }));

    expect(await screen.findByText("설정을 저장하지 못했어요.")).toBeVisible();
    expect(apiKey).toHaveValue("");
    expect(document.documentElement.outerHTML).not.toContain("key-that-must-not-stay");
  });

  it("blocks invalid estimated budget values before any save request", async () => {
    const user = userEvent.setup();
    const updateAiStudioBudget = vi.fn();
    const updateAiStudioProvider = vi.fn();
    render(<GuardianDashboard api={createGuardianApi({
      updateAiStudioBudget,
      updateAiStudioProvider
    })} />);

    await user.click(screen.getByRole("button", { name: "AI 학습실" }));
    await user.click(screen.getByRole("treeitem", { name: "월 예산·사용량" }));
    const monthlyBudget = await screen.findByLabelText("월 예산 (원)");
    fireEvent.change(monthlyBudget, { target: { value: "10001" } });

    expect(screen.getByRole("button", { name: "예산 저장" })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "월 예산은 0원에서 10,000원 사이의 정수로 입력해 주세요."
    );
    expect(updateAiStudioBudget).not.toHaveBeenCalled();
    expect(updateAiStudioProvider).not.toHaveBeenCalled();
  });

  it("drops a late math draft after the guardian switches to Korean", async () => {
    const user = userEvent.setup();
    const lateMath = deferred<{
      id: string;
      subject: "math";
      step: "current";
      requestedCount: number;
      difficulty: number;
      weakTopics: string[];
      status: "draft";
      items: [];
    }>();
    const createAiDraft = vi.fn().mockReturnValue(lateMath.promise);
    render(<GuardianDashboard api={createGuardianApi({ createAiDraft })} />);

    await user.click(screen.getByRole("button", { name: "AI 학습실" }));
    await user.click(within(screen.getByRole("tree", { name: "AI 학습실 메뉴" }))
      .getByRole("button", { name: "문제 생성" }));
    await user.click(screen.getByRole("treeitem", { name: "수학 문제 배치" }));
    await user.click(screen.getByRole("button", { name: "초안 만들기" }));
    await waitFor(() => expect(createAiDraft).toHaveBeenCalledOnce());
    await user.click(screen.getByRole("treeitem", { name: "국어·받아쓰기 배치" }));

    await act(async () => lateMath.resolve({
      id: "late-math",
      subject: "math",
      step: "current",
      requestedCount: 8,
      difficulty: 4,
      weakTopics: [],
      status: "draft",
      items: []
    }));

    expect(screen.getByRole("heading", { name: "국어·받아쓰기 배치" })).toBeVisible();
    expect(screen.queryByText(/감리 통과/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "초안 발행" })).not.toBeInTheDocument();
  });

  it("drops an old generation error after the guardian changes learning step", async () => {
    const user = userEvent.setup();
    const oldRequest = deferred<never>();
    const createAiDraft = vi.fn().mockReturnValue(oldRequest.promise);
    render(<GuardianDashboard api={createGuardianApi({ createAiDraft })} />);

    await user.click(screen.getByRole("button", { name: "AI 학습실" }));
    await user.click(within(screen.getByRole("tree", { name: "AI 학습실 메뉴" }))
      .getByRole("button", { name: "문제 생성" }));
    await user.click(screen.getByRole("treeitem", { name: "수학 문제 배치" }));
    await user.click(screen.getByRole("button", { name: "초안 만들기" }));
    await waitFor(() => expect(createAiDraft).toHaveBeenCalledOnce());
    await user.selectOptions(screen.getByLabelText("학습 단계"), "challenge");

    await act(async () => oldRequest.reject(new Error("late failure")));

    expect(screen.queryByText("초안을 만들지 못했어요.")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "초안 발행" })).not.toBeInTheDocument();
  });

  it("creates, edits, and publishes only reviewed math draft items", async () => {
    const user = userEvent.setup();
    const acceptedPayload = {
      id: "accepted-1",
      kind: "math-story" as const,
      subject: "math" as const,
      unit: "받아올림과 받아내림",
      title: "받아올림 더하기",
      level: "4단계",
      readLabel: "식을 읽고 계산하기",
      text: "28에 7을 더해요.",
      hint: "일의 자리부터 계산해요.",
      tokens: ["28", "7"],
      question: "28 + 7은 얼마일까요?",
      answer: 35,
      unitLabel: "",
      checkHint: "받아올림을 확인해요.",
      calculation: { operands: [28, 7] as [number, number], operators: ["+"] as ["+"], layout: "vertical" as const }
    };
    const rejectedPayload = { ...acceptedPayload, id: "rejected-1", title: "중복 문제" };
    const draft = {
      id: "draft-1",
      subject: "math" as const,
      step: "current" as const,
      requestedCount: 8,
      difficulty: 4,
      weakTopics: ["받아올림"],
      status: "draft" as const,
      items: [
        { id: "accepted-1", sourceProvider: "gemini" as const, payload: acceptedPayload, review: { accepted: true, reasons: [] }, status: "accepted" as const },
        { id: "rejected-1", sourceProvider: "openai" as const, payload: rejectedPayload, review: { accepted: false, reasons: ["REVIEW_DUPLICATE"] }, status: "rejected" as const }
      ]
    };
    const createAiDraft = vi.fn().mockResolvedValue(draft);
    const updateAiDraftItem = vi.fn().mockImplementation(async (
      _draftId: string,
      _itemId: string,
      payload: typeof acceptedPayload
    ) => ({
      ...draft,
      items: [{ ...draft.items[0], payload, status: "edited" as const }, draft.items[1]]
    }));
    const publishAiDraft = vi.fn().mockResolvedValue({
      ...draft,
      status: "published",
      items: [{ ...draft.items[0], status: "published" }, draft.items[1]]
    });
    const api = createGuardianApi({ createAiDraft, updateAiDraftItem, publishAiDraft });
    render(<GuardianDashboard api={api} />);

    await user.click(screen.getByRole("button", { name: "AI 학습실" }));
    await user.click(within(screen.getByRole("tree", { name: "AI 학습실 메뉴" }))
      .getByRole("button", { name: "문제 생성" }));
    await user.click(screen.getByRole("treeitem", { name: "수학 문제 배치" }));
    await user.type(screen.getByLabelText("자주 틀린 유형"), "받아올림");
    await user.click(screen.getByRole("button", { name: "초안 만들기" }));
    await waitFor(() => expect(createAiDraft).toHaveBeenCalledWith({
      subject: "math",
      step: "current",
      count: 8,
      difficulty: 4,
      weakTopics: ["받아올림"]
    }));

    const accepted = await screen.findByRole("article", { name: "받아올림 더하기 초안" });
    const rejected = screen.getByRole("article", { name: "중복 문제 초안" });
    expect(within(rejected).getByText("감리 탈락 · 발행 제외")).toBeVisible();
    expect(within(rejected).queryByRole("button", { name: "수정 저장" })).not.toBeInTheDocument();
    const answer = within(accepted).getByLabelText("정답");
    await user.clear(answer);
    await user.type(answer, "36");
    await user.click(within(accepted).getByRole("button", { name: "수정 저장" }));
    expect(await within(accepted).findByText("문제 형식을 다시 확인해 주세요.")).toBeVisible();
    expect(updateAiDraftItem).not.toHaveBeenCalled();
    await user.clear(answer);
    await user.type(answer, "35");
    const title = within(accepted).getByLabelText("문제 제목");
    await user.clear(title);
    await user.type(title, "받아올림 더하기 연습");
    await user.click(within(accepted).getByRole("button", { name: "수정 저장" }));
    await waitFor(() => expect(updateAiDraftItem).toHaveBeenCalledWith(
      "draft-1",
      "accepted-1",
      expect.objectContaining({ title: "받아올림 더하기 연습" })
    ));

    await user.click(screen.getByRole("button", { name: "초안 발행" }));
    await waitFor(() => expect(publishAiDraft).toHaveBeenCalledWith("draft-1"));
    expect(await screen.findByText("발행을 완료했어요.")).toBeVisible();
  });

  it("does not publish a draft while an accepted item save is still pending", async () => {
    const user = userEvent.setup();
    const acceptedPayload = {
      id: "accepted-1",
      kind: "math-story" as const,
      subject: "math" as const,
      unit: "받아올림과 받아내림",
      title: "받아올림 더하기",
      level: "4단계",
      readLabel: "식을 읽고 계산하기",
      text: "28에 7을 더해요.",
      hint: "일의 자리부터 계산해요.",
      tokens: ["28", "7"],
      question: "28 + 7은 얼마일까요?",
      answer: 35,
      unitLabel: "",
      checkHint: "받아올림을 확인해요.",
      calculation: { operands: [28, 7] as [number, number], operators: ["+"] as ["+"], layout: "vertical" as const }
    };
    const draft = {
      id: "draft-1",
      subject: "math" as const,
      step: "current" as const,
      requestedCount: 8,
      difficulty: 4,
      weakTopics: [],
      status: "draft" as const,
      items: [{
        id: "accepted-1",
        sourceProvider: "gemini" as const,
        payload: acceptedPayload,
        review: { accepted: true, reasons: [] },
        status: "accepted" as "accepted" | "edited"
      }]
    };
    const itemSave = deferred<typeof draft>();
    const updateAiDraftItem = vi.fn().mockReturnValue(itemSave.promise);
    const publishAiDraft = vi.fn();
    const api = createGuardianApi({
      createAiDraft: vi.fn().mockResolvedValue(draft),
      updateAiDraftItem,
      publishAiDraft
    });
    render(<GuardianDashboard api={api} />);

    await user.click(screen.getByRole("button", { name: "AI 학습실" }));
    await user.click(within(screen.getByRole("tree", { name: "AI 학습실 메뉴" }))
      .getByRole("button", { name: "문제 생성" }));
    await user.click(screen.getByRole("treeitem", { name: "수학 문제 배치" }));
    await user.click(screen.getByRole("button", { name: "초안 만들기" }));
    const accepted = await screen.findByRole("article", { name: "받아올림 더하기 초안" });
    const title = within(accepted).getByLabelText("문제 제목");
    await user.clear(title);
    await user.type(title, "저장 중인 새 제목");
    await user.click(within(accepted).getByRole("button", { name: "수정 저장" }));

    await waitFor(() => expect(updateAiDraftItem).toHaveBeenCalledWith(
      "draft-1", "accepted-1", expect.objectContaining({ title: "저장 중인 새 제목" })
    ));
    const publish = screen.getByRole("button", { name: "초안 발행" });
    expect(publish).toBeDisabled();
    await user.click(publish);
    expect(publishAiDraft).not.toHaveBeenCalled();

    itemSave.resolve({
      ...draft,
      items: [{ ...draft.items[0]!, payload: { ...acceptedPayload, title: "저장 중인 새 제목" }, status: "edited" }]
    });
    await waitFor(() => expect(screen.getByRole("button", { name: "초안 발행" })).toBeEnabled());
  });

  it("restores the selected AI panel and exposes a keyboard-operable tree hierarchy", async () => {
    const user = userEvent.setup();
    render(<GuardianDashboard api={createGuardianApi()} />);

    await user.click(screen.getByRole("button", { name: "AI 학습실" }));
    const tree = screen.getByRole("tree", { name: "AI 학습실 메뉴" });
    expect(within(tree).getByRole("treeitem", { name: "AI 설정" }))
      .toHaveAttribute("aria-expanded", "true");
    const generationBranch = within(tree).getByRole("treeitem", { name: "문제 생성" });
    generationBranch.focus();
    await user.keyboard("{ArrowRight}");
    expect(generationBranch).toHaveAttribute("aria-expanded", "true");
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("treeitem", { name: "수학 문제 배치" })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("heading", { name: "수학 문제 배치" })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "진도" }));
    await user.click(screen.getByRole("button", { name: "AI 학습실" }));
    expect(screen.getByRole("heading", { name: "수학 문제 배치" })).toBeVisible();
    expect(screen.getByRole("treeitem", { name: "수학 문제 배치" }))
      .toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("treeitem", { name: "문제 생성" }))
      .toHaveAttribute("aria-expanded", "true");
  });

  it("retains the selected settings leaf and expanded groups after AI studio re-entry", async () => {
    const user = userEvent.setup();
    render(<GuardianDashboard api={createGuardianApi()} />);

    await user.click(screen.getByRole("button", { name: "AI 학습실" }));
    await user.click(screen.getByRole("treeitem", { name: "API 키 관리" }));
    await user.click(within(screen.getByRole("tree", { name: "AI 학습실 메뉴" }))
      .getByRole("button", { name: "문제 생성" }));
    await user.click(screen.getByRole("button", { name: "진도" }));
    await user.click(screen.getByRole("button", { name: "AI 학습실" }));

    expect(screen.getByRole("treeitem", { name: "API 키 관리" }))
      .toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("treeitem", { name: "AI 설정" }))
      .toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("treeitem", { name: "문제 생성" }))
      .toHaveAttribute("aria-expanded", "true");
  });

  it("loads today and weekly reports with their KST date ranges and shows the source", async () => {
    const user = userEvent.setup();
    const now = new Date();
    const formatDate = (date: Date) => new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit"
    }).format(date);
    const today = formatDate(now);
    const weeklyStart = new Date(now);
    weeklyStart.setDate(weeklyStart.getDate() - 6);
    const getGuardianAiReport = vi.fn()
      .mockResolvedValueOnce({
        summary: "오늘은 로컬 요약이에요.", completionRate: 100, challengePerfect: true,
        commonMistakes: [], source: "local" as const
      })
      .mockResolvedValueOnce({
        summary: "이번 주는 AI 요약이에요.", completionRate: 80, challengePerfect: false,
        commonMistakes: ["받침"], source: "llm" as const
      });
    render(<GuardianDashboard api={createGuardianApi({ getGuardianAiReport })} />);

    await user.click(screen.getByRole("button", { name: "AI 학습실" }));
    await user.click(within(screen.getByRole("tree", { name: "AI 학습실 메뉴" }))
      .getByRole("button", { name: "보고서" }));
    await user.click(screen.getByRole("treeitem", { name: "오늘의 학습 요약" }));
    await waitFor(() => expect(getGuardianAiReport).toHaveBeenCalledWith(today, today));
    expect(await screen.findByText("오늘은 로컬 요약이에요.")).toBeVisible();
    expect(screen.getByText("로컬 요약")).toBeVisible();

    await user.click(screen.getByRole("treeitem", { name: "주간 변화" }));
    await waitFor(() => expect(getGuardianAiReport).toHaveBeenLastCalledWith(formatDate(weeklyStart), today));
    expect(await screen.findByText("이번 주는 AI 요약이에요.")).toBeVisible();
    expect(screen.getByText("AI 요약")).toBeVisible();
  });

  it("shows a report error after the selected report range fails", async () => {
    const user = userEvent.setup();
    const now = new Date();
    const formatDate = (date: Date) => new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit"
    }).format(date);
    const weeklyStart = new Date(now);
    weeklyStart.setDate(weeklyStart.getDate() - 6);
    const getGuardianAiReport = vi.fn().mockRejectedValue(new Error("offline"));
    render(<GuardianDashboard api={createGuardianApi({ getGuardianAiReport })} />);

    await user.click(screen.getByRole("button", { name: "AI 학습실" }));
    await user.click(within(screen.getByRole("tree", { name: "AI 학습실 메뉴" }))
      .getByRole("button", { name: "보고서" }));
    await user.click(screen.getByRole("treeitem", { name: "주간 변화" }));
    await waitFor(() => expect(getGuardianAiReport).toHaveBeenCalledWith(formatDate(weeklyStart), formatDate(now)));
    expect(await screen.findByRole("alert")).toHaveTextContent("학습 보고서를 불러오지 못했어요.");
  });

  it("shows guardian progress and star status without protected or internal data", async () => {
    const api = createGuardianApi();

    render(<GuardianDashboard api={api} />);

    expect(await screen.findByText("별 잔액 12개")).toBeVisible();
    expect(screen.getByText("5분 무반응")).toBeVisible();
    expect(screen.getByText("완료한 활동 4개")).toBeVisible();
    expect(screen.getByText("읽기 통과율 83%")).toBeVisible();
    expect(screen.getByText("수학 통과율 75%")).toBeVisible();
    expect(screen.getByText("꽃잎 · 2회")).toBeVisible();
    for (const tab of ["진도", "별 기록", "차감 승인", "학습 계획", "AI 학습실", "백업"]) {
      expect(screen.getByRole("button", { name: tab })).toBeVisible();
    }
    expect(document.body.textContent).not.toMatch(
      /event-private|item-private|password|PIN|cookie|audio|transcript|삭제/i
    );
    expect(screen.getByRole("button", { name: "기기 관리" })).toBeVisible();
  });

  it("merges server and current-browser redacted rejections without rendering private payload fields", async () => {
    const server = {
      id: "server-secret-id",
      studyDate: "2026-07-16",
      itemId: "server-secret-item",
      itemTitle: "별빛 씨앗 주머니",
      kind: "attempt" as const,
      code: "PLAN_SUBMISSION_EXPIRED",
      createdAt: "2026-07-16T03:10:00.000Z",
      receipt_json: "server-receipt-secret",
      answer: 15,
      missedTokens: ["server-token-secret"],
      transcript: "server-transcript-secret",
      learningSessionId: "server-session-secret"
    };
    const local = {
      id: "local-secret-id",
      studyDate: "2026-07-16",
      itemId: "local-secret-item",
      itemTitle: "숲속 작은 등불",
      kind: "idle" as const,
      code: "LEGACY_AUTHORITY_UNAVAILABLE",
      createdAt: "2026-07-16T03:09:00.000Z",
      answer: "local-answer-secret",
      transcript: "local-transcript-secret",
      learningSessionId: "local-session-secret"
    };
    const api = createGuardianApi({
      getGuardianOfflineRejections: vi.fn().mockResolvedValue({
        rejections: [server]
      })
    });

    render(
      <GuardianDashboard
        api={api}
        loadLocalOfflineRejections={vi.fn().mockResolvedValue([
          local as GuardianOfflineRejection
        ])}
      />
    );

    expect(await screen.findByText("동기화 확인 필요")).toBeVisible();
    expect(screen.getByText("별빛 씨앗 주머니")).toBeVisible();
    expect(screen.getByText("숲속 작은 등불")).toBeVisible();
    expect(screen.getByText("풀이 · PLAN_SUBMISSION_EXPIRED")).toBeVisible();
    expect(screen.getByText("무반응 · LEGACY_AUTHORITY_UNAVAILABLE")).toBeVisible();
    expect(document.body.textContent).not.toMatch(
      /secret-id|secret-item|receipt|answer|token-secret|transcript|session-secret/i
    );
  });

  it("lists only safe device views and confirms current and other device revocation", async () => {
    const user = userEvent.setup();
    const current = {
      publicId: "public-current",
      name: "현재 태블릿",
      createdAt: "2026-07-15T03:00:00.000Z",
      lastUsedAt: "2026-07-16T03:00:00.000Z",
      status: "active" as const,
      current: true
    };
    const other = {
      publicId: "public-other",
      name: "거실 태블릿",
      createdAt: "2026-07-14T03:00:00.000Z",
      lastUsedAt: null,
      status: "active" as const,
      current: false
    };
    const listTrustedDevices = vi.fn().mockResolvedValue([current, other]);
    const revokeTrustedDevice = vi.fn().mockImplementation((publicId: string) =>
      Promise.resolve({
        ...(publicId === current.publicId ? current : other),
        status: "revoked" as const
      }));
    const api = createGuardianApi({ listTrustedDevices, revokeTrustedDevice });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<GuardianDashboard api={api} />);

    await user.click(screen.getByRole("button", { name: "계정 메뉴" }));
    await user.click(screen.getByRole("button", { name: "기기 관리" }));
    expect(await screen.findByText("현재 태블릿")).toBeVisible();
    expect(screen.getByText("거실 태블릿")).toBeVisible();
    expect(screen.getByText("등록: 2026년 7월 15일 12:00")).toBeVisible();
    expect(screen.getByText("마지막 사용: 2026년 7월 16일 12:00")).toBeVisible();
    expect(screen.getByText("마지막 사용: 기록 없음")).toBeVisible();
    expect(document.body.textContent).not.toContain("2026-07-15T03:00:00.000Z");
    expect(document.body.textContent).not.toMatch(/public-current|public-other|token|hash/i);

    await user.click(screen.getByRole("button", { name: "거실 태블릿 기기 해제" }));
    expect(confirm).toHaveBeenLastCalledWith("거실 태블릿 기기를 해제할까요?");
    await waitFor(() => expect(revokeTrustedDevice).toHaveBeenCalledWith("public-other"));

    await user.click(screen.getByRole("button", { name: "현재 태블릿 기기 해제" }));
    expect(confirm).toHaveBeenLastCalledWith(
      "현재 기기를 해제하면 수아 모드에서 다시 등록해야 해요. 해제할까요?"
    );
    await waitFor(() => expect(revokeTrustedDevice).toHaveBeenCalledWith("public-current"));
    expect(screen.getAllByText("해제됨")).toHaveLength(2);
    confirm.mockRestore();
  });

  it("re-registers a revoked current browser and refreshes the authoritative device list", async () => {
    const user = userEvent.setup();
    const current = {
      publicId: "public-old",
      name: "기존 태블릿",
      createdAt: "2026-07-15T03:00:00.000Z",
      lastUsedAt: "2026-07-16T03:00:00.000Z",
      status: "active" as const,
      current: true
    };
    const revokedCurrent = { ...current, status: "revoked" as const };
    const revokedOld = { ...revokedCurrent, current: false };
    const replacement = {
      publicId: "public-new",
      name: "다시 등록한 태블릿",
      createdAt: "2026-07-16T04:00:00.000Z",
      lastUsedAt: null,
      status: "active" as const,
      current: true
    };
    const listTrustedDevices = vi.fn()
      .mockResolvedValueOnce([current])
      .mockResolvedValueOnce([revokedOld, replacement]);
    const revokeTrustedDevice = vi.fn().mockResolvedValue(revokedCurrent);
    const registerDevice = vi.fn().mockResolvedValue(replacement);
    const api = createGuardianApi({
      listTrustedDevices,
      registerDevice,
      revokeTrustedDevice
    });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<GuardianDashboard api={api} />);

    await user.click(screen.getByRole("button", { name: "계정 메뉴" }));
    await user.click(screen.getByRole("button", { name: "기기 관리" }));
    await user.click(await screen.findByRole("button", {
      name: "기존 태블릿 기기 해제"
    }));
    expect(await screen.findByText("해제됨")).toBeVisible();

    const name = screen.getByLabelText("현재 브라우저 이름");
    await user.clear(name);
    await user.type(name, "다시 등록한 태블릿");
    const register = screen.getByRole("button", { name: "현재 브라우저 등록" });
    await user.click(register);

    await waitFor(() => expect(registerDevice).toHaveBeenCalledWith("다시 등록한 태블릿", "tablet"));
    await waitFor(() => expect(listTrustedDevices).toHaveBeenCalledTimes(2));
    const newCurrent = (await screen.findByText("다시 등록한 태블릿")).closest("li")!;
    const oldDevice = screen.getByText("기존 태블릿").closest("li")!;
    expect(within(newCurrent).getByText("현재 기기")).toBeVisible();
    expect(within(oldDevice).getByText("다른 기기")).toBeVisible();
    confirm.mockRestore();
  });

  it("shows typed limits and lets a guardian classify a legacy device without exposing secrets", async () => {
    const user = userEvent.setup();
    const legacy = {
      publicId: "legacy-device",
      name: "기존 태블릿",
      createdAt: "2026-07-15T03:00:00.000Z",
      lastUsedAt: null,
      deviceType: null,
      status: "active" as const,
      current: false
    };
    const tablet = {
      publicId: "tablet-device",
      name: "현재 태블릿",
      createdAt: "2026-07-16T03:00:00.000Z",
      lastUsedAt: null,
      deviceType: "tablet" as const,
      status: "active" as const,
      current: true
    };
    const updateTrustedDeviceType = vi.fn().mockResolvedValue({
      ...legacy,
      deviceType: "phone" as const
    });
    const api = createGuardianApi({
      listTrustedDevices: vi.fn().mockResolvedValue([legacy, tablet]),
      updateTrustedDeviceType
    });

    render(<GuardianDashboard api={api} />);
    await user.click(screen.getByRole("button", { name: "계정 메뉴" }));
    await user.click(screen.getByRole("button", { name: "기기 관리" }));

    expect(await screen.findByText("태블릿 1/3 · 휴대폰 0/3 · Mac 0/1 · Windows 0/2"))
      .toBeVisible();
    expect(screen.getByText("기기 종류 확인 필요")).toBeVisible();
    await user.selectOptions(screen.getByLabelText("기존 태블릿 기기 종류"), "phone");
    await waitFor(() => expect(updateTrustedDeviceType)
      .toHaveBeenCalledWith("legacy-device", "phone"));
    expect(within(screen.getByText("기존 태블릿").closest("li")!)
      .getByText("휴대폰")).toBeVisible();
    expect(document.body.textContent).not.toMatch(/token|hash|internal|cookie/i);
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

    await user.click(screen.getByRole("button", { name: "차감 승인" }));
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

    await user.click(screen.getByRole("button", { name: "차감 승인" }));
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

  it("distinguishes approved-zero and waived adjustments with their audit notes", async () => {
    const user = userEvent.setup();
    const common = {
      itemId: "ko-private-1",
      requestedStars: 1,
      approvedStars: 0,
      appliedStars: 0,
      starEventId: null,
      createdAt: "2026-07-16T03:00:00.000Z",
      processedAt: "2026-07-16T04:00:00.000Z"
    };
    const api = createGuardianApi({
      getStarAdjustments: vi.fn().mockResolvedValue({
        adjustments: [{
          ...common,
          id: "approved-private",
          studyDate: "2026-07-14",
          status: "approved" as const,
          note: "차감 없이 승인"
        }, {
          ...common,
          id: "waived-private",
          studyDate: "2026-07-15",
          status: "waived" as const,
          note: "아픈 날 면제"
        }]
      })
    });
    render(<GuardianDashboard api={api} />);

    await user.click(screen.getByRole("button", { name: "차감 승인" }));
    const approved = await screen.findByRole("article", { name: "2026-07-14 차감 요청" });
    const waived = screen.getByRole("article", { name: "2026-07-15 차감 요청" });

    expect(within(approved).getByText("처리 상태 승인")).toBeVisible();
    expect(within(approved).getByText("처리 메모 차감 없이 승인")).toBeVisible();
    expect(within(waived).getByText("처리 상태 면제")).toBeVisible();
    expect(within(waived).getByText("처리 메모 아픈 날 면제")).toBeVisible();
  });

  it("guards approval in flight and reconciles an uncertain response", async () => {
    const user = userEvent.setup();
    const pending = {
      id: "pending-approval",
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
    const processed = {
      ...pending,
      approvedStars: 1,
      appliedStars: 1,
      status: "approved" as const,
      note: "확인했어요",
      starEventId: "event-private-approved",
      processedAt: "2026-07-16T04:00:00.000Z"
    };
    const uncertain = deferred<never>();
    const getStarAdjustments = vi.fn()
      .mockResolvedValueOnce({ adjustments: [pending] })
      .mockResolvedValueOnce({ adjustments: [processed] });
    const approveStarAdjustment = vi.fn().mockReturnValue(uncertain.promise);
    const api = createGuardianApi({ getStarAdjustments, approveStarAdjustment });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<GuardianDashboard api={api} />);

    await user.click(screen.getByRole("button", { name: "차감 승인" }));
    const card = await screen.findByRole("article", { name: "2026-07-15 차감 요청" });
    await user.type(within(card).getByLabelText("승인 메모 (선택)"), "확인했어요");
    const approveButton = within(card).getByRole("button", { name: "차감 승인" });
    await user.click(approveButton);
    await user.click(approveButton);

    expect(approveStarAdjustment).toHaveBeenCalledOnce();
    expect(approveButton).toBeDisabled();
    uncertain.reject(new ApiError(503, "TEMPORARY_FAILURE"));

    expect(await within(card).findByRole("alert")).toHaveTextContent(
      "차감 승인을 완료하지 못했어요. 최신 상태를 확인했어요."
    );
    expect(await within(card).findByText("처리 상태 승인")).toBeVisible();
    expect(within(card).queryByRole("button", { name: "차감 승인" })).not.toBeInTheDocument();
    expect(getStarAdjustments).toHaveBeenCalledTimes(2);
    confirm.mockRestore();
  });

  it("guards waiver in flight and retries the same intent after reconciliation", async () => {
    const user = userEvent.setup();
    const pending = {
      id: "pending-waiver",
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
    const processed = {
      ...pending,
      approvedStars: 0,
      appliedStars: 0,
      status: "waived" as const,
      note: "아파서 쉬었어요",
      processedAt: "2026-07-16T04:00:00.000Z",
      duplicate: true
    };
    const uncertain = deferred<never>();
    const getStarAdjustments = vi.fn()
      .mockResolvedValueOnce({ adjustments: [pending] })
      .mockResolvedValueOnce({ adjustments: [pending] });
    const waiveStarAdjustment = vi.fn()
      .mockReturnValueOnce(uncertain.promise)
      .mockResolvedValueOnce(processed);
    const api = createGuardianApi({ getStarAdjustments, waiveStarAdjustment });
    render(<GuardianDashboard api={api} />);

    await user.click(screen.getByRole("button", { name: "차감 승인" }));
    const card = await screen.findByRole("article", { name: "2026-07-15 차감 요청" });
    await user.type(within(card).getByLabelText("면제 사유"), "아파서 쉬었어요");
    const waiveButton = within(card).getByRole("button", { name: "아픈 날로 면제" });
    await user.click(waiveButton);
    await user.click(waiveButton);

    expect(waiveStarAdjustment).toHaveBeenCalledOnce();
    expect(waiveButton).toBeDisabled();
    uncertain.reject(new ApiError(503, "TEMPORARY_FAILURE"));
    expect(await within(card).findByRole("alert")).toHaveTextContent(
      "면제를 완료하지 못했어요. 최신 상태를 확인했어요."
    );

    await user.click(within(card).getByRole("button", { name: "아픈 날로 면제" }));
    await waitFor(() => expect(waiveStarAdjustment).toHaveBeenCalledTimes(2));
    expect(waiveStarAdjustment.mock.calls[0]).toEqual(waiveStarAdjustment.mock.calls[1]);
    expect(await within(card).findByText("처리 상태 면제")).toBeVisible();
  });

  it("serializes mutations across two adjustment rows", async () => {
    const user = userEvent.setup();
    const pending = (id: string, studyDate: string) => ({
      id,
      studyDate,
      itemId: `item-${id}`,
      requestedStars: 1,
      approvedStars: null,
      appliedStars: null,
      status: "pending" as const,
      note: null,
      starEventId: null,
      createdAt: "2026-07-16T03:00:00.000Z",
      processedAt: null
    });
    const first = pending("pending-first", "2026-07-14");
    const second = pending("pending-second", "2026-07-15");
    const approval = deferred<ProcessedStarAdjustment>();
    const approveStarAdjustment = vi.fn().mockReturnValue(approval.promise);
    const waiveStarAdjustment = vi.fn().mockResolvedValue({
      ...second,
      approvedStars: 0,
      appliedStars: 0,
      status: "waived" as const,
      note: "두 번째 요청",
      processedAt: "2026-07-16T04:00:00.000Z",
      duplicate: false
    });
    const api = createGuardianApi({
      getStarAdjustments: vi.fn().mockResolvedValue({ adjustments: [first, second] }),
      approveStarAdjustment,
      waiveStarAdjustment
    });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<GuardianDashboard api={api} />);

    await user.click(screen.getByRole("button", { name: "차감 승인" }));
    const firstCard = await screen.findByRole("article", { name: "2026-07-14 차감 요청" });
    const secondCard = screen.getByRole("article", { name: "2026-07-15 차감 요청" });
    await user.type(within(secondCard).getByLabelText("면제 사유"), "두 번째 요청");
    await user.click(within(firstCard).getByRole("button", { name: "차감 승인" }));
    const secondWaive = within(secondCard).getByRole("button", { name: "아픈 날로 면제" });
    await user.click(secondWaive);

    expect(approveStarAdjustment).toHaveBeenCalledOnce();
    expect(waiveStarAdjustment).not.toHaveBeenCalled();
    expect(secondWaive).toBeDisabled();

    approval.resolve({
      ...first,
      approvedStars: 1,
      appliedStars: 1,
      status: "approved",
      note: "",
      starEventId: "event-private-approved",
      processedAt: "2026-07-16T04:00:00.000Z",
      duplicate: false
    });
    expect(await within(firstCard).findByText("처리 상태 승인")).toBeVisible();
    confirm.mockRestore();
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

    await user.click(screen.getByRole("button", { name: "별 기록" }));
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

  it("invalidates old ledger rows and cursor before a new filter resolves", async () => {
    const user = userEvent.setup();
    const oldEvent = {
      id: "event-private-old-page",
      requestedDelta: -1,
      delta: -1,
      balanceAfter: 11,
      reason: "IDLE_TIMEOUT" as const,
      reasonText: "이전 필터 기록",
      studyDate: "2026-07-16",
      itemId: null,
      actorType: "system" as const,
      createdAt: "2026-07-16T03:00:00.000Z",
      reversesEventId: null,
      isReversed: false
    };
    const newEvent = {
      ...oldEvent,
      id: "event-private-new-first-page",
      requestedDelta: 2,
      delta: 2,
      balanceAfter: 13,
      reason: "GUARDIAN_BONUS" as const,
      reasonText: "새 필터 첫 페이지",
      actorType: "guardian" as const
    };
    const staleNextEvent = {
      ...newEvent,
      id: "event-private-stale-next",
      reasonText: "이전 커서로 건너뛴 기록"
    };
    const newFirstPage = deferred<{
      summary: {
        balance: number;
        earnedToday: number;
        deductedToday: number;
        lastReason: string;
      };
      events: typeof newEvent[];
      nextCursor: string | null;
    }>();
    const getGuardianStars = vi.fn((query?: { reason?: string; cursor?: string }) => {
      if (query?.cursor === "cursor-private-old") {
        return Promise.resolve({
          summary: {
            balance: 13,
            earnedToday: 2,
            deductedToday: 1,
            lastReason: staleNextEvent.reasonText
          },
          events: [staleNextEvent],
          nextCursor: null
        });
      }
      if (query?.reason === "GUARDIAN_BONUS") return newFirstPage.promise;
      return Promise.resolve({
        summary: {
          balance: 11,
          earnedToday: 0,
          deductedToday: 1,
          lastReason: oldEvent.reasonText
        },
        events: [oldEvent],
        nextCursor: "cursor-private-old"
      });
    });
    const api = createGuardianApi({ getGuardianStars });
    render(<GuardianDashboard api={api} />);

    await user.click(screen.getByRole("button", { name: "별 기록" }));
    expect(await screen.findByText("이전 필터 기록")).toBeVisible();
    const oldNext = screen.getByRole("button", { name: "다음 기록 100개" });
    await user.selectOptions(screen.getByLabelText("사유"), "GUARDIAN_BONUS");

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "필터 적용" }));
      fireEvent.click(oldNext);
    });

    expect(screen.queryByText("이전 필터 기록")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "다음 기록 100개" })).not.toBeInTheDocument();
    expect(getGuardianStars).not.toHaveBeenCalledWith({
      direction: "all",
      reason: "GUARDIAN_BONUS",
      cursor: "cursor-private-old"
    });

    newFirstPage.resolve({
      summary: {
        balance: 13,
        earnedToday: 2,
        deductedToday: 1,
        lastReason: newEvent.reasonText
      },
      events: [newEvent],
      nextCursor: null
    });

    expect(await screen.findByText("새 필터 첫 페이지")).toBeVisible();
    expect(screen.queryByText("이전 커서로 건너뛴 기록")).not.toBeInTheDocument();
    expect(screen.queryByText("이전 필터 기록")).not.toBeInTheDocument();
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

    await user.click(screen.getByRole("button", { name: "별 기록" }));
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

    await user.click(screen.getByRole("button", { name: "별 기록" }));
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

    await user.click(screen.getByRole("button", { name: "별 기록" }));
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

  it("serializes a manual adjustment and reloads the applied nonmatching filter", async () => {
    const user = userEvent.setup();
    const filteredEvent = {
      id: "event-private-filtered-idle",
      requestedDelta: -1,
      delta: -1,
      balanceAfter: 11,
      reason: "IDLE_TIMEOUT" as const,
      reasonText: "필터 유지 5분 무반응",
      studyDate: "2026-07-16",
      itemId: null,
      actorType: "system" as const,
      createdAt: "2026-07-16T03:00:00.000Z",
      reversesEventId: null,
      isReversed: false
    };
    const manualEvent = {
      id: "event-private-filtered-out-bonus",
      requestedDelta: 2,
      delta: 2,
      balanceAfter: 13,
      reason: "GUARDIAN_BONUS" as const,
      reasonText: "필터에 맞지 않는 보너스",
      studyDate: "2026-07-16",
      itemId: null,
      actorType: "guardian" as const,
      createdAt: "2026-07-16T04:00:00.000Z",
      reversesEventId: null
    };
    const filteredLedger = {
      summary: {
        balance: 13,
        earnedToday: 2,
        deductedToday: 1,
        lastReason: filteredEvent.reasonText
      },
      events: [filteredEvent],
      nextCursor: null
    };
    const getGuardianStars = vi.fn().mockResolvedValue(filteredLedger);
    const manualResult = deferred<AppliedStarResult>();
    const applyManualStars = vi.fn().mockReturnValue(manualResult.promise);
    const api = createGuardianApi({ getGuardianStars, applyManualStars });
    render(<GuardianDashboard api={api} />);

    await user.click(screen.getByRole("button", { name: "별 기록" }));
    expect(await screen.findByText("필터 유지 5분 무반응")).toBeVisible();
    await user.selectOptions(screen.getByLabelText("사유"), "IDLE_TIMEOUT");
    await user.click(screen.getByRole("button", { name: "필터 적용" }));
    await waitFor(() => expect(getGuardianStars).toHaveBeenLastCalledWith({
      direction: "all",
      reason: "IDLE_TIMEOUT"
    }));
    const callsBeforeAdjustment = getGuardianStars.mock.calls.length;

    await user.type(screen.getByLabelText("별 수"), "2");
    await user.type(screen.getByLabelText("조정 사유"), "필터 외 보너스");
    const save = screen.getByRole("button", { name: "별 조정 저장" });
    act(() => {
      fireEvent.click(save);
      fireEvent.click(save);
    });

    expect(applyManualStars).toHaveBeenCalledOnce();
    expect(save).toBeDisabled();

    manualResult.resolve({ event: manualEvent, duplicate: false });

    await waitFor(() => expect(getGuardianStars).toHaveBeenCalledTimes(
      callsBeforeAdjustment + 1
    ));
    expect(getGuardianStars).toHaveBeenLastCalledWith({
      direction: "all",
      reason: "IDLE_TIMEOUT"
    });
    expect(screen.getByText("필터 유지 5분 무반응")).toBeVisible();
    expect(screen.queryByText("필터에 맞지 않는 보너스")).not.toBeInTheDocument();
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
      reversesEventId: null,
      isReversed: false
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
    let reversedOnServer = false;
    const reverseStarEvent = vi.fn().mockImplementation(async () => {
      reversedOnServer = true;
      return { event: reversal, duplicate: false };
    });
    const api = createGuardianApi({
      getGuardianStars: vi.fn().mockImplementation(async () => ({
        summary: {
          balance: reversedOnServer ? 10 : 12,
          earnedToday: 2,
          deductedToday: reversedOnServer ? 2 : 0,
          lastReason: reversedOnServer ? "잘못 입력했어요" : "약속 보너스"
        },
        events: reversedOnServer
          ? [{ ...reversal, isReversed: false }, { ...original, isReversed: true }]
          : [original],
        nextCursor: null
      })),
      reverseStarEvent
    });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<GuardianDashboard api={api} />);

    await user.click(screen.getByRole("button", { name: "별 기록" }));
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

  it("hides reversal controls when server metadata marks a filtered-page original reversed", async () => {
    const user = userEvent.setup();
    const api = createGuardianApi({
      getGuardianStars: vi.fn().mockResolvedValue({
        summary: {
          balance: 10,
          earnedToday: 2,
          deductedToday: 2,
          lastReason: "잘못 입력했어요"
        },
        events: [{
          id: "event-private-original",
          requestedDelta: 2,
          delta: 2,
          balanceAfter: 12,
          reason: "GUARDIAN_BONUS" as const,
          reasonText: "필터된 원래 기록",
          studyDate: "2026-07-16",
          itemId: null,
          actorType: "guardian" as const,
          createdAt: "2026-07-16T03:00:00.000Z",
          reversesEventId: null,
          isReversed: true
        }],
        nextCursor: "cursor-private-next-page"
      })
    });
    render(<GuardianDashboard api={api} />);

    await user.click(screen.getByRole("button", { name: "별 기록" }));
    expect(await screen.findByText("필터된 원래 기록")).toBeVisible();
    expect(screen.queryByLabelText("되돌리기 사유")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "기록 되돌리기" })).not.toBeInTheDocument();
  });

  it("guards reversal in flight and reconciles a 409 from authoritative ledger metadata", async () => {
    const user = userEvent.setup();
    const original = {
      id: "event-private-original",
      requestedDelta: 2,
      delta: 2,
      balanceAfter: 12,
      reason: "GUARDIAN_BONUS" as const,
      reasonText: "동시 취소 대상",
      studyDate: "2026-07-16",
      itemId: null,
      actorType: "guardian" as const,
      createdAt: "2026-07-16T03:00:00.000Z",
      reversesEventId: null,
      isReversed: false
    };
    const ledger = (isReversed: boolean) => ({
      summary: {
        balance: isReversed ? 10 : 12,
        earnedToday: 2,
        deductedToday: isReversed ? 2 : 0,
        lastReason: isReversed ? "다른 요청에서 취소" : "동시 취소 대상"
      },
      events: [{ ...original, isReversed }],
      nextCursor: null
    });
    const getGuardianStars = vi.fn()
      .mockResolvedValueOnce(ledger(false))
      .mockResolvedValueOnce(ledger(false))
      .mockResolvedValueOnce(ledger(true));
    const uncertain = deferred<never>();
    const reverseStarEvent = vi.fn().mockReturnValue(uncertain.promise);
    const api = createGuardianApi({ getGuardianStars, reverseStarEvent });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<GuardianDashboard api={api} />);

    await user.click(screen.getByRole("button", { name: "별 기록" }));
    const reason = await screen.findByLabelText("되돌리기 사유");
    await user.type(reason, "동시에 취소했어요");
    const reverseButton = screen.getByRole("button", { name: "기록 되돌리기" });
    await user.click(reverseButton);
    await user.click(reverseButton);

    expect(reverseStarEvent).toHaveBeenCalledOnce();
    expect(reverseButton).toBeDisabled();
    uncertain.reject(new ApiError(409, "EVENT_ALREADY_REVERSED"));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "기록을 되돌리지 못했어요. 최신 별 기록을 확인했어요."
    );
    expect(screen.queryByRole("button", { name: "기록 되돌리기" })).not.toBeInTheDocument();
    expect(getGuardianStars).toHaveBeenLastCalledWith({ direction: "all" });
    confirm.mockRestore();
  });

  it("keeps newer ledger filters when an older reversal finishes uncertainly", async () => {
    const user = userEvent.setup();
    const event = {
      id: "event-private-filter-race",
      requestedDelta: 2,
      delta: 2,
      balanceAfter: 12,
      reason: "GUARDIAN_BONUS" as const,
      studyDate: "2026-07-16",
      itemId: null,
      actorType: "guardian" as const,
      createdAt: "2026-07-16T03:00:00.000Z",
      reversesEventId: null,
      isReversed: false
    };
    const response = (reasonText: string) => ({
      summary: {
        balance: 12,
        earnedToday: 2,
        deductedToday: 0,
        lastReason: reasonText
      },
      events: [{ ...event, reasonText }],
      nextCursor: null
    });
    const getGuardianStars = vi.fn(async (query?: { reason?: string }) =>
      query?.reason === "GUARDIAN_BONUS"
        ? response("필터 결과 유지")
        : response("이전 전체 결과"));
    const uncertain = deferred<never>();
    const reverseStarEvent = vi.fn().mockReturnValue(uncertain.promise);
    const api = createGuardianApi({ getGuardianStars, reverseStarEvent });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<GuardianDashboard api={api} />);

    await user.click(screen.getByRole("button", { name: "별 기록" }));
    await user.type(await screen.findByLabelText("되돌리기 사유"), "응답을 잃었어요");
    await user.click(screen.getByRole("button", { name: "기록 되돌리기" }));
    await user.selectOptions(screen.getByLabelText("사유"), "GUARDIAN_BONUS");
    await user.click(screen.getByRole("button", { name: "필터 적용" }));
    expect(await screen.findByText("필터 결과 유지")).toBeVisible();

    uncertain.reject(new ApiError(503, "TEMPORARY_FAILURE"));

    expect(await screen.findByRole("alert")).toBeVisible();
    expect(getGuardianStars).toHaveBeenLastCalledWith({
      direction: "all",
      reason: "GUARDIAN_BONUS"
    });
    expect(screen.getByText("필터 결과 유지")).toBeVisible();
    expect(screen.queryByText("이전 전체 결과")).not.toBeInTheDocument();
    confirm.mockRestore();
  });

  it("reconciles a successful reversal against filters selected while it was in flight", async () => {
    const user = userEvent.setup();
    let reversed = false;
    const original = {
      id: "event-private-success-race",
      requestedDelta: 2,
      delta: 2,
      balanceAfter: 12,
      reason: "GUARDIAN_BONUS" as const,
      reasonText: "성공 중 필터 변경",
      studyDate: "2026-07-16",
      itemId: null,
      actorType: "guardian" as const,
      createdAt: "2026-07-16T03:00:00.000Z",
      reversesEventId: null,
      isReversed: false
    };
    const getGuardianStars = vi.fn(async () => ({
      summary: {
        balance: reversed ? 10 : 12,
        earnedToday: 2,
        deductedToday: reversed ? 2 : 0,
        lastReason: "성공 중 필터 변경"
      },
      events: [{ ...original, isReversed: reversed }],
      nextCursor: null
    }));
    const reversal = deferred<AppliedStarResult>();
    const api = createGuardianApi({
      getGuardianStars,
      reverseStarEvent: vi.fn().mockReturnValue(reversal.promise)
    });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<GuardianDashboard api={api} />);

    await user.click(screen.getByRole("button", { name: "별 기록" }));
    await user.type(await screen.findByLabelText("되돌리기 사유"), "성공 취소 기록");
    await user.click(screen.getByRole("button", { name: "기록 되돌리기" }));
    await user.selectOptions(screen.getByLabelText("사유"), "GUARDIAN_BONUS");
    await user.click(screen.getByRole("button", { name: "필터 적용" }));
    await waitFor(() => expect(getGuardianStars).toHaveBeenCalledTimes(3));

    reversed = true;
    reversal.resolve({
      event: {
        ...original,
        requestedDelta: -2,
        delta: -2,
        balanceAfter: 10,
        reason: "REVERSAL",
        reasonText: "성공 취소 기록",
        createdAt: "2026-07-16T04:00:00.000Z",
        reversesEventId: original.id
      },
      duplicate: false
    });

    await waitFor(() => expect(getGuardianStars).toHaveBeenCalledTimes(4));
    expect(getGuardianStars).toHaveBeenLastCalledWith({
      direction: "all",
      reason: "GUARDIAN_BONUS"
    });
    expect(screen.queryByText("성공 취소 기록")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "기록 되돌리기" })).not.toBeInTheDocument();
    confirm.mockRestore();
  });

  it("saves Korean and math difficulty 1–5 with perfect bonuses 0–5", async () => {
    const user = userEvent.setup();
    const plan = {
      studyDate: "2026-07-17",
      koreanTarget: 2,
      mathTarget: 2,
      isRestDay: false,
      subjectSettings: {
        korean: { difficulty: 3, challengeBonusStars: 1 },
        math: { difficulty: 3, challengeBonusStars: 1 }
      },
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

    await user.click(screen.getByRole("button", { name: "학습 계획" }));
    const date = await screen.findByLabelText("계획 날짜");
    await user.clear(date);
    await user.type(date, "2026-07-17");
    await user.click(screen.getByRole("button", { name: "계획 불러오기" }));
    await waitFor(() => expect(getGuardianDailyPlan).toHaveBeenLastCalledWith("2026-07-17"));
    expect(screen.getByLabelText("국어 목표")).toHaveValue(2);
    expect(screen.getByLabelText("수학 목표")).toHaveValue(2);
    await user.selectOptions(screen.getByLabelText("국어 난이도"), "5");
    await user.selectOptions(screen.getByLabelText("국어 만점 보너스"), "0");
    await user.selectOptions(screen.getByLabelText("수학 난이도"), "1");
    await user.selectOptions(screen.getByLabelText("수학 만점 보너스"), "5");
    await user.click(screen.getByLabelText("쉬는 날"));
    await user.click(screen.getByRole("button", { name: "학습 계획 저장" }));

    await waitFor(() => expect(updateGuardianDailyPlan).toHaveBeenCalledWith(
      "2026-07-17",
      {
        koreanTarget: 2,
        mathTarget: 2,
        isRestDay: true,
        subjectSettings: {
          korean: { difficulty: 5, challengeBonusStars: 0 },
          math: { difficulty: 1, challengeBonusStars: 5 }
        }
      }
    ));
    expect(await screen.findByText("쉬는 날 계획을 저장했어요.")).toBeVisible();
  });

  it("clears date A plan and blocks saving until date B is loaded", async () => {
    const user = userEvent.setup();
    const getGuardianDailyPlan = vi.fn(async (date: string) => ({
      studyDate: date,
      koreanTarget: date === "2026-07-17" ? 7 : 3,
      mathTarget: 2,
      isRestDay: false,
      requiredItemIds: []
    }));
    const updateGuardianDailyPlan = vi.fn();
    const api = createGuardianApi({ getGuardianDailyPlan, updateGuardianDailyPlan });
    render(<GuardianDashboard api={api} />);

    await user.click(screen.getByRole("button", { name: "학습 계획" }));
    const date = await screen.findByLabelText("계획 날짜");
    await user.clear(date);
    await user.type(date, "2026-07-17");
    await user.click(screen.getByRole("button", { name: "계획 불러오기" }));
    expect(await screen.findByLabelText("국어 목표")).toHaveValue(7);

    await user.clear(date);
    await user.type(date, "2026-07-18");

    expect(screen.queryByLabelText("국어 목표")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "학습 계획 저장" })).not.toBeInTheDocument();
    expect(updateGuardianDailyPlan).not.toHaveBeenCalled();
  });

  it("ignores a stale date A response after date B is selected and loaded", async () => {
    const user = userEvent.setup();
    const dateA = deferred<{
      studyDate: string;
      koreanTarget: number;
      mathTarget: number;
      isRestDay: boolean;
      requiredItemIds: string[];
    }>();
    const getGuardianDailyPlan = vi.fn((date: string) => date === "2026-07-17"
      ? dateA.promise
      : Promise.resolve({
          studyDate: date,
          koreanTarget: 3,
          mathTarget: 4,
          isRestDay: false,
          requiredItemIds: []
        }));
    const api = createGuardianApi({ getGuardianDailyPlan });
    render(<GuardianDashboard api={api} />);

    await user.click(screen.getByRole("button", { name: "학습 계획" }));
    const date = await screen.findByLabelText("계획 날짜");
    await user.clear(date);
    await user.type(date, "2026-07-17");
    await user.click(screen.getByRole("button", { name: "계획 불러오기" }));
    await user.clear(date);
    await user.type(date, "2026-07-18");
    await user.click(screen.getByRole("button", { name: "계획 불러오기" }));
    expect(await screen.findByLabelText("국어 목표")).toHaveValue(3);

    dateA.resolve({
      studyDate: "2026-07-17",
      koreanTarget: 7,
      mathTarget: 8,
      isRestDay: false,
      requiredItemIds: []
    });

    await waitFor(() => expect(screen.getByLabelText("국어 목표")).toHaveValue(3));
    expect(screen.getByLabelText("수학 목표")).toHaveValue(4);
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
      getGuardianDailyPlan: vi.fn().mockImplementation(
        (studyDate: string) => Promise.resolve({ ...plan, studyDate })
      ),
      updateGuardianDailyPlan: vi.fn().mockRejectedValue(
        new ApiError(409, "PLAN_LOCKED")
      )
    });
    render(<GuardianDashboard api={api} />);

    await user.click(screen.getByRole("button", { name: "학습 계획" }));
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
    await user.click(screen.getByRole("button", { name: "백업" }));

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
    expect(components).toMatch(
      /\.account-menu button,\s*\.device-management button\s*\{[^}]*min-height:\s*48px/s
    );
    expect(components).toMatch(
      /\.guardian-tabs button\s*\{[^}]*min-width:\s*0[^}]*white-space:\s*normal/s
    );
    expect(layout).toContain(".guardian-shell");
    expect(layout).toContain(".guardian-tabs");
    expect(responsive).toMatch(/@media\s*\(max-width:\s*700px\)[\s\S]*\.guardian-shell/);
  });
});
