import type { ApiClient } from "../api/client";
import type { AttemptInput } from "../../shared/learning";
import type { IdleEventInput } from "../../shared/stars";
import {
  applyBatchReceipt,
  cacheIssuedPlan,
  clearOfflineAuthority,
  getQueueCounts,
  handleDeviceActionRequired,
  queueAttempt,
  queueIdleEvent,
  rebindRecoveryGroup,
  reconcileLegacyActivities,
  recoveryGroups,
  rejectPendingBatch,
  rejectRecoveryGroup,
  reserveNextBatch,
  setRecoveryBlocked
} from "./db";

export type SyncApi = Pick<
  ApiClient,
  "getToday" | "createRecoveryPlan" | "applyOfflineBatch"
>;

export type SyncPendingResult = {
  sent: number;
  remaining: number;
  rejected: number;
  stopped: "auth-required" | "device-action-required" | "retry" | "terminal" | null;
  recoveryBlockedCode?: "SOURCE_DEVICE_STILL_ACTIVE";
  guidance?: "보호자 기기 관리에서 이전 기기를 해제해 주세요";
};

type SyncCompletedListener = () => void;
type RecoveryGuidanceListener = (guidance: RecoveryGuidance | null) => void;
type ErrorFacts = { status?: number; code?: string };

export const SOURCE_DEVICE_RECOVERY_GUIDANCE =
  "보호자 기기 관리에서 이전 기기를 해제해 주세요" as const;
export type RecoveryGuidance = typeof SOURCE_DEVICE_RECOVERY_GUIDANCE;

const syncCompletedListeners = new Set<SyncCompletedListener>();
const recoveryGuidanceListeners = new Set<RecoveryGuidanceListener>();

export function subscribeSyncCompleted(listener: SyncCompletedListener): () => void {
  syncCompletedListeners.add(listener);
  return () => syncCompletedListeners.delete(listener);
}

export function subscribeRecoveryGuidance(
  listener: RecoveryGuidanceListener
): () => void {
  recoveryGuidanceListeners.add(listener);
  return () => recoveryGuidanceListeners.delete(listener);
}

function publishSyncCompleted(): void {
  for (const listener of syncCompletedListeners) listener();
}

function publishRecoveryGuidance(guidance: RecoveryGuidance | null): void {
  for (const listener of recoveryGuidanceListeners) listener(guidance);
}

function errorFacts(error: unknown): ErrorFacts {
  if (error === null || typeof error !== "object") return {};
  return {
    status: "status" in error && typeof error.status === "number"
      ? error.status
      : undefined,
    code: "code" in error && typeof error.code === "string"
      ? error.code
      : undefined
  };
}

function isRetryable(error: unknown): boolean {
  const { status } = errorFacts(error);
  return error instanceof TypeError || (status !== undefined && status >= 500);
}

function isAuth(error: unknown): boolean {
  return errorFacts(error).status === 401;
}

function deviceCode(
  error: unknown
): "DEVICE_REVOKED" | "DEVICE_NOT_TRUSTED" | undefined {
  const { code } = errorFacts(error);
  return code === "DEVICE_REVOKED" || code === "DEVICE_NOT_TRUSTED"
    ? code
    : undefined;
}

const NONTERMINAL_CODES = new Set([
  "CURRENT_DAILY_PLAN_REQUIRED",
  "SOURCE_DEVICE_STILL_ACTIVE",
  "DEVICE_REVOKED",
  "DEVICE_NOT_TRUSTED",
  "AUTH_REQUIRED"
]);

function isTerminal4xx(error: unknown): boolean {
  const { status, code } = errorFacts(error);
  return status !== undefined &&
    status >= 400 &&
    status < 500 &&
    status !== 401 &&
    code !== undefined &&
    !NONTERMINAL_CODES.has(code);
}

async function snapshotResult(
  sent: number,
  stopped: SyncPendingResult["stopped"]
): Promise<SyncPendingResult> {
  const counts = await getQueueCounts();
  return {
    sent,
    remaining: counts.activities,
    rejected: counts.rejected,
    stopped
  };
}

function blockedResult(
  counts: { activities: number; rejected: number },
  stopped: "auth-required" | "device-action-required"
): SyncPendingResult {
  return {
    sent: 0,
    remaining: counts.activities,
    rejected: counts.rejected,
    stopped
  };
}

export async function preserveFailedAttempt(
  error: unknown,
  input: AttemptInput
): Promise<boolean> {
  if (!isRetryable(error)) return false;
  await queueAttempt(input);
  return true;
}

export async function preserveFailedIdleEvent(
  error: unknown,
  input: IdleEventInput
): Promise<boolean> {
  if (!isRetryable(error)) return false;
  await queueIdleEvent(input);
  return true;
}

async function fetchCurrentPlan(api: SyncApi) {
  const current = await api.getToday();
  if (current.planKind !== "daily") {
    throw new Error("CURRENT_DAILY_PLAN_MUST_BE_ORDINARY");
  }
  await cacheIssuedPlan(current, current.stars);
  await reconcileLegacyActivities(current);
  return current;
}

export async function syncPending(
  api: SyncApi,
  options: { retryRecoveryBlocked?: boolean } = {}
): Promise<SyncPendingResult> {
  let initial;
  try {
    initial = await getQueueCounts();
  } catch (error) {
    const code = errorFacts(error).code;
    return {
      sent: 0,
      remaining: 0,
      rejected: 0,
      stopped: code === "DEVICE_ACTION_REQUIRED"
        ? "device-action-required"
        : "auth-required"
    };
  }

  try {
    await fetchCurrentPlan(api);
  } catch (error) {
    if (isAuth(error)) {
      await clearOfflineAuthority("auth-required");
      return blockedResult(initial, "auth-required");
    }
    const device = deviceCode(error);
    if (device !== undefined) {
      await handleDeviceActionRequired(device);
      return blockedResult(initial, "device-action-required");
    }
    return {
      sent: 0,
      remaining: initial.activities,
      rejected: initial.rejected,
      stopped: isRetryable(error) ? "retry" : "terminal"
    };
  }

  const groups = await recoveryGroups();
  if (groups.length === 0) publishRecoveryGuidance(null);
  for (const group of groups) {
    if (
      group.recoveryBlockedCode === "SOURCE_DEVICE_STILL_ACTIVE" &&
      options.retryRecoveryBlocked !== true
    ) {
      publishRecoveryGuidance(SOURCE_DEVICE_RECOVERY_GUIDANCE);
      return {
        ...(await snapshotResult(0, "retry")),
        recoveryBlockedCode: "SOURCE_DEVICE_STILL_ACTIVE",
        guidance: SOURCE_DEVICE_RECOVERY_GUIDANCE
      };
    }
    try {
      const recovery = await api.createRecoveryPlan({
        sourcePlanId: group.sourcePlanId
      });
      await rebindRecoveryGroup(group.sourcePlanId, recovery);
      publishRecoveryGuidance(null);
    } catch (error) {
      if (isAuth(error)) {
        await clearOfflineAuthority("auth-required");
        return blockedResult(initial, "auth-required");
      }
      const device = deviceCode(error);
      if (device !== undefined) {
        await handleDeviceActionRequired(device);
        return blockedResult(initial, "device-action-required");
      }
      const { code } = errorFacts(error);
      if (code === "SOURCE_DEVICE_STILL_ACTIVE") {
        await setRecoveryBlocked(group.sourcePlanId);
        publishRecoveryGuidance(SOURCE_DEVICE_RECOVERY_GUIDANCE);
        return {
          ...(await snapshotResult(0, "retry")),
          recoveryBlockedCode: "SOURCE_DEVICE_STILL_ACTIVE",
          guidance: SOURCE_DEVICE_RECOVERY_GUIDANCE
        };
      }
      if (code === "PLAN_SUBMISSION_EXPIRED" || code === "PLAN_NOT_ISSUED") {
        await rejectRecoveryGroup(group.sourcePlanId, code);
        publishRecoveryGuidance(null);
        return await snapshotResult(0, "terminal");
      }
      return await snapshotResult(0, isRetryable(error) ? "retry" : "terminal");
    }
  }

  const batch = await reserveNextBatch();
  if (batch === undefined) return await snapshotResult(0, null);

  let retriedCurrentPlan = false;
  for (;;) {
    try {
      const receipt = await api.applyOfflineBatch(batch);
      await applyBatchReceipt(receipt);
      publishSyncCompleted();
      return await snapshotResult(batch.events.length, null);
    } catch (error) {
      if (isAuth(error)) {
        await clearOfflineAuthority("auth-required");
        return blockedResult(initial, "auth-required");
      }
      const device = deviceCode(error);
      if (device !== undefined) {
        await handleDeviceActionRequired(device);
        return blockedResult(initial, "device-action-required");
      }
      const { code } = errorFacts(error);
      if (code === "CURRENT_DAILY_PLAN_REQUIRED" && !retriedCurrentPlan) {
        retriedCurrentPlan = true;
        try {
          await fetchCurrentPlan(api);
        } catch (currentError) {
          if (isAuth(currentError)) {
            await clearOfflineAuthority("auth-required");
            return blockedResult(initial, "auth-required");
          }
          const currentDevice = deviceCode(currentError);
          if (currentDevice !== undefined) {
            await handleDeviceActionRequired(currentDevice);
            return blockedResult(initial, "device-action-required");
          }
          return await snapshotResult(0, "retry");
        }
        continue;
      }
      if (isTerminal4xx(error)) {
        await rejectPendingBatch(batch.clientBatchId, code ?? "INVALID_REQUEST");
        return await snapshotResult(0, "terminal");
      }
      return await snapshotResult(0, "retry");
    }
  }
}
