import type { JSX } from "react";
import type { CompanionId } from "../../shared/companions";
import { COMPANION_CAST } from "./cast";
import { CompanionAvatar } from "./companion-avatar";
import { selectCompanionCue } from "./cues";

export function FriendStage({
  studyDate,
  itemId,
  subject,
  completedCount,
  totalCount
}: {
  studyDate: string;
  itemId: string | null;
  subject: "korean" | "math" | null;
  completedCount: number;
  totalCount: number;
}): JSX.Element {
  const activeCompanion: CompanionId = totalCount === 0
    ? "lumi"
    : completedCount >= totalCount
      ? "bongbong"
      : subject === "math"
        ? "momo"
        : "toto";
  const cue = selectCompanionCue({
    moment: completedCount === 0 ? "home-welcome" : "home-return",
    key: `${studyDate}:${itemId ?? "rest-day"}`,
    subject: subject ?? "korean",
    preferredCompanion: activeCompanion
  });
  const activeFriend = COMPANION_CAST[activeCompanion];

  return <section className="friend-stage" aria-label="마법 친구들">
    <ul className="friend-stage__cast">
      {Object.values(COMPANION_CAST).map((friend) => (
        <li
          key={friend.id}
          aria-current={friend.id === activeCompanion ? "true" : undefined}
        >
          <CompanionAvatar
            id={friend.id}
            size={friend.id === activeCompanion ? "large" : "medium"}
          />
          <strong>{friend.name}</strong>
          <span>{friend.role}</span>
        </li>
      ))}
    </ul>
    <div className="friend-stage__speaker">
      {totalCount === 0 && <p className="friend-stage__rest-day">
        오늘은 쉬는 날이에요
      </p>}
      <div
        className={`companion-bubble companion-bubble--${cue.tone}`}
        role="status"
        aria-label="마법 친구 말풍선"
      >
        <strong>{activeFriend.name}</strong>
        <span>{cue.text}</span>
      </div>
    </div>
  </section>;
}

export function FriendTrail({
  completedCount,
  totalCount,
  metCompanions
}: {
  completedCount: number;
  totalCount: number;
  metCompanions: CompanionId[];
}): JSX.Element {
  const uniqueCompanions = totalCount === 0
    ? []
    : [...new Set(metCompanions)];

  return <section className="friend-trail" aria-label="오늘 친구 발자국">
    <h2>오늘 함께한 친구</h2>
    {totalCount === 0
      ? <p>오늘은 쉬는 날</p>
      : <p>마법 걸음 {completedCount}/{totalCount}</p>}
    <ul aria-label="오늘 만난 친구">
      {uniqueCompanions.map((id) => (
        <li key={id}>{COMPANION_CAST[id].name}</li>
      ))}
    </ul>
  </section>;
}
