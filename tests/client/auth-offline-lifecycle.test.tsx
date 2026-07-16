// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { deleteDB, openDB } from "idb";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ActivityEvent,
  AttemptInput,
  OfflineBatchInput,
  OfflineBatchReceipt,
  TodayPlan
} from "../../src/shared/learning";
import type { IdleEventInput } from "../../src/shared/stars";
import {
  OFFLINE_DB_NAME,
  OFFLINE_DB_VERSION,
  applyBatchReceipt,
  cacheIssuedPlan,
  clearOfflineAuthority,
  getDeviceState,
  handleDeviceActionRequired,
  listActivities,
  listPendingBatches,
  markStudentAuthenticated,
  queueAttempt,
  queueIdleEvent
} from "../../src/client/offline/db";
import { syncPending } from "../../src/client/offline/sync";
import { createProductionApi } from "../../src/client/api/production";
import { AuthProvider, useAuth } from "../../src/client/auth/auth-context";

const stars = {
  balance: 4,
  earnedToday: 1,
  deductedToday: 0,
  lastReason: "서버 확정"
};

function dailyPlan(overrides: Partial<TodayPlan> = {}): TodayPlan {
  return {
    planId: "plan-lifecycle-source",
    planKind: "daily",
    recoverySourcePlanId: null,
    date: "2026-07-16",
    submitUntil: "2026-07-17T14:59:59.999Z",
    offlineEpoch: 4,
    activityCursor: 2,
    studentDisplayName: "수아",
    completedItemIds: [],
    requiredItemIds: ["ko-01"],
    stars,
    items: [{
      id: "ko-01",
      version: 1,
      payload: {
        id: "ko-01",
        kind: "korean-reading",
        subject: "korean",
        unit: "동화 읽기",
        title: "작은 별",
        level: "1단계",
        readLabel: "읽기",
        text: "작은 별이 반짝여요.",
        hint: "천천히 읽어요.",
        tokens: ["작은 별", "반짝여요"]
      }
    }],
    ...overrides
  };
}

const attempt: AttemptInput = {
  clientAttemptId: "attempt-auth-lifecycle-0001",
  planId: "plan-lifecycle-source",
  itemId: "ko-01",
  contentVersion: 1,
  studyDate: "2026-07-16",
  occurredAt: "2026-07-16T01:05:00.000Z",
  readingScore: 100,
  missedTokens: [],
  mathAnswer: null,
  durationMs: 20_000,
  difficultyFeedback: null
};

const idle: IdleEventInput = {
  clientIdleEventId: "idle-auth-lifecycle-0001",
  learningSessionId: "learning-session-must-never-survive-0001",
  planId: "plan-lifecycle-source",
  itemId: "ko-01",
  contentVersion: 1,
  studyDate: "2026-07-16",
  idleStartedAt: "2026-07-16T01:00:00.000Z",
  occurredAt: "2026-07-16T01:05:00.000Z"
};

function clientId(event: ActivityEvent): string {
  return event.kind === "attempt"
    ? event.payload.clientAttemptId
    : event.payload.clientIdleEventId;
}

function receipt(
  input: OfflineBatchInput,
  currentDailyPlan: TodayPlan
): OfflineBatchReceipt {
  return {
    clientBatchId: input.clientBatchId,
    duplicate: false,
    orderConflict: true,
    batchEndCursor: 22,
    activityCursor: 22,
    receipts: input.events.map((event, index) => ({
      clientId: clientId(event),
      kind: event.kind,
      status: event.kind === "idle" ? "ORDER_CONFLICT_WAIVED" : "APPLIED",
      code: event.kind === "idle" ? "ORDER_CONFLICT_WAIVED" : null,
      attempt: event.kind === "attempt" ? {
        id: `server-attempt-${index}`,
        duplicate: false,
        readingPass: true,
        mathPass: null,
        completed: true,
        starAward: {
          awarded: true,
          amount: 1,
          balance: currentDailyPlan.stars.balance,
          eventId: `server-star-${index}`
        },
        activityCursor: 22
      } : null,
      idle: event.kind === "idle" ? {
        id: `server-idle-${index}`,
        outcome: "order-conflict-waived",
        starEventId: null,
        duplicate: false,
        activityCursor: 22
      } : null
    })),
    processedPlan: dailyPlan({
      planId: input.planId,
      planKind: "recovery",
      recoverySourcePlanId: "plan-lifecycle-source",
      offlineEpoch: input.offlineEpoch,
      activityCursor: 22
    }),
    currentDailyPlan,
    stars: currentDailyPlan.stars
  };
}

describe("browser auth/offline lifecycle", () => {
  beforeEach(async () => {
    await deleteDB(OFFLINE_DB_NAME);
  });

  afterEach(cleanup);

  it("runs production callbacks from revoke through guardian-authenticated registration, existing PIN, and recovery sync", async () => {
    const source = dailyPlan();
    const currentDaily = dailyPlan({
      planId: "plan-lifecycle-current-runtime",
      date: "2026-07-17",
      submitUntil: "2026-07-18T14:59:59.999Z",
      offlineEpoch: 8,
      activityCursor: 20,
      stars: { ...stars, balance: 5 }
    });
    const recovery = dailyPlan({
      planId: "plan-lifecycle-recovery-runtime",
      planKind: "recovery",
      recoverySourcePlanId: source.planId,
      offlineEpoch: 9,
      activityCursor: 20
    });
    await markStudentAuthenticated();
    await cacheIssuedPlan(source, source.stars);
    await queueAttempt(attempt);
    await queueIdleEvent(idle);

    let rejectNextStars = true;
    let guardianAuthenticated = false;
    const recoveryRequests: unknown[] = [];
    const submitted: OfflineBatchInput[] = [];
    const json = (body: unknown, status = 200) => new Response(
      JSON.stringify(body),
      { status, headers: { "content-type": "application/json" } }
    );
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      const method = init?.method ?? "GET";
      if (path === "/api/auth/me" && method === "GET") {
        return json({ id: "student-1", role: "student", displayName: "수아" });
      }
      if (path === "/api/auth/session/end" && method === "POST") {
        guardianAuthenticated = false;
        return new Response(null, { status: 204 });
      }
      if (path === "/api/auth/guardian/login" && method === "POST") {
        guardianAuthenticated = true;
        return new Response(null, { status: 204 });
      }
      if (path === "/api/student/stars" && method === "GET" && rejectNextStars) {
        rejectNextStars = false;
        return json({ code: "DEVICE_REVOKED" }, 403);
      }
      if (path === "/api/guardian/devices/current" && method === "POST") {
        if (!guardianAuthenticated) {
          return json({ code: "AUTH_REQUIRED" }, 401);
        }
        return json({
          publicId: "replacement-device-public",
          name: "Galaxy Tab A 재등록",
          createdAt: "2026-07-17T01:00:00.000Z",
          lastUsedAt: null,
          status: "active",
          current: true
        }, 201);
      }
      if (path === "/api/auth/student/login" && method === "POST") {
        return json({ offlineAccessUntil: "2026-07-18T14:59:59.999Z" });
      }
      if (path === "/api/student/today" && method === "GET") {
        return json(currentDaily);
      }
      if (path === "/api/student/recovery-plans" && method === "POST") {
        recoveryRequests.push(JSON.parse(String(init?.body)));
        return json(recovery);
      }
      if (path === "/api/student/offline-batches" && method === "POST") {
        const batch = JSON.parse(String(init?.body)) as OfflineBatchInput;
        submitted.push(batch);
        return json(receipt(batch, currentDaily));
      }
      throw new Error(`unexpected request: ${method} ${path}`);
    });
    const api = createProductionApi(fetcher as typeof fetch);

    function Probe() {
      const auth = useAuth();
      return <div>
        <output aria-label="phase">{auth.phase}</output>
        <button type="button" onClick={() => void auth.logout()}>logout</button>
        <button type="button" onClick={() => {
          void auth.api.getStudentStars().catch(() => undefined);
        }}>revoke response</button>
        <button type="button" onClick={() => {
          void auth.guardianLogin("correct horse battery staple");
        }}>guardian login</button>
        <button type="button" onClick={() => {
          void auth.registerDevice("Galaxy Tab A 재등록");
        }}>register</button>
        <button type="button" onClick={() => void auth.studentLogin("2580")}>student login</button>
      </div>;
    }

    const user = userEvent.setup();
    render(<AuthProvider api={api}><Probe /></AuthProvider>);
    await waitFor(() => expect(screen.getByLabelText("phase"))
      .toHaveTextContent("authenticated"));

    await user.click(screen.getByRole("button", { name: "logout" }));
    await waitFor(() => expect(screen.getByLabelText("phase"))
      .toHaveTextContent("student-login"));
    await expect(getDeviceState()).resolves.toBe("auth-required");
    await expect(listActivities()).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
    const afterLogout = await openDB(OFFLINE_DB_NAME, OFFLINE_DB_VERSION);
    expect(await afterLogout.count("activityQueue")).toBe(2);
    afterLogout.close();

    await user.click(screen.getByRole("button", { name: "revoke response" }));
    await waitFor(() => expect(screen.getByLabelText("phase"))
      .toHaveTextContent("device-recovery-guardian-login"));
    await expect(getDeviceState()).resolves.toBe("device-action-required");
    const afterRevoke = await openDB(OFFLINE_DB_NAME, OFFLINE_DB_VERSION);
    const rows = await afterRevoke.getAll("activityQueue");
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.requiresRecovery)).toBe(true);
    afterRevoke.close();

    await user.click(screen.getByRole("button", { name: "guardian login" }));
    await waitFor(() => expect(screen.getByLabelText("phase"))
      .toHaveTextContent("device-recovery-registration"));
    expect(guardianAuthenticated).toBe(true);
    await user.click(screen.getByRole("button", { name: "register" }));
    await waitFor(() => expect(screen.getByLabelText("phase"))
      .toHaveTextContent("student-login"));
    expect(guardianAuthenticated).toBe(false);
    await user.click(screen.getByRole("button", { name: "student login" }));
    await waitFor(() => expect(screen.getByLabelText("phase"))
      .toHaveTextContent("authenticated"));
    await waitFor(() => expect(recoveryRequests).toEqual([
      { sourcePlanId: source.planId }
    ]));
    await waitFor(() => expect(submitted).toHaveLength(1));
    expect(submitted[0]).toMatchObject({
      planId: recovery.planId,
      offlineEpoch: recovery.offlineEpoch,
      startCursor: recovery.activityCursor
    });
    expect(submitted[0]!.events.find((event) => event.kind === "idle"))
      .toMatchObject({ legacy: true });
    expect(JSON.stringify(submitted[0])).not.toContain("learningSessionId");
    await waitFor(async () => expect(await listActivities()).toEqual([]));
    await expect(listPendingBatches()).resolves.toEqual([]);
  });

  it("preserves and blocks the journal, rebinds after PIN, sanitizes idle, and commits a receipt atomically", async () => {
    const source = dailyPlan();
    await markStudentAuthenticated();
    await cacheIssuedPlan(source, source.stars);
    await queueAttempt(attempt);
    await queueIdleEvent(idle);

    await clearOfflineAuthority("auth-required");
    await expect(getDeviceState()).resolves.toBe("auth-required");
    await expect(listActivities()).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
    const afterLogout = await openDB(OFFLINE_DB_NAME, OFFLINE_DB_VERSION);
    expect(await afterLogout.count("activityQueue")).toBe(2);
    expect(await afterLogout.count("pendingBatches")).toBe(0);
    expect(await afterLogout.count("rejectedActivities")).toBe(0);
    expect(JSON.stringify(await afterLogout.getAll("activityQueue")))
      .not.toContain(idle.learningSessionId);
    afterLogout.close();

    await markStudentAuthenticated();
    await handleDeviceActionRequired("DEVICE_REVOKED");
    await expect(getDeviceState()).resolves.toBe("device-action-required");
    await expect(listActivities()).rejects.toMatchObject({
      code: "DEVICE_ACTION_REQUIRED"
    });
    const afterRevoke = await openDB(OFFLINE_DB_NAME, OFFLINE_DB_VERSION);
    expect(await afterRevoke.count("activityQueue")).toBe(2);
    const recoveryRows = await afterRevoke.getAll("activityQueue");
    expect(recoveryRows.every((row) => row.requiresRecovery)).toBe(true);
    expect(recoveryRows.every((row) => row.sourcePlanId === source.planId)).toBe(true);
    afterRevoke.close();

    // Fresh registration + PIN authentication re-opens only the preserved journal.
    await markStudentAuthenticated();
    const currentDaily = dailyPlan({
      planId: "plan-lifecycle-current",
      offlineEpoch: 8,
      activityCursor: 20,
      stars: { ...stars, balance: 5 }
    });
    const recovery = dailyPlan({
      planId: "plan-lifecycle-recovery",
      planKind: "recovery",
      recoverySourcePlanId: source.planId,
      offlineEpoch: 9,
      activityCursor: 20
    });
    let submitted: OfflineBatchInput | undefined;
    const api = {
      getToday: vi.fn().mockResolvedValue(currentDaily),
      createRecoveryPlan: vi.fn().mockResolvedValue(recovery),
      applyOfflineBatch: vi.fn().mockImplementation(async (input: OfflineBatchInput) => {
        submitted = structuredClone(input);
        throw new TypeError("response lost after server commit");
      })
    };

    await syncPending(api, { retryRecoveryBlocked: true });
    expect(api.createRecoveryPlan).toHaveBeenCalledWith({
      sourcePlanId: source.planId
    });
    expect(submitted).toMatchObject({
      planId: recovery.planId,
      offlineEpoch: recovery.offlineEpoch,
      startCursor: recovery.activityCursor
    });
    const recoveredAttempt = submitted!.events.find((event) =>
      event.kind === "attempt"
    );
    const recoveredIdle = submitted!.events.find((event) => event.kind === "idle");
    expect(recoveredAttempt).toMatchObject({
      legacy: false,
      payload: { planId: recovery.planId, clientAttemptId: attempt.clientAttemptId }
    });
    expect(recoveredIdle).toMatchObject({
      legacy: true,
      payload: { clientIdleEventId: idle.clientIdleEventId }
    });
    expect(JSON.stringify(recoveredIdle)).not.toContain("learningSessionId");

    const serverReceipt = receipt(submitted!, currentDaily);
    await expect(applyBatchReceipt(
      serverReceipt,
      { abortBeforeCommit: true }
    )).rejects.toBeDefined();

    const afterCrash = await openDB(OFFLINE_DB_NAME, OFFLINE_DB_VERSION);
    expect(await afterCrash.count("activityQueue")).toBe(2);
    expect(await afterCrash.count("pendingBatches")).toBe(1);
    afterCrash.close();
    await expect(listActivities()).resolves.toHaveLength(2);
    await expect(listPendingBatches()).resolves.toHaveLength(1);

    await applyBatchReceipt(serverReceipt);
    await expect(listActivities()).resolves.toEqual([]);
    await expect(listPendingBatches()).resolves.toEqual([]);
  });
});
