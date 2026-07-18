import { useState } from "react";
import type { CompanionId } from "../../shared/companions";
import { COMPANION_CAST } from "./cast";

export function CompanionAvatar({
  id,
  size = "medium",
  decorative = false
}: {
  id: CompanionId;
  size?: "small" | "medium" | "large";
  decorative?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const friend = COMPANION_CAST[id];
  if (failed) {
    return <span
      className={`companion-avatar companion-avatar--${size} companion-avatar--${friend.accent}`}
      role={decorative ? undefined : "img"}
      aria-hidden={decorative || undefined}
      aria-label={decorative ? undefined : friend.alt}
      data-companion-fallback={id}
    >{friend.name.slice(-2, -1)}</span>;
  }
  return <img
    className={`companion-avatar companion-avatar--${size}`}
    src={friend.asset}
    alt={decorative ? "" : friend.alt}
    onError={() => setFailed(true)}
  />;
}
