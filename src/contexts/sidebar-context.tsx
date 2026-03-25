"use client";

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePersistedState } from "@/hooks/use-persisted-state";

const SIDEBAR_ACTIVE_VIEW_KEY = "weave:sidebar:activeView";
const SIDEBAR_WIDTH_KEY = "weave:sidebar:width";

export const SIDEBAR_MIN_WIDTH = 180;
export const SIDEBAR_MAX_WIDTH = 480;
export const SIDEBAR_RAIL_WIDTH = 48;
export const SIDEBAR_DEFAULT_WIDTH = 224;

// Kept for any consumers that imported SIDEBAR_COLLAPSED_WIDTH
// @deprecated use SIDEBAR_RAIL_WIDTH instead
export const SIDEBAR_COLLAPSED_WIDTH = SIDEBAR_RAIL_WIDTH;

export type SidebarView = "welcome" | "fleet" | "github" | "repositories";

/** Views that show a contextual side panel */
const PANEL_VIEWS = new Set<SidebarView>(["fleet", "github", "repositories"]);

/** Whether the given view shows a contextual side panel */
export function viewHasPanel(view: SidebarView): boolean {
  return PANEL_VIEWS.has(view);
}

interface SidebarContextValue {
  /** Which view icon is active in the icon rail */
  activeView: SidebarView;
  /** Whether the contextual panel is visible (derived from activeView) */
  readonly panelOpen: boolean;
  /** Set the active view — panel visibility is derived automatically */
  setActiveView: (view: SidebarView) => void;
  /** Toggle sidebar panel (⌘B): switches between welcome and last panel view */
  toggleSidebar: () => void;
  /** Read-only backwards-compat alias: collapsed === !panelOpen */
  readonly collapsed: boolean;
  width: number;
  setWidth: (value: number | ((prev: number) => number)) => void;
  isResizing: boolean;
  setIsResizing: (value: boolean) => void;
}

const SidebarContext = createContext<SidebarContextValue | null>(null);

// ── Synchronous localStorage migration ───────────────────────────────────────
// Cleans up legacy keys from previous sidebar implementations.
let _migrated = false;

function migrateSidebarStorage(): void {
  if (_migrated) return;
  _migrated = true;

  try {
    // Remove legacy keys that are no longer used
    localStorage.removeItem("weave:sidebar:collapsed");
    localStorage.removeItem("weave:sidebar:panelOpen");

    // Migrate old activeView values that no longer exist
    const raw = localStorage.getItem(SIDEBAR_ACTIVE_VIEW_KEY);
    if (raw !== null) {
      try {
        const value = JSON.parse(raw) as string;
        if (!PANEL_VIEWS.has(value as SidebarView) && value !== "welcome") {
          localStorage.removeItem(SIDEBAR_ACTIVE_VIEW_KEY);
        }
      } catch {
        localStorage.removeItem(SIDEBAR_ACTIVE_VIEW_KEY);
      }
    }
  } catch {
    // localStorage unavailable (SSR / private browsing)
  }
}

interface SidebarProviderProps {
  children: ReactNode;
}

export function SidebarProvider({ children }: SidebarProviderProps) {
  // Run synchronous migration before any hook reads localStorage
  migrateSidebarStorage();

  const [activeView, setActiveViewState] = usePersistedState<SidebarView>(
    SIDEBAR_ACTIVE_VIEW_KEY,
    "fleet"
  );

  const [width, setWidth] = usePersistedState<number>(
    SIDEBAR_WIDTH_KEY,
    SIDEBAR_DEFAULT_WIDTH
  );

  const [isResizing, setIsResizing] = useState(false);

  // Track the last panel view so ⌘B can restore it
  const lastPanelViewRef = useRef<SidebarView>(
    viewHasPanel(activeView) ? activeView : "fleet"
  );

  // Derive panel visibility from the active view
  const panelOpen = viewHasPanel(activeView);

  const setActiveView = useCallback(
    (view: SidebarView) => {
      if (viewHasPanel(view)) {
        lastPanelViewRef.current = view;
      }
      setActiveViewState(view);
    },
    [setActiveViewState]
  );

  const toggleSidebar = useCallback(() => {
    if (panelOpen) {
      // Panel is showing → switch to welcome (hides panel)
      setActiveViewState("welcome");
    } else {
      // Panel is hidden → restore last panel view
      setActiveViewState(lastPanelViewRef.current);
    }
  }, [panelOpen, setActiveViewState]);

  return (
    <SidebarContext.Provider
      value={{
        activeView,
        panelOpen,
        setActiveView,
        toggleSidebar,
        get collapsed() {
          return !panelOpen;
        },
        width,
        setWidth,
        isResizing,
        setIsResizing,
      }}
    >
      {children}
    </SidebarContext.Provider>
  );
}

export function useSidebar(): SidebarContextValue {
  const ctx = useContext(SidebarContext);
  if (!ctx) {
    throw new Error("useSidebar must be used within a SidebarProvider");
  }
  return ctx;
}
