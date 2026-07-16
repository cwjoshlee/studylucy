import { useEffect, useRef, useState } from "react";
import type { GuardianProgress } from "../../shared/learning";
import type {
  GuardianStarLedger,
  GuardianDailyPlan,
  PendingStarAdjustment,
  StarReason
} from "../../shared/stars";
import type {
  ApiClient,
  BackupStatus,
  GuardianLedgerFilters
} from "../api/client";
import { ApiError } from "../api/client";

type GuardianDashboardApi = Pick<ApiClient,
  | "getGuardianProgress"
  | "getGuardianStars"
  | "applyManualStars"
  | "reverseStarEvent"
  | "getStarAdjustments"
  | "approveStarAdjustment"
  | "waiveStarAdjustment"
  | "getGuardianDailyPlan"
  | "updateGuardianDailyPlan"
  | "getBackupStatus"
>;

type DashboardData = {
  progress: GuardianProgress;
  ledger: GuardianStarLedger;
};

const TABS = ["진도", "별 기록", "차감 승인", "학습 계획", "백업"] as const;
type GuardianTab = typeof TABS[number];

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

function progressRange(): { from: string; to: string } {
  const now = new Date();
  const from = new Date(now);
  from.setDate(from.getDate() - 6);
  return { from: studyDate(from), to: studyDate(now) };
}

export function GuardianDashboard({ api }: { api: GuardianDashboardApi }) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [failed, setFailed] = useState(false);
  const [activeTab, setActiveTab] = useState<GuardianTab>("진도");

  useEffect(() => {
    let active = true;
    const range = progressRange();
    void Promise.all([
      api.getGuardianProgress(range.from, range.to),
      api.getGuardianStars()
    ]).then(
      ([progress, ledger]) => {
        if (active) setData({ progress, ledger });
      },
      () => {
        if (active) setFailed(true);
      }
    );
    return () => {
      active = false;
    };
  }, [api]);

  return (
    <div className="guardian-shell">
      <header className="guardian-header">
        <p className="eyebrow">보호자 로그인으로 보호되어 있어요</p>
        <h1>보호자 공간</h1>
      </header>
      <nav className="guardian-tabs" aria-label="보호자 메뉴" role="tablist">
        {TABS.map((tab) => (
          <button
            aria-selected={tab === activeTab}
            key={tab}
            onClick={() => setActiveTab(tab)}
            role="tab"
            type="button"
          >
            {tab}
          </button>
        ))}
      </nav>
      <main className="guardian-panel" role="tabpanel" aria-label={activeTab}>
        {activeTab === "진도" ? (
          <ProgressPanel data={data} failed={failed} />
        ) : null}
        {activeTab === "별 기록" ? <LedgerPanel api={api} /> : null}
        {activeTab === "차감 승인" ? <AdjustmentsPanel api={api} /> : null}
        {activeTab === "학습 계획" ? <DailyPlanPanel api={api} /> : null}
        {activeTab === "백업" ? <BackupPanel api={api} /> : null}
      </main>
    </div>
  );
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
          </>
        ) : null}
    </>
  );
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
        isRestDay
      });
      if (planVersion.current !== requestVersion) return;
      setPlan(updated);
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
