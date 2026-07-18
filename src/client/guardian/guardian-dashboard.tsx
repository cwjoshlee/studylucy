import { useEffect, useRef, useState } from "react";
import {
  DEVICE_TYPE_LIMITS,
  type DeviceType,
  type TrustedDeviceView
} from "../../shared/auth";
import type {
  GuardianOfflineRejection,
  GuardianProgress
} from "../../shared/learning";
import type {
  GuardianStarLedger,
  GuardianDailyPlan,
  PendingStarAdjustment,
  StarReason,
  SubjectStepSettings
} from "../../shared/stars";
import type {
  ApiClient,
  BackupStatus,
  GuardianLedgerFilters
} from "../api/client";
import { ApiError } from "../api/client";
import { listGuardianOfflineRejections } from "../offline/db";
import {
  ResponsiveNavigation,
  type NavigationEntry
} from "../navigation/responsive-navigation";
import {
  AiLearningStudio,
  type AiLearningStudioApi,
  initialAiStudioTreeState,
  type AiStudioPanel
} from "./ai-learning-studio";

type GuardianDashboardApi = Pick<ApiClient,
  | "getGuardianProgress"
  | "getGuardianOfflineRejections"
  | "getGuardianStars"
  | "applyManualStars"
  | "reverseStarEvent"
  | "getStarAdjustments"
  | "approveStarAdjustment"
  | "waiveStarAdjustment"
  | "getGuardianDailyPlan"
  | "updateGuardianDailyPlan"
  | "getBackupStatus"
  | "registerDevice"
  | "listTrustedDevices"
  | "revokeTrustedDevice"
  | "updateTrustedDeviceType"
> & Partial<AiLearningStudioApi>;

function supportsAiLearningStudio(
  api: GuardianDashboardApi
): api is GuardianDashboardApi & AiLearningStudioApi {
  return typeof api.getAiStudioSettings === "function" &&
    typeof api.updateAiStudioProvider === "function" &&
    typeof api.createAiDraft === "function" &&
    typeof api.getAiDraft === "function" &&
    typeof api.updateAiDraftItem === "function" &&
    typeof api.publishAiDraft === "function" &&
    typeof api.getGuardianAiReport === "function";
}

type DashboardData = {
  progress: GuardianProgress;
  ledger: GuardianStarLedger;
  rejections: GuardianOfflineRejection[];
};

const TABS = ["진도", "별 기록", "차감 승인", "학습 계획", "AI 학습실", "백업"] as const;
type GuardianTab = typeof TABS[number];

const GUARDIAN_ENTRIES: readonly NavigationEntry[] = [
  { id: "progress", label: "진도" },
  { id: "star-ledger", label: "별 기록" },
  { id: "adjustment-approval", label: "차감 승인" },
  { id: "daily-plan", label: "학습 계획" },
  {
    id: "ai",
    label: "AI 학습실",
    children: [
      {
        id: "ai/settings",
        label: "AI 설정",
        children: [
          { id: "ai/provider-model", label: "제공자·모델 선택" },
          { id: "ai/api-keys", label: "API 키 관리" },
          { id: "ai/budget", label: "월 예산·사용량" }
        ]
      },
      {
        id: "ai/generation",
        label: "문제 생성",
        children: [
          { id: "ai/generate-math", label: "수학 문제 배치" },
          { id: "ai/generate-korean", label: "국어·받아쓰기 배치" }
        ]
      },
      {
        id: "ai/reports",
        label: "보고서",
        children: [
          { id: "ai/today-report", label: "오늘의 학습 요약" },
          { id: "ai/weekly-report", label: "주간 변화" }
        ]
      }
    ]
  },
  { id: "backup", label: "백업" },
  { id: "devices", label: "기기 관리" }
];

const TAB_ENTRY_ID: Record<Exclude<GuardianTab, "AI 학습실">, string> = {
  "진도": "progress",
  "별 기록": "star-ledger",
  "차감 승인": "adjustment-approval",
  "학습 계획": "daily-plan",
  "백업": "backup"
};

const ENTRY_TAB: Record<string, Exclude<GuardianTab, "AI 학습실">> = {
  progress: "진도",
  "star-ledger": "별 기록",
  "adjustment-approval": "차감 승인",
  "daily-plan": "학습 계획",
  backup: "백업"
};

const AI_ENTRY_PANEL: Record<string, AiStudioPanel> = {
  "ai/provider-model": "settings",
  "ai/api-keys": "settings",
  "ai/budget": "settings",
  "ai/generate-math": "generate-math",
  "ai/generate-korean": "generate-korean",
  "ai/today-report": "today-report",
  "ai/weekly-report": "weekly-report"
};

const ADJUSTMENT_STATUS_LABELS: Record<PendingStarAdjustment["status"], string> = {
  pending: "대기",
  approved: "승인",
  waived: "면제"
};

function studyDate(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

const deviceDateFormatter = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23"
});

function formatDeviceDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "확인할 수 없음";

  const parts = deviceDateFormatter.formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}년 ${Number(part("month"))}월 ${Number(part("day"))}일 ${part("hour")}:${part("minute")}`;
}

function progressRange(): { from: string; to: string } {
  const now = new Date();
  const from = new Date(now);
  from.setDate(from.getDate() - 6);
  return { from: studyDate(from), to: studyDate(now) };
}

export function GuardianDashboard({
  api,
  onEnterStudentMode,
  onLogout,
  loadLocalOfflineRejections = listGuardianOfflineRejections
}: {
  api: GuardianDashboardApi;
  onEnterStudentMode?: () => Promise<void>;
  onLogout?: () => Promise<void>;
  loadLocalOfflineRejections?: () => Promise<GuardianOfflineRejection[]>;
}) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [failed, setFailed] = useState(false);
  const [activeTab, setActiveTab] = useState<GuardianTab>("진도");
  const [aiPanel, setAiPanel] = useState<AiStudioPanel>("settings");
  const [aiTreeState, setAiTreeState] = useState(() => initialAiStudioTreeState("settings"));
  const [expandedNavigationIds, setExpandedNavigationIds] = useState<string[]>([]);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [deviceManagementOpen, setDeviceManagementOpen] = useState(false);

  const activeNavigationId = deviceManagementOpen
    ? "devices"
    : activeTab === "AI 학습실"
      ? `ai/${aiTreeState.selectedLeaf}`
      : TAB_ENTRY_ID[activeTab];

  const toggleNavigation = (id: string) => {
    setExpandedNavigationIds((current) => current.includes(id)
      ? current.filter((entryId) => entryId !== id)
      : [...current, id]);
  };

  const selectNavigation = (id: string) => {
    if (id === "devices") {
      setDeviceManagementOpen(true);
      return;
    }
    setDeviceManagementOpen(false);
    const tab = ENTRY_TAB[id];
    if (tab !== undefined) {
      setActiveTab(tab);
      return;
    }
    if (id === "ai" || id.startsWith("ai/")) setActiveTab("AI 학습실");
    const panel = AI_ENTRY_PANEL[id];
    if (panel === undefined) return;
    const selectedLeaf = id.slice("ai/".length);
    const groupId = id === "ai/generate-math" || id === "ai/generate-korean"
      ? "generation"
      : id === "ai/today-report" || id === "ai/weekly-report"
        ? "reports"
        : "settings";
    setAiPanel(panel);
    setAiTreeState((current) => ({
      selectedLeaf,
      openGroups: Array.from(new Set([...current.openGroups, groupId]))
    }));
  };

  useEffect(() => {
    let active = true;
    const range = progressRange();
    void Promise.all([
      api.getGuardianProgress(range.from, range.to),
      api.getGuardianStars(),
      api.getGuardianOfflineRejections().then(({ rejections }) => rejections),
      loadLocalOfflineRejections().catch(() => [])
    ]).then(
      ([progress, ledger, serverRejections, localRejections]) => {
        if (active) {
          const rejections = [...serverRejections, ...localRejections]
            .map(redactedRejection)
            .filter((entry, index, all) => all.findIndex((candidate) =>
              candidate.id === entry.id
            ) === index)
            .sort((left, right) =>
              right.createdAt.localeCompare(left.createdAt) ||
              right.id.localeCompare(left.id)
            );
          setData({ progress, ledger, rejections });
        }
      },
      () => {
        if (active) setFailed(true);
      }
    );
    return () => {
      active = false;
    };
  }, [api, loadLocalOfflineRejections]);

  return (
    <div className="guardian-shell">
      <header className="guardian-header">
        <div className="guardian-header__row">
          <div>
            <p className="eyebrow">보호자 로그인으로 보호되어 있어요</p>
            <h1>보호자 공간</h1>
          </div>
          <div>
            <button
              aria-expanded={accountMenuOpen}
              onClick={() => setAccountMenuOpen((open) => !open)}
              type="button"
            >
              계정 메뉴
            </button>
            {accountMenuOpen ? (
              <div className="account-menu">
                <button
                  onClick={() => void onEnterStudentMode?.()}
                  type="button"
                >
                  수아 모드
                </button>
                <button
                  onClick={() => void onLogout?.()}
                  type="button"
                >
                  로그아웃
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </header>
      <div className="responsive-shell">
        <ResponsiveNavigation
          activeId={activeNavigationId}
          entries={GUARDIAN_ENTRIES}
          expandedIds={expandedNavigationIds}
          fabLabel="메뉴 열기"
          label="보호자 메뉴"
          onSelect={selectNavigation}
          onToggle={toggleNavigation}
        />
        <main
          className="guardian-panel responsive-shell__content"
          aria-label={deviceManagementOpen ? "기기 관리" : activeTab}
        >
          {deviceManagementOpen ? (
            <DeviceManagement
              api={api}
              onClose={() => setDeviceManagementOpen(false)}
            />
          ) : (
            <>
              {activeTab === "진도" ? (
                <ProgressPanel data={data} failed={failed} />
              ) : null}
              {activeTab === "별 기록" ? <LedgerPanel api={api} /> : null}
              {activeTab === "차감 승인" ? <AdjustmentsPanel api={api} /> : null}
              {activeTab === "학습 계획" ? <DailyPlanPanel api={api} /> : null}
              {activeTab === "AI 학습실" ? (
                supportsAiLearningStudio(api) ? (
                  <AiLearningStudio
                    api={api}
                    onPanelChange={setAiPanel}
                    onTreeStateChange={(next) => {
                      setAiTreeState(next);
                      setExpandedNavigationIds((current) => Array.from(new Set([
                        ...current,
                        "ai",
                        ...next.openGroups.map((group) => `ai/${group}`)
                      ])));
                    }}
                    panel={aiPanel}
                    treeState={aiTreeState}
                  />
                ) : <p role="alert">AI 학습실을 사용할 수 없어요.</p>
              ) : null}
              {activeTab === "백업" ? <BackupPanel api={api} /> : null}
            </>
          )}
        </main>
      </div>
    </div>
  );
}

function DeviceManagement({
  api,
  onClose
}: {
  api: GuardianDashboardApi;
  onClose: () => void;
}) {
  const [devices, setDevices] = useState<TrustedDeviceView[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [registering, setRegistering] = useState(false);
  const [deviceName, setDeviceName] = useState("수아 태블릿");
  const [deviceType, setDeviceType] = useState<DeviceType>("tablet");
  const [classifying, setClassifying] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void api.listTrustedDevices().then(
      (loaded) => {
        if (active) setDevices(loaded);
      },
      () => {
        if (active) setFailed(true);
      }
    );
    return () => {
      active = false;
    };
  }, [api]);

  const revoke = async (device: TrustedDeviceView) => {
    const confirmed = window.confirm(device.current
      ? "현재 기기를 해제하면 수아 모드에서 다시 등록해야 해요. 해제할까요?"
      : `${device.name} 기기를 해제할까요?`);
    if (!confirmed) return;
    setRevoking(device.publicId);
    try {
      const revoked = await api.revokeTrustedDevice(device.publicId);
      setDevices((current) => current?.map((item) =>
        item.publicId === revoked.publicId ? revoked : item
      ) ?? null);
    } catch {
      setFailed(true);
    } finally {
      setRevoking(null);
    }
  };

  const registerCurrent = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = deviceName.trim();
    if (name.length === 0) return;

    setRegistering(true);
    setFailed(false);
    try {
      await api.registerDevice(name, deviceType);
      setDevices(await api.listTrustedDevices());
    } catch {
      setFailed(true);
    } finally {
      setRegistering(false);
    }
  };

  const classify = async (device: TrustedDeviceView, nextType: DeviceType) => {
    setClassifying(device.publicId);
    setFailed(false);
    try {
      const updated = await api.updateTrustedDeviceType(device.publicId, nextType);
      setDevices((current) => current?.map((item) =>
        item.publicId === updated.publicId ? updated : item
      ) ?? null);
    } catch {
      setFailed(true);
    } finally {
      setClassifying(null);
    }
  };

  const activeCounts = devices?.filter((device) => device.status === "active")
    .reduce<Record<DeviceType, number>>((counts, device) => {
      if (device.deviceType !== null) counts[device.deviceType] += 1;
      return counts;
    }, { tablet: 0, phone: 0, mac: 0, windows: 0 });

  return (
    <section className="device-management" aria-labelledby="device-management-title">
      <div className="device-management__heading">
        <h2 id="device-management-title">기기 관리</h2>
        <button className="button-secondary" onClick={onClose} type="button">
          닫기
        </button>
      </div>
      <form className="device-management__register" onSubmit={registerCurrent}>
        <label>
          현재 브라우저 이름
          <input
            maxLength={60}
            onChange={(event) => setDeviceName(event.target.value)}
            required
            value={deviceName}
          />
        </label>
        <label>
          기기 종류
          <select onChange={(event) => setDeviceType(event.target.value as DeviceType)} value={deviceType}>
            <option value="tablet">태블릿</option>
            <option value="phone">휴대폰</option>
            <option value="mac">Mac</option>
            <option value="windows">Windows</option>
          </select>
        </label>
        <button disabled={registering || revoking !== null} type="submit">
          {registering ? "등록 중" : "현재 브라우저 등록"}
        </button>
      </form>
      {devices === null && !failed ? <p aria-busy="true">기기를 불러오고 있어요.</p> : null}
      {failed ? <p role="alert">기기 정보를 불러오지 못했어요.</p> : null}
      {activeCounts !== undefined ? (
        <p className="device-management__limits">
          태블릿 {activeCounts.tablet}/{DEVICE_TYPE_LIMITS.tablet} · 휴대폰 {activeCounts.phone}/{DEVICE_TYPE_LIMITS.phone} · Mac {activeCounts.mac}/{DEVICE_TYPE_LIMITS.mac} · Windows {activeCounts.windows}/{DEVICE_TYPE_LIMITS.windows}
        </p>
      ) : null}
      {devices?.length === 0 ? <p>등록된 기기가 없어요.</p> : null}
      {devices !== null && devices.length > 0 ? (
        <ul className="device-management__list">
          {devices.map((device) => (
            <li key={device.publicId}>
              <div>
                <strong>{device.name}</strong>
                <span>{device.current ? "현재 기기" : "다른 기기"}</span>
                <span>{device.status === "active" ? "사용 가능" : "해제됨"}</span>
                <span>{device.deviceType === null ? "기기 종류 확인 필요" : deviceTypeLabel(device.deviceType)}</span>
                <span>등록: {formatDeviceDate(device.createdAt)}</span>
                <span>
                  마지막 사용: {device.lastUsedAt === null
                    ? "기록 없음"
                    : formatDeviceDate(device.lastUsedAt)}
                </span>
              </div>
              {device.status === "active" && device.deviceType === null ? (
                <label>
                  기존 기기 종류
                  <select
                    aria-label={`${device.name} 기기 종류`}
                    disabled={classifying !== null}
                    onChange={(event) => void classify(device, event.target.value as DeviceType)}
                    value=""
                  >
                    <option disabled value="">선택하세요</option>
                    <option value="tablet">태블릿</option>
                    <option value="phone">휴대폰</option>
                    <option value="mac">Mac</option>
                    <option value="windows">Windows</option>
                  </select>
                </label>
              ) : null}
              {device.status === "active" ? (
                <button
                  aria-label={`${device.name} 기기 해제`}
                  disabled={revoking !== null}
                  onClick={() => void revoke(device)}
                  type="button"
                >
                  기기 해제
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function deviceTypeLabel(type: DeviceType): string {
  return ({ tablet: "태블릿", phone: "휴대폰", mac: "Mac", windows: "Windows" })[type];
}

function ProgressPanel({
  data,
  failed
}: {
  data: DashboardData | null;
  failed: boolean;
}) {
  return (
    <>
        {failed ? <p role="alert">보호자 정보를 불러오지 못했어요.</p> : null}
        {data === null && !failed ? <p aria-busy="true">진도를 불러오고 있어요.</p> : null}
        {data !== null ? (
          <>
            <h2>수아의 이번 주</h2>
            <p className="guardian-balance">별 잔액 {data.ledger.summary.balance}개</p>
            <p>{data.ledger.events[0]?.reasonText ?? data.ledger.summary.lastReason}</p>
            <section className="guardian-metrics" aria-label="학습 진도">
              <p>완료한 활동 {data.progress.completedItems}개</p>
              <p>전체 시도 {data.progress.totalAttempts}회</p>
              <p>읽기 통과율 {data.progress.readingPassRate}%</p>
              <p>수학 통과율 {data.progress.mathPassRate}%</p>
            </section>
            <section aria-labelledby="review-tokens-title">
              <h3 id="review-tokens-title">다시 볼 표현</h3>
              {data.progress.recentReviewTokens.length === 0 ? (
                <p>이번 기간에는 다시 볼 표현이 없어요.</p>
              ) : (
                <ul>
                  {data.progress.recentReviewTokens.map(({ token, count }) => (
                    <li key={token}>{token} · {count}회</li>
                  ))}
                </ul>
              )}
            </section>
            {data.rejections.length > 0 ? (
              <section
                className="guardian-sync-review"
                aria-labelledby="offline-rejections-title"
              >
                <h3 id="offline-rejections-title">동기화 확인 필요</h3>
                <ul>
                  {data.rejections.map((rejection) => (
                    <li key={rejection.id}>
                      <strong>{rejection.itemTitle}</strong>
                      <span>
                        {rejection.kind === "attempt" ? "풀이" : "무반응"}
                        {" · "}{rejection.code}
                      </span>
                      <time dateTime={rejection.studyDate}>
                        {rejection.studyDate}
                      </time>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </>
        ) : null}
    </>
  );
}

function redactedRejection(
  input: GuardianOfflineRejection
): GuardianOfflineRejection {
  return {
    id: input.id,
    studyDate: input.studyDate,
    itemId: input.itemId,
    itemTitle: input.itemTitle,
    kind: input.kind,
    code: input.code,
    createdAt: input.createdAt
  };
}

function BackupPanel({ api }: { api: GuardianDashboardApi }) {
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    void api.getBackupStatus().then(
      (loaded) => {
        if (active) setStatus(loaded);
      },
      () => {
        if (active) setFailed(true);
      }
    );
    return () => {
      active = false;
    };
  }, [api]);

  if (failed) return <p role="alert">백업 상태를 불러오지 못했어요.</p>;
  if (status === null) return <p aria-busy="true">백업 상태를 불러오고 있어요.</p>;

  const safeFilename = status.filename?.split(/[\\/]/).at(-1);
  return (
    <section aria-labelledby="backup-title">
      <h2 id="backup-title">백업</h2>
      {status.status === "never-run" ? <p>아직 완료된 백업이 없어요.</p> : null}
      {status.status === "success" ? <p>최근 백업이 정상적으로 완료되었어요.</p> : null}
      {status.status === "failure" ? <p>최근 백업을 완료하지 못했어요.</p> : null}
      {status.finishedAt !== undefined ? <p>완료 시각 {status.finishedAt}</p> : null}
      {safeFilename !== undefined ? <p>{safeFilename}</p> : null}
    </section>
  );
}

function DailyPlanPanel({ api }: { api: GuardianDashboardApi }) {
  const [date, setDate] = useState(studyDate(new Date()));
  const [plan, setPlan] = useState<GuardianDailyPlan | null>(null);
  const [koreanTarget, setKoreanTarget] = useState(2);
  const [mathTarget, setMathTarget] = useState(2);
  const [isRestDay, setIsRestDay] = useState(false);
  const [subjectSettings, setSubjectSettings] = useState<
    Record<"korean" | "math", SubjectStepSettings>
  >({
    korean: { difficulty: 3, challengeBonusStars: 1 },
    math: { difficulty: 3, challengeBonusStars: 1 }
  });
  const [message, setMessage] = useState("");
  const [locked, setLocked] = useState(false);
  const planVersion = useRef(0);

  const loadPlan = async () => {
    const requestedDate = date;
    const requestVersion = ++planVersion.current;
    setPlan(null);
    setMessage("");
    setLocked(false);
    try {
      const loaded = await api.getGuardianDailyPlan(requestedDate);
      if (planVersion.current !== requestVersion) return;
      setPlan(loaded);
      setKoreanTarget(loaded.koreanTarget);
      setMathTarget(loaded.mathTarget);
      setIsRestDay(loaded.isRestDay);
      setSubjectSettings(loaded.subjectSettings ?? {
        korean: { difficulty: 3, challengeBonusStars: 1 },
        math: { difficulty: 3, challengeBonusStars: 1 }
      });
    } catch {
      if (planVersion.current !== requestVersion) return;
      setPlan(null);
      setMessage("학습 계획을 불러오지 못했어요.");
    }
  };

  const savePlan = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (plan === null || plan.studyDate !== date) return;
    const requestedDate = date;
    const requestVersion = planVersion.current;
    try {
      const updated = await api.updateGuardianDailyPlan(requestedDate, {
        koreanTarget,
        mathTarget,
        isRestDay,
        subjectSettings
      });
      if (planVersion.current !== requestVersion) return;
      setPlan(updated);
      setSubjectSettings(updated.subjectSettings);
      setMessage(updated.isRestDay
        ? "쉬는 날 계획을 저장했어요."
        : "학습 계획을 저장했어요.");
    } catch (error) {
      if (planVersion.current !== requestVersion) return;
      if (error instanceof ApiError && error.code === "PLAN_LOCKED") {
        setLocked(true);
        setMessage("학습을 시작한 날짜와 지난 날짜의 계획은 바꿀 수 없어요.");
        return;
      }
      setMessage("학습 계획을 저장하지 못했어요.");
    }
  };

  return (
    <section aria-labelledby="daily-plan-title">
      <h2 id="daily-plan-title">학습 계획</h2>
      <div className="guardian-plan-loader">
        <label>
          계획 날짜
          <input
            onChange={(event) => {
              const value = event.currentTarget.value;
              planVersion.current += 1;
              setDate(value);
              setPlan(null);
              setMessage("");
              setLocked(false);
            }}
            type="date"
            value={date}
          />
        </label>
        <button type="button" onClick={() => void loadPlan()}>계획 불러오기</button>
      </div>
      {plan !== null && plan.studyDate === date ? (
        <form className="guardian-plan-form" onSubmit={savePlan}>
          <label>
            국어 목표
            <input
              max="10"
              min="0"
              disabled={locked}
              onChange={(event) => setKoreanTarget(event.currentTarget.valueAsNumber)}
              required
              type="number"
              value={koreanTarget}
            />
          </label>
          <label>
            수학 목표
            <input
              max="10"
              min="0"
              disabled={locked}
              onChange={(event) => setMathTarget(event.currentTarget.valueAsNumber)}
              required
              type="number"
              value={mathTarget}
            />
          </label>
          <label>
            국어 난이도
            <select
              disabled={locked}
              onChange={(event) => {
                const difficulty = Number(event.currentTarget.value);
                setSubjectSettings((current) => ({
                  ...current,
                  korean: { ...current.korean, difficulty }
                }));
              }}
              value={subjectSettings.korean.difficulty}
            >
              {[1, 2, 3, 4, 5].map((value) => (
                <option key={value} value={value}>{value}</option>
              ))}
            </select>
          </label>
          <label>
            국어 만점 보너스
            <select
              disabled={locked}
              onChange={(event) => {
                const challengeBonusStars = Number(event.currentTarget.value);
                setSubjectSettings((current) => ({
                  ...current,
                  korean: { ...current.korean, challengeBonusStars }
                }));
              }}
              value={subjectSettings.korean.challengeBonusStars}
            >
              {[0, 1, 2, 3, 4, 5].map((value) => (
                <option key={value} value={value}>{value}개</option>
              ))}
            </select>
          </label>
          <label>
            수학 난이도
            <select
              disabled={locked}
              onChange={(event) => {
                const difficulty = Number(event.currentTarget.value);
                setSubjectSettings((current) => ({
                  ...current,
                  math: { ...current.math, difficulty }
                }));
              }}
              value={subjectSettings.math.difficulty}
            >
              {[1, 2, 3, 4, 5].map((value) => (
                <option key={value} value={value}>{value}</option>
              ))}
            </select>
          </label>
          <label>
            수학 만점 보너스
            <select
              disabled={locked}
              onChange={(event) => {
                const challengeBonusStars = Number(event.currentTarget.value);
                setSubjectSettings((current) => ({
                  ...current,
                  math: { ...current.math, challengeBonusStars }
                }));
              }}
              value={subjectSettings.math.challengeBonusStars}
            >
              {[0, 1, 2, 3, 4, 5].map((value) => (
                <option key={value} value={value}>{value}개</option>
              ))}
            </select>
          </label>
          <label className="guardian-checkbox">
            <input
              checked={isRestDay}
              disabled={locked}
              onChange={(event) => setIsRestDay(event.currentTarget.checked)}
              type="checkbox"
            />
            쉬는 날
          </label>
          <button disabled={locked} type="submit">학습 계획 저장</button>
        </form>
      ) : null}
      {message !== "" ? <p role="status">{message}</p> : null}
    </section>
  );
}

type LedgerFilterForm = {
  from: string;
  to: string;
  direction: "all" | "earned" | "deducted";
  reason: "" | StarReason;
};

const EMPTY_LEDGER_FILTERS: LedgerFilterForm = {
  from: "",
  to: "",
  direction: "all",
  reason: ""
};

function ledgerQuery(filters: LedgerFilterForm): GuardianLedgerFilters {
  return {
    ...(filters.from === "" ? {} : { from: filters.from }),
    ...(filters.to === "" ? {} : { to: filters.to }),
    direction: filters.direction,
    ...(filters.reason === "" ? {} : { reason: filters.reason })
  };
}

function LedgerPanel({ api }: { api: GuardianDashboardApi }) {
  const [draft, setDraft] = useState<LedgerFilterForm>(EMPTY_LEDGER_FILTERS);
  const applied = useRef<GuardianLedgerFilters>({ direction: "all" });
  const loadVersion = useRef(0);
  const paginationReady = useRef(false);
  const [ledger, setLedger] = useState<GuardianStarLedger | null>(null);
  const [failed, setFailed] = useState(false);
  const [manualDelta, setManualDelta] = useState("");
  const [manualReason, setManualReason] = useState("");
  const [manualCommandId, setManualCommandId] = useState<string | null>(null);
  const [manualMessage, setManualMessage] = useState("");
  const manualInFlight = useRef(false);
  const [manualSaving, setManualSaving] = useState(false);
  const [reversalNotes, setReversalNotes] = useState<Record<string, string>>({});
  const [reversalErrors, setReversalErrors] = useState<Record<string, string>>({});
  const reversalInFlight = useRef(new Set<string>());
  const [reversingIds, setReversingIds] = useState<Set<string>>(new Set());

  const load = async (
    query: GuardianLedgerFilters,
    append = false
  ): Promise<boolean> => {
    if (append && !paginationReady.current) return true;
    paginationReady.current = false;
    const requestVersion = ++loadVersion.current;
    if (!append) setLedger(null);
    setFailed(false);
    try {
      const loaded = await api.getGuardianStars(query);
      if (loadVersion.current !== requestVersion) return true;
      setLedger((current) => append && current !== null ? {
        ...loaded,
        events: [...current.events, ...loaded.events]
      } : loaded);
      return true;
    } catch {
      if (loadVersion.current !== requestVersion) return true;
      setFailed(true);
      return false;
    } finally {
      if (loadVersion.current === requestVersion) paginationReady.current = true;
    }
  };

  useEffect(() => {
    void load({ direction: "all" });
  }, [api]);

  const applyFilters = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const query = ledgerQuery(draft);
    applied.current = query;
    void load(query);
  };

  const applyManualAdjustment = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (manualInFlight.current) return;
    const delta = Number(manualDelta);
    const reason = manualReason.trim();
    if (!Number.isInteger(delta) || delta === 0 || reason.length === 0) return;
    if (delta < 0 && !window.confirm("별을 직접 차감할까요?")) return;
    const clientCommandId = manualCommandId ?? crypto.randomUUID();
    manualInFlight.current = true;
    setManualSaving(true);
    setManualCommandId(clientCommandId);
    setManualMessage("");
    try {
      await api.applyManualStars({ delta, reason, clientCommandId });
      const reconciled = await load(applied.current);
      setManualCommandId(null);
      setManualDelta("");
      setManualReason("");
      if (!reconciled) {
        setManualMessage("별 조정은 저장했지만 최신 별 기록을 불러오지 못했어요.");
      }
    } catch {
      setManualMessage("별 조정을 저장하지 못했어요. 다시 시도해 주세요.");
    } finally {
      manualInFlight.current = false;
      setManualSaving(false);
    }
  };

  const reverse = async (eventId: string) => {
    if (reversalInFlight.current.has(eventId)) return;
    const note = reversalNotes[eventId]?.trim() ?? "";
    if (note.length === 0) return;
    if (!window.confirm("이 별 기록을 되돌릴까요?")) return;
    reversalInFlight.current.add(eventId);
    setReversingIds(new Set(reversalInFlight.current));
    setReversalErrors((current) => ({ ...current, [eventId]: "" }));
    try {
      await api.reverseStarEvent(eventId, { note });
      const reconciled = await load(applied.current);
      if (!reconciled) {
        setReversalErrors((current) => ({
          ...current,
          [eventId]: "기록은 되돌렸지만 최신 별 기록을 불러오지 못했어요. 다시 불러와 주세요."
        }));
      }
    } catch {
      const reconciled = await load(applied.current);
      setReversalErrors((current) => ({
        ...current,
        [eventId]: reconciled
          ? "기록을 되돌리지 못했어요. 최신 별 기록을 확인했어요."
          : "기록을 되돌리지 못했고 최신 별 기록도 불러오지 못했어요. 다시 시도해 주세요."
      }));
    } finally {
      reversalInFlight.current.delete(eventId);
      setReversingIds(new Set(reversalInFlight.current));
    }
  };

  return (
    <section aria-labelledby="ledger-title">
      <h2 id="ledger-title">별 기록</h2>
      <form className="guardian-manual-stars" onSubmit={applyManualAdjustment}>
        <h3>별 직접 조정</h3>
        <label>
          별 수
          <input
            disabled={manualSaving}
            max="100"
            min="-100"
            onChange={(event) => {
              setManualDelta(event.currentTarget.value);
              setManualCommandId(null);
              setManualMessage("");
            }}
            required
            type="number"
            value={manualDelta}
          />
        </label>
        <label>
          조정 사유
          <input
            disabled={manualSaving}
            maxLength={200}
            onChange={(event) => {
              setManualReason(event.currentTarget.value);
              setManualCommandId(null);
              setManualMessage("");
            }}
            required
            type="text"
            value={manualReason}
          />
        </label>
        <button disabled={manualSaving} type="submit">별 조정 저장</button>
        {manualMessage !== "" ? <p role="status">{manualMessage}</p> : null}
      </form>
      <form className="guardian-filter" onSubmit={applyFilters}>
        <label>
          시작일
          <input
            onChange={(event) => {
              const value = event.currentTarget.value;
              setDraft((current) => ({ ...current, from: value }));
            }}
            type="date"
            value={draft.from}
          />
        </label>
        <label>
          종료일
          <input
            onChange={(event) => {
              const value = event.currentTarget.value;
              setDraft((current) => ({ ...current, to: value }));
            }}
            type="date"
            value={draft.to}
          />
        </label>
        <label>
          방향
          <select
            onChange={(event) => {
              const value = event.currentTarget.value as LedgerFilterForm["direction"];
              setDraft((current) => ({ ...current, direction: value }));
            }}
            value={draft.direction}
          >
            <option value="all">전체</option>
            <option value="earned">적립</option>
            <option value="deducted">차감</option>
          </select>
        </label>
        <label>
          사유
          <select
            onChange={(event) => {
              const value = event.currentTarget.value as LedgerFilterForm["reason"];
              setDraft((current) => ({ ...current, reason: value }));
            }}
            value={draft.reason}
          >
            <option value="">전체</option>
            <option value="REQUIRED_ITEM_COMPLETED">필수 학습 완료</option>
            <option value="IDLE_TIMEOUT">5분 무반응</option>
            <option value="MISSED_DAILY_PLAN">학습 계획 미완료</option>
            <option value="GUARDIAN_BONUS">보호자 보너스</option>
            <option value="GUARDIAN_ADJUSTMENT">보호자 조정</option>
            <option value="REWARD_REDEMPTION">보상 사용</option>
            <option value="REVERSAL">되돌리기</option>
            <option value="NO_BALANCE_AUDIT">잔액 없음 기록</option>
          </select>
        </label>
        <button type="submit">필터 적용</button>
      </form>
      {failed ? <p role="alert">별 기록을 불러오지 못했어요.</p> : null}
      {ledger === null && !failed ? <p aria-busy="true">별 기록을 불러오고 있어요.</p> : null}
      {ledger !== null ? (
        <>
          <p>별 잔액 {ledger.summary.balance}개</p>
          {ledger.events.length === 0 ? <p>조건에 맞는 별 기록이 없어요.</p> : null}
          <div className="guardian-list">
            {ledger.events.map((event) => {
              return (
                <article
                  aria-label={`${event.studyDate} 별 기록`}
                  className="guardian-card"
                  key={event.id}
                >
                  <h3>{event.reasonText}</h3>
                  <p>{event.studyDate}</p>
                  <p>
                    요청 {event.requestedDelta > 0 ? "+" : ""}{event.requestedDelta}개 · 실제 {event.delta > 0 ? "+" : ""}{event.delta}개 · 잔액 {event.balanceAfter}개
                  </p>
                  {event.reversesEventId !== null ? (
                    <p className="ledger-link">원래 기록에 연결된 되돌리기</p>
                  ) : null}
                  {event.reason !== "REVERSAL" && !event.isReversed ? (
                    <>
                      <label>
                        되돌리기 사유
                        <input
                          disabled={reversingIds.has(event.id)}
                          maxLength={200}
                          onChange={(inputEvent) => {
                            const value = inputEvent.currentTarget.value;
                            setReversalNotes((current) => ({
                              ...current,
                              [event.id]: value
                            }));
                          }}
                          required
                          type="text"
                          value={reversalNotes[event.id] ?? ""}
                        />
                      </label>
                      <button
                        disabled={reversingIds.has(event.id)}
                        type="button"
                        onClick={() => void reverse(event.id)}
                      >
                        기록 되돌리기
                      </button>
                    </>
                  ) : null}
                  {reversalErrors[event.id] ? (
                    <p role="alert">{reversalErrors[event.id]}</p>
                  ) : null}
                </article>
              );
            })}
          </div>
          {ledger.nextCursor !== null ? (
            <button
              type="button"
              onClick={() => void load({
                ...applied.current,
                cursor: ledger.nextCursor ?? undefined
              }, true)}
            >
              다음 기록 100개
            </button>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

function AdjustmentsPanel({ api }: { api: GuardianDashboardApi }) {
  const [adjustments, setAdjustments] = useState<PendingStarAdjustment[] | null>(null);
  const [approvedStars, setApprovedStars] = useState<Record<string, number>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [waiverNotes, setWaiverNotes] = useState<Record<string, string>>({});
  const [failed, setFailed] = useState(false);
  const mutationInFlight = useRef(new Set<string>());
  const [mutatingIds, setMutatingIds] = useState<Set<string>>(new Set());
  const [mutationErrors, setMutationErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    let active = true;
    void api.getStarAdjustments().then(
      ({ adjustments: loaded }) => {
        if (active) setAdjustments(loaded);
      },
      () => {
        if (active) setFailed(true);
      }
    );
    return () => {
      active = false;
    };
  }, [api]);

  const beginMutation = (adjustmentId: string): boolean => {
    if (mutationInFlight.current.size > 0) return false;
    mutationInFlight.current.add(adjustmentId);
    setMutatingIds(new Set(mutationInFlight.current));
    setMutationErrors((current) => ({ ...current, [adjustmentId]: "" }));
    return true;
  };

  const finishMutation = (adjustmentId: string) => {
    mutationInFlight.current.delete(adjustmentId);
    setMutatingIds(new Set(mutationInFlight.current));
  };

  const reconcileAdjustments = async (): Promise<boolean> => {
    try {
      const { adjustments: loaded } = await api.getStarAdjustments();
      setAdjustments(loaded);
      return true;
    } catch {
      return false;
    }
  };

  const approve = async (adjustment: PendingStarAdjustment) => {
    if (mutationInFlight.current.size > 0) return;
    if (!window.confirm("별 차감을 승인할까요?")) return;
    if (!beginMutation(adjustment.id)) return;
    try {
      const updated = await api.approveStarAdjustment(adjustment.id, {
        approvedStars: approvedStars[adjustment.id] ?? Math.min(1, adjustment.requestedStars),
        note: notes[adjustment.id] ?? ""
      });
      setAdjustments((current) => current?.map((item) =>
        item.id === adjustment.id ? updated : item
      ) ?? null);
    } catch {
      const reconciled = await reconcileAdjustments();
      setMutationErrors((current) => ({
        ...current,
        [adjustment.id]: reconciled
          ? "차감 승인을 완료하지 못했어요. 최신 상태를 확인했어요."
          : "차감 승인을 완료하지 못했고 최신 상태도 불러오지 못했어요. 다시 시도해 주세요."
      }));
    } finally {
      finishMutation(adjustment.id);
    }
  };

  const waive = async (adjustment: PendingStarAdjustment) => {
    if (mutationInFlight.current.size > 0) return;
    const note = waiverNotes[adjustment.id]?.trim() ?? "";
    if (note.length === 0) return;
    if (!beginMutation(adjustment.id)) return;
    try {
      const updated = await api.waiveStarAdjustment(adjustment.id, { note });
      setAdjustments((current) => current?.map((item) =>
        item.id === adjustment.id ? updated : item
      ) ?? null);
    } catch {
      const reconciled = await reconcileAdjustments();
      setMutationErrors((current) => ({
        ...current,
        [adjustment.id]: reconciled
          ? "면제를 완료하지 못했어요. 최신 상태를 확인했어요."
          : "면제를 완료하지 못했고 최신 상태도 불러오지 못했어요. 다시 시도해 주세요."
      }));
    } finally {
      finishMutation(adjustment.id);
    }
  };

  if (failed) return <p role="alert">차감 요청을 불러오지 못했어요.</p>;
  if (adjustments === null) return <p aria-busy="true">차감 요청을 불러오고 있어요.</p>;
  if (adjustments.length === 0) return <p>확인할 차감 요청이 없어요.</p>;

  return (
    <section aria-labelledby="adjustments-title">
      <h2 id="adjustments-title">차감 승인</h2>
      <div className="guardian-list">
        {adjustments.map((adjustment) => (
          <article
            aria-label={`${adjustment.studyDate} 차감 요청`}
            className="guardian-card"
            key={adjustment.id}
          >
            <h3>{adjustment.studyDate} 학습 계획</h3>
            <div className="adjustment-values">
              <span>요청 {adjustment.requestedStars}개</span>
              <span>승인 {adjustment.approvedStars === null ? "—" : `${adjustment.approvedStars}개`}</span>
              <span>실제 적용 {adjustment.appliedStars === null ? "—" : `${adjustment.appliedStars}개`}</span>
            </div>
            <p>처리 상태 {ADJUSTMENT_STATUS_LABELS[adjustment.status]}</p>
            {adjustment.status !== "pending" ? (
              <p>처리 메모 {adjustment.note?.trim() || "없음"}</p>
            ) : null}
            {adjustment.status === "pending" ? (
              <>
                <label>
                  승인할 별
                  <input
                    disabled={mutatingIds.size > 0}
                    max={adjustment.requestedStars}
                    min="0"
                    onChange={(event) => {
                      const value = event.currentTarget.valueAsNumber;
                      setApprovedStars((current) => ({
                        ...current,
                        [adjustment.id]: value
                      }));
                    }}
                    type="number"
                    value={approvedStars[adjustment.id] ?? Math.min(1, adjustment.requestedStars)}
                  />
                </label>
                <label>
                  승인 메모 (선택)
                  <input
                    disabled={mutatingIds.size > 0}
                    maxLength={200}
                    onChange={(event) => {
                      const value = event.currentTarget.value;
                      setNotes((current) => ({
                        ...current,
                        [adjustment.id]: value
                      }));
                    }}
                    type="text"
                    value={notes[adjustment.id] ?? ""}
                  />
                </label>
                <button
                  disabled={mutatingIds.size > 0}
                  type="button"
                  onClick={() => void approve(adjustment)}
                >
                  차감 승인
                </button>
                <label>
                  면제 사유
                  <input
                    disabled={mutatingIds.size > 0}
                    maxLength={200}
                    onChange={(event) => {
                      const value = event.currentTarget.value;
                      setWaiverNotes((current) => ({
                        ...current,
                        [adjustment.id]: value
                      }));
                    }}
                    required
                    type="text"
                    value={waiverNotes[adjustment.id] ?? ""}
                  />
                </label>
                <button
                  disabled={mutatingIds.size > 0}
                  type="button"
                  onClick={() => void waive(adjustment)}
                >
                  아픈 날로 면제
                </button>
              </>
            ) : null}
            {mutationErrors[adjustment.id] ? (
              <p role="alert">{mutationErrors[adjustment.id]}</p>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}
