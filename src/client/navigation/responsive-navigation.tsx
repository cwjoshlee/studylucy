import {
  useEffect,
  useId,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent
} from "react";

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
  fabLabel,
  getDrawerSelectionFocusTarget
}: {
  label: string;
  entries: readonly NavigationEntry[];
  activeId: string;
  expandedIds: readonly string[];
  onSelect(id: string): void;
  onToggle(id: string): void;
  fabLabel: string;
  getDrawerSelectionFocusTarget?(id: string): HTMLElement | null;
}): JSX.Element {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerId = useId();
  const drawerRef = useRef<HTMLDivElement>(null);
  const fabRef = useRef<HTMLButtonElement>(null);
  const railRef = useRef<HTMLElement>(null);
  const closeFocusTarget = useRef<"fab" | "rail" | "destination">("fab");
  const drawerSelectionId = useRef<string | null>(null);
  const drawerWasOpen = useRef(false);
  const expanded = new Set(expandedIds);

  function closeDrawer(focusTarget: "fab" | "rail" | "destination" = "fab"): void {
    closeFocusTarget.current = focusTarget;
    setDrawerOpen(false);
  }

  useEffect(() => {
    if (drawerOpen) {
      drawerWasOpen.current = true;
      drawerRef.current?.querySelector<HTMLButtonElement>(
        "[data-drawer-close]"
      )?.focus();
      return;
    }
    if (!drawerWasOpen.current) return;
    drawerWasOpen.current = false;
    if (closeFocusTarget.current === "destination") {
      const destination = drawerSelectionId.current === null
        ? null
        : getDrawerSelectionFocusTarget?.(drawerSelectionId.current);
      if (destination !== null && destination !== undefined) {
        destination.focus();
        return;
      }
    }
    if (closeFocusTarget.current === "rail") {
      const railTarget = railRef.current?.querySelector<HTMLButtonElement>(
        '[aria-current="page"]'
      ) ?? railRef.current?.querySelector<HTMLButtonElement>("button");
      railTarget?.focus();
      return;
    }
    fabRef.current?.focus();
  }, [drawerOpen]);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const landscapeRail = window.matchMedia(
      "(min-width: 900px) and (orientation: landscape)"
    );
    const handleLayoutChange = (event: MediaQueryListEvent) => {
      if (event.matches && drawerOpen) closeDrawer("rail");
    };
    landscapeRail.addEventListener("change", handleLayoutChange);
    return () => landscapeRail.removeEventListener("change", handleLayoutChange);
  }, [drawerOpen]);

  function trapDrawerFocus(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === "Escape") {
      event.preventDefault();
      closeDrawer();
      return;
    }
    if (event.key !== "Tab") return;
    const buttons = Array.from(
      drawerRef.current?.querySelectorAll<HTMLButtonElement>(
        "button:not([disabled])"
      ) ?? []
    );
    if (buttons.length === 0) return;
    const first = buttons[0]!;
    const last = buttons[buttons.length - 1]!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

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
                else if (shell === "drawer") {
                  drawerSelectionId.current = entry.id;
                  closeDrawer(
                    getDrawerSelectionFocusTarget === undefined ? "fab" : "destination"
                  );
                }
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
      <nav aria-label={label} className="responsive-nav__rail" ref={railRef}>
        {renderEntries("rail", entries)}
      </nav>
      <button
        aria-controls={drawerId}
        aria-expanded={drawerOpen}
        aria-label={fabLabel}
        className="responsive-nav__fab"
        onClick={() => {
          closeFocusTarget.current = "fab";
          setDrawerOpen((open) => !open);
        }}
        ref={fabRef}
        type="button"
      >
        <span aria-hidden="true">☰</span>
      </button>
      <div
        aria-label={label}
        aria-modal="true"
        className="responsive-nav__drawer"
        hidden={!drawerOpen}
        id={drawerId}
        onKeyDown={trapDrawerFocus}
        ref={drawerRef}
        role="dialog"
      >
        <div className="responsive-nav__drawer-header">
          <button
            className="button-secondary responsive-nav__drawer-close"
            data-drawer-close
            onClick={() => closeDrawer()}
            type="button"
          >
            메뉴 닫기
          </button>
        </div>
        {renderEntries("drawer", entries)}
      </div>
    </div>
  );
}
