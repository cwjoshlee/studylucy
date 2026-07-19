import { useCallback, useEffect, useRef, useState } from "react";
import type { CompanionId } from "../../shared/companions";
import type { PlanItem, TodayPlan } from "../../shared/learning";
import type { StudentStarSummary } from "../../shared/stars";
import type { ClientApi } from "../api/client";
import { COMPANION_CAST } from "../companions/cast";
import { CompanionAvatar } from "../companions/companion-avatar";
import { FriendStage, FriendTrail } from "../companions/friend-stage";
import { TodayStars } from "../delight/today-stars";
import { LearningSession } from "../learning/learning-session";
import { StudentNavigation } from "./student-navigation";
import {
  SOURCE_DEVICE_RECOVERY_GUIDANCE,
  subscribeRecoveryGuidance,
  subscribeSyncCompleted,
  type RecoveryGuidance
} from "../offline/sync";
import {
  cacheIssuedPlan,
  getQueueCounts,
  getProvisionalItemIds,
  getReceiptAuthorityGeneration,
  loadOfflineStudentSession,
  recoveryGroups,
  subscribeConfirmedStars,
  subscribeQueueCounts,
  updateCachedPlanActivityCursor,
  type OfflineStudentSession,
  type QueueCounts
} from "../offline/db";

type StudentData = { plan: TodayPlan; stars: StudentStarSummary };

export type StepStatus = "locked" | "available" | "complete";

const STEP_ORDER = ["foundation", "current", "challenge"] as const;
const STEP_LABEL = {
  foundation: "기초 다지기",
  current: "현재 수준",
  challenge: "도전"
} as const;

export function stepStatus(
  items: readonly PlanItem[],
  completedItemIds: readonly string[],
  item: PlanItem
): StepStatus {
  if (completedItemIds.includes(item.id)) return "complete";
  const position = STEP_ORDER.indexOf(item.step);
  const earlierSubjectItems = items.filter((candidate) =>
    candidate.payload.subject === item.payload.subject &&
    STEP_ORDER.indexOf(candidate.step) < position
  );
  return earlierSubjectItems.every((candidate) => completedItemIds.includes(candidate.id))
    ? "available"
    : "locked";
}

function nextAvailableRequiredItem(plan: TodayPlan): PlanItem | null {
  const requiredIds = new Set(plan.requiredItemIds);
  const requiredItems = plan.items.filter((item) => requiredIds.has(item.id));
  return requiredItems.find((item) =>
    !plan.completedItemIds.includes(item.id) &&
    stepStatus(requiredItems, plan.completedItemIds, item) === "available"
  ) ?? null;
}

export function StudentHome({
  api,
  offlineSession,
  onEnterGuardianMode,
  onLogout
}: {
  api: ClientApi;
  offlineSession?: OfflineStudentSession | null;
  onEnterGuardianMode?: () => Promise<void>;
  onLogout?: () => Promise<void>;
}) {
  const [data, setData] = useState<StudentData | null>(() =>
    offlineSession === null || offlineSession === undefined
      ? null
      : { plan: offlineSession.plan, stars: offlineSession.stars }
  );
  const [failed, setFailed] = useState(false);
  const [queuedCount, setQueuedCount] = useState(0);
  const [offlineMode, setOfflineMode] = useState(offlineSession != null);
  const [recoveryGuidance, setRecoveryGuidance] =
    useState<RecoveryGuidance | null>(null);
  const [provisionalItemIds, setProvisionalItemIds] = useState<Set<string>>(
    () => new Set()
  );
  const [selectedItem, setSelectedItem] = useState<TodayPlan["items"][number] | null>(null);
  const [learningViewOpen, setLearningViewOpen] = useState(false);
  const [postCompletionRefreshFailed, setPostCompletionRefreshFailed] = useState(false);
  const [postCompletionRefreshPending, setPostCompletionRefreshPending] = useState(false);
  const [navigationHelpOpen, setNavigationHelpOpen] = useState(false);
  const authorityRequestGeneration = useRef(0);
  const mountedRef = useRef(true);
  const dashboardFocusTarget = useRef<HTMLButtonElement>(null);
  const showDashboardPreservingDraft = useCallback(() => {
    setLearningViewOpen(false);
  }, []);
  const discardLearningSession = useCallback(() => {
    setLearningViewOpen(false);
    setSelectedItem(null);
    setPostCompletionRefreshFailed(false);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      authorityRequestGeneration.current += 1;
    };
  }, []);

  useEffect(() => {
    let active = true;
    const loadProvisionalItems = () => {
      void getProvisionalItemIds().then((ids) => {
        if (active) setProvisionalItemIds(new Set(ids));
      }, () => undefined);
    };
    const loadAuthoritativeData = (showFailure: boolean) => {
      const requestGeneration = ++authorityRequestGeneration.current;
      const receiptGeneration = getReceiptAuthorityGeneration();
      void (async () => {
        try {
          const [plan, stars] = await Promise.all([
            api.getToday(),
            api.getStudentStars()
          ]);
          if (!active || requestGeneration !== authorityRequestGeneration.current) {
            return;
          }
          const cached = await cacheIssuedPlan(plan, stars, {
            expectedReceiptGeneration: receiptGeneration
          });
          if (
            cached &&
            active &&
            requestGeneration === authorityRequestGeneration.current
          ) {
            setData({ plan, stars });
            setOfflineMode(false);
            setFailed(false);
          }
        } catch (error: unknown) {
          if (!active || !showFailure) return;
          if (error instanceof TypeError) {
            const cached = await loadOfflineStudentSession().catch(() => undefined);
            if (!active) return;
            if (cached !== undefined) {
              setData({ plan: cached.plan, stars: cached.stars });
              setOfflineMode(true);
              setFailed(false);
              return;
            }
          }
          if (active) setFailed(true);
        }
      })();
    };
    const updateQueueCounts = (counts: QueueCounts) => {
      if (active) {
        setQueuedCount(counts.provisionalAttempts);
        loadProvisionalItems();
      }
    };
    const unsubscribe = subscribeQueueCounts(updateQueueCounts);
    const unsubscribeConfirmedStars = subscribeConfirmedStars((stars) => {
      if (active) {
        setData((current) => current === null ? current : { ...current, stars });
      }
    });
    const unsubscribeSyncCompleted = subscribeSyncCompleted(() => {
      loadAuthoritativeData(false);
      loadProvisionalItems();
    });
    let recoveryGuidanceEventSeen = false;
    const unsubscribeRecoveryGuidance = subscribeRecoveryGuidance((guidance) => {
      recoveryGuidanceEventSeen = true;
      if (active) setRecoveryGuidance(guidance);
    });
    void recoveryGroups().then((groups) => {
      if (!active || recoveryGuidanceEventSeen) return;
      setRecoveryGuidance(groups.some(
        (group) => group.recoveryBlockedCode === "SOURCE_DEVICE_STILL_ACTIVE"
      ) ? SOURCE_DEVICE_RECOVERY_GUIDANCE : null);
    }, () => undefined);
    void getQueueCounts().then(updateQueueCounts, () => undefined);
    loadProvisionalItems();
    if (offlineSession == null) loadAuthoritativeData(true);
    return () => {
      active = false;
      unsubscribe();
      unsubscribeConfirmedStars();
      unsubscribeSyncCompleted();
      unsubscribeRecoveryGuidance();
    };
  }, [api, offlineSession]);

  const refreshAfterCompletion = useCallback(async (
    openNextItem: boolean
  ): Promise<void> => {
    const requestGeneration = ++authorityRequestGeneration.current;
    const receiptGeneration = getReceiptAuthorityGeneration();
    setPostCompletionRefreshPending(true);
    try {
      const [plan, stars] = await Promise.all([
        api.getToday(),
        api.getStudentStars()
      ]);
      if (
        !mountedRef.current ||
        requestGeneration !== authorityRequestGeneration.current
      ) return;
      const cached = await cacheIssuedPlan(plan, stars, {
        expectedReceiptGeneration: receiptGeneration
      });
      if (
        !cached ||
        !mountedRef.current ||
        requestGeneration !== authorityRequestGeneration.current
      ) {
        if (
          mountedRef.current &&
          requestGeneration === authorityRequestGeneration.current
        ) setPostCompletionRefreshFailed(true);
        return;
      }
      setData({ plan, stars });
      setOfflineMode(false);
      setPostCompletionRefreshFailed(false);
      const nextItem = openNextItem ? nextAvailableRequiredItem(plan) : null;
      setSelectedItem(nextItem);
      setLearningViewOpen(nextItem !== null);
    } catch {
      if (
        mountedRef.current &&
        requestGeneration === authorityRequestGeneration.current
      ) setPostCompletionRefreshFailed(true);
    } finally {
      if (
        mountedRef.current &&
        requestGeneration === authorityRequestGeneration.current
      ) setPostCompletionRefreshPending(false);
    }
  }, [api]);

  const retryPostCompletionRefresh = useCallback(() =>
    refreshAfterCompletion(true), [refreshAfterCompletion]);

  if (failed) return <main>오늘의 학습을 불러오지 못했어요. 잠시 후 다시 만나요.</main>;
  if (data === null) return <main aria-busy="true">오늘의 학습을 준비하고 있어요.</main>;

  async function finishLearning(): Promise<void> {
    if (selectedItem !== null && provisionalItemIds.has(selectedItem.id)) {
      setSelectedItem(null);
      setLearningViewOpen(false);
      return;
    }
    await refreshAfterCompletion(false);
  }

  const requiredIds = new Set(data.plan.requiredItemIds);
  const requiredItems = data.plan.items.filter((item) => requiredIds.has(item.id));
  const optionalItems = data.plan.items.filter((item) => !requiredIds.has(item.id));
  const completedRequiredCount = requiredItems.filter((item) =>
    data.plan.completedItemIds.includes(item.id)
  ).length;
  const nextRequired = requiredItems.find((item) =>
    stepStatus(requiredItems, data.plan.completedItemIds, item) === "available"
  ) ?? requiredItems[0] ?? null;
  const metCompanions = Array.from(new Set(data.plan.completedItemIds.flatMap((id) => {
    const item = data.plan.items.find((candidate) => candidate.id === id);
    return item === undefined
      ? []
      : [item.payload.delight?.companion ?? (item.payload.subject === "korean" ? "toto" : "momo")];
  }))) as CompanionId[];
  const renderCard = (item: TodayPlan["items"][number], required: boolean) => {
    const status = required
      ? stepStatus(requiredItems, data.plan.completedItemIds, item)
      : "available";
    const completed = status === "complete";
    const provisional = provisionalItemIds.has(item.id) && !completed;
    const stageLabel = item.step === undefined ? null : STEP_LABEL[item.step];
    const companion = item.payload.delight?.companion
      ?? (item.payload.subject === "korean" ? "toto" : "momo");
    return (
      <article className={`study-card ${required ? "study-card--required" : ""}`} key={item.id}>
        <p className="subject-chip">
          {item.payload.subject === "korean" ? "국어" : "수학"} · {stageLabel === null ? item.payload.unit : `${stageLabel} · ${item.payload.unit}`}
        </p>
        <h3>{item.payload.title}</h3>
        <div className="study-card__friend">
          <CompanionAvatar id={companion} size="small" decorative />
          <strong>{COMPANION_CAST[companion].name}</strong>
        </div>
        {item.payload.delight === undefined ? null : (
          <div className="study-card__mishap">
            <strong>오늘의 우당탕 사건</strong>
            <p>{item.payload.delight.mishap}</p>
          </div>
        )}
        {required ? (
          <span className="reward-claim" data-testid="required-star">
            {completed ? "★ 받은 별 1개" : "★ 완료하면 별 1개"}
          </span>
        ) : null}
        {completed ? <strong>함께 해결했어요</strong> : null}
        {provisional ? <strong className="provisional-label">동기화 대기</strong> : null}
        <button
          type="button"
          disabled={status === "locked"}
          onClick={() => {
            setSelectedItem(item);
            setLearningViewOpen(true);
          }}
        >
          {stageLabel === null ? "" : `${stageLabel} · `}{item.payload.title} 시작하기
        </button>
      </article>
    );
  };

  return (
    <>
      {selectedItem === null ? null : (
        <main className="student-learning-view" hidden={!learningViewOpen}>
          <LearningSession
            active={learningViewOpen}
            item={selectedItem}
            api={api}
            planId={data.plan.planId}
            studyDate={data.plan.date}
            offlineEligibility={offlineMode ? "validated" : undefined}
            onProvisional={() => {
              setProvisionalItemIds((current) => new Set(current).add(selectedItem.id));
            }}
            onActivityCursor={(activityCursor) => {
              void updateCachedPlanActivityCursor(
                data.plan.planId,
                activityCursor
              );
              setData((current) => current === null
                ? current
                : {
                    ...current,
                    plan: {
                      ...current.plan,
                      activityCursor: Math.max(
                        current.plan.activityCursor,
                        activityCursor
                      )
                    }
                  });
            }}
            onNext={finishLearning}
            onRetryRefresh={retryPostCompletionRefresh}
            postCompletionRefreshFailed={postCompletionRefreshFailed}
            postCompletionRefreshPending={postCompletionRefreshPending}
            onExit={discardLearningSession}
            onNavigateToday={showDashboardPreservingDraft}
            getNavigationDestinationFocusTarget={() => dashboardFocusTarget.current}
          />
        </main>
      )}
      <div
        className="responsive-shell student-responsive-shell"
        hidden={learningViewOpen}
      >
      <StudentNavigation
        activeId={navigationHelpOpen ? "help" : "today"}
        onExit={() => window.history.back()}
        onHelp={() => setNavigationHelpOpen((open) => !open)}
        onPauseForBreak={() => undefined}
        onToday={() => setNavigationHelpOpen(false)}
      />
      <div className="student-shell responsive-shell__content">
      <header className="student-header">
        <p>수아야, 오늘도 한 걸음!</p>
        <div className="student-account-actions">
          <button
            className="button-secondary"
            onClick={() => void onEnterGuardianMode?.()}
            ref={dashboardFocusTarget}
            type="button"
          >
            보호자 모드
          </button>
          <button onClick={() => void onLogout?.()} type="button">
            로그아웃
          </button>
        </div>
      </header>
      <aside className="student-shell__left" aria-label="마법 친구 쉼터">
        <FriendStage
          studyDate={data.plan.date}
          itemId={nextRequired?.id ?? null}
          subject={nextRequired?.payload.subject ?? null}
          completedCount={completedRequiredCount}
          totalCount={requiredItems.length}
        />
      </aside>
      <main className="student-shell__main">
        <div className="student-shell__intro">
          {offlineMode ? <p className="offline-learning-banner" role="status">오프라인 학습 중</p> : null}
          {recoveryGuidance === null ? null : (
            <p className="recovery-guidance" role="status">{recoveryGuidance}</p>
          )}
          <h1>오늘의 학습</h1>
          {navigationHelpOpen ? (
            <p role="status">도움이 필요하면 보호자와 함께 학습 카드를 골라 보세요.</p>
          ) : null}
        </div>
        <section className="learning-section student-shell__required" aria-labelledby="required-title">
          <div className="section-heading">
            <h2 id="required-title">필수 학습</h2>
            <span>{requiredItems.length}개의 마법 걸음</span>
          </div>
          <div className="step-up-groups">
            {(["korean", "math"] as const).map((subject) => {
              const subjectItems = requiredItems
                .filter((item) => item.payload.subject === subject)
                .sort((left, right) => STEP_ORDER.indexOf(left.step) - STEP_ORDER.indexOf(right.step));
              if (subjectItems.length === 0) return null;
              const subjectLabel = subject === "korean" ? "국어" : "수학";
              return (
                <section
                  className="step-up-group"
                  role="group"
                  aria-label={`${subjectLabel} 스텝업`}
                  key={subject}
                >
                  <h3>{subjectLabel} 기초부터 도전까지</h3>
                  <div className="study-grid">
                    {subjectItems.map((item) => renderCard(item, true))}
                  </div>
                </section>
              );
            })}
          </div>
        </section>
        <aside className="student-shell__right" aria-label="별 현황">
          <TodayStars summary={data.stars} queuedCount={queuedCount} />
          <FriendTrail
            completedCount={completedRequiredCount}
            totalCount={requiredItems.length}
            metCompanions={metCompanions}
          />
          {requiredItems.length === 0 ? (
            <p className="friend-trail__zero-progress">마법 걸음 0/0</p>
          ) : null}
        </aside>
        <section className="learning-section learning-section--optional student-shell__optional" aria-labelledby="optional-title">
          <div className="section-heading">
            <h2 id="optional-title">선택 학습</h2>
            <span>더 해 보고 싶을 때 만나요</span>
          </div>
          <div className="study-grid">{optionalItems.map((item) => renderCard(item, false))}</div>
        </section>
      </main>
      </div>
      </div>
    </>
  );
}
