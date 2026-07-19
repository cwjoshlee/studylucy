import { isCalculationItem, type LearningItemPayload } from "../../shared/learning";
import { CompanionAvatar } from "./companion-avatar";
import { COMPANION_CAST } from "./cast";
import {
  selectCompanionCue,
  type BunnyMoment,
  type CompanionMoment
} from "./cues";

const SAVE_STATUS_TEXT = {
  saving: "학습 기록을 확인하고 있어요. 잠깐 기다려 주세요.",
  queued: "학습 기록이 아직 여행 중이에요. 연결되면 확인할게요.",
  failed: "학습 기록을 안전하게 보관하지 못했어요. 다시 시도해 주세요."
} as const;

export function LearningCompanion({
  moment,
  studyDate,
  item,
  saveState,
  bunnyMoment,
  paused = false
}: {
  moment: CompanionMoment;
  studyDate: string;
  item: LearningItemPayload;
  saveState?: "saving" | "queued" | "failed";
  bunnyMoment?: BunnyMoment;
  paused?: boolean;
}) {
  if (paused) return null;
  const cue = selectCompanionCue({
    moment,
    key: `${studyDate}:${item.id}:${moment}`,
    subject: item.subject,
    delight: item.delight,
    preferredCompanion: item.kind === "korean-dictation" || isCalculationItem(item)
      ? "bongbong"
      : undefined,
    bunnyMoment
  });
  const text = moment === "save-wait" && saveState !== undefined
    ? SAVE_STATUS_TEXT[saveState]
    : cue.text;

  return (
    <section className="learning-companion" aria-label="학습 친구">
      <CompanionAvatar id={cue.companion} size="large" decorative />
      <p
        className={`companion-bubble companion-bubble--${cue.tone}`}
        role="status"
        aria-label="마법 친구 말풍선"
        data-cue-tone={cue.tone}
      >
        <strong>{COMPANION_CAST[cue.companion].name}</strong>
        <span>{text}</span>
      </p>
    </section>
  );
}
