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
import { createProductionApi } from "../../src/client/api/production";
import type { ActivityEvent, TodayPlan } from "../../src/shared/learning";
import { TodayStars } from "../../src/client/delight/today-stars";
import { StudentHome, stepStatus } from "../../src/client/home/student-home";
import {
  OFFLINE_DB_NAME,
  cacheIssuedPlan,
  clearOfflineAuthority,
  getDeviceState,
  getQueueCounts,
  handleDeviceActionRequired,
  listActivities,
  listQueuedAttempts,
  loadCachedTodayPlan,
  markStudentAuthenticated,
  queueAttempt,
  removeQueuedAttempt,
  setRecoveryBlocked,
  storeOfflineLease,
  storeConfirmedStars
} from "../../src/client/offline/db";
import { syncPending } from "../../src/client/offline/sync";
import { createFakeApi } from "../helpers/client";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

afterEach(cleanup);
beforeEach(async () => {
  vi.useRealTimers();
  await deleteDB(OFFLINE_DB_NAME);
});

describe("가족 로그인과 학생 홈", () => {
  it("keeps math and dictation drafts mounted across student navigation while explicit exit resets them", async () => {
    const user = userEvent.setup();
    const seeded = createFakeApi();
    const original = await seeded.getToday();
    const mathItem: TodayPlan["items"][number] = {
      id: "math-draft",
      version: 1,
      step: "foundation",
      payload: {
        id: "math-draft",
        kind: "math-story",
        subject: "math",
        unit: "받아올림과 받아내림",
        title: "답을 간직해요",
        level: "1단계",
        readLabel: "읽기",
        text: "2와 3을 더해요.",
        hint: "차근차근 더해 봐요.",
        tokens: ["2", "3"],
        question: "답은 얼마일까요?",
        answer: 5,
        unitLabel: "",
        checkHint: "2와 3을 더해 봐요.",
        calculation: {
          operands: [2, 3],
          operators: ["+"],
          layout: "horizontal"
        }
      }
    };
    const dictationItem: TodayPlan["items"][number] = {
      id: "dictation-draft",
      version: 1,
      step: "foundation",
      payload: {
        id: "dictation-draft",
        kind: "korean-dictation",
        subject: "korean",
        unit: "받아쓰기",
        title: "봄비를 간직해요",
        level: "1단계",
        readLabel: "다시 듣기",
        text: "들은 내용을 써 보세요.",
        hint: "천천히 다시 들어 봐요.",
        tokens: ["봄비"],
        promptText: "봄비",
        answerText: "봄비",
        mode: "word"
      }
    };
    const plan: TodayPlan = {
      ...original,
      items: [mathItem, dictationItem],
      requiredItemIds: [mathItem.id, dictationItem.id],
      completedItemIds: []
    };
    const api = createFakeApi({ getToday: vi.fn().mockResolvedValue(plan) });
    await markStudentAuthenticated();

    render(<StudentHome api={api} />);

    await user.click(await screen.findByRole("button", {
      name: /답을 간직해요 시작하기/
    }));
    await screen.findByRole("heading", { name: "답을 간직해요" });
    await user.click(screen.getByRole("button", { name: "5" }));
    expect(screen.getByLabelText("입력한 답")).toHaveTextContent("5");

    await user.click(screen.getByRole("button", { name: "메뉴 열기" }));
    await user.click(within(screen.getByRole("dialog", { name: "학생 메뉴" }))
      .getByRole("button", { name: "오늘 학습" }));
    expect(screen.getByRole("button", { name: "보호자 모드" })).toBeVisible();
    expect(screen.getByRole("button", { name: "보호자 모드" })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: /답을 간직해요 시작하기/ }));
    expect(screen.getByLabelText("입력한 답")).toHaveTextContent("5");

    await user.click(screen.getByRole("button", { name: "대시보드로 돌아가기" }));
    await user.click(screen.getByRole("button", { name: /답을 간직해요 시작하기/ }));
    expect(screen.getByLabelText("입력한 답")).not.toHaveTextContent("5");
    await user.click(screen.getByRole("button", { name: "대시보드로 돌아가기" }));

    await user.click(screen.getByRole("button", { name: /봄비를 간직해요 시작하기/ }));
    const dictation = await screen.findByLabelText("받아쓰기 답");
    await user.type(dictation, "봄 비");
    await user.click(screen.getByRole("button", { name: "뒤로" }));
    await user.click(screen.getByRole("button", { name: /봄비를 간직해요 시작하기/ }));
    expect(screen.getByLabelText("받아쓰기 답")).toHaveValue("봄 비");
    await expect(listQueuedAttempts()).resolves.toHaveLength(0);
  });

  it("groups six daily steps and unlocks only from canonical completed item receipts", async () => {
    const seeded = createFakeApi();
    const original = await seeded.getToday();
    const makeItem = (
      id: string,
      subject: "korean" | "math",
      step: "foundation" | "current" | "challenge"
    ): TodayPlan["items"][number] => ({
      id,
      version: 4,
      step,
      payload: {
        id,
        kind: "korean-reading",
        subject,
        unit: subject === "korean" ? "낱말" : "계산",
        title: `${subject === "korean" ? "국어" : "수학"} ${step}`,
        level: "1단계",
        readLabel: "읽기",
        text: "학습 내용",
        hint: "천천히 해 봐요.",
        tokens: ["학습"]
      }
    });
    const items = (["korean", "math"] as const).flatMap((subject) =>
      (["foundation", "current", "challenge"] as const).map((step) =>
        makeItem(`${subject}-${step}`, subject, step)
      )
    );
    const plan: TodayPlan = {
      ...original,
      items,
      requiredItemIds: items.map((item) => item.id),
      completedItemIds: []
    };
    const api = createFakeApi({ getToday: vi.fn().mockResolvedValue(plan) });
    await markStudentAuthenticated();
    render(<App api={api} />);

    const korean = await screen.findByRole("group", { name: "국어 스텝업" });
    const math = screen.getByRole("group", { name: "수학 스텝업" });
    expect(within(korean).getByRole("button", { name: /기초 다지기.*시작하기/ })).toBeEnabled();
    expect(within(korean).getByRole("button", { name: /현재 수준.*시작하기/ })).toBeDisabled();
    expect(within(korean).getByRole("button", { name: /도전.*시작하기/ })).toBeDisabled();
    expect(within(math).getByRole("button", { name: /기초 다지기.*시작하기/ })).toBeEnabled();
    expect(within(math).getByRole("button", { name: /현재 수준.*시작하기/ })).toBeDisabled();

    expect(stepStatus(items, ["korean-foundation"], items[1]!)).toBe("available");
    expect(stepStatus(items, ["korean-foundation"], items[2]!)).toBe("locked");
    expect(stepStatus(items, ["korean-foundation", "korean-current"], items[2]!)).toBe("available");
    expect(stepStatus(items, ["korean-foundation", "korean-current", "korean-challenge"], items[2]!)).toBe("complete");
  });
  it("keeps the shared component fake honest about guardian-only device registration", async () => {
    const api = createFakeApi();

    await expect(api.registerDevice("인증 없이 등록 시도"))
      .rejects.toEqual(new ApiError(401, "AUTH_REQUIRED"));
    await api.guardianLogin("correct horse battery staple");
    await expect(api.registerDevice("보호자 인증 후 등록"))
      .resolves.toMatchObject({
        name: "수아 갤럭시 탭",
        status: "active",
        current: true
      });
  });

  it("requires a student PIN when the server still has a student session but local authority is new or missing", async () => {
    const api = createFakeApi({
      me: vi.fn().mockResolvedValue({
        id: "student-1",
        role: "student",
        displayName: "수아"
      })
    });

    render(<App api={api} />);

    expect(await screen.findByRole("heading", {
      name: "수아 PIN으로 들어가기"
    })).toBeVisible();
    await expect(getDeviceState()).resolves.toBe("auth-required");
    expect(api.getToday).not.toHaveBeenCalled();
  });

  it("does not let a lost-logout server student session restore local auth-required authority", async () => {
    await markStudentAuthenticated();
    await clearOfflineAuthority("auth-required");
    const api = createFakeApi({
      me: vi.fn().mockResolvedValue({
        id: "student-1",
        role: "student",
        displayName: "수아"
      })
    });

    render(<App api={api} />);

    expect(await screen.findByRole("heading", {
      name: "수아 PIN으로 들어가기"
    })).toBeVisible();
    await expect(getDeviceState()).resolves.toBe("auth-required");
    expect(api.studentLogin).not.toHaveBeenCalled();
  });

  it("keeps a server student session behind registration when local device action is required", async () => {
    await markStudentAuthenticated();
    await handleDeviceActionRequired("DEVICE_REVOKED");
    const api = createFakeApi({
      me: vi.fn().mockResolvedValue({
        id: "student-1",
        role: "student",
        displayName: "수아"
      })
    });

    render(<App api={api} />);

    expect(await screen.findByRole("heading", { name: "보호자 확인" }))
      .toBeVisible();
    await expect(getDeviceState()).resolves.toBe("device-action-required");
    expect(api.studentLogin).not.toHaveBeenCalled();
    expect(api.registerDevice).not.toHaveBeenCalled();
  });

  it("cold-starts only from a ready unexpired same-KST-day student lease after a network TypeError", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-07-16T02:00:00.000Z"));
    const seeded = createFakeApi();
    const cachedPlan = await seeded.getToday();
    await markStudentAuthenticated();
    await cacheIssuedPlan(cachedPlan, cachedPlan.stars);
    await storeOfflineLease({
      offlineAccessUntil: "2026-07-16T14:59:59.999Z",
      user: { id: "student-1", role: "student", displayName: "수아" }
    });
    const api = createFakeApi({
      me: vi.fn().mockRejectedValue(new TypeError("offline")),
      getToday: vi.fn().mockRejectedValue(new TypeError("offline")),
      getStudentStars: vi.fn().mockRejectedValue(new TypeError("offline")),
      createLearningSession: vi.fn().mockRejectedValue(new TypeError("offline"))
    });

    render(<App api={api} />);

    expect(await screen.findByText("오프라인 학습 중")).toBeVisible();
    expect(screen.getByRole("heading", { name: "오늘의 학습" })).toBeVisible();
    expect(screen.getByText("모은 별 7개")).toBeVisible();
    for (const label of ["뒤로", "오늘 학습", "도움말", "잠깐 쉬기"]) {
      expect(screen.getByRole("button", { name: label })).toBeVisible();
    }
    expect(api.studentLogin).not.toHaveBeenCalled();
  });

  it("never treats an explicit 401 as offline even when a valid cache and lease exist", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-07-16T02:00:00.000Z"));
    const seeded = createFakeApi();
    const cachedPlan = await seeded.getToday();
    await markStudentAuthenticated();
    await cacheIssuedPlan(cachedPlan, cachedPlan.stars);
    await storeOfflineLease({
      offlineAccessUntil: "2026-07-16T14:59:59.999Z",
      user: { id: "student-1", role: "student", displayName: "수아" }
    });
    const api = createFakeApi({
      me: vi.fn().mockRejectedValue(new ApiError(401, "AUTH_REQUIRED"))
    });

    render(<App api={api} />);

    expect(await screen.findByRole("heading", {
      name: "수아 PIN으로 들어가기"
    })).toBeVisible();
    expect(screen.queryByText("오프라인 학습 중")).not.toBeInTheDocument();
    await expect(getDeviceState()).resolves.toBe("auth-required");
    await expect(loadCachedTodayPlan(cachedPlan.date)).resolves.toBeUndefined();
  });

  it.each([
    ["expired lease", "2026-07-15T14:59:59.999Z", "2026-07-16"],
    ["wrong-day plan", "2026-07-16T14:59:59.999Z", "2026-07-15"]
  ])("rejects offline cold start for %s", async (_label, offlineAccessUntil, date) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-07-16T02:00:00.000Z"));
    const seeded = createFakeApi();
    const cachedPlan = { ...(await seeded.getToday()), date };
    await markStudentAuthenticated();
    await cacheIssuedPlan(cachedPlan, cachedPlan.stars);
    await storeOfflineLease({
      offlineAccessUntil,
      user: { id: "student-1", role: "student", displayName: "수아" }
    });
    const api = createFakeApi({
      me: vi.fn().mockRejectedValue(new TypeError("offline"))
    });

    render(<App api={api} />);

    expect(await screen.findByText("잠시 후 다시 시도해 주세요.")).toBeVisible();
    expect(screen.queryByText("오프라인 학습 중")).not.toBeInTheDocument();
  });

  it("moves a revoked startup to device action and preserves the blocked journal", async () => {
    const seeded = createFakeApi();
    const cachedPlan = await seeded.getToday();
    await markStudentAuthenticated();
    await cacheIssuedPlan(cachedPlan, cachedPlan.stars);
    await queueAttempt({
      clientAttemptId: "revoked-startup-attempt-0001",
      planId: cachedPlan.planId,
      itemId: cachedPlan.items[0]!.id,
      contentVersion: cachedPlan.items[0]!.version,
      studyDate: cachedPlan.date,
      occurredAt: "2026-07-16T01:00:00.000Z",
      readingScore: 100,
      missedTokens: [],
      mathAnswer: null,
      durationMs: 20_000,
      difficultyFeedback: null
    });
    const api = createFakeApi({
      me: vi.fn().mockRejectedValue(new ApiError(403, "DEVICE_REVOKED"))
    });

    render(<App api={api} />);

    expect(await screen.findByRole("heading", { name: "보호자 확인" }))
      .toBeVisible();
    await expect(getDeviceState()).resolves.toBe("device-action-required");
    await expect(listQueuedAttempts()).rejects.toMatchObject({
      code: "DEVICE_ACTION_REQUIRED"
    });
    expect(api.registerDevice).not.toHaveBeenCalled();
  });

  it("requires guardian authentication before recovery registration and returns to a fresh student PIN without losing the journal", async () => {
    const user = userEvent.setup();
    const seeded = createFakeApi();
    const cachedPlan = await seeded.getToday();
    await markStudentAuthenticated();
    await cacheIssuedPlan(cachedPlan, cachedPlan.stars);
    await queueAttempt({
      clientAttemptId: "guardian-recovery-attempt-0001",
      planId: cachedPlan.planId,
      itemId: cachedPlan.items[0]!.id,
      contentVersion: cachedPlan.items[0]!.version,
      studyDate: cachedPlan.date,
      occurredAt: "2026-07-16T01:00:00.000Z",
      readingScore: 100,
      missedTokens: [],
      mathAnswer: null,
      durationMs: 20_000,
      difficultyFeedback: null
    });
    const endSession = vi.fn().mockResolvedValue(undefined);
    const api = createFakeApi({
      endSession,
      me: vi.fn().mockRejectedValue(new ApiError(403, "DEVICE_REVOKED"))
    });

    render(<App api={api} />);

    expect(await screen.findByRole("heading", { name: "보호자 확인" }))
      .toBeVisible();
    expect(screen.queryByLabelText("기기 이름")).not.toBeInTheDocument();
    expect(api.registerDevice).not.toHaveBeenCalled();

    await user.type(
      screen.getByLabelText("보호자 비밀번호"),
      "correct horse battery staple"
    );
    await user.click(screen.getByRole("button", { name: "확인하고 기기 복구하기" }));
    expect(api.guardianLogin).toHaveBeenCalledWith(
      "correct horse battery staple"
    );

    expect(await screen.findByRole("heading", { name: "이 기기 다시 등록하기" }))
      .toBeVisible();
    await user.clear(screen.getByLabelText("기기 이름"));
    await user.type(screen.getByLabelText("기기 이름"), "수아 갤럭시 탭 복구");
    await user.click(screen.getByRole("button", { name: "현재 기기 다시 등록" }));

    expect(api.registerDevice).toHaveBeenCalledWith("수아 갤럭시 탭 복구", "mac");
    expect(endSession).toHaveBeenCalledOnce();
    expect(await screen.findByRole("heading", {
      name: "수아 PIN으로 들어가기"
    })).toBeVisible();
    await expect(getDeviceState()).resolves.toBe("auth-required");
    await markStudentAuthenticated();
    const preserved = await listQueuedAttempts();
    expect(preserved).toHaveLength(1);
    expect(preserved[0]).toMatchObject({
      clientAttemptId: "guardian-recovery-attempt-0001"
    });
  });

  it("fails closed to a fresh student PIN when the guardian-session end response is lost after recovery registration", async () => {
    const user = userEvent.setup();
    const api = createFakeApi({
      me: vi.fn().mockRejectedValue(new ApiError(403, "DEVICE_NOT_TRUSTED")),
      endSession: vi.fn().mockRejectedValue(new TypeError("response lost"))
    });

    render(<App api={api} />);
    await screen.findByRole("heading", { name: "보호자 확인" });
    await user.type(
      screen.getByLabelText("보호자 비밀번호"),
      "correct horse battery staple"
    );
    await user.click(screen.getByRole("button", {
      name: "확인하고 기기 복구하기"
    }));
    await screen.findByRole("heading", { name: "이 기기 다시 등록하기" });
    await user.click(screen.getByRole("button", {
      name: "현재 기기 다시 등록"
    }));

    expect(await screen.findByRole("heading", {
      name: "수아 PIN으로 들어가기"
    })).toBeVisible();
    await expect(getDeviceState()).resolves.toBe("auth-required");
    expect(api.setStudentPin).not.toHaveBeenCalled();
  });

  it("keeps the authenticated recovery registration step retryable after a transient register failure", async () => {
    const user = userEvent.setup();
    const registerDevice = vi.fn()
      .mockRejectedValueOnce(new ApiError(503, "HTTP_503"))
      .mockResolvedValueOnce({
        publicId: "replacement-device-public",
        name: "수아 갤럭시 탭",
        createdAt: "2026-07-16T03:00:00.000Z",
        lastUsedAt: null,
        status: "active",
        current: true
      });
    const api = createFakeApi({
      me: vi.fn().mockRejectedValue(new ApiError(403, "DEVICE_REVOKED")),
      registerDevice
    });

    render(<App api={api} />);
    await screen.findByRole("heading", { name: "보호자 확인" });
    await user.type(
      screen.getByLabelText("보호자 비밀번호"),
      "correct horse battery staple"
    );
    await user.click(screen.getByRole("button", {
      name: "확인하고 기기 복구하기"
    }));
    await screen.findByRole("heading", { name: "이 기기 다시 등록하기" });

    await user.click(screen.getByRole("button", {
      name: "현재 기기 다시 등록"
    }));
    expect(await screen.findByRole("alert")).toHaveTextContent("HTTP_503");
    expect(screen.getByRole("heading", {
      name: "이 기기 다시 등록하기"
    })).toBeVisible();

    await user.click(screen.getByRole("button", {
      name: "현재 기기 다시 등록"
    }));
    expect(await screen.findByRole("heading", {
      name: "수아 PIN으로 들어가기"
    })).toBeVisible();
    expect(api.guardianLogin).toHaveBeenCalledOnce();
    expect(registerDevice).toHaveBeenCalledTimes(2);
    expect(api.endSession).toHaveBeenCalledOnce();
    expect(api.setStudentPin).not.toHaveBeenCalled();
  });

  it("keeps production recovery retryable across a bad guardian password and an expired guardian registration session", async () => {
    const user = userEvent.setup();
    await markStudentAuthenticated();
    let guardianLoginCalls = 0;
    let registerCalls = 0;
    const json = (body: unknown, status = 200) => new Response(
      JSON.stringify(body),
      { status, headers: { "content-type": "application/json" } }
    );
    const fetcher = vi.fn().mockImplementation(async (
      input: RequestInfo | URL,
      init?: RequestInit
    ) => {
      const path = String(input);
      if (path === "/api/auth/me") {
        return json({ code: "DEVICE_REVOKED" }, 403);
      }
      if (path === "/api/auth/guardian/login") {
        guardianLoginCalls += 1;
        return guardianLoginCalls === 1
          ? json({ code: "AUTH_INVALID" }, 401)
          : new Response(null, { status: 204 });
      }
      if (path === "/api/guardian/devices/current") {
        registerCalls += 1;
        return registerCalls === 1
          ? json({ code: "AUTH_REQUIRED" }, 401)
          : json({
              publicId: "replacement-device-public",
              name: "수아 갤럭시 탭",
              createdAt: "2026-07-16T03:00:00.000Z",
              lastUsedAt: null,
              status: "active",
              current: true
            }, 201);
      }
      if (path === "/api/auth/session/end") {
        return new Response(null, { status: 204 });
      }
      throw new Error(`Unexpected request: ${init?.method} ${path}`);
    });
    const api = createProductionApi(fetcher);

    render(<App api={api} />);
    await screen.findByRole("heading", { name: "보호자 확인" });
    await user.type(screen.getByLabelText("보호자 비밀번호"), "wrong password");
    await user.click(screen.getByRole("button", {
      name: "확인하고 기기 복구하기"
    }));

    expect(await screen.findByRole("alert")).toHaveTextContent("AUTH_INVALID");
    expect(screen.getByRole("heading", { name: "보호자 확인" }))
      .toBeVisible();
    await expect(getDeviceState()).resolves.toBe("device-action-required");

    await user.click(screen.getByRole("button", {
      name: "확인하고 기기 복구하기"
    }));
    await screen.findByRole("heading", { name: "이 기기 다시 등록하기" });
    await user.click(screen.getByRole("button", {
      name: "현재 기기 다시 등록"
    }));

    expect(await screen.findByRole("heading", { name: "보호자 확인" }))
      .toBeVisible();
    await expect(getDeviceState()).resolves.toBe("device-action-required");
    await user.type(
      screen.getByLabelText("보호자 비밀번호"),
      "correct horse battery staple"
    );
    await user.click(screen.getByRole("button", {
      name: "확인하고 기기 복구하기"
    }));
    await screen.findByRole("heading", { name: "이 기기 다시 등록하기" });
    await user.click(screen.getByRole("button", {
      name: "현재 기기 다시 등록"
    }));

    expect(await screen.findByRole("heading", {
      name: "수아 PIN으로 들어가기"
    })).toBeVisible();
    expect(guardianLoginCalls).toBe(3);
    expect(registerCalls).toBe(2);
  });

  it("shows setup only for SETUP_REQUIRED", async () => {
    const api = createFakeApi({
      me: vi.fn().mockRejectedValue(new ApiError(409, "SETUP_REQUIRED"))
    });

    render(<App api={api} />);

    expect(await screen.findByRole("heading", {
      name: "수아의 공부방 시작하기"
    })).toBeVisible();
  });

  it("does not open setup for an unrelated 409 code", async () => {
    const api = createFakeApi({
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
    const api = createFakeApi({
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
    expect(api.registerDevice).toHaveBeenCalledWith("수아 갤럭시 탭", "mac");
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
    const api = createFakeApi({
      me: vi.fn().mockResolvedValue({
        id: "guardian-1",
        role: "guardian",
        displayName: "보호자"
      })
    });

    render(<App api={api} />);

    expect(await screen.findByRole("heading", { name: "보호자 공간" })).toBeVisible();
    expect(screen.getByRole("button", { name: "진도" })).toHaveAttribute("aria-current", "page");
    expect(await screen.findByText("별 잔액 12개")).toBeVisible();
    expect(api.getGuardianProgress).toHaveBeenCalledOnce();
    expect(api.getGuardianStars).toHaveBeenCalledOnce();
  });

  it("returns an existing guardian to the protected guardian space", async () => {
    const user = userEvent.setup();
    const api = createFakeApi({
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
    const studentLogin = vi.fn().mockResolvedValue({
      offlineAccessUntil: "2026-07-16T14:59:59.999Z"
    });
    const api = createFakeApi({
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

  it("retries a source-device recovery block only after a successful fresh student PIN login", async () => {
    const user = userEvent.setup();
    const seeded = createFakeApi();
    const currentPlan = await seeded.getToday();
    await markStudentAuthenticated();
    await cacheIssuedPlan(currentPlan, currentPlan.stars);
    await queueAttempt({
      clientAttemptId: "attempt-login-recovery-0001",
      planId: currentPlan.planId,
      itemId: currentPlan.items[0]!.id,
      contentVersion: currentPlan.items[0]!.version,
      studyDate: currentPlan.date,
      occurredAt: "2026-07-16T01:00:00.000Z",
      readingScore: 100,
      missedTokens: [],
      mathAnswer: null,
      durationMs: 20_000,
      difficultyFeedback: null
    });
    await handleDeviceActionRequired("DEVICE_NOT_TRUSTED");
    await markStudentAuthenticated();
    await setRecoveryBlocked(currentPlan.planId);
    await clearOfflineAuthority("auth-required");

    const recoveryPlan = {
      ...currentPlan,
      planId: "plan-recovery-after-login",
      planKind: "recovery" as const,
      recoverySourcePlanId: currentPlan.planId,
      offlineEpoch: currentPlan.offlineEpoch + 1,
      activityCursor: 20
    };
    const createRecoveryPlan = vi.fn().mockResolvedValue(recoveryPlan);
    const api = createFakeApi({
      me: vi.fn()
        .mockRejectedValueOnce(new ApiError(401, "AUTH_REQUIRED"))
        .mockResolvedValueOnce({
          id: "student-1",
          role: "student",
          displayName: "수아"
        }),
      getToday: vi.fn().mockResolvedValue(currentPlan),
      createRecoveryPlan,
      applyOfflineBatch: vi.fn().mockRejectedValue(new TypeError("offline"))
    });
    render(<App api={api} />);

    await screen.findByRole("heading", { name: "수아 PIN으로 들어가기" });
    await user.type(screen.getByLabelText("수아의 4자리 PIN"), "2580");
    await user.click(screen.getByRole("button", { name: "공부 시작하기" }));

    await waitFor(() => expect(createRecoveryPlan).toHaveBeenCalledWith({
      sourcePlanId: currentPlan.planId
    }));
    await expect(listActivities()).resolves.toEqual([
      expect.objectContaining({
        planId: recoveryPlan.planId,
        sourcePlanId: currentPlan.planId,
        requiresRecovery: false,
        recoveryBlockedCode: null
      })
    ]);
  });

  it("shows the guardian device-management guidance when recovery remains source-device blocked", async () => {
    const user = userEvent.setup();
    const seeded = createFakeApi();
    const currentPlan = await seeded.getToday();
    await markStudentAuthenticated();
    await cacheIssuedPlan(currentPlan, currentPlan.stars);
    await queueAttempt({
      clientAttemptId: "attempt-login-recovery-blocked-0001",
      planId: currentPlan.planId,
      itemId: currentPlan.items[0]!.id,
      contentVersion: currentPlan.items[0]!.version,
      studyDate: currentPlan.date,
      occurredAt: "2026-07-16T01:00:00.000Z",
      readingScore: 100,
      missedTokens: [],
      mathAnswer: null,
      durationMs: 20_000,
      difficultyFeedback: null
    });
    await handleDeviceActionRequired("DEVICE_NOT_TRUSTED");
    await clearOfflineAuthority("auth-required");

    const api = createFakeApi({
      me: vi.fn()
        .mockRejectedValueOnce(new ApiError(401, "AUTH_REQUIRED"))
        .mockResolvedValueOnce({
          id: "student-1",
          role: "student",
          displayName: "수아"
        }),
      getToday: vi.fn().mockResolvedValue(currentPlan),
      createRecoveryPlan: vi.fn().mockRejectedValue(
        new ApiError(409, "SOURCE_DEVICE_STILL_ACTIVE")
      )
    });
    render(<App api={api} />);

    await screen.findByRole("heading", { name: "수아 PIN으로 들어가기" });
    await user.type(screen.getByLabelText("수아의 4자리 PIN"), "2580");
    await user.click(screen.getByRole("button", { name: "공부 시작하기" }));

    expect(await screen.findByText(
      "보호자 기기 관리에서 이전 기기를 해제해 주세요"
    )).toBeVisible();
  });

  it("ends the student session before requiring a fresh guardian password", async () => {
    const user = userEvent.setup();
    const endSession = vi.fn().mockResolvedValue(undefined);
    const guardianLogin = vi.fn().mockResolvedValue(undefined);
    const api = createFakeApi({
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
    await markStudentAuthenticated();
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
    const api = createFakeApi({ endSession });
    await markStudentAuthenticated();
    render(<App api={api} />);

    await screen.findByText("수아야, 오늘도 한 걸음!");
    await user.click(screen.getByRole("button", { name: "로그아웃" }));

    expect(endSession).toHaveBeenCalledOnce();
    expect(await screen.findByRole("heading", {
      name: "수아 PIN으로 들어가기"
    })).toBeVisible();
  });

  it("clears and blocks offline authority on logout even when the session-end request loses the network", async () => {
    const user = userEvent.setup();
    const api = createFakeApi({
      endSession: vi.fn().mockRejectedValue(new TypeError("offline"))
    });
    const issuedPlan = await api.getToday();
    api.getToday.mockClear();
    await markStudentAuthenticated();
    await cacheIssuedPlan(issuedPlan, issuedPlan.stars);
    await storeOfflineLease({
      offlineAccessUntil: "2026-07-17T14:59:59.999Z",
      user: { id: "student-1", role: "student", displayName: "수아" }
    });
    await queueAttempt({
      clientAttemptId: "logout-network-attempt-0001",
      planId: issuedPlan.planId,
      itemId: issuedPlan.items[0]!.id,
      contentVersion: issuedPlan.items[0]!.version,
      studyDate: issuedPlan.date,
      occurredAt: "2026-07-16T01:00:00.000Z",
      readingScore: 100,
      missedTokens: [],
      mathAnswer: null,
      durationMs: 10_000,
      difficultyFeedback: null
    });
    render(<App api={api} />);
    await screen.findByText("수아야, 오늘도 한 걸음!");

    await user.click(screen.getByRole("button", { name: "로그아웃" }));

    expect(await screen.findByRole("heading", {
      name: "수아 PIN으로 들어가기"
    })).toBeVisible();
    await expect(getDeviceState()).resolves.toBe("auth-required");
    await expect(listQueuedAttempts()).rejects.toMatchObject({
      code: "AUTH_REQUIRED"
    });
    await markStudentAuthenticated();
    await expect(listQueuedAttempts()).resolves.toHaveLength(1);
  });

  it("shows the magical friend room with one star aside in reading order", async () => {
    const api = createFakeApi();
    await markStudentAuthenticated();
    render(<App api={api} />);

    expect(await screen.findByRole("heading", { name: "오늘의 학습" })).toBeVisible();
    expect(screen.getByText("수아야, 오늘도 한 걸음!")).toBeVisible();
    const friendRoom = screen.getByRole("complementary", {
      name: "마법 친구 쉼터"
    });
    expect(friendRoom).toBeVisible();
    const friendCast = within(friendRoom).getByRole("list");
    expect(within(friendCast).getByText("별토끼 버니")).toBeVisible();
    expect(within(friendCast).getByText("수달 또또")).toBeVisible();
    expect(within(friendCast).getByText("너구리 모모")).toBeVisible();
    expect(within(friendCast).getByText("아기용 밀키")).toBeVisible();
    expect(screen.getAllByRole("status", { name: "마법 친구 말풍선" }))
      .toHaveLength(1);
    expect(screen.getByText("모은 별 7개")).toBeVisible();
    expect(screen.getAllByTestId("required-star")).toHaveLength(4);
    const required = screen.getByRole("region", { name: "필수 학습" });
    const starAside = screen.getByRole("complementary", { name: "별 현황" });
    const optional = screen.getByRole("region", { name: "선택 학습" });
    expect(screen.getAllByRole("complementary", { name: "별 현황" }))
      .toHaveLength(1);
    expect(required.compareDocumentPosition(starAside) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBeTruthy();
    expect(starAside.compareDocumentPosition(optional) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBeTruthy();
    expect(within(optional).getByText("구름 산책")).toBeVisible();
    expect(within(optional).queryByText(/\uBCC4 1\uAC1C/)).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/\bPASS\b|\bFAIL\b/);
    expect(document.body).not.toHaveTextContent(/마이\s*리틀\s*포니|티니핑|시나모롤/i);
    expect(api.getToday).toHaveBeenCalledWith();
  });

  it("shows delighted and legacy cards with their production companion cues", async () => {
    await markStudentAuthenticated();
    render(<App api={createFakeApi()} />);

    const delightedKoreanCard = (await screen.findByRole("heading", {
      name: "바람과 꽃"
    })).closest("article");
    expect(delightedKoreanCard).not.toBeNull();
    expect(within(delightedKoreanCard!).getByText("오늘의 우당탕 사건"))
      .toBeVisible();
    expect(within(delightedKoreanCard!).getByText("또또의 수첩이 수영부터 배우겠대요."))
      .toBeVisible();
    expect(within(delightedKoreanCard!).getByText("수달 또또")).toBeVisible();
    expect(within(delightedKoreanCard!).getByText("★ 완료하면 별 1개"))
      .toBeVisible();
    expect(within(delightedKoreanCard!).getByRole("button", {
      name: "바람과 꽃 시작하기"
    })).toBeVisible();

    const delightedMathCard = screen.getByRole("heading", {
      name: "별을 세어요"
    }).closest("article");
    expect(delightedMathCard).not.toBeNull();
    expect(within(delightedMathCard!).getByText("모모가 주판 알 대신 포도알을 올렸어요."))
      .toBeVisible();
    expect(within(delightedMathCard!).getByText("너구리 모모")).toBeVisible();

    const legacyCard = screen.getByRole("heading", {
      name: "작은 씨앗"
    }).closest("article");
    expect(legacyCard).not.toBeNull();
    expect(within(legacyCard!).getByText("수달 또또")).toBeVisible();
    expect(within(legacyCard!).queryByText("오늘의 우당탕 사건"))
      .not.toBeInTheDocument();
  });

  it("makes Bongbong current after all required learning without another star promise", async () => {
    const api = createFakeApi();
    const plan = await api.getToday();
    api.getToday.mockResolvedValue({
      ...plan,
      completedItemIds: [...plan.requiredItemIds]
    });
    await markStudentAuthenticated();
    render(<App api={api} />);

    await screen.findByRole("heading", { name: "오늘의 학습" });
    const currentFriend = screen.getByRole("listitem", { current: true });
    expect(within(currentFriend).getByText("아기용 밀키")).toBeVisible();
    expect(screen.getByText("마법 걸음 4/4")).toBeVisible();
    expect(screen.getAllByText("함께 해결했어요")).toHaveLength(4);
    expect(screen.getAllByText("★ 받은 별 1개")).toHaveLength(4);
    expect(screen.queryByText("★ 완료하면 별 1개")).not.toBeInTheDocument();
  });

  it("keeps Lumi current and an honest zero trail on a required-free rest day", async () => {
    const api = createFakeApi();
    const plan = await api.getToday();
    api.getToday.mockResolvedValue({
      ...plan,
      requiredItemIds: [],
      completedItemIds: []
    });
    await markStudentAuthenticated();
    render(<App api={api} />);

    expect(await screen.findByRole("heading", { name: "오늘의 학습" }))
      .toBeVisible();
    const currentFriend = screen.getByRole("listitem", { current: true });
    expect(within(currentFriend).getByText("별토끼 버니")).toBeVisible();
    expect(within(currentFriend).queryByText("아기용 밀키"))
      .not.toBeInTheDocument();
    expect(screen.getByText("오늘은 쉬는 날이에요")).toBeVisible();
    expect(screen.getByText("마법 걸음 0/0")).toBeVisible();
  });

  it.each([
    [409, "PLAN_NOT_ISSUED", "수아 PIN으로 들어가기"],
    [403, "DEVICE_NOT_TRUSTED", "보호자 확인"]
  ])(
    "moves the live learning UI immediately after a direct %s %s authority failure",
    async (status, code, expectedHeading) => {
      const fixtures = createFakeApi();
      const plan = await fixtures.getToday();
      const stars = await fixtures.getStudentStars();
      await markStudentAuthenticated();
      const fetcher = vi.fn().mockImplementation(
        async (input: RequestInfo | URL) => {
          const path = String(input);
          const response = (body: unknown, responseStatus = 200) =>
            new Response(JSON.stringify(body), {
              status: responseStatus,
              headers: { "content-type": "application/json" }
            });
          if (path === "/api/auth/me") {
            return response({
              id: "student-1",
              role: "student",
              displayName: "수아"
            });
          }
          if (path === "/api/student/today") return response(plan);
          if (path === "/api/student/stars") return response(stars);
          if (path === "/api/student/learning-sessions") {
            return response({
              learningSessionId: "live-authority-session-0001",
              activeUntil: "2026-07-16T07:00:00.000Z",
              submitUntil: "2026-07-17T14:59:59.999Z"
            }, 201);
          }
          if (path === "/api/student/attempts") {
            return response({ code }, status);
          }
          throw new Error(`Unexpected request: ${path}`);
        }
      );
      const api = createProductionApi(fetcher);
      const user = userEvent.setup();
      render(<App api={api} />);

      await user.click(await screen.findByRole("button", {
        name: "바람과 꽃 시작하기"
      }));
      await user.click(screen.getByText("직접 입력으로 확인하기"));
      await user.type(
        screen.getByLabelText("읽은 내용 직접 입력"),
        "바람과 꽃"
      );
      await user.click(screen.getByRole("button", { name: "읽기 판정하기" }));

      expect(await screen.findByRole("heading", {
        name: expectedHeading
      })).toBeVisible();
      await expect(getDeviceState()).resolves.toBe(
        code === "DEVICE_NOT_TRUSTED"
          ? "device-action-required"
          : "auth-required"
      );
    }
  );

  it.each([
    ["필수", "바람과 꽃"],
    ["선택", "구름 산책"]
  ])("launches a selected %s item from the dashboard", async (_kind, title) => {
    const user = userEvent.setup();
    await markStudentAuthenticated();
    render(<App api={createFakeApi()} />);

    await user.click(await screen.findByRole("button", { name: `${title} 시작하기` }));

    expect(screen.getByRole("region", { name: `${title} 학습` })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "오늘의 학습" })).not.toBeInTheDocument();
  });

  it("returns after a gated completion with refreshed authoritative progress and stars", async () => {
    const user = userEvent.setup();
    const api = createFakeApi();
    const initialPlan = await api.getToday();
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

    await markStudentAuthenticated();
    render(<App api={api} />);
    await user.click(await screen.findByRole("button", { name: "바람과 꽃 시작하기" }));
    await user.click(screen.getByText("직접 입력으로 확인하기"));
    await user.type(screen.getByLabelText("읽은 내용 직접 입력"), "바람과 꽃");
    await user.click(screen.getByRole("button", { name: "읽기 판정하기" }));

    expect(api.saveAttempt).toHaveBeenCalledWith(expect.objectContaining({
      planId: initialPlan.planId,
      occurredAt: expect.any(String)
    }));

    expect(await screen.findByText("별 1개를 모았어요")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "다음 문제" }));

    expect(await screen.findByRole("heading", { name: "오늘의 학습" })).toBeVisible();
    expect(await screen.findByText("모은 별 8개")).toBeVisible();
    const completedCard = screen.getByRole("heading", { name: "바람과 꽃" }).closest("article");
    expect(completedCard).not.toBeNull();
    expect(within(completedCard!).getByText("함께 해결했어요")).toBeVisible();
    expect(within(completedCard!).getByText("★ 받은 별 1개")).toBeVisible();
    expect(api.getToday).toHaveBeenCalledTimes(2);
    expect(api.getStudentStars).toHaveBeenCalledTimes(2);
  });

  it("returns with an offline attempt queued then refetches authoritative home state after sync", async () => {
    const user = userEvent.setup();
    const api = createFakeApi();
    const initialPlan = await api.getToday();
    const confirmedAfterSync = {
      balance: 8,
      earnedToday: 3,
      deductedToday: 1,
      lastReason: "필수 학습을 마쳤어요."
    };
    const syncedPlan = {
      ...initialPlan,
      activityCursor: 1,
      completedItemIds: ["ko-01"],
      stars: confirmedAfterSync
    };
    api.getToday.mockReset()
      .mockResolvedValueOnce(initialPlan)
      .mockResolvedValue(syncedPlan);
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
        activityCursor: 1,
        starAward: {
          awarded: true,
          amount: 1,
          balance: 8,
          eventId: "star-after-sync"
        }
      });
    api.applyOfflineBatch.mockImplementation(async (input) => ({
      clientBatchId: input.clientBatchId,
      duplicate: false,
      orderConflict: false,
      batchEndCursor: 1,
      activityCursor: 1,
      receipts: input.events.map((event: ActivityEvent) => ({
        clientId: event.kind === "attempt"
          ? event.payload.clientAttemptId
          : event.payload.clientIdleEventId,
        kind: event.kind,
        status: "APPLIED" as const,
        code: null,
        attempt: event.kind === "attempt" ? {
          id: "attempt-server-after-sync",
          duplicate: false,
          readingPass: true,
          mathPass: null,
          completed: true,
          activityCursor: 1,
          starAward: {
            awarded: true,
            amount: 1,
            balance: 8,
            eventId: "star-after-sync"
          }
        } : null,
        idle: null
      })),
      processedPlan: syncedPlan,
      currentDailyPlan: syncedPlan,
      stars: confirmedAfterSync
    }));

    await markStudentAuthenticated();
    render(<App api={api} />);
    await user.click(await screen.findByRole("button", { name: "바람과 꽃 시작하기" }));
    await user.click(screen.getByText("직접 입력으로 확인하기"));
    await user.type(screen.getByLabelText("읽은 내용 직접 입력"), "바람과 꽃");
    await user.click(screen.getByRole("button", { name: "읽기 판정하기" }));

    expect(await screen.findByText("학습 기록이 아직 여행 중이에요. 연결되면 확인할게요.")).toBeVisible();
    await expect(listQueuedAttempts()).resolves.toHaveLength(1);
    expect(screen.getByRole("button", { name: "다음 문제" })).toBeEnabled();
    expect(within(screen.getByRole("region", { name: "바람과 꽃 학습" }))
      .getByText("동기화 대기")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "다음 문제" }));

    expect(await screen.findByRole("heading", { name: "오늘의 학습" })).toBeVisible();
    expect(screen.getByText("동기화 대기 별 1개")).toBeVisible();
    expect(screen.getByText("모은 별 7개")).toBeVisible();
    const provisionalCard = screen.getByRole("heading", { name: "바람과 꽃" }).closest("article");
    expect(provisionalCard).not.toBeNull();
    expect(within(provisionalCard!).getByText("동기화 대기")).toBeVisible();
    await expect(listQueuedAttempts()).resolves.toHaveLength(1);

    await act(async () => {
      await syncPending(api);
    });

    expect(await screen.findByText("동기화 대기 별 0개")).toBeVisible();
    expect(await screen.findByText("모은 별 8개")).toBeVisible();
    await waitFor(() => {
      const completedCard = screen.getByRole("heading", { name: "바람과 꽃" }).closest("article");
      expect(completedCard).not.toBeNull();
      expect(within(completedCard!).getByText("함께 해결했어요")).toBeVisible();
      expect(within(completedCard!).getByText("★ 받은 별 1개")).toBeVisible();
    });
    await expect(listQueuedAttempts()).resolves.toHaveLength(0);
    expect(api.getToday).toHaveBeenCalledTimes(3);
    expect(api.getStudentStars).toHaveBeenCalledTimes(2);
  });

  it("keeps the post-receipt plan, stars, React state, and cache when an older home request resolves last", async () => {
    const fixtures = createFakeApi();
    const oldPlan = await fixtures.getToday();
    const freshStars = {
      balance: 8,
      earnedToday: 3,
      deductedToday: 1,
      lastReason: "동기화를 마쳤어요."
    };
    const freshPlan = {
      ...oldPlan,
      activityCursor: 1,
      completedItemIds: ["ko-01"],
      stars: freshStars
    };
    const delayedPlan = deferred<typeof oldPlan>();
    const delayedStars = deferred<typeof oldPlan.stars>();
    let todayCall = 0;
    let starsCall = 0;
    const api = createFakeApi({
      getToday: vi.fn().mockImplementation(() => {
        todayCall += 1;
        if (todayCall === 1) return delayedPlan.promise;
        if (todayCall === 2) return Promise.resolve(oldPlan);
        return Promise.resolve(freshPlan);
      }),
      getStudentStars: vi.fn().mockImplementation(() => {
        starsCall += 1;
        return starsCall === 1
          ? delayedStars.promise
          : Promise.resolve(freshStars);
      }),
      applyOfflineBatch: vi.fn().mockImplementation(async (input) => ({
        clientBatchId: input.clientBatchId,
        duplicate: false,
        orderConflict: false,
        batchEndCursor: 1,
        activityCursor: 1,
        receipts: input.events.map((event: ActivityEvent) => ({
          clientId: event.kind === "attempt"
            ? event.payload.clientAttemptId
            : event.payload.clientIdleEventId,
          kind: event.kind,
          status: "APPLIED" as const,
          code: null,
          attempt: event.kind === "attempt" ? {
            id: "attempt-race-server-1",
            duplicate: false,
            readingPass: true,
            mathPass: null,
            completed: true,
            activityCursor: 1,
            starAward: {
              awarded: true,
              amount: 1,
              balance: 8,
              eventId: "star-race-1"
            }
          } : null,
          idle: null
        })),
        processedPlan: freshPlan,
        currentDailyPlan: freshPlan,
        stars: freshStars
      }))
    });
    await markStudentAuthenticated();
    await cacheIssuedPlan(oldPlan, oldPlan.stars);
    await queueAttempt({
      clientAttemptId: "attempt-home-race-0001",
      planId: oldPlan.planId,
      itemId: "ko-01",
      contentVersion: 1,
      studyDate: oldPlan.date,
      occurredAt: "2026-07-16T01:00:00.000Z",
      readingScore: 100,
      missedTokens: [],
      mathAnswer: null,
      durationMs: 30_000,
      difficultyFeedback: null
    });

    render(<App api={api} />);
    await waitFor(() => expect(api.getToday).toHaveBeenCalledTimes(1));
    await act(async () => {
      await syncPending(api);
    });
    expect(await screen.findByText("모은 별 8개")).toBeVisible();

    await act(async () => {
      delayedPlan.resolve(oldPlan);
      delayedStars.resolve(oldPlan.stars);
      await Promise.resolve();
    });

    expect(screen.getByText("모은 별 8개")).toBeVisible();
    const completedCard = screen.getByRole("heading", {
      name: "바람과 꽃"
    }).closest("article");
    expect(completedCard).not.toBeNull();
    expect(within(completedCard!).getByText("함께 해결했어요")).toBeVisible();
    await expect(loadCachedTodayPlan(oldPlan.date)).resolves.toMatchObject({
      activityCursor: 1,
      completedItemIds: ["ko-01"],
      stars: freshStars
    });
  });

  it("keeps a locally incorrect offline math attempt queued without projecting provisional completion", async () => {
    const api = createFakeApi();
    const basePlan = await api.getToday();
    const plan: TodayPlan = {
      ...basePlan,
      items: basePlan.items.map((item: TodayPlan["items"][number]) => item.id === "math-01" ? {
        ...item,
        payload: {
          id: "math-01",
          subject: "math",
          unit: "수 이야기",
          title: "별을 세어요",
          level: "1단계",
          readLabel: "수학 지문 읽기",
          text: "별 세 개와 별 두 개가 있어요.",
          hint: "천천히 읽어 봐요.",
          tokens: ["별", "세 개", "두 개", "모두"],
          kind: "math-story",
          question: "별은 모두 몇 개일까요?",
          answer: 5,
          unitLabel: "개",
          checkHint: "3과 2를 더해 봐요."
        }
      } : item)
    };
    api.getToday.mockResolvedValue(plan);
    await markStudentAuthenticated();
    await cacheIssuedPlan(plan, plan.stars);
    await queueAttempt({
      clientAttemptId: "attempt-wrong-math-projection-0001",
      planId: plan.planId,
      itemId: "math-01",
      contentVersion: 1,
      studyDate: plan.date,
      occurredAt: "2026-07-16T01:00:00.000Z",
      readingScore: 100,
      missedTokens: [],
      mathAnswer: 4,
      durationMs: 30_000,
      difficultyFeedback: null
    });

    render(<App api={api} />);

    const card = (await screen.findByRole("heading", {
      name: "별을 세어요"
    })).closest("article");
    expect(card).not.toBeNull();
    await waitFor(() => {
      expect(within(card!).queryByText("동기화 대기")).not.toBeInTheDocument();
    });
    expect(screen.getByText("동기화 대기 별 0개")).toBeVisible();
    await expect(listQueuedAttempts()).resolves.toHaveLength(1);
    await expect(getQueueCounts()).resolves.toEqual({
      activities: 1,
      provisionalAttempts: 0,
      rejected: 0
    });
  });

  it.each(["batch", "recovery"] as const)(
    "removes provisional projection immediately after a terminal %s rejection",
    async (kind) => {
      const fixtures = createFakeApi();
      const plan = await fixtures.getToday();
      const api = createFakeApi({
        getToday: vi.fn().mockResolvedValue(plan),
        applyOfflineBatch: vi.fn().mockRejectedValue(
          new ApiError(400, "INVALID_REQUEST")
        ),
        createRecoveryPlan: vi.fn().mockRejectedValue(
          new ApiError(409, "PLAN_NOT_ISSUED")
        )
      });
      await markStudentAuthenticated();
      await cacheIssuedPlan(plan, plan.stars);
      await queueAttempt({
        clientAttemptId: `attempt-terminal-${kind}-projection-0001`,
        planId: plan.planId,
        itemId: "ko-01",
        contentVersion: 1,
        studyDate: plan.date,
        occurredAt: "2026-07-16T01:00:00.000Z",
        readingScore: 100,
        missedTokens: [],
        mathAnswer: null,
        durationMs: 30_000,
        difficultyFeedback: null
      });
      if (kind === "recovery") {
        await handleDeviceActionRequired("DEVICE_REVOKED");
        await markStudentAuthenticated();
      }
      render(<App api={api} />);

      const card = (await screen.findByRole("heading", {
        name: "바람과 꽃"
      })).closest("article");
      expect(card).not.toBeNull();
      expect(await within(card!).findByText("동기화 대기")).toBeVisible();

      await act(async () => {
        await syncPending(api);
      });

      await waitFor(() => {
        expect(within(card!).queryByText("동기화 대기"))
          .not.toBeInTheDocument();
      });
      await expect(listActivities()).resolves.toEqual([]);
    }
  );

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
    const api = createFakeApi({
      getStudentStars: vi.fn().mockResolvedValue({
        balance: 5,
        earnedToday: 1,
        deductedToday: 0,
        lastReason: "필수 학습을 마쳤어요."
      })
    });
    const queuedAttempt = {
      clientAttemptId: "home-queued-attempt-0001",
      planId: "plan-daily-1",
      itemId: "ko-01",
      contentVersion: 1,
      studyDate: "2026-07-16",
      occurredAt: "2026-07-16T01:00:00.000Z",
      readingScore: 100,
      missedTokens: [],
      mathAnswer: null,
      durationMs: 30_000,
      difficultyFeedback: null
    };
    const issuedPlan = await api.getToday();
    api.getToday.mockClear();
    await markStudentAuthenticated();
    await cacheIssuedPlan(issuedPlan, issuedPlan.stars);
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
    const api = createFakeApi();
    const plan = await api.getToday();
    api.getToday.mockResolvedValue({
      ...plan,
      completedItemIds: ["ko-01"]
    });
    await markStudentAuthenticated();
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
    expect(layout).toMatch(/grid-template-columns:\s*260px\s+minmax\(0,\s*1fr\)\s+240px/);
    expect(layout).toMatch(/\.student-shell__main[^{]*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+240px/s);
    expect(components).toMatch(/(?:button|input)[^{]*\{[^}]*min-height:\s*var\(--touch-min\)/s);
    expect(components).toContain(":focus-visible");
    expect(layout).toContain(".student-learning-view");
    expect(components).toContain(".learning-session");
    expect(components).toContain(".learning-companion");
    expect(components).toMatch(/\.learning-session textarea\s*\{[^}]*min-height:\s*120px/s);
    expect(responsive).toMatch(/@media\s*\(max-width:\s*950px\)/);
    expect(responsive).toMatch(/max-width:\s*850px/);
    expect(responsive).toContain(".friend-stage__cast");
    expect(responsive).not.toMatch(/\.friend-stage\s*\{[^}]*display:\s*none/s);
    expect(responsive).toContain('"right"');
    expect(responsive).not.toMatch(/\.student-shell__right\s*\{[^}]*display:\s*none/s);
    expect(responsive).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)/);
    expect(responsive).toContain(".learning-companion .companion-avatar");
    expect(components).toMatch(/\.companion-bubble\s*\{[^}]*overflow-wrap:\s*anywhere/s);
    expect(components).toMatch(
      /\.account-menu button,\s*\.device-management button\s*\{[^}]*min-height:\s*48px/s
    );
  });
});
