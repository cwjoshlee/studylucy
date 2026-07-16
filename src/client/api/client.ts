import type {
  CurrentUser,
  StudentLoginResult,
  TrustedDeviceView
} from "../../shared/auth";
import type {
  AttemptInput,
  AttemptReceipt,
  GuardianProgress,
  TodayPlan
} from "../../shared/learning";
import type {
  AppliedStarResult,
  ApprovalInput,
  DailyPlanInput,
  GuardianDailyPlan,
  GuardianStarLedger,
  IdleEventInput,
  IdleEventResult,
  ManualStarInput,
  PendingStarAdjustment,
  ProcessedStarAdjustment,
  StarReason,
  StudentStarSummary
} from "../../shared/stars";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string
  ) {
    super(code);
    this.name = "ApiError";
  }
}

type Fetcher = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>;

export type SetupInput = {
  setupSecret: string;
  guardianName: string;
  password: string;
  studentName: string;
};

export type BackupStatus = {
  status: "never-run" | "success" | "failure";
  finishedAt?: string;
  filename?: string;
};

export type AuthorityPolicyCallbacks = {
  onSessionEnded?(): void | Promise<void>;
  onDeviceRevoked?(publicId: string): void | Promise<void>;
  onAuthorityFailure?(code: string): void | Promise<void>;
};

export type GuardianLedgerFilters = {
  from?: string;
  to?: string;
  direction?: "all" | "earned" | "deducted";
  reason?: StarReason;
  cursor?: string;
};

export class ApiClient {
  constructor(
    private fetcher: Fetcher = fetch,
    private callbacks: AuthorityPolicyCallbacks = {}
  ) {}

  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const response = await this.fetcher.call(globalThis, path, {
      method,
      credentials: "same-origin",
      headers: {
        accept: "application/json",
        ...(body === undefined ? {} : { "content-type": "application/json" })
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => null) as unknown;
      const code = payload !== null && typeof payload === "object" &&
        "code" in payload && typeof payload.code === "string"
        ? payload.code
        : `HTTP_${response.status}`;
      if (
        response.status === 401 ||
        code.startsWith("DEVICE_") ||
        code.startsWith("PLAN_")
      ) {
        await this.callbacks.onAuthorityFailure?.(code);
      }
      throw new ApiError(response.status, code);
    }
    if (response.status === 204) return undefined as T;
    return await response.json() as T;
  }

  me(): Promise<CurrentUser> {
    return this.request("GET", "/api/auth/me");
  }

  setup(input: SetupInput): Promise<{ status: "created" }> {
    return this.request("POST", "/api/auth/setup", input);
  }

  guardianLogin(password: string): Promise<void> {
    return this.request("POST", "/api/auth/guardian/login", { password });
  }

  registerDevice(name: string): Promise<TrustedDeviceView> {
    return this.request("POST", "/api/guardian/devices/current", { name });
  }

  async listTrustedDevices(): Promise<TrustedDeviceView[]> {
    const result = await this.request<{ devices: TrustedDeviceView[] }>(
      "GET",
      "/api/guardian/devices"
    );
    return result.devices;
  }

  async revokeTrustedDevice(publicId: string): Promise<TrustedDeviceView> {
    const device = await this.request<TrustedDeviceView>(
      "POST",
      `/api/guardian/devices/${encodeURIComponent(publicId)}/revoke`
    );
    await this.callbacks.onDeviceRevoked?.(publicId);
    return device;
  }

  setStudentPin(pin: string): Promise<void> {
    return this.request("PUT", "/api/auth/student-pin", { pin });
  }

  studentLogin(pin: string): Promise<StudentLoginResult> {
    return this.request("POST", "/api/auth/student/login", { pin });
  }

  async endSession(): Promise<void> {
    await this.request("POST", "/api/auth/session/end");
    await this.callbacks.onSessionEnded?.();
  }

  logout(): Promise<void> {
    return this.request("POST", "/api/auth/logout");
  }

  getToday(): Promise<TodayPlan> {
    return this.request("GET", "/api/student/today");
  }

  saveAttempt(input: AttemptInput): Promise<AttemptReceipt> {
    return this.request("POST", "/api/student/attempts", input);
  }

  getStudentStars(): Promise<StudentStarSummary> {
    return this.request("GET", "/api/student/stars");
  }

  sendIdleEvent(input: IdleEventInput): Promise<IdleEventResult> {
    return this.request("POST", "/api/student/idle-events", input);
  }

  getGuardianProgress(from: string, to: string): Promise<GuardianProgress> {
    return this.request("GET", `/api/guardian/progress?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
  }

  getGuardianStars(filters: GuardianLedgerFilters = {}): Promise<GuardianStarLedger> {
    const query = new URLSearchParams();
    if (filters.from !== undefined) query.set("from", filters.from);
    if (filters.to !== undefined) query.set("to", filters.to);
    if (filters.direction !== undefined) query.set("direction", filters.direction);
    if (filters.reason !== undefined) query.set("reason", filters.reason);
    if (filters.cursor !== undefined) query.set("cursor", filters.cursor);
    query.set("limit", "100");
    return this.request("GET", `/api/guardian/stars?${query}`);
  }

  getStarAdjustments(): Promise<{ adjustments: PendingStarAdjustment[] }> {
    return this.request("GET", "/api/guardian/star-adjustments");
  }

  approveStarAdjustment(
    id: string,
    input: ApprovalInput
  ): Promise<ProcessedStarAdjustment> {
    return this.request(
      "POST",
      `/api/guardian/star-adjustments/${encodeURIComponent(id)}/approve`,
      input
    );
  }

  waiveStarAdjustment(
    id: string,
    input: { note: string }
  ): Promise<ProcessedStarAdjustment> {
    return this.request(
      "POST",
      `/api/guardian/star-adjustments/${encodeURIComponent(id)}/waive`,
      input
    );
  }

  applyManualStars(input: ManualStarInput): Promise<AppliedStarResult> {
    return this.request("POST", "/api/guardian/stars/manual", input);
  }

  reverseStarEvent(
    eventId: string,
    input: { note: string }
  ): Promise<AppliedStarResult> {
    return this.request(
      "POST",
      `/api/guardian/stars/${encodeURIComponent(eventId)}/reverse`,
      input
    );
  }

  getGuardianDailyPlan(date: string): Promise<GuardianDailyPlan> {
    return this.request("GET", `/api/guardian/daily-plans/${encodeURIComponent(date)}`);
  }

  updateGuardianDailyPlan(
    date: string,
    input: DailyPlanInput
  ): Promise<GuardianDailyPlan> {
    return this.request(
      "PUT",
      `/api/guardian/daily-plans/${encodeURIComponent(date)}`,
      input
    );
  }

  getBackupStatus(): Promise<BackupStatus> {
    return this.request("GET", "/api/guardian/backup-status");
  }
}

export type ClientApi = Pick<ApiClient,
  | "me"
  | "setup"
  | "guardianLogin"
  | "registerDevice"
  | "listTrustedDevices"
  | "revokeTrustedDevice"
  | "setStudentPin"
  | "studentLogin"
  | "endSession"
  | "logout"
  | "getToday"
  | "saveAttempt"
  | "getStudentStars"
  | "sendIdleEvent"
  | "getGuardianProgress"
  | "getGuardianStars"
  | "getStarAdjustments"
  | "approveStarAdjustment"
  | "waiveStarAdjustment"
  | "applyManualStars"
  | "reverseStarEvent"
  | "getGuardianDailyPlan"
  | "updateGuardianDailyPlan"
  | "getBackupStatus"
>;
