import type { ApiClient } from "../api/client";
import type { AttemptInput, SyncResult } from "../../shared/learning";
import type { IdleEventInput } from "../../shared/stars";
import {
  getQueueCounts,
  listQueuedAttempts,
  listQueuedIdleEvents,
  queueAttempt,
  queueIdleEvent,
  removeQueuedAttempt,
  removeQueuedIdleEvent,
  setDeviceActionRequired,
  storeConfirmedStars
} from "./db";

export type SyncApi = Pick<
  ApiClient,
  "saveAttempt" | "sendIdleEvent" | "getStudentStars"
>;

type FailureKind = "auth" | "device-revoked" | "retry" | "other";

function failureKind(error: unknown): FailureKind {
  if (error === null || typeof error !== "object") return "retry";
  const status = "status" in error && typeof error.status === "number"
    ? error.status
    : undefined;
  const code = "code" in error && typeof error.code === "string"
    ? error.code
    : undefined;

  if (code === "DEVICE_REVOKED") return "device-revoked";
  if (status === 401) return "auth";
  if (error instanceof TypeError || (status !== undefined && status >= 500)) {
    return "retry";
  }
  return "other";
}

export async function preserveFailedAttempt(
  error: unknown,
  input: AttemptInput
): Promise<boolean> {
  const kind = failureKind(error);
  if (kind === "other") return false;
  await queueAttempt(input);
  if (kind === "device-revoked") await setDeviceActionRequired();
  return true;
}

export async function preserveFailedIdleEvent(
  error: unknown,
  input: IdleEventInput
): Promise<boolean> {
  const kind = failureKind(error);
  if (kind === "other") return false;
  await queueIdleEvent(input);
  if (kind === "device-revoked") await setDeviceActionRequired();
  return true;
}

type StopKind = Exclude<FailureKind, "other">;
type QueueSync = SyncResult & { stopped: StopKind | null };

async function syncAttempts(api: SyncApi): Promise<QueueSync> {
  let sent = 0;
  for (const input of await listQueuedAttempts()) {
    try {
      await api.saveAttempt(input);
      await removeQueuedAttempt(input.clientAttemptId);
      sent += 1;
    } catch (error) {
      const kind = failureKind(error);
      if (kind === "device-revoked") await setDeviceActionRequired();
      if (kind !== "other") {
        const { attempts } = await getQueueCounts();
        return { sent, remaining: attempts, stopped: kind };
      }
    }
  }
  const { attempts } = await getQueueCounts();
  return { sent, remaining: attempts, stopped: null };
}

async function syncIdleEvents(api: SyncApi): Promise<QueueSync> {
  let sent = 0;
  for (const input of await listQueuedIdleEvents()) {
    try {
      await api.sendIdleEvent(input);
      await removeQueuedIdleEvent(input.clientIdleEventId);
      sent += 1;
    } catch (error) {
      const kind = failureKind(error);
      if (kind === "device-revoked") await setDeviceActionRequired();
      if (kind !== "other") {
        const { idleEvents } = await getQueueCounts();
        return { sent, remaining: idleEvents, stopped: kind };
      }
    }
  }
  const { idleEvents } = await getQueueCounts();
  return { sent, remaining: idleEvents, stopped: null };
}

async function refreshConfirmedStars(api: SyncApi): Promise<void> {
  try {
    await storeConfirmedStars(await api.getStudentStars());
  } catch (error) {
    if (failureKind(error) === "device-revoked") {
      await setDeviceActionRequired();
    }
  }
}

export async function syncPending(api: SyncApi): Promise<{
  attempts: SyncResult;
  idleEvents: SyncResult;
}> {
  const attempts = await syncAttempts(api);
  if (attempts.stopped !== null) {
    if (attempts.stopped === "retry" && attempts.sent > 0) {
      await refreshConfirmedStars(api);
    }
    const counts = await getQueueCounts();
    return {
      attempts: { sent: attempts.sent, remaining: attempts.remaining },
      idleEvents: { sent: 0, remaining: counts.idleEvents }
    };
  }

  const idleEvents = await syncIdleEvents(api);
  const canRefresh = idleEvents.stopped === null || idleEvents.stopped === "retry";
  if (canRefresh && attempts.sent + idleEvents.sent > 0) {
    await refreshConfirmedStars(api);
  }

  return {
    attempts: { sent: attempts.sent, remaining: attempts.remaining },
    idleEvents: { sent: idleEvents.sent, remaining: idleEvents.remaining }
  };
}
