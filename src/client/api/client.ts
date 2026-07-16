import type { CurrentUser } from "../../shared/auth";
import type {
  AttemptInput,
  AttemptReceipt,
  GuardianProgress,
  TodayPlan
} from "../../shared/learning";
import type {
  GuardianDailyPlan,
  GuardianStarLedger,
  IdleEventInput,
  IdleEventResult,
  PendingStarAdjustment,
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

export class ApiClient {
  constructor(private fetcher: Fetcher = fetch) {}

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

  registerDevice(name: string): Promise<{ status: "created" }> {
    return this.request("POST", "/api/auth/devices", { name });
  }

  setStudentPin(pin: string): Promise<void> {
    return this.request("PUT", "/api/auth/student-pin", { pin });
  }

  studentLogin(pin: string): Promise<void> {
    return this.request("POST", "/api/auth/student/login", { pin });
  }

  logout(): Promise<void> {
    return this.request("POST", "/api/auth/logout");
  }

  getToday(date: string): Promise<TodayPlan> {
    return this.request("GET", `/api/student/today?date=${encodeURIComponent(date)}`);
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

  getGuardianStars(): Promise<GuardianStarLedger> {
    return this.request("GET", "/api/guardian/stars");
  }

  getStarAdjustments(): Promise<{ adjustments: PendingStarAdjustment[] }> {
    return this.request("GET", "/api/guardian/star-adjustments");
  }

  getGuardianDailyPlan(date: string): Promise<GuardianDailyPlan> {
    return this.request("GET", `/api/guardian/daily-plans/${encodeURIComponent(date)}`);
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
  | "setStudentPin"
  | "studentLogin"
  | "logout"
  | "getToday"
  | "getStudentStars"
>;
