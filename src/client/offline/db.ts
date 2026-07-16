import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import {
  AttemptInputSchema,
  LearningItemPayloadSchema,
  type AttemptInput,
  type TodayPlan
} from "../../shared/learning";
import {
  IdleEventInputSchema,
  type IdleEventInput,
  type StudentStarSummary
} from "../../shared/stars";

export const OFFLINE_DB_NAME = "sua-learning-v1";

export type DeviceState = "ready" | "device-action-required";
export type QueueCounts = { attempts: number; idleEvents: number };
type QueueCountsListener = (counts: QueueCounts) => void;
type ConfirmedStarsListener = (summary: StudentStarSummary) => void;

const queueCountsListeners = new Set<QueueCountsListener>();
const confirmedStarsListeners = new Set<ConfirmedStarsListener>();

type OfflineMeta =
  | { key: "device-state"; value: DeviceState }
  | { key: "confirmed-stars"; value: StudentStarSummary };

interface OfflineDatabase extends DBSchema {
  todayPlans: {
    key: string;
    value: TodayPlan;
  };
  attemptQueue: {
    key: string;
    value: AttemptInput;
  };
  idleEventQueue: {
    key: string;
    value: IdleEventInput;
  };
  meta: {
    key: OfflineMeta["key"];
    value: OfflineMeta;
  };
}

async function withDatabase<T>(
  operation: (database: IDBPDatabase<OfflineDatabase>) => Promise<T>
): Promise<T> {
  const database = await openDB<OfflineDatabase>(OFFLINE_DB_NAME, 1, {
    upgrade(db) {
      db.createObjectStore("todayPlans", { keyPath: "date" });
      db.createObjectStore("attemptQueue", { keyPath: "clientAttemptId" });
      db.createObjectStore("idleEventQueue", { keyPath: "clientIdleEventId" });
      db.createObjectStore("meta", { keyPath: "key" });
    }
  });
  try {
    return await operation(database);
  } finally {
    database.close();
  }
}

function sanitizeTodayPlan(plan: TodayPlan): TodayPlan {
  return {
    date: plan.date,
    completedItemIds: [...plan.completedItemIds],
    requiredItemIds: [...plan.requiredItemIds],
    stars: {
      balance: plan.stars.balance,
      earnedToday: plan.stars.earnedToday,
      deductedToday: plan.stars.deductedToday,
      lastReason: plan.stars.lastReason
    },
    items: plan.items.map((item) => ({
      id: item.id,
      version: item.version,
      payload: LearningItemPayloadSchema.parse(item.payload)
    }))
  };
}

export function cacheTodayPlan(plan: TodayPlan): Promise<void> {
  const safePlan = sanitizeTodayPlan(plan);
  return withDatabase(async (database) => {
    await database.put("todayPlans", safePlan);
  });
}

export function loadCachedTodayPlan(date: string): Promise<TodayPlan | undefined> {
  return withDatabase((database) => database.get("todayPlans", date));
}

async function publishQueueCounts(): Promise<void> {
  if (queueCountsListeners.size === 0) return;
  const counts = await getQueueCounts();
  for (const listener of queueCountsListeners) listener(counts);
}

export function subscribeQueueCounts(listener: QueueCountsListener): () => void {
  queueCountsListeners.add(listener);
  return () => queueCountsListeners.delete(listener);
}

export function subscribeConfirmedStars(
  listener: ConfirmedStarsListener
): () => void {
  confirmedStarsListeners.add(listener);
  return () => confirmedStarsListeners.delete(listener);
}

export async function queueAttempt(input: AttemptInput): Promise<void> {
  const safeInput = AttemptInputSchema.parse(input);
  await withDatabase(async (database) => {
    await database.put("attemptQueue", safeInput);
  });
  await publishQueueCounts();
}

export async function queueIdleEvent(input: IdleEventInput): Promise<void> {
  const safeInput = IdleEventInputSchema.parse(input);
  await withDatabase(async (database) => {
    await database.put("idleEventQueue", safeInput);
  });
  await publishQueueCounts();
}

export function listQueuedAttempts(): Promise<AttemptInput[]> {
  return withDatabase((database) => database.getAll("attemptQueue"));
}

export function listQueuedIdleEvents(): Promise<IdleEventInput[]> {
  return withDatabase((database) => database.getAll("idleEventQueue"));
}

export async function removeQueuedAttempt(clientAttemptId: string): Promise<void> {
  await withDatabase(async (database) => {
    await database.delete("attemptQueue", clientAttemptId);
  });
  await publishQueueCounts();
}

export async function removeQueuedIdleEvent(clientIdleEventId: string): Promise<void> {
  await withDatabase(async (database) => {
    await database.delete("idleEventQueue", clientIdleEventId);
  });
  await publishQueueCounts();
}

export function getQueueCounts(): Promise<QueueCounts> {
  return withDatabase(async (database) => {
    const [attempts, idleEvents] = await Promise.all([
      database.count("attemptQueue"),
      database.count("idleEventQueue")
    ]);
    return { attempts, idleEvents };
  });
}

export function setDeviceActionRequired(): Promise<void> {
  return withDatabase(async (database) => {
    await database.put("meta", {
      key: "device-state",
      value: "device-action-required"
    });
  });
}

export function getDeviceState(): Promise<DeviceState> {
  return withDatabase(async (database) => {
    const record = await database.get("meta", "device-state");
    return record?.key === "device-state" ? record.value : "ready";
  });
}

export async function storeConfirmedStars(summary: StudentStarSummary): Promise<void> {
  const confirmed: StudentStarSummary = {
    balance: summary.balance,
    earnedToday: summary.earnedToday,
    deductedToday: summary.deductedToday,
    lastReason: summary.lastReason
  };
  await withDatabase(async (database) => {
    await database.put("meta", { key: "confirmed-stars", value: confirmed });
  });
  for (const listener of confirmedStarsListeners) listener(confirmed);
}

export function getConfirmedStars(): Promise<StudentStarSummary | undefined> {
  return withDatabase(async (database) => {
    const record = await database.get("meta", "confirmed-stars");
    return record?.key === "confirmed-stars" ? record.value : undefined;
  });
}
