import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { getDailyItems } from "../../shared/daily-order";
import {
  LearningItemPayloadSchema,
  type AttemptInput,
  type LearningItemPayload
} from "../../shared/learning";
import { kstDayBounds, kstStudyDate } from "../../shared/study-date";
import { DailyPlanService } from "../stars/daily-plan";

export type IssuedPlanErrorCode =
  | "PLAN_NOT_ISSUED"
  | "PLAN_SUBMISSION_EXPIRED"
  | "CONTENT_VERSION_CONFLICT"
  | "INVALID_REQUEST";

export class IssuedPlanError extends Error {
  constructor(readonly code: IssuedPlanErrorCode) {
    super(code);
  }
}

export type IssuedPlanItemSnapshot = {
  id: string;
  version: number;
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
        const activeItems = this.listActiveItems();
        const deliveredItems = getDailyItems(activeItems, studyDate);
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
            plan_id, item_id, content_version, is_required, sort_order
          ) VALUES (?, ?, ?, ?, ?)
        `);
        deliveredItems.forEach((item, sortOrder) => {
          insertItem.run(
            planId,
            item.id,
            item.version,
            requiredIds.has(item.id) ? 1 : 0,
            sortOrder
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
             cv.payload_json AS payloadJson
      FROM issued_plan_items AS ipi
      JOIN content_versions AS cv
        ON cv.item_id = ipi.item_id
       AND cv.version = ipi.content_version
      WHERE ipi.plan_id = ? AND ipi.item_id = ?
    `).get(input.planId, input.itemId) as
      | { contentVersion: number; isRequired: number; payloadJson: string }
      | undefined;
    if (item === undefined) {
      throw new IssuedPlanError("PLAN_NOT_ISSUED");
    }
    if (item.contentVersion !== input.contentVersion) {
      throw new IssuedPlanError("CONTENT_VERSION_CONFLICT");
    }
    return {
      issuedPlanId: plan.id,
      studyDate: plan.studyDate,
      contentVersion: item.contentVersion,
      payload: LearningItemPayloadSchema.parse(JSON.parse(item.payloadJson)),
      isRequired: item.isRequired === 1
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
        isRequired: item.isRequired === 1,
        sortOrder: item.sortOrder,
        payload: LearningItemPayloadSchema.parse(JSON.parse(item.payloadJson))
      }))
    };
  }

  private listActiveItems(): Array<{
    id: string;
    version: number;
    payload: LearningItemPayload;
  }> {
    const rows = this.db.prepare(`
      SELECT ci.id, ci.active_version AS version, cv.payload_json AS payloadJson
      FROM content_items AS ci
      JOIN content_versions AS cv
        ON cv.item_id = ci.id AND cv.version = ci.active_version
      WHERE ci.status = 'published'
      ORDER BY ci.id
    `).all() as Array<{ id: string; version: number; payloadJson: string }>;
    return rows.map((row) => ({
      id: row.id,
      version: row.version,
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
