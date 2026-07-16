import { vi } from "vitest";

const items = [
  ["ko-01", "korean", "동시 읽기", "바람과 꽃"],
  ["ko-02", "korean", "문장 읽기", "작은 씨앗"],
  ["math-01", "math", "수 이야기", "별을 세어요"],
  ["math-02", "math", "더하기", "토끼의 당근"],
  ["optional-01", "korean", "선택 읽기", "구름 산책"]
] as const;

export function createFakeApi(overrides: Record<string, unknown> = {}) {
  return {
    me: vi.fn().mockResolvedValue({
      id: "student-1",
      role: "student",
      displayName: "수아"
    }),
    setup: vi.fn().mockResolvedValue({ status: "created" }),
    guardianLogin: vi.fn().mockResolvedValue(undefined),
    registerDevice: vi.fn().mockResolvedValue({ status: "created" }),
    setStudentPin: vi.fn().mockResolvedValue(undefined),
    logout: vi.fn().mockResolvedValue(undefined),
    studentLogin: vi.fn().mockResolvedValue(undefined),
    getToday: vi.fn().mockResolvedValue({
      date: "2026-07-16",
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
      starAward: {
        awarded: true,
        amount: 1,
        balance: 8,
        eventId: "star-required-completion-1"
      }
    }),
    sendIdleEvent: vi.fn().mockResolvedValue({
      id: "idle-server-1",
      outcome: "applied",
      starEventId: "star-idle-1",
      duplicate: false
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
