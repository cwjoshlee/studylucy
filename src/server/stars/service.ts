import type Database from "better-sqlite3";
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
import { isValidStudyDate, kstStudyDate } from "./kst";
import { DailyPlanService } from "./daily-plan";
import { StarRepository } from "./repository";
import { getStudentStarSummary } from "./student-summary";

type IdleEventRow = {
  id: string;
  outcome: IdleEventResult["outcome"];
  starEventId: string | null;
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

  constructor(private deps: StarServiceDeps) {
    this.stars = new StarRepository(deps.db);
    this.dailyPlan = new DailyPlanService(deps.db, deps.now);
  }

  findIdleResult(
    studentId: string,
    clientIdleEventId: string
  ): IdleEventResult | null {
    const row = this.deps.db.prepare(`
      SELECT id, outcome, star_event_id AS starEventId
      FROM idle_events
      WHERE student_id = ? AND id = ?
    `).get(studentId, clientIdleEventId) as IdleEventRow | undefined;
    return row === undefined ? null : { ...row, duplicate: true };
  }

  recordIdleEvent(
    studentId: string,
    input: IdleEventInput
  ): IdleEventResult {
    return this.deps.db.transaction((): IdleEventResult => {
      const existing = this.findIdleResult(studentId, input.clientIdleEventId);
      if (existing !== null) {
        return existing;
      }

      const idleStartedAt = new Date(input.idleStartedAt);
      const occurredAt = new Date(input.occurredAt);
      const elapsed = occurredAt.getTime() - idleStartedAt.getTime();
      if (
        elapsed < 300_000 ||
        occurredAt.getTime() > this.deps.now().getTime() + 300_000 ||
        input.studyDate !== kstStudyDate(occurredAt)
      ) {
        throw new StarServiceError(400, "INVALID_REQUEST");
      }
      const availableItem = this.deps.db.prepare(`
        SELECT 1 FROM content_items WHERE id = ? AND status = 'published'
      `).get(input.itemId);
      if (availableItem === undefined) {
        throw new StarServiceError(400, "INVALID_REQUEST");
      }

      const counted = this.deps.db.prepare(`
        SELECT COUNT(*) AS count
        FROM idle_events
        WHERE student_id = ? AND study_date = ?
          AND outcome IN ('applied', 'no-balance')
      `).get(studentId, input.studyDate) as { count: number };
      const createdAt = this.deps.now().toISOString();
      if (counted.count >= 2) {
        this.insertIdleEvent(studentId, input, "capped", null, createdAt);
        return {
          id: input.clientIdleEventId,
          outcome: "capped",
          starEventId: null,
          duplicate: false
        };
      }

      const applied = this.stars.apply({
        studentId,
        delta: -1,
        reason: "IDLE_TIMEOUT",
        reasonText: "5분 동안 쉬고 있었어요. 별 1개를 잠시 돌려놓았어요.",
        studyDate: input.studyDate,
        itemId: input.itemId,
        idleEventId: input.clientIdleEventId,
        actorType: "system",
        sourceKey: `idle:${studentId}:${input.clientIdleEventId}`,
        createdAt
      });
      const outcome: IdleEventResult["outcome"] =
        applied.event.reason === "NO_BALANCE_AUDIT"
        ? "no-balance"
        : "applied";
      this.insertIdleEvent(
        studentId,
        input,
        outcome,
        applied.event.id,
        createdAt
      );
      return {
        id: input.clientIdleEventId,
        outcome,
        starEventId: applied.event.id,
        duplicate: false
      };
    }).immediate();
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
    input: IdleEventInput,
    outcome: IdleEventResult["outcome"],
    starEventId: string | null,
    createdAt: string
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
      input.learningSessionId,
      input.idleStartedAt,
      input.occurredAt,
      outcome,
      starEventId,
      createdAt
    );
  }
}
