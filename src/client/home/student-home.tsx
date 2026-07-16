import { useEffect, useState } from "react";
import type { TodayPlan } from "../../shared/learning";
import type { StudentStarSummary } from "../../shared/stars";
import type { ClientApi } from "../api/client";
import { StarBunny } from "../delight/star-bunny";
import { TodayStars } from "../delight/today-stars";
import { LearningSession } from "../learning/learning-session";
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
  loadOfflineStudentSession,
  recoveryGroups,
  subscribeConfirmedStars,
  subscribeQueueCounts,
  updateCachedPlanActivityCursor,
  type OfflineStudentSession,
  type QueueCounts
} from "../offline/db";

type StudentData = { plan: TodayPlan; stars: StudentStarSummary };

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

  useEffect(() => {
    let active = true;
    const loadProvisionalItems = () => {
      void getProvisionalItemIds().then((ids) => {
        if (active) setProvisionalItemIds(new Set(ids));
      }, () => undefined);
    };
    const loadAuthoritativeData = (showFailure: boolean) => {
      void (async () => {
        try {
          const [plan, stars] = await Promise.all([
            api.getToday(),
            api.getStudentStars()
          ]);
          await cacheIssuedPlan(plan, stars);
          if (active) {
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
      if (active) setQueuedCount(counts.provisionalAttempts);
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

  if (failed) return <main>오늘의 학습을 불러오지 못했어요. 잠시 후 다시 만나요.</main>;
  if (data === null) return <main aria-busy="true">오늘의 학습을 준비하고 있어요.</main>;

  async function finishLearning(): Promise<void> {
    if (selectedItem !== null && provisionalItemIds.has(selectedItem.id)) {
      setSelectedItem(null);
      return;
    }
    try {
      const [plan, stars] = await Promise.all([
        api.getToday(),
        api.getStudentStars()
      ]);
      await cacheIssuedPlan(plan, stars);
      setData({ plan, stars });
      setOfflineMode(false);
      setSelectedItem(null);
    } catch {
      setFailed(true);
    }
  }

  if (selectedItem !== null) {
    return (
      <main className="student-learning-view">
        <LearningSession
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
          onExit={() => setSelectedItem(null)}
        />
      </main>
    );
  }

  const requiredIds = new Set(data.plan.requiredItemIds);
  const requiredItems = data.plan.items.filter((item) => requiredIds.has(item.id));
  const optionalItems = data.plan.items.filter((item) => !requiredIds.has(item.id));
  const renderCard = (item: TodayPlan["items"][number], required: boolean) => {
    const completed = data.plan.completedItemIds.includes(item.id);
    const provisional = provisionalItemIds.has(item.id) && !completed;
    return (
      <article className={`study-card ${required ? "study-card--required" : ""}`} key={item.id}>
        <p className="subject-chip">{item.payload.subject === "korean" ? "국어" : "수학"} · {item.payload.unit}</p>
        <h3>{item.payload.title}</h3>
        {required ? (
          <span className="reward-claim" data-testid="required-star">
            {completed ? "★ 받은 별 1개" : "★ 완료하면 별 1개"}
          </span>
        ) : null}
        {completed ? <strong>완료했어요</strong> : null}
        {provisional ? <strong className="provisional-label">동기화 대기</strong> : null}
        <button type="button" onClick={() => setSelectedItem(item)}>
          {item.payload.title} 시작하기
        </button>
      </article>
    );
  };

  return (
    <div className="student-shell">
      <header className="student-header">
        <p>수아야, 오늘도 한 걸음!</p>
        <div className="student-account-actions">
          <button
            className="button-secondary"
            onClick={() => void onEnterGuardianMode?.()}
            type="button"
          >
            보호자 모드
          </button>
          <button onClick={() => void onLogout?.()} type="button">
            로그아웃
          </button>
        </div>
      </header>
      <aside className="student-shell__left" aria-label="마법 친구">
        <StarBunny />
      </aside>
      <main className="student-shell__main">
        {offlineMode ? <p className="offline-learning-banner" role="status">오프라인 학습 중</p> : null}
        {recoveryGuidance === null ? null : (
          <p className="recovery-guidance" role="status">{recoveryGuidance}</p>
        )}
        <h1>오늘의 학습</h1>
        <section className="learning-section" aria-labelledby="required-title">
          <div className="section-heading">
            <h2 id="required-title">필수 학습</h2>
            <span>{requiredItems.length}개의 마법 걸음</span>
          </div>
          <div className="study-grid">{requiredItems.map((item) => renderCard(item, true))}</div>
        </section>
        <section className="learning-section learning-section--optional" aria-labelledby="optional-title">
          <div className="section-heading">
            <h2 id="optional-title">선택 학습</h2>
            <span>더 해 보고 싶을 때 만나요</span>
          </div>
          <div className="study-grid">{optionalItems.map((item) => renderCard(item, false))}</div>
        </section>
      </main>
      <aside className="student-shell__right" aria-label="별 현황">
        <TodayStars summary={data.stars} queuedCount={queuedCount} />
      </aside>
    </div>
  );
}
