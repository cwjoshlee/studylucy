import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import {
  LearningItemPayloadSchema,
  type AttemptInput,
  type LearningStep,
  type LearningItemPayload
} from "../../shared/learning";
import { kstDayBounds, kstStudyDate } from "../../shared/study-date";
import { DailyPlanService } from "../stars/daily-plan";

export type IssuedPlanErrorCode =
  | "PLAN_NOT_ISSUED"
  | "PLAN_SUBMISSION_EXPIRED"
  | "CONTENT_VERSION_CONFLICT"
  | "STEP_LOCKED"
  | "SOURCE_DEVICE_STILL_ACTIVE"
  | "INVALID_REQUEST";

export class IssuedPlanError extends Error {
  constructor(readonly code: IssuedPlanErrorCode) {
    super(code);
  }
}

export type IssuedPlanItemSnapshot = {
  id: string;
  version: number;
  step: LearningStep;
  payload: LearningItemPayload;
  isRequired: boolean;
  sortOrder: number;
};

export type IssuedPlanSnapshot = {
  id: string;
  planKind: "daily" | "recovery";
  recoverySourcePlanId: string | null;
  studyDate: string;
  submitUntil: string;
  offlineEpoch: number;
  startCursor: number;
  activityCursor: number;
  studentDisplayName: string;
  items: IssuedPlanItemSnapshot[];
};

export type ValidatedAttemptSnapshot = {
  issuedPlanId: string;
  studyDate: string;
  contentVersion: number;
  payload: LearningItemPayload;
  isRequired: boolean;
  step: LearningStep;
};

type CursorRow = {
  nextEpoch: number;
  currentCursor: number;
};

type PlanRow = {
  id: string;
  planKind: "daily" | "recovery";
  recoverySourcePlanId: string | null;
  studyDate: string;
  submitUntil: string;
  offlineEpoch: number;
  startCursor: number;
};

type PlanAuthorityRow = PlanRow & {
  trustedDeviceId: string;
  originalDeviceId: string;
};

type IssuedStepAuthorityRow = {
  itemId: string;
  step: LearningStep;
  payloadJson: string;
  completed: number;
};

const STEP_RANK: Record<LearningStep, number> = {
  foundation: 0,
  current: 1,
  challenge: 2
};

export function assertIssuedStepUnlocked(
  db: Database.Database,
  studentId: string,
  planId: string,
  itemId: string
): void {
  const rows = db.prepare(`
    SELECT ipi.item_id AS itemId, ipi.step,
           cv.payload_json AS payloadJson,
           EXISTS (
             SELECT 1
             FROM attempts AS a
             JOIN issued_daily_plans AS completed_plan
               ON completed_plan.id = a.issued_plan_id
              AND completed_plan.student_id = a.user_id
              AND completed_plan.study_date = a.study_date
             JOIN issued_plan_items AS completed_item
               ON completed_item.plan_id = completed_plan.id
              AND completed_item.item_id = a.item_id
              AND completed_item.content_version = a.content_version
             WHERE a.user_id = ?
               AND a.study_date = requested.study_date
               AND a.item_id = ipi.item_id
               AND a.content_version = ipi.content_version
               AND a.completed = 1
           ) AS completed
    FROM issued_plan_items AS ipi
    JOIN issued_daily_plans AS requested ON requested.id = ipi.plan_id
    JOIN content_versions AS cv
      ON cv.item_id = ipi.item_id
     AND cv.version = ipi.content_version
    WHERE ipi.plan_id = ?
    ORDER BY CASE ipi.step
      WHEN 'foundation' THEN 0
      WHEN 'current' THEN 1
      WHEN 'challenge' THEN 2
    END, ipi.sort_order, ipi.item_id
  `).all(studentId, planId) as IssuedStepAuthorityRow[];
  const target = rows.find((row) => row.itemId === itemId);
  if (target === undefined) {
    throw new IssuedPlanError("PLAN_NOT_ISSUED");
  }
  const targetSubject = LearningItemPayloadSchema.parse(
    JSON.parse(target.payloadJson)
  ).subject;
  const blocked = rows.some((row) =>
    STEP_RANK[row.step] < STEP_RANK[target.step] &&
    LearningItemPayloadSchema.parse(JSON.parse(row.payloadJson)).subject ===
      targetSubject &&
    row.completed !== 1
  );
  if (blocked) throw new IssuedPlanError("STEP_LOCKED");
}

export type IssuedPlanAuthority = {
  snapshot: IssuedPlanSnapshot;
  trustedDeviceId: string;
  originalDeviceId: string;
};

export class IssuedPlanRepository {
  private dailyPlan: DailyPlanService;

  constructor(
    private db: Database.Database,
    private now: () => Date
  ) {
    this.dailyPlan = new DailyPlanService(db, now);
  }

  issueToday(studentId: string, trustedDeviceId: string): IssuedPlanSnapshot {
    return this.db.transaction(() => {
      const issuedAt = this.now();
      const issuedAtIso = issuedAt.toISOString();
      const studyDate = kstStudyDate(issuedAt);
      this.db.prepare(`
        INSERT INTO student_activity_cursors (
          student_id, next_epoch, current_cursor, updated_at
        ) VALUES (?, 1, 0, ?)
        ON CONFLICT(student_id) DO NOTHING
      `).run(studentId, issuedAtIso);

      let plan = this.findDailyPlan(studentId, trustedDeviceId, studyDate);
      if (plan === null) {
        const required = this.dailyPlan.ensureInTransaction(studentId, studyDate);
        const deliveredItems = this.listRequiredItems(studentId, studyDate);
        const cursor = this.getCursor(studentId);
        const submitUntil = new Date(
          Date.parse(kstDayBounds(studyDate).end) + 86_400_000 - 1
        ).toISOString();
        const planId = randomUUID();
        this.db.prepare(`
          INSERT INTO issued_daily_plans (
            id, student_id, trusted_device_id, plan_kind,
            recovery_source_plan_id, study_date, issued_at, submit_until,
            offline_epoch, start_cursor
          ) VALUES (?, ?, ?, 'daily', NULL, ?, ?, ?, ?, ?)
        `).run(
          planId,
          studentId,
          trustedDeviceId,
          studyDate,
          issuedAtIso,
          submitUntil,
          cursor.nextEpoch,
          cursor.currentCursor
        );
        const requiredIds = new Set(required.requiredItemIds);
        const insertItem = this.db.prepare(`
          INSERT INTO issued_plan_items (
            plan_id, item_id, content_version, is_required, sort_order, step
          ) VALUES (?, ?, ?, ?, ?, ?)
        `);
        deliveredItems.forEach((item, sortOrder) => {
          insertItem.run(
            planId,
            item.id,
            item.version,
            requiredIds.has(item.id) ? 1 : 0,
            sortOrder,
            item.step
          );
        });
        this.db.prepare(`
          UPDATE student_activity_cursors
          SET next_epoch = next_epoch + 1, updated_at = ?
          WHERE student_id = ?
        `).run(issuedAtIso, studentId);
        plan = this.findDailyPlan(studentId, trustedDeviceId, studyDate);
      }
      if (plan === null) {
        throw new Error("ISSUED_DAILY_PLAN_MISSING");
      }
      return this.readSnapshot(studentId, plan);
    }).immediate();
  }

  findCurrentDaily(
    studentId: string,
    trustedDeviceId: string,
    at: Date = this.now()
  ): IssuedPlanSnapshot | null {
    const plan = this.findDailyPlan(
      studentId,
      trustedDeviceId,
      kstStudyDate(at)
    );
    return plan === null ? null : this.readSnapshot(studentId, plan);
  }

  findPlanAuthority(
    studentId: string,
    planId: string
  ): IssuedPlanAuthority | null {
    const row = this.db.prepare(`
      SELECT p.id, p.plan_kind AS planKind,
             p.recovery_source_plan_id AS recoverySourcePlanId,
             p.study_date AS studyDate, p.submit_until AS submitUntil,
             p.offline_epoch AS offlineEpoch, p.start_cursor AS startCursor,
             p.trusted_device_id AS trustedDeviceId,
             COALESCE(source.trusted_device_id, p.trusted_device_id)
               AS originalDeviceId
      FROM issued_daily_plans AS p
      LEFT JOIN issued_daily_plans AS source
        ON source.id = p.recovery_source_plan_id
      WHERE p.id = ? AND p.student_id = ?
    `).get(planId, studentId) as PlanAuthorityRow | undefined;
    if (row === undefined) return null;
    return {
      snapshot: this.readSnapshot(studentId, row),
      trustedDeviceId: row.trustedDeviceId,
      originalDeviceId: row.originalDeviceId
    };
  }

  issueRecovery(
    studentId: string,
    trustedDeviceId: string,
    sourcePlanId: string
  ): IssuedPlanSnapshot {
    return this.db.transaction(() => {
      const now = this.now();
      const nowIso = now.toISOString();
      const activeDevice = this.db.prepare(`
        SELECT 1 FROM trusted_devices
        WHERE id = ? AND revoked_at IS NULL
      `).get(trustedDeviceId);
      if (activeDevice === undefined) {
        throw new IssuedPlanError("PLAN_NOT_ISSUED");
      }

      const source = this.db.prepare(`
        SELECT p.id, p.plan_kind AS planKind,
               p.study_date AS studyDate, p.submit_until AS submitUntil,
               p.trusted_device_id AS trustedDeviceId,
               td.revoked_at AS revokedAt
        FROM issued_daily_plans AS p
        JOIN trusted_devices AS td ON td.id = p.trusted_device_id
        WHERE p.id = ? AND p.student_id = ?
      `).get(sourcePlanId, studentId) as {
        id: string;
        planKind: "daily" | "recovery";
        studyDate: string;
        submitUntil: string;
        trustedDeviceId: string;
        revokedAt: string | null;
      } | undefined;
      if (source === undefined || source.planKind !== "daily") {
        throw new IssuedPlanError("PLAN_NOT_ISSUED");
      }
      if (source.revokedAt === null) {
        throw new IssuedPlanError("SOURCE_DEVICE_STILL_ACTIVE");
      }
      if (now.getTime() > Date.parse(source.submitUntil)) {
        throw new IssuedPlanError("PLAN_SUBMISSION_EXPIRED");
      }

      const existing = this.db.prepare(`
        SELECT id, plan_kind AS planKind,
               recovery_source_plan_id AS recoverySourcePlanId,
               study_date AS studyDate, submit_until AS submitUntil,
               offline_epoch AS offlineEpoch, start_cursor AS startCursor
        FROM issued_daily_plans
        WHERE student_id = ? AND trusted_device_id = ?
          AND recovery_source_plan_id = ? AND plan_kind = 'recovery'
      `).get(studentId, trustedDeviceId, sourcePlanId) as PlanRow | undefined;
      if (existing !== undefined) {
        return this.readSnapshot(studentId, existing);
      }

      const cursor = this.getCursor(studentId);
      const recoveryPlanId = randomUUID();
      this.db.prepare(`
        INSERT INTO issued_daily_plans (
          id, student_id, trusted_device_id, plan_kind,
          recovery_source_plan_id, study_date, issued_at, submit_until,
          offline_epoch, start_cursor
        ) VALUES (?, ?, ?, 'recovery', ?, ?, ?, ?, ?, ?)
      `).run(
        recoveryPlanId,
        studentId,
        trustedDeviceId,
        source.id,
        source.studyDate,
        nowIso,
        source.submitUntil,
        cursor.nextEpoch,
        cursor.currentCursor
      );
      this.db.prepare(`
        INSERT INTO issued_plan_items (
          plan_id, item_id, content_version, is_required, sort_order, step
        )
        SELECT ?, item_id, content_version, is_required, sort_order, step
        FROM issued_plan_items WHERE plan_id = ?
      `).run(recoveryPlanId, source.id);
      this.db.prepare(`
        UPDATE student_activity_cursors
        SET next_epoch = next_epoch + 1, updated_at = ?
        WHERE student_id = ?
      `).run(nowIso, studentId);
      const recovery = this.db.prepare(`
        SELECT id, plan_kind AS planKind,
               recovery_source_plan_id AS recoverySourcePlanId,
               study_date AS studyDate, submit_until AS submitUntil,
               offline_epoch AS offlineEpoch, start_cursor AS startCursor
        FROM issued_daily_plans WHERE id = ?
      `).get(recoveryPlanId) as PlanRow | undefined;
      if (recovery === undefined) {
        throw new Error("RECOVERY_PLAN_MISSING");
      }
      return this.readSnapshot(studentId, recovery);
    }).immediate();
  }

  validateAttempt(
    studentId: string,
    trustedDeviceId: string,
    input: AttemptInput,
    receivedAt: Date
  ): ValidatedAttemptSnapshot {
    const plan = this.db.prepare(`
      SELECT id, study_date AS studyDate, submit_until AS submitUntil
      FROM issued_daily_plans
      WHERE id = ? AND student_id = ? AND trusted_device_id = ?
    `).get(input.planId, studentId, trustedDeviceId) as
      | { id: string; studyDate: string; submitUntil: string }
      | undefined;
    if (plan === undefined) {
      throw new IssuedPlanError("PLAN_NOT_ISSUED");
    }
    if (receivedAt.getTime() > Date.parse(plan.submitUntil)) {
      throw new IssuedPlanError("PLAN_SUBMISSION_EXPIRED");
    }
    if (input.studyDate !== plan.studyDate) {
      throw new IssuedPlanError("INVALID_REQUEST");
    }
    const occurredAt = Date.parse(input.occurredAt);
    const bounds = kstDayBounds(plan.studyDate);
    if (
      !Number.isFinite(occurredAt) ||
      occurredAt < Date.parse(bounds.start) ||
      occurredAt >= Date.parse(bounds.end)
    ) {
      throw new IssuedPlanError("INVALID_REQUEST");
    }

    const item = this.db.prepare(`
      SELECT ipi.content_version AS contentVersion,
             ipi.is_required AS isRequired,
             ipi.step AS step,
             cv.payload_json AS payloadJson
      FROM issued_plan_items AS ipi
      JOIN content_versions AS cv
        ON cv.item_id = ipi.item_id
       AND cv.version = ipi.content_version
      WHERE ipi.plan_id = ? AND ipi.item_id = ?
    `).get(input.planId, input.itemId) as
      | {
          contentVersion: number;
          isRequired: number;
          step: LearningStep;
          payloadJson: string;
        }
      | undefined;
    if (item === undefined) {
      throw new IssuedPlanError("PLAN_NOT_ISSUED");
    }
    if (item.contentVersion !== input.contentVersion) {
      throw new IssuedPlanError("CONTENT_VERSION_CONFLICT");
    }
    assertIssuedStepUnlocked(this.db, studentId, input.planId, input.itemId);
    return {
      issuedPlanId: plan.id,
      studyDate: plan.studyDate,
      contentVersion: item.contentVersion,
      payload: LearningItemPayloadSchema.parse(JSON.parse(item.payloadJson)),
      isRequired: item.isRequired === 1,
      step: item.step
    };
  }

  private findDailyPlan(
    studentId: string,
    trustedDeviceId: string,
    studyDate: string
  ): PlanRow | null {
    const row = this.db.prepare(`
      SELECT id, plan_kind AS planKind,
             recovery_source_plan_id AS recoverySourcePlanId,
             study_date AS studyDate, submit_until AS submitUntil,
             offline_epoch AS offlineEpoch, start_cursor AS startCursor
      FROM issued_daily_plans
      WHERE student_id = ? AND trusted_device_id = ? AND study_date = ?
        AND plan_kind = 'daily'
    `).get(studentId, trustedDeviceId, studyDate) as PlanRow | undefined;
    return row ?? null;
  }

  private readSnapshot(studentId: string, plan: PlanRow): IssuedPlanSnapshot {
    const student = this.db.prepare(`
      SELECT display_name AS displayName FROM users WHERE id = ?
    `).get(studentId) as { displayName: string } | undefined;
    if (student === undefined) throw new Error("STUDENT_NOT_FOUND");
    const items = this.db.prepare(`
      SELECT ipi.item_id AS id, ipi.content_version AS version,
             ipi.is_required AS isRequired, ipi.sort_order AS sortOrder,
             ipi.step AS step,
             cv.payload_json AS payloadJson
      FROM issued_plan_items AS ipi
      JOIN content_versions AS cv
        ON cv.item_id = ipi.item_id
       AND cv.version = ipi.content_version
      WHERE ipi.plan_id = ?
      ORDER BY ipi.sort_order, ipi.item_id
    `).all(plan.id) as Array<{
      id: string;
      version: number;
      isRequired: number;
      sortOrder: number;
      step: LearningStep;
      payloadJson: string;
    }>;
    return {
      id: plan.id,
      planKind: plan.planKind,
      recoverySourcePlanId: plan.recoverySourcePlanId,
      studyDate: plan.studyDate,
      submitUntil: plan.submitUntil,
      offlineEpoch: plan.offlineEpoch,
      startCursor: plan.startCursor,
      activityCursor: this.getCursor(studentId).currentCursor,
      studentDisplayName: student.displayName,
      items: items.map((item) => ({
        id: item.id,
        version: item.version,
        step: item.step,
        isRequired: item.isRequired === 1,
        sortOrder: item.sortOrder,
        payload: LearningItemPayloadSchema.parse(JSON.parse(item.payloadJson))
      }))
    };
  }

  private listRequiredItems(
    studentId: string,
    studyDate: string
  ): Array<{
    id: string;
    version: number;
    step: LearningStep;
    payload: LearningItemPayload;
  }> {
    const rows = this.db.prepare(`
      SELECT ci.id, ci.active_version AS version, dr.step,
             cv.payload_json AS payloadJson
      FROM daily_requirements AS dr
      JOIN content_items AS ci ON ci.id = dr.item_id
      JOIN content_versions AS cv
        ON cv.item_id = ci.id AND cv.version = ci.active_version
      WHERE dr.student_id = ? AND dr.study_date = ?
        AND ci.status = 'published'
      ORDER BY dr.sort_order, dr.item_id
    `).all(studentId, studyDate) as Array<{
      id: string;
      version: number;
      step: LearningStep;
      payloadJson: string;
    }>;
    return rows.map((row) => ({
      id: row.id,
      version: row.version,
      step: row.step,
      payload: LearningItemPayloadSchema.parse(JSON.parse(row.payloadJson))
    }));
  }

  private getCursor(studentId: string): CursorRow {
    const row = this.db.prepare(`
      SELECT next_epoch AS nextEpoch, current_cursor AS currentCursor
      FROM student_activity_cursors WHERE student_id = ?
    `).get(studentId) as CursorRow | undefined;
    if (row === undefined) throw new Error("STUDENT_ACTIVITY_CURSOR_MISSING");
    return row;
  }
}
