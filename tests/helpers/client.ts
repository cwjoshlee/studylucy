import { vi } from "vitest";

const items = [
  ["ko-01", "korean", "동시 읽기", "바람과 꽃"],
  ["ko-02", "korean", "문장 읽기", "작은 씨앗"],
  ["math-01", "math", "수 이야기", "별을 세어요"],
  ["math-02", "math", "더하기", "토끼의 당근"],
  ["optional-01", "korean", "선택 읽기", "구름 산책"]
] as const;

const trustedDevice = {
  publicId: "device-public-1",
  name: "수아 갤럭시 탭",
  createdAt: "2026-07-15T03:00:00.000Z",
  lastUsedAt: null,
  status: "active" as const,
  current: true
};

const studentLoginResult = {
  offlineAccessUntil: "2026-07-16T14:59:59.999Z"
};

export function createFakeApi(overrides: Record<string, unknown> = {}) {
  return {
    me: vi.fn().mockResolvedValue({
      id: "student-1",
      role: "student",
      displayName: "수아"
    }),
    setup: vi.fn().mockResolvedValue({ status: "created" }),
    guardianLogin: vi.fn().mockResolvedValue(undefined),
    registerDevice: vi.fn().mockResolvedValue(trustedDevice),
    listTrustedDevices: vi.fn().mockResolvedValue([trustedDevice]),
    revokeTrustedDevice: vi.fn().mockResolvedValue({
      ...trustedDevice,
      status: "revoked" as const
    }),
    setStudentPin: vi.fn().mockResolvedValue(undefined),
    endSession: vi.fn().mockResolvedValue(undefined),
    logout: vi.fn().mockResolvedValue(undefined),
    studentLogin: vi.fn().mockResolvedValue(studentLoginResult),
    getToday: vi.fn().mockResolvedValue({
      planId: "plan-daily-1",
      planKind: "daily" as const,
      recoverySourcePlanId: null,
      date: "2026-07-16",
      submitUntil: "2026-07-17T14:59:59.999Z",
      offlineEpoch: 1,
      activityCursor: 0,
      studentDisplayName: "수아",
      completedItemIds: [],
      requiredItemIds: ["ko-01", "ko-02", "math-01", "math-02"],
      stars: {
        balance: 7,
        earnedToday: 2,
        deductedToday: 1,
        lastReason: "필수 학습을 마쳤어요."
      },
      items: items.map(([id, subject, unit, title]) => ({
        id,
        version: 1,
        payload: {
          id,
          subject,
          unit,
          title,
          level: "1단계",
          readLabel: "읽어 보기",
          text: title,
          hint: "천천히 읽어 봐요.",
          tokens: [title],
          kind: "korean-reading"
        }
      }))
    }),
    getStudentStars: vi.fn().mockResolvedValue({
      balance: 7,
      earnedToday: 2,
      deductedToday: 1,
      lastReason: "필수 학습을 마쳤어요."
    }),
    saveAttempt: vi.fn().mockResolvedValue({
      id: "attempt-server-1",
      duplicate: false,
      readingPass: true,
      mathPass: null,
      completed: true,
      activityCursor: 1,
      starAward: {
        awarded: true,
        amount: 1,
        balance: 8,
        eventId: "star-required-completion-1"
      }
    }),
    createLearningSession: vi.fn().mockResolvedValue({
      learningSessionId: "server-issued-learning-session-0001",
      activeUntil: "2026-07-16T07:00:00.000Z",
      submitUntil: "2026-07-17T14:59:59.999Z"
    }),
    sendIdleEvent: vi.fn().mockResolvedValue({
      id: "idle-server-1",
      outcome: "applied",
      starEventId: "star-idle-1",
      duplicate: false,
      activityCursor: 2
    }),
    getGuardianProgress: vi.fn().mockResolvedValue({
      completedItems: 4,
      totalAttempts: 6,
      readingPassRate: 83,
      mathPassRate: 75,
      recentReviewTokens: [{ token: "꽃잎", count: 2 }]
    }),
    getGuardianStars: vi.fn().mockResolvedValue({
      summary: {
        balance: 12,
        earnedToday: 3,
        deductedToday: 1,
        lastReason: "5분 무반응"
      },
      events: [],
      nextCursor: null
    }),
    getStarAdjustments: vi.fn().mockResolvedValue({ adjustments: [] }),
    approveStarAdjustment: vi.fn(),
    waiveStarAdjustment: vi.fn(),
    applyManualStars: vi.fn(),
    reverseStarEvent: vi.fn(),
    getGuardianDailyPlan: vi.fn().mockResolvedValue({
      studyDate: "2026-07-17",
      koreanTarget: 2,
      mathTarget: 2,
      isRestDay: false,
      requiredItemIds: []
    }),
    updateGuardianDailyPlan: vi.fn(),
    getBackupStatus: vi.fn().mockResolvedValue({ status: "never-run" }),
    ...overrides
  };
}
