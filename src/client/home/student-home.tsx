import { useEffect, useState } from "react";
import type { TodayPlan } from "../../shared/learning";
import type { StudentStarSummary } from "../../shared/stars";
import type { ClientApi } from "../api/client";
import { StarBunny } from "../delight/star-bunny";
import { TodayStars } from "../delight/today-stars";
import { LearningSession } from "../learning/learning-session";
import { subscribeSyncCompleted } from "../offline/sync";
import {
  getQueueCounts,
  subscribeConfirmedStars,
  subscribeQueueCounts
} from "../offline/db";

type StudentData = { plan: TodayPlan; stars: StudentStarSummary };

function studyDate(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

export function StudentHome({
  api,
  onEnterGuardianMode,
  onLogout
}: {
  api: ClientApi;
  onEnterGuardianMode?: () => Promise<void>;
  onLogout?: () => Promise<void>;
}) {
  const [data, setData] = useState<StudentData | null>(null);
  const [failed, setFailed] = useState(false);
  const [queuedCount, setQueuedCount] = useState(0);
  const [selectedItem, setSelectedItem] = useState<TodayPlan["items"][number] | null>(null);

  useEffect(() => {
    let active = true;
    const loadAuthoritativeData = (showFailure: boolean) => {
      void Promise.all([api.getToday(studyDate()), api.getStudentStars()]).then(
        ([plan, stars]) => {
          if (active) {
            setData({ plan, stars });
            setFailed(false);
          }
        },
        () => {
          if (active && showFailure) setFailed(true);
        }
      );
    };
    const updateQueueCounts = (counts: { attempts: number }) => {
      if (active) setQueuedCount(counts.attempts);
    };
    const unsubscribe = subscribeQueueCounts(updateQueueCounts);
    const unsubscribeConfirmedStars = subscribeConfirmedStars((stars) => {
      if (active) {
        setData((current) => current === null ? current : { ...current, stars });
      }
    });
    const unsubscribeSyncCompleted = subscribeSyncCompleted(() => {
      loadAuthoritativeData(false);
    });
    void getQueueCounts().then(updateQueueCounts, () => undefined);
    loadAuthoritativeData(true);
    return () => {
      active = false;
      unsubscribe();
      unsubscribeConfirmedStars();
      unsubscribeSyncCompleted();
    };
  }, [api]);

  if (failed) return <main>오늘의 학습을 불러오지 못했어요. 잠시 후 다시 만나요.</main>;
  if (data === null) return <main aria-busy="true">오늘의 학습을 준비하고 있어요.</main>;

  async function finishLearning(): Promise<void> {
    try {
      const [plan, stars] = await Promise.all([
        api.getToday(studyDate()),
        api.getStudentStars()
      ]);
      setData({ plan, stars });
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
          studyDate={data.plan.date}
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
