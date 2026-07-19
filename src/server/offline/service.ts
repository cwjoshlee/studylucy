import type Database from "better-sqlite3";
import { createHash, randomUUID } from "node:crypto";
import type { AppConfig } from "../config";
import { GuardianOfflineRejectionsSchema } from "../../shared/learning";
import type {
  ActivityEvent,
  ActivityReceipt,
  AttemptInput,
  GuardianOfflineRejections,
  LegacyIdleEventInput,
  OfflineBatchInput,
  OfflineBatchReceipt,
  TodayPlan
} from "../../shared/learning";
import type { IdleEventInput } from "../../shared/stars";
import { getStudentStarSummary } from "../stars/student-summary";
import {
  AttemptIdempotencyError,
  LearningRepository
} from "../learning/repository";
import {
  IssuedPlanError,
  IssuedPlanRepository,
  type IssuedPlanAuthority,
  type IssuedPlanSnapshot
} from "../learning/issued-plan-repository";
import { StarService, StarServiceError } from "../stars/service";
import {
  OfflineRepository,
  immutableBatchFacts,
  type InsertActivityInput,
  type StoredBatchFacts
} from "./repository";

export class OfflineBatchError extends Error {
  constructor(
    readonly statusCode: 400 | 403 | 409,
    readonly code: string
  ) {
    super(code);
  }
}

export type OfflineBatchServiceDeps = {
  db: Database.Database;
  now: () => Date;
  config: Pick<AppConfig, "sessionPepper">;
};

type CanonicalEvent = {
  wire: ActivityEvent;
  clientId: string;
  occurredAt: string;
  eventFingerprint: string;
  payloadPlanMismatch: boolean;
  originalIndex: number;
};

type PendingActivityReceipt = Omit<InsertActivityInput,
  "studentId" | "clientBatchId" | "createdAt"
>;

function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function clientIdOf(event: ActivityEvent): string {
  return event.kind === "attempt"
    ? event.payload.clientAttemptId
    : event.payload.clientIdleEventId;
}

function occurredAtOf(event: ActivityEvent, receivedAt: string): string {
  return event.kind === "attempt" && event.legacy
    ? receivedAt
    : event.payload.occurredAt;
}

function itemIdOf(event: ActivityEvent): string {
  return event.payload.itemId;
}

function duplicateActivityReceipt(receipt: ActivityReceipt): ActivityReceipt {
  return {
    ...receipt,
    status: "DUPLICATE",
    attempt: receipt.attempt === null
      ? null
      : { ...receipt.attempt, duplicate: true },
    idle: receipt.idle === null
      ? null
      : { ...receipt.idle, duplicate: true }
  };
}

export class OfflineBatchService {
  private offline: OfflineRepository;
  private issuedPlans: IssuedPlanRepository;
  private learning: LearningRepository;
  private stars: StarService;

  constructor(private deps: OfflineBatchServiceDeps) {
    this.offline = new OfflineRepository(deps.db);
    this.issuedPlans = new IssuedPlanRepository(deps.db, deps.now);
    this.learning = new LearningRepository(
      deps.db,
      deps.config.sessionPepper
    );
    this.stars = new StarService(deps);
  }

  listGuardianRejections(limit: number): GuardianOfflineRejections {
    const student = this.deps.db.prepare(`
      SELECT id FROM users WHERE role = 'student' ORDER BY created_at, id LIMIT 1
    `).get() as { id: string } | undefined;
    return GuardianOfflineRejectionsSchema.parse({
      rejections: student === undefined
        ? []
        : this.offline.listRejectedActivities(student.id, limit)
    });
  }

  createRecoveryPlan(
    studentId: string,
    trustedDeviceId: string,
    sourcePlanId: string
  ): TodayPlan {
    try {
      const snapshot = this.issuedPlans.issueRecovery(
        studentId,
        trustedDeviceId,
        sourcePlanId
      );
      return this.planView(studentId, snapshot);
    } catch (error) {
      if (error instanceof IssuedPlanError) {
        throw new OfflineBatchError(
          error.code === "INVALID_REQUEST" ? 400 : 409,
          error.code
        );
      }
      throw error;
    }
  }

  apply(
    studentId: string,
    trustedDeviceId: string,
    input: OfflineBatchInput
  ): OfflineBatchReceipt {
    if (input.events.some((event) =>
      event.kind === "attempt" && event.payload.dictationText !== undefined
    )) {
      throw new OfflineBatchError(400, "DICTATION_ONLINE_ONLY");
    }
    return this.deps.db.transaction(() => {
      const requestReceivedAt = this.deps.now();
      try {
        this.offline.assertActiveDevice(trustedDeviceId);
      } catch (error) {
        if (error instanceof Error && error.message === "ACTIVE_DEVICE_REQUIRED") {
          throw new OfflineBatchError(403, "DEVICE_REVOKED");
        }
        throw error;
      }

      const currentDaily = this.issuedPlans.findCurrentDaily(
        studentId,
        trustedDeviceId,
        requestReceivedAt
      );
      if (currentDaily === null) {
        throw new OfflineBatchError(409, "CURRENT_DAILY_PLAN_REQUIRED");
      }

      const storedBatch = this.offline.findBatch(
        studentId,
        input.clientBatchId
      );
      const canonicalReceivedAt = storedBatch?.canonicalReceivedAt ??
        requestReceivedAt.toISOString();
      const canonicalEvents = this.canonicalEvents(
        input,
        canonicalReceivedAt
      );
      const requestFingerprint = fingerprint({
        planId: input.planId,
        offlineEpoch: input.offlineEpoch,
        startCursor: input.startCursor,
        events: canonicalEvents.map((event) => event.wire)
      });

      if (storedBatch !== null) {
        if (storedBatch.requestFingerprint !== requestFingerprint) {
          throw new OfflineBatchError(409, "BATCH_ID_CONFLICT");
        }
        const freshDaily = this.issuedPlans.findCurrentDaily(
          studentId,
          trustedDeviceId,
          requestReceivedAt
        );
        if (freshDaily === null) {
          throw new OfflineBatchError(409, "CURRENT_DAILY_PLAN_REQUIRED");
        }
        const activityCursor = this.offline.getCursor(studentId);
        const currentDailyPlan = this.planView(studentId, freshDaily);
        return {
          clientBatchId: input.clientBatchId,
          duplicate: true,
          orderConflict: storedBatch.facts.orderConflict,
          batchEndCursor: storedBatch.facts.batchEndCursor,
          activityCursor,
          receipts: storedBatch.facts.receipts,
          processedPlan: storedBatch.facts.processedPlan,
          currentDailyPlan,
          stars: currentDailyPlan.stars
        };
      }

      const authority = this.validateBatchAuthority(
        studentId,
        trustedDeviceId,
        input
      );
      const initialCursor = this.offline.getCursor(studentId);
      if (input.startCursor > initialCursor) {
        throw new OfflineBatchError(400, "INVALID_REQUEST");
      }
      const orderConflict =
        input.startCursor !== initialCursor ||
        authority.snapshot.planKind === "recovery";
      const receivedAt = new Date(canonicalReceivedAt);
      const expired = receivedAt.getTime() >
        Date.parse(authority.snapshot.submitUntil);
      const receipts: ActivityReceipt[] = [];
      const pendingActivities: PendingActivityReceipt[] = [];
      const issuedItemVersions = new Map(
        authority.snapshot.items.map((item) => [item.id, item.version])
      );
      const batchActivities = new Map<string, {
        eventFingerprint: string;
        receipt: ActivityReceipt;
      }>();
      let currentCursor = initialCursor;

      for (const event of canonicalEvents) {
        const earlierInBatch = batchActivities.get(event.clientId);
        if (earlierInBatch !== undefined) {
          if (earlierInBatch.eventFingerprint !== event.eventFingerprint) {
            throw new OfflineBatchError(400, "INVALID_REQUEST");
          }
          receipts.push(duplicateActivityReceipt(earlierInBatch.receipt));
          continue;
        }
        const existing = this.offline.findActivity(studentId, event.clientId);
        if (existing !== null) {
          if (existing.eventFingerprint !== event.eventFingerprint) {
            throw new OfflineBatchError(400, "INVALID_REQUEST");
          }
          receipts.push(duplicateActivityReceipt(existing.receipt));
          continue;
        }

        let receipt: ActivityReceipt;
        if (expired) {
          currentCursor += 1;
          receipt = this.rejectedReceipt(
            event,
            "PLAN_SUBMISSION_EXPIRED"
          );
        } else if (event.payloadPlanMismatch) {
          currentCursor += 1;
          receipt = this.rejectedReceipt(event, "PLAN_NOT_ISSUED");
        } else {
          receipt = this.applyEvent({
            studentId,
            trustedDeviceId,
            authority: authority.snapshot,
            event,
            receivedAt,
            orderConflict,
            currentCursor
          });
          const duplicate = receipt.status === "DUPLICATE";
          if (!duplicate) currentCursor += 1;
          if (receipt.attempt !== null) {
            receipt.attempt.activityCursor = currentCursor;
          }
          if (receipt.idle !== null) {
            receipt.idle.activityCursor = currentCursor;
          }
        }
        receipts.push(receipt);
        const clientItemId = itemIdOf(event.wire);
        const clientContentVersion = "contentVersion" in event.wire.payload
          ? event.wire.payload.contentVersion
          : null;
        const issuedContentVersion = issuedItemVersions.get(clientItemId);
        pendingActivities.push({
          clientEventId: event.clientId,
          eventFingerprint: event.eventFingerprint,
          studyDate: authority.snapshot.studyDate,
          itemId:
            issuedContentVersion !== undefined &&
            (
              clientContentVersion === null ||
              clientContentVersion === issuedContentVersion
            )
              ? clientItemId
              : null,
          kind: event.wire.kind,
          receipt
        });
        batchActivities.set(event.clientId, {
          eventFingerprint: event.eventFingerprint,
          receipt
        });
      }

      if (currentCursor !== initialCursor) {
        this.offline.setCursor(studentId, currentCursor, canonicalReceivedAt);
      }
      const processedPlan = this.planView(studentId, authority.snapshot);
      const refreshedDaily = this.issuedPlans.findCurrentDaily(
        studentId,
        trustedDeviceId,
        requestReceivedAt
      );
      if (refreshedDaily === null) {
        throw new Error("CURRENT_DAILY_PLAN_DISAPPEARED");
      }
      const currentDailyPlan = this.planView(studentId, refreshedDaily);
      const facts = immutableBatchFacts({
        orderConflict,
        batchEndCursor: currentCursor,
        receipts,
        processedPlan
      });
      this.persistBatch({
        studentId,
        trustedDeviceId,
        input,
        authority,
        requestFingerprint,
        currentCursor,
        expired,
        facts,
        pendingActivities,
        createdAt: canonicalReceivedAt
      });
      return {
        clientBatchId: input.clientBatchId,
        duplicate: false,
        orderConflict,
        batchEndCursor: currentCursor,
        activityCursor: currentCursor,
        receipts,
        processedPlan,
        currentDailyPlan,
        stars: currentDailyPlan.stars
      };
    }).immediate();
  }

  private canonicalEvents(
    input: OfflineBatchInput,
    canonicalReceivedAt: string
  ): CanonicalEvent[] {
    return input.events
      .map((wire, originalIndex) => {
        const clientId = clientIdOf(wire);
        return {
          wire,
          clientId,
          occurredAt: occurredAtOf(wire, canonicalReceivedAt),
          eventFingerprint: fingerprint(wire),
          payloadPlanMismatch: !wire.legacy && wire.payload.planId !== input.planId,
          originalIndex
        };
      })
      .sort((left, right) =>
        Date.parse(left.occurredAt) - Date.parse(right.occurredAt) ||
        left.wire.deviceSequence - right.wire.deviceSequence ||
        left.clientId.localeCompare(right.clientId) ||
        left.originalIndex - right.originalIndex
      );
  }

  private validateBatchAuthority(
    studentId: string,
    trustedDeviceId: string,
    input: OfflineBatchInput
  ): IssuedPlanAuthority {
    const authority = this.issuedPlans.findPlanAuthority(
      studentId,
      input.planId
    );
    if (
      authority === null ||
      authority.trustedDeviceId !== trustedDeviceId
    ) {
      throw new OfflineBatchError(409, "PLAN_NOT_ISSUED");
    }
    if (authority.snapshot.offlineEpoch !== input.offlineEpoch) {
      throw new OfflineBatchError(409, "INVALID_REQUEST");
    }
    return authority;
  }

  private applyEvent(input: {
    studentId: string;
    trustedDeviceId: string;
    authority: IssuedPlanSnapshot;
    event: CanonicalEvent;
    receivedAt: Date;
    orderConflict: boolean;
    currentCursor: number;
  }): ActivityReceipt {
    try {
      if (input.event.wire.kind === "attempt") {
        const attemptInput: AttemptInput = input.event.wire.legacy
          ? {
              ...input.event.wire.payload,
              planId: input.authority.id,
              occurredAt: input.event.occurredAt
            }
          : input.event.wire.payload;
        const snapshot = this.issuedPlans.validateAttempt(
          input.studentId,
          input.trustedDeviceId,
          attemptInput,
          input.receivedAt
        );
        const saved = this.learning.saveAttemptInTransaction({
          ...attemptInput,
          id: randomUUID(),
          userId: input.studentId,
          trustedDeviceId: input.trustedDeviceId,
          createdAt: input.receivedAt.toISOString(),
          snapshot
        });
        return {
          clientId: input.event.clientId,
          kind: "attempt",
          status: saved.inserted ? "APPLIED" : "DUPLICATE",
          code: null,
          attempt: {
            ...saved.receipt,
            activityCursor: input.currentCursor
          },
          idle: null
        };
      }

      const idle = this.stars.recordIdleEventInTransaction(
        input.studentId,
        input.trustedDeviceId,
        input.event.wire.payload as IdleEventInput | LegacyIdleEventInput,
        {
          advanceCursor: false,
          orderConflict: input.orderConflict,
          legacy: input.event.wire.legacy,
          legacyPlan: input.authority,
          receivedAt: input.receivedAt
        }
      );
      return {
        clientId: input.event.clientId,
        kind: "idle",
        status: idle.duplicate
          ? "DUPLICATE"
          : idle.outcome === "order-conflict-waived"
            ? "ORDER_CONFLICT_WAIVED"
            : "APPLIED",
        code: null,
        attempt: null,
        idle
      };
    } catch (error) {
      const code = this.businessErrorCode(error);
      if (code === null) throw error;
      return this.rejectedReceipt(input.event, code);
    }
  }

  private businessErrorCode(error: unknown): string | null {
    if (error instanceof IssuedPlanError) return error.code;
    if (error instanceof AttemptIdempotencyError) return error.code;
    if (error instanceof StarServiceError) return error.code;
    return null;
  }

  private rejectedReceipt(
    event: CanonicalEvent,
    code: string
  ): ActivityReceipt {
    return {
      clientId: event.clientId,
      kind: event.wire.kind,
      status: "REJECTED",
      code,
      attempt: null,
      idle: null
    };
  }

  private persistBatch(input: {
    studentId: string;
    trustedDeviceId: string;
    input: OfflineBatchInput;
    authority: IssuedPlanAuthority;
    requestFingerprint: string;
    currentCursor: number;
    expired: boolean;
    facts: StoredBatchFacts;
    pendingActivities: PendingActivityReceipt[];
    createdAt: string;
  }): void {
    this.offline.insertBatch({
      studentId: input.studentId,
      clientBatchId: input.input.clientBatchId,
      requestFingerprint: input.requestFingerprint,
      originalDeviceId: input.authority.originalDeviceId,
      submittingDeviceId: input.trustedDeviceId,
      planId: input.input.planId,
      offlineEpoch: input.input.offlineEpoch,
      startCursor: input.input.startCursor,
      endCursor: input.currentCursor,
      outcome: input.expired
        ? "expired"
        : input.facts.orderConflict
          ? "order-conflict"
          : "applied",
      facts: input.facts,
      createdAt: input.createdAt
    });
    for (const activity of input.pendingActivities) {
      this.offline.insertActivity({
        ...activity,
        studentId: input.studentId,
        clientBatchId: input.input.clientBatchId,
        createdAt: input.createdAt
      });
    }
  }

  private planView(
    studentId: string,
    snapshot: IssuedPlanSnapshot
  ): TodayPlan {
    return {
      planId: snapshot.id,
      planKind: snapshot.planKind,
      recoverySourcePlanId: snapshot.recoverySourcePlanId,
      date: snapshot.studyDate,
      submitUntil: snapshot.submitUntil,
      offlineEpoch: snapshot.offlineEpoch,
      activityCursor: this.offline.getCursor(studentId),
      studentDisplayName: snapshot.studentDisplayName,
      completedItemIds: this.learning.listCompletedItemIds(
        studentId,
        snapshot.id
      ),
      requiredItemIds: snapshot.items
        .filter((item) => item.isRequired)
        .map((item) => item.id),
      stars: getStudentStarSummary(
        this.deps.db,
        studentId,
        snapshot.studyDate
      ),
      items: snapshot.items.map(({ id, version, step, payload }) => ({
        id,
        version,
        step,
        payload
      }))
    };
  }
}
