import type { JSX } from "react";
import {
  ResponsiveNavigation,
  type NavigationEntry
} from "../navigation/responsive-navigation";

const STUDENT_ENTRIES: readonly NavigationEntry[] = [
  { id: "back", label: "뒤로" },
  { id: "today", label: "오늘 학습" },
  { id: "help", label: "도움말" },
  { id: "break", label: "잠깐 쉬기" }
];

export function StudentNavigation({
  activeId = "today",
  onExit,
  onToday,
  onHelp,
  onPauseForBreak,
  getDrawerSelectionFocusTarget
}: {
  activeId?: "back" | "today" | "help" | "break";
  onExit(): void;
  onToday(): void;
  onHelp(): void;
  onPauseForBreak(): void;
  getDrawerSelectionFocusTarget?(id: "back" | "today"): HTMLElement | null;
}): JSX.Element {
  return (
    <ResponsiveNavigation
      activeId={activeId}
      entries={STUDENT_ENTRIES}
      expandedIds={[]}
      fabLabel="메뉴 열기"
      getDrawerSelectionFocusTarget={(id) =>
        id === "back" || id === "today"
          ? getDrawerSelectionFocusTarget?.(id) ?? null
          : null
      }
      label="학생 메뉴"
      onSelect={(id) => {
        if (id === "back") onExit();
        else if (id === "today") onToday();
        else if (id === "help") onHelp();
        else if (id === "break") onPauseForBreak();
      }}
      onToggle={() => undefined}
    />
  );
}
