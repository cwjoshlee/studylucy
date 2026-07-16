import type { ApiClient } from "../api/client";
import type { SyncResult } from "../../shared/learning";
import {
  getQueueCounts,
  listQueuedAttempts,
  listQueuedIdleEvents,
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

type QueueSync = SyncResult & { stopped: boolean };

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
        return { sent, remaining: attempts, stopped: true };
      }
    }
  }
  const { attempts } = await getQueueCounts();
  return { sent, remaining: attempts, stopped: false };
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
        return { sent, remaining: idleEvents, stopped: true };
      }
    }
  }
  const { idleEvents } = await getQueueCounts();
  return { sent, remaining: idleEvents, stopped: false };
}

export async function syncPending(api: SyncApi): Promise<{
  attempts: SyncResult;
  idleEvents: SyncResult;
}> {
  const attempts = await syncAttempts(api);
  if (attempts.stopped) {
    const counts = await getQueueCounts();
    return {
      attempts: { sent: attempts.sent, remaining: attempts.remaining },
      idleEvents: { sent: 0, remaining: counts.idleEvents }
    };
  }

  const idleEvents = await syncIdleEvents(api);
  if (!idleEvents.stopped && attempts.sent + idleEvents.sent > 0) {
    try {
      await storeConfirmedStars(await api.getStudentStars());
    } catch (error) {
      if (failureKind(error) === "device-revoked") {
        await setDeviceActionRequired();
      }
    }
  }

  return {
    attempts: { sent: attempts.sent, remaining: attempts.remaining },
    idleEvents: { sent: idleEvents.sent, remaining: idleEvents.remaining }
  };
}
