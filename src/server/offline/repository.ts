import type Database from "better-sqlite3";
import { z } from "zod";
import {
  ActivityReceiptSchema,
  TodayPlanSchema,
  type ActivityReceipt,
  type TodayPlan
} from "../../shared/learning";

const StoredBatchFactsSchema = z.object({
  orderConflict: z.boolean(),
  batchEndCursor: z.number().int().nonnegative(),
  receipts: z.array(ActivityReceiptSchema),
  processedPlan: TodayPlanSchema
}).strict();

const StoredActivitySchema = z.object({
  eventFingerprint: z.string().min(1),
  receipt: ActivityReceiptSchema
}).strict();

export type StoredBatchFacts = z.infer<typeof StoredBatchFactsSchema>;

export type StoredBatch = {
  requestFingerprint: string;
  canonicalReceivedAt: string;
  facts: StoredBatchFacts;
};

export type StoredActivity = {
  eventFingerprint: string;
  receipt: ActivityReceipt;
};

export type InsertBatchInput = {
  studentId: string;
  clientBatchId: string;
  requestFingerprint: string;
  originalDeviceId: string;
  submittingDeviceId: string;
  planId: string;
  offlineEpoch: number;
  startCursor: number;
  endCursor: number;
  outcome: string;
  facts: StoredBatchFacts;
  createdAt: string;
};

export type InsertActivityInput = {
  studentId: string;
  clientBatchId: string;
  clientEventId: string;
  eventFingerprint: string;
  studyDate: string;
  itemId: string;
  kind: "attempt" | "idle";
  receipt: ActivityReceipt;
  createdAt: string;
};

export class OfflineRepository {
  constructor(private db: Database.Database) {}

  assertActiveDevice(trustedDeviceId: string): void {
    const row = this.db.prepare(`
      SELECT 1 FROM trusted_devices
      WHERE id = ? AND revoked_at IS NULL
    `).get(trustedDeviceId);
    if (row === undefined) throw new Error("ACTIVE_DEVICE_REQUIRED");
  }

  getCursor(studentId: string): number {
    const row = this.db.prepare(`
      SELECT current_cursor AS currentCursor
      FROM student_activity_cursors WHERE student_id = ?
    `).get(studentId) as { currentCursor: number } | undefined;
    if (row === undefined) throw new Error("STUDENT_ACTIVITY_CURSOR_MISSING");
    return row.currentCursor;
  }

  setCursor(studentId: string, currentCursor: number, updatedAt: string): void {
    const result = this.db.prepare(`
      UPDATE student_activity_cursors
      SET current_cursor = ?, updated_at = ?
      WHERE student_id = ?
    `).run(currentCursor, updatedAt, studentId);
    if (result.changes !== 1) {
      throw new Error("STUDENT_ACTIVITY_CURSOR_MISSING");
    }
  }

  findBatch(studentId: string, clientBatchId: string): StoredBatch | null {
    const row = this.db.prepare(`
      SELECT request_fingerprint AS requestFingerprint,
             created_at AS canonicalReceivedAt,
             response_json AS responseJson
      FROM offline_batches
      WHERE student_id = ? AND client_batch_id = ?
    `).get(studentId, clientBatchId) as {
      requestFingerprint: string;
      canonicalReceivedAt: string;
      responseJson: string;
    } | undefined;
    if (row === undefined) return null;
    return {
      requestFingerprint: row.requestFingerprint,
      canonicalReceivedAt: row.canonicalReceivedAt,
      facts: StoredBatchFactsSchema.parse(JSON.parse(row.responseJson))
    };
  }

  findActivity(studentId: string, clientEventId: string): StoredActivity | null {
    const row = this.db.prepare(`
      SELECT receipt_json AS receiptJson
      FROM offline_activity_receipts
      WHERE student_id = ? AND client_event_id = ?
    `).get(studentId, clientEventId) as { receiptJson: string } | undefined;
    if (row === undefined) return null;
    return StoredActivitySchema.parse(JSON.parse(row.receiptJson));
  }

  insertBatch(input: InsertBatchInput): void {
    this.db.prepare(`
      INSERT INTO offline_batches (
        client_batch_id, request_fingerprint, student_id,
        original_device_id, submitting_device_id, plan_id, offline_epoch,
        start_cursor, end_cursor, outcome, response_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.clientBatchId,
      input.requestFingerprint,
      input.studentId,
      input.originalDeviceId,
      input.submittingDeviceId,
      input.planId,
      input.offlineEpoch,
      input.startCursor,
      input.endCursor,
      input.outcome,
      JSON.stringify(input.facts),
      input.createdAt
    );
  }

  insertActivity(input: InsertActivityInput): void {
    const stored: StoredActivity = {
      eventFingerprint: input.eventFingerprint,
      receipt: input.receipt
    };
    this.db.prepare(`
      INSERT INTO offline_activity_receipts (
        student_id, client_event_id, client_batch_id, study_date,
        item_id, kind, status, code, receipt_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.studentId,
      input.clientEventId,
      input.clientBatchId,
      input.studyDate,
      input.itemId,
      input.kind,
      input.receipt.status.toLowerCase(),
      input.receipt.code ?? "",
      JSON.stringify(stored),
      input.createdAt
    );
  }
}

export function immutableBatchFacts(input: {
  orderConflict: boolean;
  batchEndCursor: number;
  receipts: ActivityReceipt[];
  processedPlan: TodayPlan;
}): StoredBatchFacts {
  return StoredBatchFactsSchema.parse(input);
}
