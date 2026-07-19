import {
  useEffect,
  useId,
  useLayoutEffect,
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
  const rootRef = useRef<HTMLDivElement>(null);
  const drawerOpenRef = useRef(false);
  const closeFocusTarget = useRef<"fab" | "rail" | "destination">("fab");
  const drawerSelectionId = useRef<string | null>(null);
  const drawerWasOpen = useRef(false);
  const expanded = new Set(expandedIds);
  drawerOpenRef.current = drawerOpen;

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
    let wasLandscape = landscapeRail.matches;
    let cancelScheduledFocus: (() => void) | null = null;
    const cancelFocusHandoff = () => {
      cancelScheduledFocus?.();
      cancelScheduledFocus = null;
    };
    const handleLayoutChange = (event: MediaQueryListEvent) => {
      cancelFocusHandoff();
      if (event.matches && drawerOpenRef.current) {
        closeFocusTarget.current = "rail";
        setDrawerOpen(false);
      } else if (!event.matches && wasLandscape) {
        const focusedRailEntry = document.activeElement;
        if (
          focusedRailEntry instanceof HTMLElement &&
          railRef.current?.contains(focusedRailEntry)
        ) {
          let settled = false;
          let cancelDeferredFocus = () => {};
          const stopWatchingFocus = () => {
            document.removeEventListener("focus", cancelOnExternalFocus, true);
            document.removeEventListener("focusin", cancelOnExternalFocus, true);
          };
          const cancelHandoff = () => {
            if (settled) return;
            settled = true;
            cancelDeferredFocus();
            stopWatchingFocus();
          };
          const cancelOnExternalFocus = (focusEvent: FocusEvent) => {
            if (focusEvent.target !== focusedRailEntry) {
              cancelHandoff();
              if (cancelScheduledFocus === cancelHandoff) {
                cancelScheduledFocus = null;
              }
            }
          };
          const moveFocus = () => {
            if (settled) return;
            settled = true;
            stopWatchingFocus();
            cancelScheduledFocus = null;
            if (
              !landscapeRail.matches &&
              document.activeElement === focusedRailEntry &&
              fabRef.current?.isConnected
            ) {
              fabRef.current.focus();
            }
          };
          if (typeof window.requestAnimationFrame === "function") {
            const frame = window.requestAnimationFrame(moveFocus);
            cancelDeferredFocus = () => {
              if (typeof window.cancelAnimationFrame === "function") {
                window.cancelAnimationFrame(frame);
              }
            };
          } else {
            const timeout = window.setTimeout(moveFocus, 0);
            cancelDeferredFocus = () => window.clearTimeout(timeout);
          }
          cancelScheduledFocus = cancelHandoff;
          document.addEventListener("focus", cancelOnExternalFocus, true);
          document.addEventListener("focusin", cancelOnExternalFocus, true);
        }
      }
      wasLandscape = event.matches;
    };
    landscapeRail.addEventListener("change", handleLayoutChange);
    return () => {
      cancelFocusHandoff();
      landscapeRail.removeEventListener("change", handleLayoutChange);
    };
  }, []);

  useLayoutEffect(() => {
    if (!drawerOpen) return;
    const root = rootRef.current;
    const drawer = drawerRef.current;
    const rail = railRef.current;
    if (root === null || drawer === null || rail === null) return;

    const fab = fabRef.current;
    const protectedElements = new Set<HTMLElement>([rail]);
    if (fab !== null) protectedElements.add(fab);
    const shell = root.closest<HTMLElement>(".responsive-shell");
    const appScope = root.closest<HTMLElement>(".guardian-shell") ?? shell;
    if (appScope !== null) {
      let modalBranch: HTMLElement = root;
      while (modalBranch !== appScope) {
        const parent = modalBranch.parentElement;
        if (parent === null || !appScope.contains(parent)) break;
        for (const sibling of Array.from(parent.children)) {
          if (sibling instanceof HTMLElement && sibling !== modalBranch) {
            protectedElements.add(sibling);
          }
        }
        modalBranch = parent;
      }
    }

    const restoreBoundaries = Array.from(protectedElements, (element) => {
      const previousInert = element.getAttribute("inert");
      const previousAriaHidden = element.getAttribute("aria-hidden");
      const previousDisabled = element.getAttribute("disabled");
      const stopBeforeBackgroundHandlers = (event: Event) => {
        event.preventDefault();
        event.stopPropagation();
        if (typeof event.stopImmediatePropagation === "function") {
          event.stopImmediatePropagation();
        }
      };
      const blockInteraction = (event: Event) => {
        stopBeforeBackgroundHandlers(event);
      };
      const redirectFocus = (event: FocusEvent) => {
        if (element.contains(event.target as Node)) {
          stopBeforeBackgroundHandlers(event);
          drawer.querySelector<HTMLButtonElement>("[data-drawer-close]")?.focus();
        }
      };

      element.setAttribute("inert", "");
      element.setAttribute("aria-hidden", "true");
      if (element === fab) element.setAttribute("disabled", "");
      element.addEventListener("click", blockInteraction, true);
      element.addEventListener("pointerdown", blockInteraction, true);
      element.addEventListener("keydown", blockInteraction, true);
      element.addEventListener("focus", redirectFocus, true);
      element.addEventListener("focusin", redirectFocus, true);

      return () => {
        if (previousInert === null) element.removeAttribute("inert");
        else element.setAttribute("inert", previousInert);
        if (previousAriaHidden === null) element.removeAttribute("aria-hidden");
        else element.setAttribute("aria-hidden", previousAriaHidden);
        if (element === fab) {
          if (previousDisabled === null) element.removeAttribute("disabled");
          else element.setAttribute("disabled", previousDisabled);
        }
        element.removeEventListener("click", blockInteraction, true);
        element.removeEventListener("pointerdown", blockInteraction, true);
        element.removeEventListener("keydown", blockInteraction, true);
        element.removeEventListener("focus", redirectFocus, true);
        element.removeEventListener("focusin", redirectFocus, true);
      };
    });

    return () => {
      for (const restore of restoreBoundaries) restore();
    };
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
    <div className="responsive-nav" ref={rootRef}>
      <nav aria-label={label} className="responsive-nav__rail" ref={railRef}>
        {renderEntries("rail", entries)}
      </nav>
      <button
        aria-controls={drawerId}
        aria-expanded={drawerOpen}
        aria-label={fabLabel}
        className="responsive-nav__fab"
        onClick={() => {
          if (drawerOpenRef.current) return;
          closeFocusTarget.current = "fab";
          setDrawerOpen(true);
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
