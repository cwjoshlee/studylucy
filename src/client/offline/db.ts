import { openDB, type DBSchema, type IDBPDatabase, type IDBPTransaction } from "idb";
import type { CurrentUser } from "../../shared/auth";
import {
  ActivityEventSchema,
  AttemptInputSchema,
  LegacyAttemptInputSchema,
  LegacyIdleEventInputSchema,
  TodayPlanSchema,
  type ActivityEvent,
  type AttemptInput,
  type GuardianOfflineRejection,
  type LegacyAttemptInput,
  type LegacyIdleEventInput,
  type OfflineBatchInput,
  type OfflineBatchReceipt,
  type TodayPlan
} from "../../shared/learning";
import {
  IdleEventInputSchema,
  StudentStarSummarySchema,
  type IdleEventInput,
  type StudentStarSummary
} from "../../shared/stars";
import { READING_PASS_SCORE } from "../learning/reading-judge";

export const OFFLINE_DB_NAME = "sua-learning-v1";
export const OFFLINE_DB_VERSION = 2;

export type DeviceState = "ready" | "auth-required" | "device-action-required";
export type QueueCounts = {
  activities: number;
  provisionalAttempts: number;
  rejected: number;
};

type QueueCountsListener = (counts: QueueCounts) => void;
type ConfirmedStarsListener = (summary: StudentStarSummary) => void;
type AuthorityStateListener = (state: DeviceState) => void;
type WithoutDeviceSequence<T> = T extends unknown
  ? Omit<T, "deviceSequence">
  : never;

export type PersistedActivity = {
  clientId: string;
  occurredAt: string;
  deviceSequence: number;
  planId: string;
  sourcePlanId: string | null;
  offlineEpoch: number;
  baseCursor: number;
  requiresRecovery: boolean;
  recoveryBlockedCode: "SOURCE_DEVICE_STILL_ACTIVE" | null;
  provisionalCompleted?: boolean;
  event: WithoutDeviceSequence<ActivityEvent>;
};

export type LegacyActivity =
  | { clientId: string; kind: "attempt"; payload: LegacyAttemptInput }
  | { clientId: string; kind: "idle"; payload: LegacyIdleEventInput };

export type RejectedActivity = {
  clientId: string;
  kind: "attempt" | "idle";
  code: string;
  studyDate: string;
  itemId: string;
  occurredAt: string | null;
  localLegacyRecord?: LegacyActivity;
};

export type PendingBatch = {
  clientBatchId: string;
  groupKey: string;
  planId: string;
  offlineEpoch: number;
  startCursor: number;
  orderedClientIds: string[];
  requestFingerprint: string;
};

export type OfflineLease = {
  offlineAccessUntil: string;
  user: CurrentUser & { role: "student" };
};

export type OfflineStudentSession = {
  user: CurrentUser & { role: "student" };
  plan: TodayPlan;
  stars: StudentStarSummary;
};

type AcknowledgedCursors = Record<string, number>;
type OfflineMeta =
  | { key: "offline-lease"; value: OfflineLease }
  | { key: "next-device-sequence"; value: number }
  | { key: "acknowledged-cursors"; value: AcknowledgedCursors }
  | { key: "device-state"; value: DeviceState }
  | { key: "confirmed-stars"; value: StudentStarSummary };

interface OfflineDatabase extends DBSchema {
  todayPlans: { key: string; value: TodayPlan };
  attemptQueue: { key: string; value: AttemptInput };
  idleEventQueue: { key: string; value: IdleEventInput };
  activityQueue: {
    key: string;
    value: PersistedActivity;
    indexes: {
      "by-plan-order": [string, number, string, number, string];
      "by-plan-cursor": [string, number];
    };
  };
  legacyActivities: { key: string; value: LegacyActivity };
  rejectedActivities: { key: string; value: RejectedActivity };
  pendingBatches: {
    key: string;
    value: PendingBatch;
    indexes: { "by-group": string };
  };
  meta: { key: OfflineMeta["key"]; value: OfflineMeta };
}

type OfflineTransaction = IDBPTransaction<OfflineDatabase, any, any>;

const queueCountsListeners = new Set<QueueCountsListener>();
const confirmedStarsListeners = new Set<ConfirmedStarsListener>();
const authorityStateListeners = new Set<AuthorityStateListener>();
let authorityWriteTail: Promise<void> = Promise.resolve();
let receiptAuthorityGeneration = 0;

async function serializeAuthorityWrite<T>(
  operation: () => Promise<T>
): Promise<T> {
  const previous = authorityWriteTail;
  let release!: () => void;
  authorityWriteTail = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await operation();
  } finally {
    release();
  }
}

export function getReceiptAuthorityGeneration(): number {
  return receiptAuthorityGeneration;
}

export class OfflineAuthorityError extends Error {
  constructor(readonly code: "AUTH_REQUIRED" | "DEVICE_ACTION_REQUIRED" | "PLAN_AUTHORITY_REQUIRED" | "RESERVATION_INVALID" | "CLIENT_ID_CONFLICT") {
    super(code);
    this.name = "OfflineAuthorityError";
  }
}

function sanitizeStars(summary: StudentStarSummary): StudentStarSummary {
  return StudentStarSummarySchema.parse(summary);
}

function sanitizePlan(plan: TodayPlan): TodayPlan {
  return TodayPlanSchema.parse(plan);
}

function legacyAttempt(
  input: AttemptInput
): Extract<LegacyActivity, { kind: "attempt" }> {
  return {
    clientId: input.clientAttemptId,
    kind: "attempt",
    payload: LegacyAttemptInputSchema.parse({
      clientAttemptId: input.clientAttemptId,
      itemId: input.itemId,
      contentVersion: input.contentVersion,
      studyDate: input.studyDate,
      readingScore: input.readingScore,
      missedTokens: input.missedTokens,
      mathAnswer: input.mathAnswer,
      durationMs: input.durationMs,
      difficultyFeedback: input.difficultyFeedback
    })
  };
}

function legacyIdle(
  input: IdleEventInput
): Extract<LegacyActivity, { kind: "idle" }> {
  return {
    clientId: input.clientIdleEventId,
    kind: "idle",
    payload: LegacyIdleEventInputSchema.parse({
      clientIdleEventId: input.clientIdleEventId,
      itemId: input.itemId,
      studyDate: input.studyDate,
      idleStartedAt: input.idleStartedAt,
      occurredAt: input.occurredAt
    })
  };
}

function installV1Stores(db: IDBPDatabase<OfflineDatabase>): void {
  db.createObjectStore("todayPlans", { keyPath: "date" });
  db.createObjectStore("attemptQueue", { keyPath: "clientAttemptId" });
  db.createObjectStore("idleEventQueue", { keyPath: "clientIdleEventId" });
  db.createObjectStore("meta", { keyPath: "key" });
}

function installV2Stores(db: IDBPDatabase<OfflineDatabase>): void {
  const activities = db.createObjectStore("activityQueue", { keyPath: "clientId" });
  activities.createIndex(
    "by-plan-order",
    ["planId", "offlineEpoch", "occurredAt", "deviceSequence", "clientId"]
  );
  activities.createIndex("by-plan-cursor", ["planId", "baseCursor"]);
  db.createObjectStore("legacyActivities", { keyPath: "clientId" });
  db.createObjectStore("rejectedActivities", { keyPath: "clientId" });
  const batches = db.createObjectStore("pendingBatches", {
    keyPath: "clientBatchId"
  });
  batches.createIndex("by-group", "groupKey", { unique: true });
}

function migrateV1(
  transaction: IDBPTransaction<OfflineDatabase, any, "versionchange">
): void {
  const attemptsStore = transaction.objectStore("attemptQueue");
  const idleStore = transaction.objectStore("idleEventQueue");
  const planStore = transaction.objectStore("todayPlans");
  const metaStore = transaction.objectStore("meta");
  const legacyStore = transaction.objectStore("legacyActivities");

  void Promise.all([
    attemptsStore.getAll(),
    idleStore.getAll(),
    planStore.getAll(),
    metaStore.getAll()
  ]).then(async ([attempts, idles, plans, meta]) => {
    const confirmed = meta.find((entry) => entry.key === "confirmed-stars");
    const state = meta.find((entry) => entry.key === "device-state");
    await Promise.all([
      attemptsStore.clear(),
      idleStore.clear(),
      planStore.clear(),
      metaStore.clear()
    ]);
    for (const input of attempts) {
      const parsed = AttemptInputSchema.safeParse(input);
      if (parsed.success) await legacyStore.put(legacyAttempt(parsed.data));
    }
    for (const input of idles) {
      const parsed = IdleEventInputSchema.safeParse(input);
      if (parsed.success) await legacyStore.put(legacyIdle(parsed.data));
    }
    for (const candidate of plans) {
      const parsed = TodayPlanSchema.safeParse(candidate);
      if (parsed.success && parsed.data.planKind === "daily") {
        await planStore.put(parsed.data);
      }
    }
    await metaStore.put({ key: "next-device-sequence", value: 0 });
    await metaStore.put({ key: "acknowledged-cursors", value: {} });
    await metaStore.put({
      key: "device-state",
      value: state?.key === "device-state" &&
        (state.value === "ready" || state.value === "auth-required" || state.value === "device-action-required")
        ? state.value
        : "auth-required"
    });
    if (confirmed?.key === "confirmed-stars") {
      const parsed = StudentStarSummarySchema.safeParse(confirmed.value);
      if (parsed.success) {
        await metaStore.put({ key: "confirmed-stars", value: parsed.data });
      }
    }
  });
}

async function withDatabase<T>(
  operation: (database: IDBPDatabase<OfflineDatabase>) => Promise<T>
): Promise<T> {
  const database = await openDB<OfflineDatabase>(
    OFFLINE_DB_NAME,
    OFFLINE_DB_VERSION,
    {
      upgrade(db, oldVersion, _newVersion, transaction) {
        if (oldVersion < 1) installV1Stores(db);
        if (oldVersion < 2) {
          installV2Stores(db);
          migrateV1(transaction);
        }
      }
    }
  );
  try {
    return await operation(database);
  } finally {
    database.close();
  }
}

async function deviceStateIn(transaction: OfflineTransaction): Promise<DeviceState> {
  const state = await transaction.objectStore("meta").get("device-state");
  return state?.key === "device-state" ? state.value : "auth-required";
}

async function requireReady(transaction: OfflineTransaction): Promise<void> {
  const state = await deviceStateIn(transaction);
  if (state === "auth-required") throw new OfflineAuthorityError("AUTH_REQUIRED");
  if (state === "device-action-required") {
    throw new OfflineAuthorityError("DEVICE_ACTION_REQUIRED");
  }
}

function activityOrder(left: PersistedActivity, right: PersistedActivity): number {
  return left.baseCursor - right.baseCursor ||
    Date.parse(left.occurredAt) - Date.parse(right.occurredAt) ||
    left.deviceSequence - right.deviceSequence ||
    left.clientId.localeCompare(right.clientId);
}

function eventClientId(event: ActivityEvent): string {
  return event.kind === "attempt"
    ? event.payload.clientAttemptId
    : event.payload.clientIdleEventId;
}

function wireEvent(row: PersistedActivity): ActivityEvent {
  return ActivityEventSchema.parse({
    ...row.event,
    deviceSequence: row.deviceSequence
  });
}

function batchEnvelope(batch: PendingBatch, rows: PersistedActivity[]): OfflineBatchInput {
  return {
    clientBatchId: batch.clientBatchId,
    planId: batch.planId,
    offlineEpoch: batch.offlineEpoch,
    startCursor: batch.startCursor,
    events: rows.map(wireEvent)
  };
}

function fingerprint(input: Omit<OfflineBatchInput, "clientBatchId">): string {
  const value = JSON.stringify(input);
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(value)) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0");
}

function newBatchId(): string {
  const random = typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `batch-${random}`;
}

function currentKstDate(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(now);
}

async function acknowledgedCursors(
  transaction: OfflineTransaction
): Promise<AcknowledgedCursors> {
  const record = await transaction.objectStore("meta").get("acknowledged-cursors");
  return record?.key === "acknowledged-cursors" ? record.value : {};
}

async function putAcknowledgedCursor(
  transaction: OfflineTransaction,
  planId: string,
  cursor: number
): Promise<void> {
  const existing = await acknowledgedCursors(transaction);
  await transaction.objectStore("meta").put!({
    key: "acknowledged-cursors",
    value: { ...existing, [planId]: Math.max(existing[planId] ?? 0, cursor) }
  });
}

async function findPlan(
  transaction: OfflineTransaction,
  planId: string
): Promise<TodayPlan> {
  const plans = await transaction.objectStore("todayPlans").getAll();
  const plan = plans.find((candidate) => candidate.planId === planId);
  if (plan === undefined) throw new OfflineAuthorityError("PLAN_AUTHORITY_REQUIRED");
  return plan;
}

type ProvisionalAttempt = Pick<
  AttemptInput,
  "itemId" | "contentVersion" | "readingScore" | "missedTokens" | "mathAnswer"
>;

function isLocallyCompleted(
  attempt: ProvisionalAttempt,
  plan: TodayPlan
): boolean {
  const item = plan.items.find((candidate) =>
    candidate.id === attempt.itemId &&
    candidate.version === attempt.contentVersion
  );
  if (
    item === undefined ||
    attempt.readingScore < READING_PASS_SCORE ||
    attempt.missedTokens.length > 0
  ) {
    return false;
  }
  return item.payload.kind !== "math-story" ||
    attempt.mathAnswer === item.payload.answer;
}

async function nextSequence(
  transaction: OfflineTransaction
): Promise<number> {
  const store = transaction.objectStore("meta");
  const record = await store.get("next-device-sequence");
  const sequence = record?.key === "next-device-sequence" ? record.value : 0;
  await store.put!({ key: "next-device-sequence", value: sequence + 1 });
  return sequence;
}

async function publishQueueCounts(): Promise<void> {
  if (queueCountsListeners.size === 0) return;
  let counts: QueueCounts;
  try {
    counts = await getQueueCounts();
  } catch {
    return;
  }
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

export function subscribeAuthorityState(
  listener: AuthorityStateListener
): () => void {
  authorityStateListeners.add(listener);
  return () => authorityStateListeners.delete(listener);
}

function publishAuthorityState(state: DeviceState): void {
  for (const listener of authorityStateListeners) listener(state);
}

export async function cacheIssuedPlan(
  input: TodayPlan,
  stars: StudentStarSummary = input.stars,
  options: { expectedReceiptGeneration?: number } = {}
): Promise<boolean> {
  const plan = sanitizePlan(input);
  if (plan.planKind !== "daily") return false;
  const confirmed = sanitizeStars(stars);
  const cached = await serializeAuthorityWrite(async () => {
    if (
      options.expectedReceiptGeneration !== undefined &&
      options.expectedReceiptGeneration !== receiptAuthorityGeneration
    ) {
      return false;
    }
    await withDatabase(async (database) => {
      const transaction = database.transaction(["todayPlans", "meta"], "readwrite");
      await requireReady(transaction);
      await transaction.objectStore("todayPlans").clear();
      await transaction.objectStore("todayPlans").put({ ...plan, stars: confirmed });
      await transaction.objectStore("meta").put({
        key: "confirmed-stars",
        value: confirmed
      });
      await putAcknowledgedCursor(transaction, plan.planId, plan.activityCursor);
      await transaction.done;
    });
    return true;
  });
  if (!cached) return false;
  for (const listener of confirmedStarsListeners) listener(confirmed);
  return true;
}

export const cacheTodayPlan = cacheIssuedPlan;

export function loadCachedTodayPlan(date: string): Promise<TodayPlan | undefined> {
  return withDatabase((database) => database.get("todayPlans", date));
}

export async function updateCachedPlanActivityCursor(
  planId: string,
  activityCursor: number
): Promise<void> {
  await withDatabase(async (database) => {
    const transaction = database.transaction(["todayPlans", "meta"], "readwrite");
    await requireReady(transaction);
    const plans = await transaction.objectStore("todayPlans").getAll();
    const matching = plans.find((candidate) => candidate.planId === planId);
    if (matching !== undefined) {
      await transaction.objectStore("todayPlans").put({
        ...matching,
        activityCursor: Math.max(matching.activityCursor, activityCursor)
      });
    }
    await putAcknowledgedCursor(transaction, planId, activityCursor);
    await transaction.done;
  });
}

export async function queueAttempt(input: AttemptInput): Promise<void> {
  const safe = AttemptInputSchema.parse(input);
  await withDatabase(async (database) => {
    const transaction = database.transaction(
      ["activityQueue", "todayPlans", "meta"],
      "readwrite"
    );
    await requireReady(transaction);
    const store = transaction.objectStore("activityQueue");
    const existing = await store.get(safe.clientAttemptId);
    if (existing !== undefined) {
      if (JSON.stringify(wireEvent(existing)) !== JSON.stringify({
        kind: "attempt",
        legacy: false,
        deviceSequence: existing.deviceSequence,
        payload: safe
      })) {
        throw new OfflineAuthorityError("CLIENT_ID_CONFLICT");
      }
      await transaction.done;
      return;
    }
    const plan = await findPlan(transaction, safe.planId);
    const item = plan.items.find((candidate) =>
      candidate.id === safe.itemId && candidate.version === safe.contentVersion
    );
    if (item === undefined || plan.date !== safe.studyDate) {
      throw new OfflineAuthorityError("PLAN_AUTHORITY_REQUIRED");
    }
    const cursors = await acknowledgedCursors(transaction);
    await store.put({
      clientId: safe.clientAttemptId,
      occurredAt: safe.occurredAt,
      deviceSequence: await nextSequence(transaction),
      planId: plan.planId,
      sourcePlanId: null,
      offlineEpoch: plan.offlineEpoch,
      baseCursor: cursors[plan.planId] ?? plan.activityCursor,
      requiresRecovery: false,
      recoveryBlockedCode: null,
      provisionalCompleted: isLocallyCompleted(safe, plan),
      event: { kind: "attempt", legacy: false, payload: safe }
    });
    await transaction.done;
  });
  await publishQueueCounts();
}

export async function queueIdleEvent(input: IdleEventInput): Promise<void> {
  const safe = IdleEventInputSchema.parse(input);
  const waiver = legacyIdle(safe);
  await withDatabase(async (database) => {
    const transaction = database.transaction(
      ["activityQueue", "todayPlans", "meta"],
      "readwrite"
    );
    await requireReady(transaction);
    const store = transaction.objectStore("activityQueue");
    const existing = await store.get(safe.clientIdleEventId);
    if (existing !== undefined) {
      if (JSON.stringify(existing.event) !== JSON.stringify({
        kind: "idle",
        legacy: true,
        payload: waiver.payload
      })) {
        throw new OfflineAuthorityError("CLIENT_ID_CONFLICT");
      }
      await transaction.done;
      return;
    }
    const plan = await findPlan(transaction, safe.planId);
    const item = plan.items.find((candidate) =>
      candidate.id === safe.itemId && candidate.version === safe.contentVersion
    );
    if (item === undefined || plan.date !== safe.studyDate) {
      throw new OfflineAuthorityError("PLAN_AUTHORITY_REQUIRED");
    }
    const cursors = await acknowledgedCursors(transaction);
    await store.put({
      clientId: safe.clientIdleEventId,
      occurredAt: safe.occurredAt,
      deviceSequence: await nextSequence(transaction),
      planId: plan.planId,
      sourcePlanId: null,
      offlineEpoch: plan.offlineEpoch,
      baseCursor: cursors[plan.planId] ?? plan.activityCursor,
      requiresRecovery: false,
      recoveryBlockedCode: null,
      provisionalCompleted: false,
      event: { kind: "idle", legacy: true, payload: waiver.payload }
    });
    await transaction.done;
  });
  await publishQueueCounts();
}

export function listActivities(): Promise<PersistedActivity[]> {
  return withDatabase(async (database) => {
    const transaction = database.transaction(["activityQueue", "meta"]);
    await requireReady(transaction);
    const rows = await transaction.objectStore("activityQueue").getAll();
    await transaction.done;
    return rows.sort(activityOrder);
  });
}

export function listLegacyActivities(): Promise<LegacyActivity[]> {
  return withDatabase(async (database) => {
    const transaction = database.transaction(["legacyActivities", "meta"]);
    await requireReady(transaction);
    const rows = await transaction.objectStore("legacyActivities").getAll();
    await transaction.done;
    return rows;
  });
}

export function listRejectedActivities(): Promise<RejectedActivity[]> {
  return withDatabase(async (database) => {
    const transaction = database.transaction(["rejectedActivities", "meta"]);
    await requireReady(transaction);
    const rows = await transaction.objectStore("rejectedActivities").getAll();
    await transaction.done;
    return rows;
  });
}

export function listGuardianOfflineRejections(): Promise<
  GuardianOfflineRejection[]
> {
  return withDatabase(async (database) => {
    const transaction = database.transaction([
      "rejectedActivities",
      "todayPlans"
    ]);
    const rows = await transaction.objectStore("rejectedActivities").getAll();
    const plans = await transaction.objectStore("todayPlans").getAll();
    await transaction.done;
    const titles = new Map(
      plans.flatMap((plan) => plan.items.map((item) => [
        item.id,
        item.payload.title
      ] as const))
    );
    return rows.map((row) => ({
      id: row.clientId,
      studyDate: row.studyDate,
      itemId: row.itemId,
      itemTitle: titles.get(row.itemId) ?? "학습 항목",
      kind: row.kind,
      code: row.code,
      createdAt: row.occurredAt ?? `${row.studyDate}T00:00:00+09:00`
    })).sort((left, right) =>
      right.createdAt.localeCompare(left.createdAt) ||
      right.id.localeCompare(left.id)
    );
  });
}

export function listPendingBatches(): Promise<PendingBatch[]> {
  return withDatabase(async (database) => {
    const transaction = database.transaction(["pendingBatches", "meta"]);
    await requireReady(transaction);
    const rows = await transaction.objectStore("pendingBatches").getAll();
    await transaction.done;
    return rows;
  });
}

export async function listQueuedAttempts(): Promise<AttemptInput[]> {
  const rows = await listActivities();
  return rows.flatMap((row) =>
    row.event.kind === "attempt" && row.event.legacy === false
      ? [row.event.payload]
      : []
  );
}

export async function listQueuedIdleEvents(): Promise<IdleEventInput[]> {
  await listActivities();
  return [];
}

async function removeActivity(clientId: string): Promise<void> {
  await withDatabase(async (database) => {
    const transaction = database.transaction(["activityQueue", "meta"], "readwrite");
    await requireReady(transaction);
    await transaction.objectStore("activityQueue").delete(clientId);
    await transaction.done;
  });
  await publishQueueCounts();
}

export const removeQueuedAttempt = removeActivity;
export const removeQueuedIdleEvent = removeActivity;

function locallyCompletedItemId(
  row: PersistedActivity,
  plans: TodayPlan[]
): string | null {
  if (row.event.kind !== "attempt") return null;
  const attempt = row.event.payload;
  if (row.provisionalCompleted !== undefined) {
    return row.provisionalCompleted ? attempt.itemId : null;
  }
  const plan = plans.find((candidate) =>
    candidate.planId === row.planId || candidate.planId === row.sourcePlanId
  );
  return plan !== undefined && isLocallyCompleted(attempt, plan)
    ? attempt.itemId
    : null;
}

export function getQueueCounts(): Promise<QueueCounts> {
  return withDatabase(async (database) => {
    const transaction = database.transaction(
      ["activityQueue", "rejectedActivities", "todayPlans", "meta"]
    );
    await requireReady(transaction);
    const activities = await transaction.objectStore("activityQueue").getAll();
    const plans = await transaction.objectStore("todayPlans").getAll();
    const rejected = await transaction.objectStore("rejectedActivities").count();
    await transaction.done;
    return {
      activities: activities.length,
      provisionalAttempts: activities.filter(
        (row) => locallyCompletedItemId(row, plans) !== null
      ).length,
      rejected
    };
  });
}

export async function getProvisionalItemIds(): Promise<string[]> {
  return withDatabase(async (database) => {
    const transaction = database.transaction(["activityQueue", "todayPlans", "meta"]);
    await requireReady(transaction);
    const rows = await transaction.objectStore("activityQueue").getAll();
    const plans = await transaction.objectStore("todayPlans").getAll();
    await transaction.done;
    const completed = rows.flatMap((row) => {
      const itemId = locallyCompletedItemId(row, plans);
      return itemId === null ? [] : [itemId];
    });
    return [...new Set(completed)];
  });
}

export function getDeviceState(): Promise<DeviceState> {
  return withDatabase(async (database) => {
    const transaction = database.transaction("meta");
    const state = await deviceStateIn(transaction);
    await transaction.done;
    return state;
  });
}

export async function markStudentAuthenticated(): Promise<void> {
  await withDatabase(async (database) => {
    await database.put("meta", { key: "device-state", value: "ready" });
  });
  publishAuthorityState("ready");
}

export async function storeOfflineLease(input: OfflineLease): Promise<void> {
  if (input.user.role !== "student") throw new OfflineAuthorityError("AUTH_REQUIRED");
  const lease: OfflineLease = {
    offlineAccessUntil: new Date(input.offlineAccessUntil).toISOString(),
    user: {
      id: input.user.id,
      role: "student",
      displayName: input.user.displayName
    }
  };
  await withDatabase(async (database) => {
    const transaction = database.transaction("meta", "readwrite");
    await requireReady(transaction);
    await transaction.store.put({ key: "offline-lease", value: lease });
    await transaction.done;
  });
}

export function loadOfflineStudentSession(
  now = new Date()
): Promise<OfflineStudentSession | undefined> {
  return withDatabase(async (database) => {
    const transaction = database.transaction(["todayPlans", "meta"]);
    if (await deviceStateIn(transaction) !== "ready") {
      await transaction.done;
      return undefined;
    }
    const lease = await transaction.objectStore("meta").get("offline-lease");
    const stars = await transaction.objectStore("meta").get("confirmed-stars");
    if (
      lease?.key !== "offline-lease" ||
      lease.value.user.role !== "student" ||
      Date.parse(lease.value.offlineAccessUntil) <= now.getTime() ||
      stars?.key !== "confirmed-stars"
    ) {
      await transaction.done;
      return undefined;
    }
    const date = currentKstDate(now);
    const plan = await transaction.objectStore("todayPlans").get(date);
    await transaction.done;
    if (plan === undefined || plan.planKind !== "daily" || plan.date !== date) {
      return undefined;
    }
    return { user: lease.value.user, plan, stars: stars.value };
  });
}

export async function clearOfflineAuthority(
  _reason: "auth-required"
): Promise<void> {
  await withDatabase(async (database) => {
    const transaction = database.transaction(["todayPlans", "meta"], "readwrite");
    await Promise.all([
      transaction.objectStore("todayPlans").clear(),
      transaction.objectStore("meta").delete("offline-lease"),
      transaction.objectStore("meta").delete("confirmed-stars"),
      transaction.objectStore("meta").put({
        key: "device-state",
        value: "auth-required"
      })
    ]);
    await transaction.done;
  });
  publishAuthorityState("auth-required");
}

export async function handleDeviceActionRequired(
  _code: "DEVICE_REVOKED" | "DEVICE_NOT_TRUSTED",
  options: { abortBeforeCommit?: boolean } = {}
): Promise<void> {
  await withDatabase(async (database) => {
    const transaction = database.transaction(
      ["todayPlans", "meta", "activityQueue", "pendingBatches"],
      "readwrite"
    );
    const activities = await transaction.objectStore("activityQueue").getAll();
    await Promise.all([
      transaction.objectStore("todayPlans").clear(),
      transaction.objectStore("meta").delete("offline-lease"),
      transaction.objectStore("meta").delete("confirmed-stars"),
      transaction.objectStore("meta").put({
        key: "device-state",
        value: "device-action-required"
      })
    ]);
    const affectedPlans = new Set<string>();
    for (const row of activities) {
      const sourcePlanId = row.sourcePlanId ?? row.planId;
      affectedPlans.add(row.planId);
      await transaction.objectStore("activityQueue").put({
        ...row,
        sourcePlanId,
        requiresRecovery: true,
        recoveryBlockedCode: null
      });
    }
    const pending = await transaction.objectStore("pendingBatches").getAll();
    for (const batch of pending) {
      if (affectedPlans.has(batch.planId)) {
        await transaction.objectStore("pendingBatches").delete(batch.clientBatchId);
      }
    }
    if (options.abortBeforeCommit) transaction.abort();
    await transaction.done;
  });
  publishAuthorityState("device-action-required");
}

export function setDeviceActionRequired(): Promise<void> {
  return handleDeviceActionRequired("DEVICE_REVOKED");
}

export async function applyAuthorityFailure(code: string): Promise<void> {
  if (code === "DEVICE_REVOKED" || code === "DEVICE_NOT_TRUSTED") {
    await handleDeviceActionRequired(code);
    return;
  }
  await clearOfflineAuthority("auth-required");
}

export function clearCurrentV1Authority(code: string): Promise<void> {
  return applyAuthorityFailure(code);
}

export async function storeConfirmedStars(summary: StudentStarSummary): Promise<void> {
  const confirmed = sanitizeStars(summary);
  await withDatabase(async (database) => {
    const transaction = database.transaction("meta", "readwrite");
    await requireReady(transaction);
    await transaction.store.put({ key: "confirmed-stars", value: confirmed });
    await transaction.done;
  });
  for (const listener of confirmedStarsListeners) listener(confirmed);
}

export function getConfirmedStars(): Promise<StudentStarSummary | undefined> {
  return withDatabase(async (database) => {
    const record = await database.get("meta", "confirmed-stars");
    return record?.key === "confirmed-stars" ? record.value : undefined;
  });
}

export function getAcknowledgedCursor(planId: string): Promise<number> {
  return withDatabase(async (database) => {
    const transaction = database.transaction("meta");
    await requireReady(transaction);
    const cursors = await acknowledgedCursors(transaction);
    await transaction.done;
    return cursors[planId] ?? 0;
  });
}

async function validateReservation(
  batch: PendingBatch,
  rows: PersistedActivity[]
): Promise<OfflineBatchInput> {
  if (
    rows.length !== batch.orderedClientIds.length ||
    rows.some((row, index) => row.clientId !== batch.orderedClientIds[index]) ||
    rows.some((row) =>
      row.planId !== batch.planId ||
      row.offlineEpoch !== batch.offlineEpoch ||
      row.baseCursor !== batch.startCursor ||
      row.requiresRecovery
    )
  ) {
    throw new OfflineAuthorityError("RESERVATION_INVALID");
  }
  const envelope = batchEnvelope(batch, rows);
  const actual = fingerprint({
    planId: envelope.planId,
    offlineEpoch: envelope.offlineEpoch,
    startCursor: envelope.startCursor,
    events: envelope.events
  });
  if (actual !== batch.requestFingerprint) {
    throw new OfflineAuthorityError("RESERVATION_INVALID");
  }
  return envelope;
}

export function reserveNextBatch(): Promise<OfflineBatchInput | undefined> {
  return withDatabase(async (database) => {
    const transaction = database.transaction(
      ["activityQueue", "pendingBatches", "meta"],
      "readwrite"
    );
    await requireReady(transaction);
    const activityStore = transaction.objectStore("activityQueue");
    const batchStore = transaction.objectStore("pendingBatches");
    const allRows = (await activityStore.getAll()).sort(activityOrder);
    const pending = await batchStore.getAll();
    if (pending.length > 0) {
      const candidates = pending.map((batch) => ({
        batch,
        rows: batch.orderedClientIds.map((id) => allRows.find((row) => row.clientId === id))
      }));
      candidates.sort((left, right) => {
        const leftRow = left.rows[0];
        const rightRow = right.rows[0];
        if (leftRow === undefined) return -1;
        if (rightRow === undefined) return 1;
        return activityOrder(leftRow, rightRow);
      });
      const selected = candidates[0]!;
      if (selected.rows.some((row) => row === undefined)) {
        throw new OfflineAuthorityError("RESERVATION_INVALID");
      }
      const envelope = await validateReservation(
        selected.batch,
        selected.rows as PersistedActivity[]
      );
      await transaction.done;
      return envelope;
    }
    const first = allRows.find((row) => !row.requiresRecovery);
    if (first === undefined) {
      await transaction.done;
      return undefined;
    }
    const rows = allRows.filter((row) =>
      !row.requiresRecovery &&
      row.planId === first.planId &&
      row.offlineEpoch === first.offlineEpoch &&
      row.baseCursor === first.baseCursor
    ).slice(0, 100);
    const clientBatchId = newBatchId();
    const groupKey = JSON.stringify([
      first.planId,
      first.offlineEpoch,
      first.baseCursor
    ]);
    const envelope: OfflineBatchInput = {
      clientBatchId,
      planId: first.planId,
      offlineEpoch: first.offlineEpoch,
      startCursor: first.baseCursor,
      events: rows.map(wireEvent)
    };
    const requestFingerprint = fingerprint({
      planId: envelope.planId,
      offlineEpoch: envelope.offlineEpoch,
      startCursor: envelope.startCursor,
      events: envelope.events
    });
    await batchStore.put({
      clientBatchId,
      groupKey,
      planId: envelope.planId,
      offlineEpoch: envelope.offlineEpoch,
      startCursor: envelope.startCursor,
      orderedClientIds: rows.map((row) => row.clientId),
      requestFingerprint
    });
    await transaction.done;
    return envelope;
  });
}

function redactedRejection(
  row: PersistedActivity,
  code: string
): RejectedActivity {
  return {
    clientId: row.clientId,
    kind: row.event.kind,
    code,
    studyDate: row.event.payload.studyDate,
    itemId: row.event.payload.itemId,
    occurredAt: row.occurredAt
  };
}

export async function applyBatchReceipt(
  input: OfflineBatchReceipt,
  options: { abortBeforeCommit?: boolean } = {}
): Promise<void> {
  const receipt = input;
  await serializeAuthorityWrite(async () => {
    await withDatabase(async (database) => {
      const transaction = database.transaction(
        ["activityQueue", "rejectedActivities", "pendingBatches", "todayPlans", "meta"],
        "readwrite"
      );
      await requireReady(transaction);
      const batchStore = transaction.objectStore("pendingBatches");
      const batch = await batchStore.get(receipt.clientBatchId);
      if (batch === undefined) throw new OfflineAuthorityError("RESERVATION_INVALID");
      const expected = new Set(batch.orderedClientIds);
      const received = new Set(receipt.receipts.map((entry) => entry.clientId));
      if (
        received.size !== expected.size ||
        [...received].some((id) => !expected.has(id))
      ) {
        throw new OfflineAuthorityError("RESERVATION_INVALID");
      }
      for (const eventReceipt of receipt.receipts) {
        const row = await transaction.objectStore("activityQueue").get(eventReceipt.clientId);
        if (row === undefined) throw new OfflineAuthorityError("RESERVATION_INVALID");
        if (eventReceipt.kind !== row.event.kind) {
          throw new OfflineAuthorityError("RESERVATION_INVALID");
        }
        if (eventReceipt.status === "REJECTED") {
          await transaction.objectStore("rejectedActivities").put(
            redactedRejection(row, eventReceipt.code ?? "REJECTED")
          );
        }
        await transaction.objectStore("activityQueue").delete(row.clientId);
      }
      await batchStore.delete(batch.clientBatchId);
      await putAcknowledgedCursor(
        transaction,
        batch.planId,
        receipt.activityCursor
      );
      const current = sanitizePlan(receipt.currentDailyPlan);
      if (current.planKind === "daily" && current.date === currentKstDate()) {
        await transaction.objectStore("todayPlans").clear();
        await transaction.objectStore("todayPlans").put({
          ...current,
          stars: sanitizeStars(receipt.stars)
        });
      }
      const confirmed = sanitizeStars(receipt.stars);
      await transaction.objectStore("meta").put({
        key: "confirmed-stars",
        value: confirmed
      });
      if (options.abortBeforeCommit) transaction.abort();
      await transaction.done;
    });
    receiptAuthorityGeneration += 1;
  });
  await publishQueueCounts();
  const confirmed = sanitizeStars(receipt.stars);
  for (const listener of confirmedStarsListeners) listener(confirmed);
}

export async function rejectPendingBatch(
  clientBatchId: string,
  code: string
): Promise<void> {
  await withDatabase(async (database) => {
    const transaction = database.transaction(
      ["activityQueue", "rejectedActivities", "pendingBatches", "meta"],
      "readwrite"
    );
    await requireReady(transaction);
    const batch = await transaction.objectStore("pendingBatches").get(clientBatchId);
    if (batch === undefined) {
      await transaction.done;
      return;
    }
    for (const id of batch.orderedClientIds) {
      const row = await transaction.objectStore("activityQueue").get(id);
      if (row !== undefined) {
        await transaction.objectStore("rejectedActivities").put(
          redactedRejection(row, code)
        );
        await transaction.objectStore("activityQueue").delete(id);
      }
    }
    await transaction.objectStore("pendingBatches").delete(clientBatchId);
    await transaction.done;
  });
  await publishQueueCounts();
}

export async function recoveryGroups(): Promise<Array<{
  sourcePlanId: string;
  recoveryBlockedCode: "SOURCE_DEVICE_STILL_ACTIVE" | null;
}>> {
  const rows = await listActivities();
  const groups = new Map<string, "SOURCE_DEVICE_STILL_ACTIVE" | null>();
  for (const row of rows) {
    if (!row.requiresRecovery || row.sourcePlanId === null) continue;
    groups.set(
      row.sourcePlanId,
      row.recoveryBlockedCode === "SOURCE_DEVICE_STILL_ACTIVE"
        ? row.recoveryBlockedCode
        : groups.get(row.sourcePlanId) ?? null
    );
  }
  return [...groups].map(([sourcePlanId, recoveryBlockedCode]) => ({
    sourcePlanId,
    recoveryBlockedCode
  }));
}

export async function setRecoveryBlocked(sourcePlanId: string): Promise<void> {
  await withDatabase(async (database) => {
    const transaction = database.transaction(["activityQueue", "meta"], "readwrite");
    await requireReady(transaction);
    const rows = await transaction.objectStore("activityQueue").getAll();
    for (const row of rows) {
      if (row.requiresRecovery && row.sourcePlanId === sourcePlanId) {
        await transaction.objectStore("activityQueue").put({
          ...row,
          recoveryBlockedCode: "SOURCE_DEVICE_STILL_ACTIVE"
        });
      }
    }
    await transaction.done;
  });
}

export async function rebindRecoveryGroup(
  sourcePlanId: string,
  input: TodayPlan,
  options: { abortBeforeCommit?: boolean } = {}
): Promise<void> {
  const recovery = sanitizePlan(input);
  if (
    recovery.planKind !== "recovery" ||
    recovery.recoverySourcePlanId !== sourcePlanId
  ) {
    throw new OfflineAuthorityError("PLAN_AUTHORITY_REQUIRED");
  }
  await withDatabase(async (database) => {
    const transaction = database.transaction(
      ["activityQueue", "pendingBatches", "meta"],
      "readwrite"
    );
    await requireReady(transaction);
    const rows = await transaction.objectStore("activityQueue").getAll();
    for (const row of rows) {
      if (!row.requiresRecovery || row.sourcePlanId !== sourcePlanId) continue;
      const event = row.event.kind === "attempt" && row.event.legacy === false
        ? {
            ...row.event,
            payload: { ...row.event.payload, planId: recovery.planId }
          }
        : row.event;
      await transaction.objectStore("activityQueue").put({
        ...row,
        planId: recovery.planId,
        offlineEpoch: recovery.offlineEpoch,
        baseCursor: recovery.activityCursor,
        requiresRecovery: false,
        recoveryBlockedCode: null,
        event
      });
    }
    const batches = await transaction.objectStore("pendingBatches").getAll();
    for (const batch of batches) {
      if (batch.planId === sourcePlanId) {
        await transaction.objectStore("pendingBatches").delete(batch.clientBatchId);
      }
    }
    await putAcknowledgedCursor(
      transaction,
      recovery.planId,
      recovery.activityCursor
    );
    if (options.abortBeforeCommit) transaction.abort();
    await transaction.done;
  });
}

export async function rejectRecoveryGroup(
  sourcePlanId: string,
  code: string
): Promise<void> {
  await withDatabase(async (database) => {
    const transaction = database.transaction(
      ["activityQueue", "rejectedActivities", "pendingBatches", "meta"],
      "readwrite"
    );
    await requireReady(transaction);
    const rows = await transaction.objectStore("activityQueue").getAll();
    for (const row of rows) {
      if (row.sourcePlanId === sourcePlanId) {
        await transaction.objectStore("rejectedActivities").put(
          redactedRejection(row, code)
        );
        await transaction.objectStore("activityQueue").delete(row.clientId);
      }
    }
    const batches = await transaction.objectStore("pendingBatches").getAll();
    for (const batch of batches) {
      if (batch.planId === sourcePlanId) {
        await transaction.objectStore("pendingBatches").delete(batch.clientBatchId);
      }
    }
    await transaction.done;
  });
  await publishQueueCounts();
}

export async function reconcileLegacyActivities(
  input: TodayPlan,
  receivedAt = new Date().toISOString(),
  options: { expectedReceiptGeneration?: number } = {}
): Promise<boolean> {
  const plan = sanitizePlan(input);
  if (plan.planKind !== "daily") return false;
  const reconciled = await serializeAuthorityWrite(async () => {
    if (
      options.expectedReceiptGeneration !== undefined &&
      options.expectedReceiptGeneration !== receiptAuthorityGeneration
    ) {
      return false;
    }
    await withDatabase(async (database) => {
      const transaction = database.transaction(
        ["legacyActivities", "activityQueue", "rejectedActivities", "meta"],
        "readwrite"
      );
      await requireReady(transaction);
      const legacy = await transaction.objectStore("legacyActivities").getAll();
      const cursors = await acknowledgedCursors(transaction);
      let sequenceRecord = await transaction.objectStore("meta").get("next-device-sequence");
      let sequence = sequenceRecord?.key === "next-device-sequence"
        ? sequenceRecord.value
        : 0;
      for (const record of legacy) {
        const matches = plan.items.filter((item) =>
          item.id === record.payload.itemId &&
          (record.kind === "idle" || item.version === record.payload.contentVersion)
        );
        if (record.payload.studyDate !== plan.date || matches.length !== 1) {
          await transaction.objectStore("rejectedActivities").put({
            clientId: record.clientId,
            kind: record.kind,
            code: "LEGACY_AUTHORITY_UNAVAILABLE",
            studyDate: record.payload.studyDate,
            itemId: record.payload.itemId,
            occurredAt: record.kind === "idle" ? record.payload.occurredAt : null,
            localLegacyRecord: record
          });
        } else {
          const occurredAt = record.kind === "attempt"
            ? receivedAt
            : record.payload.occurredAt;
          await transaction.objectStore("activityQueue").put({
            clientId: record.clientId,
            occurredAt,
            deviceSequence: sequence++,
            planId: plan.planId,
            sourcePlanId: null,
            offlineEpoch: plan.offlineEpoch,
            baseCursor: cursors[plan.planId] ?? plan.activityCursor,
            requiresRecovery: false,
            recoveryBlockedCode: null,
            provisionalCompleted: record.kind === "attempt"
              ? isLocallyCompleted(record.payload, plan)
              : false,
            event: record.kind === "attempt"
              ? { kind: "attempt", legacy: true, payload: record.payload }
              : { kind: "idle", legacy: true, payload: record.payload }
          });
        }
        await transaction.objectStore("legacyActivities").delete(record.clientId);
      }
      await transaction.objectStore("meta").put({
        key: "next-device-sequence",
        value: sequence
      });
      await transaction.done;
    });
    return true;
  });
  if (reconciled) await publishQueueCounts();
  return reconciled;
}
