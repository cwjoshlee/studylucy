import { useId, useState, type JSX } from "react";

export type NavigationEntry = {
  id: string;
  label: string;
  children?: readonly NavigationEntry[];
};

export function ResponsiveNavigation({
  label,
  entries,
  activeId,
  expandedIds,
  onSelect,
  onToggle,
  fabLabel
}: {
  label: string;
  entries: readonly NavigationEntry[];
  activeId: string;
  expandedIds: readonly string[];
  onSelect(id: string): void;
  onToggle(id: string): void;
  fabLabel: string;
}): JSX.Element {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerId = useId();
  const expanded = new Set(expandedIds);

  const renderEntries = (
    shell: "rail" | "drawer",
    currentEntries: readonly NavigationEntry[],
    depth = 0
  ): JSX.Element => (
    <ul className="responsive-nav__list" data-depth={depth}>
      {currentEntries.map((entry) => {
        const hasChildren = entry.children !== undefined && entry.children.length > 0;
        const isExpanded = hasChildren && expanded.has(entry.id);
        return (
          <li key={entry.id}>
            <button
              aria-current={entry.id === activeId ? "page" : undefined}
              aria-expanded={hasChildren ? isExpanded : undefined}
              className="responsive-nav__entry"
              onClick={() => {
                onSelect(entry.id);
                if (hasChildren) onToggle(entry.id);
                else if (shell === "drawer") setDrawerOpen(false);
              }}
              type="button"
            >
              <span>{entry.label}</span>
              {hasChildren ? <span aria-hidden="true">{isExpanded ? "−" : "+"}</span> : null}
            </button>
            {hasChildren && isExpanded
              ? renderEntries(shell, entry.children!, depth + 1)
              : null}
          </li>
        );
      })}
    </ul>
  );

  return (
    <div className="responsive-nav">
      <nav aria-label={label} className="responsive-nav__rail">
        {renderEntries("rail", entries)}
      </nav>
      <button
        aria-controls={drawerId}
        aria-expanded={drawerOpen}
        aria-label={drawerOpen ? "메뉴 닫기" : fabLabel}
        className="responsive-nav__fab"
        onClick={() => setDrawerOpen((open) => !open)}
        type="button"
      >
        <span aria-hidden="true">{drawerOpen ? "×" : "☰"}</span>
      </button>
      <div
        aria-label={label}
        aria-modal="true"
        className="responsive-nav__drawer"
        hidden={!drawerOpen}
        id={drawerId}
        role="dialog"
      >
        {renderEntries("drawer", entries)}
      </div>
    </div>
  );
}
