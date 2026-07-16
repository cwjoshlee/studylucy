import { useEffect, useState } from "react";
import type { TodayPlan } from "../../shared/learning";
import type { StudentStarSummary } from "../../shared/stars";
import type { ClientApi } from "../api/client";
import { StarBunny } from "../delight/star-bunny";
import { TodayStars } from "../delight/today-stars";
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

export function StudentHome({ api }: { api: ClientApi }) {
  const [data, setData] = useState<StudentData | null>(null);
  const [failed, setFailed] = useState(false);
  const [queuedCount, setQueuedCount] = useState(0);

  useEffect(() => {
    let active = true;
    const updateQueueCounts = (counts: { attempts: number }) => {
      if (active) setQueuedCount(counts.attempts);
    };
    const unsubscribe = subscribeQueueCounts(updateQueueCounts);
    const unsubscribeConfirmedStars = subscribeConfirmedStars((stars) => {
      if (active) {
        setData((current) => current === null ? current : { ...current, stars });
      }
    });
    void getQueueCounts().then(updateQueueCounts, () => undefined);
    void Promise.all([api.getToday(studyDate()), api.getStudentStars()]).then(
      ([plan, stars]) => {
        if (active) setData({ plan, stars });
      },
      () => {
        if (active) setFailed(true);
      }
    );
    return () => {
      active = false;
      unsubscribe();
      unsubscribeConfirmedStars();
    };
  }, [api]);

  if (failed) return <main>오늘의 학습을 불러오지 못했어요. 잠시 후 다시 만나요.</main>;
  if (data === null) return <main aria-busy="true">오늘의 학습을 준비하고 있어요.</main>;

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
      </article>
    );
  };

  return (
    <div className="student-shell">
      <header className="student-header">
        <p>수아야, 오늘도 한 걸음!</p>
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
