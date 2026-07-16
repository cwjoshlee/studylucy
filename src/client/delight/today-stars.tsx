import type { StudentStarSummary } from "../../shared/stars";

export function TodayStars({
  summary,
  queuedCount = 0
}: {
  summary: StudentStarSummary;
  queuedCount?: number;
}) {
  return (
    <section className="today-stars" aria-labelledby="today-stars-title">
      <h2 id="today-stars-title">모은 별 {summary.balance}개</h2>
      <p className="today-stars__change">오늘 만난 별 +{summary.earnedToday}개 · 줄어든 별 -{summary.deductedToday}개</p>
      {summary.lastReason ? <p className="today-stars__reason">{summary.lastReason}</p> : null}
      <div className="queued-stars" role="status" aria-label="동기화 대기 별">
        <strong>동기화 대기 별 {queuedCount}개</strong>
        <span>확정 잔액에 포함되지 않아요.</span>
      </div>
    </section>
  );
}
