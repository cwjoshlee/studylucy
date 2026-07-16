import type Database from "better-sqlite3";
import type { LegacyIdleEventInput } from "../../shared/learning";
import { kstDayBounds } from "../../shared/study-date";
import type {
  ApprovalInput,
  DailyPlanInput,
  GuardianDailyPlan,
  GuardianStarEvent,
  GuardianStarLedger,
  IdleEventInput,
  IdleEventResult,
  ManualStarInput,
  PendingStarAdjustment,
  ProcessedStarAdjustment,
  AppliedStarResult,
  StarEvent,
  StudentStarSummary
} from "../../shared/stars";
import { StarReasonSchema } from "../../shared/stars";
import { IssuedPlanError } from "../learning/issued-plan-repository";
import type { IssuedPlanSnapshot } from "../learning/issued-plan-repository";
import {
  LearningSessionError,
  LearningSessionRepository
} from "../learning/session-repository";
import { isValidStudyDate, kstStudyDate } from "./kst";
import { DailyPlanService } from "./daily-plan";
import { StarRepository } from "./repository";
import { getStudentStarSummary } from "./student-summary";

type IdleEventRow = {
  id: string;
  outcome: IdleEventResult["outcome"];
  starEventId: string | null;
  learningSessionId: string;
  planId: string;
  trustedDeviceId: string;
  itemId: string;
  contentVersion: number;
  studyDate: string;
  idleStartedAt: string;
  occurredAt: string;
  revokedAt: string | null;
};

export type RecordIdleEventOptions = {
  advanceCursor?: boolean;
  orderConflict?: boolean;
  legacy?: boolean;
  legacyPlan?: IssuedPlanSnapshot;
  receivedAt?: Date;
};

type PendingAdjustmentRow = PendingStarAdjustment & {
  studentId: string;
};

type GuardianStarEventRow = Omit<GuardianStarEvent, "reason" | "isReversed"> & {
  reason: string;
  isReversed: 0 | 1;
};

export type GuardianLedgerQuery = {
  limit: number;
  cursor: string | null;
  from: string | null;
  to: string | null;
  direction: "all" | "earned" | "deducted";
  reason: string | null;
};

export class StarServiceError extends Error {
  constructor(
    readonly statusCode: 400 | 404 | 409,
    readonly code: string
  ) {
    super(code);
  }
}

export type StarServiceDeps = {
  db: Database.Database;
  now: () => Date;
};

export class StarService {
  private stars: StarRepository;
  private dailyPlan: DailyPlanService;
  private learningSessions: LearningSessionRepository;

  constructor(private deps: StarServiceDeps) {
    this.stars = new StarRepository(deps.db);
    this.dailyPlan = new DailyPlanService(deps.db, deps.now);
    this.learningSessions = new LearningSessionRepository(deps.db);
  }

  findIdleResult(
    studentId: string,
    trustedDeviceId: string,
    input: IdleEventInput
  ): IdleEventResult | null {
    const row = this.deps.db.prepare(`
      SELECT ie.id, ie.outcome, ie.star_event_id AS starEventId,
             ie.learning_session_id AS learningSessionId,
             ils.plan_id AS planId,
             ils.trusted_device_id AS trustedDeviceId,
             ie.item_id AS itemId,
             ils.content_version AS contentVersion,
             ie.study_date AS studyDate,
             ie.idle_started_at AS idleStartedAt,
             ie.occurred_at AS occurredAt,
             ils.revoked_at AS revokedAt
      FROM idle_events AS ie
      JOIN issued_learning_sessions AS ils
        ON ils.id = ie.learning_session_id
      WHERE ie.student_id = ? AND ie.id = ?
    `).get(studentId, input.clientIdleEventId) as IdleEventRow | undefined;
    if (row === undefined) return null;
    if (row.revokedAt !== null) {
      throw new StarServiceError(409, "LEARNING_SESSION_INVALID");
    }
    if (
      row.trustedDeviceId !== trustedDeviceId ||
      row.learningSessionId !== input.learningSessionId ||
      row.planId !== input.planId ||
      row.itemId !== input.itemId ||
      row.contentVersion !== input.contentVersion ||
      row.studyDate !== input.studyDate ||
      row.idleStartedAt !== input.idleStartedAt ||
      row.occurredAt !== input.occurredAt
    ) {
      throw new StarServiceError(400, "INVALID_REQUEST");
    }
    return {
      id: row.id,
      outcome: row.outcome,
      starEventId: row.starEventId,
      duplicate: true,
      activityCursor: this.getActivityCursor(studentId)
    };
  }

  recordIdleEvent(
    studentId: string,
    trustedDeviceId: string,
    input: IdleEventInput
  ): IdleEventResult {
    return this.deps.db.transaction(() => this.recordIdleEventInTransaction(
      studentId,
      trustedDeviceId,
      input
    )).immediate();
  }

  recordIdleEventInTransaction(
    studentId: string,
    trustedDeviceId: string,
    input: IdleEventInput | LegacyIdleEventInput,
    options: RecordIdleEventOptions = {}
  ): IdleEventResult {
    const existing = options.legacy === true
      ? this.findLegacyIdleResult(studentId, input as LegacyIdleEventInput)
      : this.findIdleResult(
          studentId,
          trustedDeviceId,
          input as IdleEventInput
        );
    if (existing !== null) return existing;

    const receivedAt = options.receivedAt ?? this.deps.now();
    if (options.legacy === true) {
      this.validateLegacyIdle(
        input as LegacyIdleEventInput,
        options.legacyPlan,
        receivedAt
      );
    } else {
      try {
        this.learningSessions.validateIdle(
          studentId,
          trustedDeviceId,
          input as IdleEventInput,
          receivedAt
        );
      } catch (error) {
        if (error instanceof IssuedPlanError || error instanceof LearningSessionError) {
          throw new StarServiceError(
            error.code === "INVALID_REQUEST" ? 400 : 409,
            error.code
          );
        }
        throw error;
      }
    }

    const canonicalInput = input as IdleEventInput | LegacyIdleEventInput;
    const counted = this.deps.db.prepare(`
      SELECT COUNT(*) AS count
      FROM idle_events
      WHERE student_id = ? AND study_date = ?
        AND outcome IN ('applied', 'no-balance')
    `).get(studentId, canonicalInput.studyDate) as { count: number };
    const createdAt = receivedAt.toISOString();
    let outcome: IdleEventResult["outcome"];
    let starEventId: string | null;
    const waiver = options.orderConflict === true || options.legacy === true;
    if (waiver) {
      const audited = this.stars.appendNoBalanceAuditInTransaction({
        studentId,
        reasonText: "오프라인 순서 충돌로 차감하지 않았어요",
        studyDate: canonicalInput.studyDate,
        itemId: canonicalInput.itemId,
        idleEventId: canonicalInput.clientIdleEventId,
        sourceKey: `idle:${studentId}:${canonicalInput.clientIdleEventId}`,
        createdAt
      });
      outcome = "order-conflict-waived";
      starEventId = audited.event.id;
    } else if (counted.count >= 2) {
      outcome = "capped";
      starEventId = null;
    } else if (this.stars.currentBalance(studentId) === 0) {
      const audited = this.stars.appendNoBalanceAuditInTransaction({
        studentId,
        reasonText: "5분 동안 쉬고 있었어요. 별 1개를 잠시 돌려놓았어요.",
        studyDate: canonicalInput.studyDate,
        itemId: canonicalInput.itemId,
        idleEventId: canonicalInput.clientIdleEventId,
        sourceKey: `idle:${studentId}:${canonicalInput.clientIdleEventId}`,
        createdAt
      });
      outcome = "no-balance";
      starEventId = audited.event.id;
    } else {
      const applied = this.stars.applyInTransaction({
        studentId,
        delta: -1,
        reason: "IDLE_TIMEOUT",
        reasonText: "5분 동안 쉬고 있었어요. 별 1개를 잠시 돌려놓았어요.",
        studyDate: canonicalInput.studyDate,
        itemId: canonicalInput.itemId,
        idleEventId: canonicalInput.clientIdleEventId,
        actorType: "system",
        sourceKey: `idle:${studentId}:${canonicalInput.clientIdleEventId}`,
        createdAt
      });
      outcome = applied.event.reason === "NO_BALANCE_AUDIT"
        ? "no-balance"
        : "applied";
      starEventId = applied.event.id;
    }
    this.insertIdleEvent(
      studentId,
      canonicalInput,
      outcome,
      starEventId,
      createdAt,
      options.legacy === true
    );
    if (options.advanceCursor !== false) {
      const updated = this.deps.db.prepare(`
        UPDATE student_activity_cursors
        SET current_cursor = current_cursor + 1, updated_at = ?
        WHERE student_id = ?
      `).run(createdAt, studentId);
      if (updated.changes !== 1) {
        throw new Error("STUDENT_ACTIVITY_CURSOR_MISSING");
      }
    }
    return {
      id: canonicalInput.clientIdleEventId,
      outcome,
      starEventId,
      duplicate: false,
      activityCursor: this.getActivityCursor(studentId)
    };
  }

  listAdjustments(limit: number): PendingStarAdjustment[] {
    const studentId = this.getStudentId();
    return (this.deps.db.prepare(`
      SELECT id, student_id AS studentId, study_date AS studyDate,
             item_id AS itemId, requested_stars AS requestedStars,
             approved_stars AS approvedStars, applied_stars AS appliedStars,
             status, note, star_event_id AS starEventId,
             created_at AS createdAt, processed_at AS processedAt
      FROM pending_star_adjustments
      WHERE student_id = ?
      ORDER BY study_date DESC, created_at DESC, rowid DESC
      LIMIT ?
    `).all(studentId, limit) as PendingAdjustmentRow[])
      .map(({ studentId: _studentId, ...row }) => row);
  }

  getStudentStars(studentId: string): StudentStarSummary {
    return getStudentStarSummary(
      this.deps.db,
      studentId,
      kstStudyDate(this.deps.now())
    );
  }

  getGuardianStars(query: GuardianLedgerQuery): GuardianStarLedger {
    if (
      (query.from !== null && !isValidStudyDate(query.from))
      || (query.to !== null && !isValidStudyDate(query.to))
      || (query.from !== null && query.to !== null && query.from > query.to)
    ) {
      throw new StarServiceError(400, "INVALID_REQUEST");
    }
    const studentId = this.getStudentId();
    if (query.cursor !== null && this.deps.db.prepare(`
      SELECT 1 FROM star_events WHERE id = ? AND student_id = ?
    `).get(query.cursor, studentId) === undefined) {
      throw new StarServiceError(400, "INVALID_REQUEST");
    }
    const rows = this.deps.db.prepare(`
      SELECT se.id, se.requested_delta AS requestedDelta, se.delta,
             se.balance_after AS balanceAfter, se.reason_code AS reason,
             se.reason_text AS reasonText, se.study_date AS studyDate,
             se.item_id AS itemId, se.actor_type AS actorType,
             se.created_at AS createdAt,
             se.reverses_event_id AS reversesEventId,
             EXISTS (
               SELECT 1 FROM star_events AS reversal
               WHERE reversal.reverses_event_id = se.id
             ) AS isReversed
      FROM star_events AS se
      WHERE se.student_id = ?
        AND (? IS NULL OR se.study_date >= ?)
        AND (? IS NULL OR se.study_date <= ?)
        AND (
          ? = 'all'
          OR (? = 'earned' AND requested_delta > 0)
          OR (? = 'deducted' AND requested_delta < 0)
        )
        AND (? IS NULL OR se.reason_code = ?)
        AND (? IS NULL OR se.rowid < (
          SELECT rowid FROM star_events WHERE id = ? AND student_id = ?
        ))
      ORDER BY se.rowid DESC
      LIMIT ?
    `).all(
      studentId,
      query.from,
      query.from,
      query.to,
      query.to,
      query.direction,
      query.direction,
      query.direction,
      query.reason,
      query.reason,
      query.cursor,
      query.cursor,
      studentId,
      query.limit + 1
    ) as GuardianStarEventRow[];
    const hasNext = rows.length > query.limit;
    const page = rows.slice(0, query.limit);
    return {
      summary: this.getStudentStars(studentId),
      events: page.map((row) => ({
        ...row,
        reason: StarReasonSchema.parse(row.reason),
        isReversed: row.isReversed === 1
      })),
      nextCursor: hasNext ? page.at(-1)!.id : null
    };
  }

  approveAdjustment(
    adjustmentId: string,
    guardianId: string,
    input: ApprovalInput
  ): ProcessedStarAdjustment {
    return this.deps.db.transaction(() => {
      const row = this.getAdjustment(adjustmentId);
      if (row.status === "approved") {
        return this.processedAdjustment(row, true);
      }
      if (row.status !== "pending") {
        throw new StarServiceError(409, "ADJUSTMENT_ALREADY_PROCESSED");
      }
      if (input.approvedStars > row.requestedStars) {
        throw new StarServiceError(400, "INVALID_REQUEST");
      }
      const processedAt = this.deps.now().toISOString();
      let appliedStars = 0;
      let starEventId: string | null = null;
      if (input.approvedStars > 0) {
        const applied = this.stars.apply({
          studentId: row.studentId,
          delta: -input.approvedStars,
          reason: "MISSED_DAILY_PLAN",
          reasonText: `미완료 학습을 확인하고 별 ${input.approvedStars}개를 조정했어요.`,
          studyDate: row.studyDate,
          itemId: row.itemId,
          pendingAdjustmentId: row.id,
          actorType: "guardian",
          actorUserId: guardianId,
          sourceKey: `pending:${row.id}`,
          createdAt: processedAt
        });
        appliedStars = -applied.event.delta;
        starEventId = applied.event.id;
      }
      this.deps.db.prepare(`
        UPDATE pending_star_adjustments
        SET approved_stars = ?, applied_stars = ?, status = 'approved',
            processed_by = ?, note = ?, star_event_id = ?, processed_at = ?
        WHERE id = ? AND status = 'pending'
      `).run(
        input.approvedStars,
        appliedStars,
        guardianId,
        input.note,
        starEventId,
        processedAt,
        row.id
      );
      return this.processedAdjustment({
        ...row,
        approvedStars: input.approvedStars,
        appliedStars,
        status: "approved",
        note: input.note,
        starEventId,
        processedAt
      }, false);
    }).immediate();
  }

  waiveAdjustment(
    adjustmentId: string,
    guardianId: string,
    note: string
  ): ProcessedStarAdjustment {
    return this.deps.db.transaction(() => {
      const row = this.getAdjustment(adjustmentId);
      if (row.status === "waived") {
        return this.processedAdjustment(row, true);
      }
      if (row.status !== "pending") {
        throw new StarServiceError(409, "ADJUSTMENT_ALREADY_PROCESSED");
      }
      const processedAt = this.deps.now().toISOString();
      this.deps.db.prepare(`
        UPDATE pending_star_adjustments
        SET approved_stars = 0, applied_stars = 0, status = 'waived',
            processed_by = ?, note = ?, processed_at = ?
        WHERE id = ? AND status = 'pending'
      `).run(guardianId, note, processedAt, row.id);
      return this.processedAdjustment({
        ...row,
        approvedStars: 0,
        appliedStars: 0,
        status: "waived",
        note,
        processedAt
      }, false);
    }).immediate();
  }

  findManualAdjustment(
    guardianId: string,
    clientCommandId: string
  ): AppliedStarResult | null {
    const event = this.stars.findBySource(
      `guardian:${guardianId}:${clientCommandId}`
    );
    return event === null ? null : { event, duplicate: true };
  }

  applyManualAdjustment(
    guardianId: string,
    input: ManualStarInput
  ): AppliedStarResult {
    return this.stars.apply({
      studentId: this.getStudentId(),
      delta: input.delta,
      reason: input.delta > 0 ? "GUARDIAN_BONUS" : "GUARDIAN_ADJUSTMENT",
      reasonText: input.reason,
      studyDate: kstStudyDate(this.deps.now()),
      actorType: "guardian",
      actorUserId: guardianId,
      sourceKey: `guardian:${guardianId}:${input.clientCommandId}`,
      createdAt: this.deps.now().toISOString()
    });
  }

  reverseEvent(
    eventId: string,
    guardianId: string,
    note: string
  ): AppliedStarResult {
    try {
      return this.stars.reverse(eventId, guardianId, note, this.deps.now());
    } catch (error) {
      if (error instanceof Error && error.message === "EVENT_NOT_FOUND") {
        throw new StarServiceError(404, "EVENT_NOT_FOUND");
      }
      if (error instanceof Error && error.message === "EVENT_ALREADY_REVERSED") {
        throw new StarServiceError(409, "EVENT_ALREADY_REVERSED");
      }
      throw error;
    }
  }

  getGuardianPlan(studyDate: string): GuardianDailyPlan {
    this.requireValidStudyDate(studyDate);
    return this.dailyPlan.getGuardianPlan(this.getStudentId(), studyDate);
  }

  updateGuardianPlan(
    studyDate: string,
    input: DailyPlanInput,
    guardianId: string
  ): GuardianDailyPlan {
    this.requireValidStudyDate(studyDate);
    try {
      return this.dailyPlan.updateGuardianPlan(
        this.getStudentId(),
        studyDate,
        input,
        guardianId
      );
    } catch (error) {
      if (error instanceof Error && error.message === "PLAN_LOCKED") {
        throw new StarServiceError(409, "PLAN_LOCKED");
      }
      throw error;
    }
  }

  private getStudentId(): string {
    const student = this.deps.db.prepare(`
      SELECT id FROM users WHERE role = 'student' ORDER BY created_at LIMIT 1
    `).get() as { id: string } | undefined;
    if (student === undefined) {
      throw new StarServiceError(404, "STUDENT_NOT_FOUND");
    }
    return student.id;
  }

  private requireValidStudyDate(studyDate: string): void {
    if (!isValidStudyDate(studyDate)) {
      throw new StarServiceError(400, "INVALID_REQUEST");
    }
  }

  private getAdjustment(id: string): PendingAdjustmentRow {
    const row = this.deps.db.prepare(`
      SELECT id, student_id AS studentId, study_date AS studyDate,
             item_id AS itemId, requested_stars AS requestedStars,
             approved_stars AS approvedStars, applied_stars AS appliedStars,
             status, note, star_event_id AS starEventId,
             created_at AS createdAt, processed_at AS processedAt
      FROM pending_star_adjustments WHERE id = ?
    `).get(id) as PendingAdjustmentRow | undefined;
    if (row === undefined) {
      throw new StarServiceError(404, "ADJUSTMENT_NOT_FOUND");
    }
    return row;
  }

  private processedAdjustment(
    row: PendingAdjustmentRow,
    duplicate: boolean
  ): ProcessedStarAdjustment {
    const { studentId: _studentId, ...adjustment } = row;
    return { ...adjustment, duplicate };
  }

  private insertIdleEvent(
    studentId: string,
    input: IdleEventInput | LegacyIdleEventInput,
    outcome: IdleEventResult["outcome"],
    starEventId: string | null,
    createdAt: string,
    legacy = false
  ): void {
    this.deps.db.prepare(`
      INSERT INTO idle_events (
        id, student_id, study_date, item_id, learning_session_id,
        idle_started_at, occurred_at, outcome, star_event_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.clientIdleEventId,
      studentId,
      input.studyDate,
      input.itemId,
      legacy ? null : (input as IdleEventInput).learningSessionId,
      input.idleStartedAt,
      input.occurredAt,
      outcome,
      starEventId,
      createdAt
    );
  }

  private findLegacyIdleResult(
    studentId: string,
    input: LegacyIdleEventInput
  ): IdleEventResult | null {
    const row = this.deps.db.prepare(`
      SELECT id, item_id AS itemId, study_date AS studyDate,
             idle_started_at AS idleStartedAt, occurred_at AS occurredAt,
             outcome, star_event_id AS starEventId
      FROM idle_events
      WHERE student_id = ? AND id = ? AND learning_session_id IS NULL
    `).get(studentId, input.clientIdleEventId) as (Pick<
      IdleEventRow,
      "id" | "itemId" | "studyDate" | "idleStartedAt" | "occurredAt" |
      "outcome" | "starEventId"
    >) | undefined;
    if (row === undefined) return null;
    if (
      row.itemId !== input.itemId ||
      row.studyDate !== input.studyDate ||
      row.idleStartedAt !== input.idleStartedAt ||
      row.occurredAt !== input.occurredAt ||
      row.outcome !== "order-conflict-waived"
    ) {
      throw new StarServiceError(400, "INVALID_REQUEST");
    }
    return {
      id: row.id,
      outcome: row.outcome,
      starEventId: row.starEventId,
      duplicate: true,
      activityCursor: this.getActivityCursor(studentId)
    };
  }

  private validateLegacyIdle(
    input: LegacyIdleEventInput,
    plan: IssuedPlanSnapshot | undefined,
    receivedAt: Date
  ): void {
    if (
      plan === undefined ||
      plan.studyDate !== input.studyDate ||
      !plan.items.some((item) => item.id === input.itemId)
    ) {
      throw new StarServiceError(409, "PLAN_NOT_ISSUED");
    }
    const idleStartedAt = Date.parse(input.idleStartedAt);
    const occurredAt = Date.parse(input.occurredAt);
    const bounds = kstDayBounds(plan.studyDate);
    if (
      !Number.isFinite(idleStartedAt) ||
      !Number.isFinite(occurredAt) ||
      occurredAt < idleStartedAt ||
      occurredAt - idleStartedAt < 5 * 60 * 1_000 ||
      idleStartedAt < Date.parse(bounds.start) ||
      occurredAt >= Date.parse(bounds.end) ||
      occurredAt > receivedAt.getTime() + 5 * 60 * 1_000
    ) {
      throw new StarServiceError(400, "INVALID_REQUEST");
    }
  }

  private getActivityCursor(studentId: string): number {
    const row = this.deps.db.prepare(`
      SELECT current_cursor AS currentCursor
      FROM student_activity_cursors
      WHERE student_id = ?
    `).get(studentId) as { currentCursor: number } | undefined;
    if (row === undefined) {
      throw new Error("STUDENT_ACTIVITY_CURSOR_MISSING");
    }
    return row.currentCursor;
  }
}
