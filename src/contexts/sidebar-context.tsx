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
import { useIsMobileNav } from "@/hooks/use-media-query";

const SIDEBAR_ACTIVE_VIEW_KEY = "weave:sidebar:activeView";
const SIDEBAR_WIDTH_KEY = "weave:sidebar:width";
const SIDEBAR_COLLAPSED_KEY = "weave:sidebar:isCollapsed";

export const SIDEBAR_MIN_WIDTH = 180;
export const SIDEBAR_MAX_WIDTH = 480;
export const SIDEBAR_RAIL_WIDTH = 48;
export const SIDEBAR_DEFAULT_WIDTH = 224;

// Kept for any consumers that imported SIDEBAR_COLLAPSED_WIDTH
// @deprecated use SIDEBAR_RAIL_WIDTH instead
export const SIDEBAR_COLLAPSED_WIDTH = SIDEBAR_RAIL_WIDTH;

export type SidebarView = "welcome" | "fleet" | "github" | "repositories" | "google-chat";

/** Views that show a contextual side panel */
const PANEL_VIEWS = new Set<SidebarView>(["fleet", "github", "repositories", "google-chat"]);

/** Whether the given view shows a contextual side panel */
export function viewHasPanel(view: SidebarView): boolean {
  return PANEL_VIEWS.has(view);
}

interface SidebarContextValue {
  /** Which view icon is active in the icon rail */
  activeView: SidebarView;
  /** Whether the contextual panel is visible (derived from activeView AND isCollapsed) */
  readonly panelOpen: boolean;
  /** Set the active view — panel visibility is derived automatically */
  setActiveView: (view: SidebarView) => void;
  /** Toggle sidebar panel (⌘B): toggles isCollapsed on desktop */
  toggleSidebar: () => void;
  /** Read-only backwards-compat alias: collapsed === !panelOpen */
  readonly collapsed: boolean;
  /** Whether the sidebar panel is explicitly collapsed (persisted) */
  isCollapsed: boolean;
  /** Directly set the collapsed state */
  setCollapsed: (value: boolean) => void;
  /** Toggle isCollapsed (desktop only; mobile toggles the drawer instead) */
  toggleCollapse: () => void;
  width: number;
  setWidth: (value: number | ((prev: number) => number)) => void;
  isResizing: boolean;
  setIsResizing: (value: boolean) => void;
  /** True when in mobile nav mode (< 717px fold breakpoint) — sidebar renders as a Sheet drawer */
  isMobileNav: boolean;
  /** Whether the mobile sidebar drawer is open */
  mobileDrawerOpen: boolean;
  /** Open or close the mobile sidebar drawer */
  setMobileDrawerOpen: (open: boolean) => void;
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

  const [isCollapsed, setIsCollapsed] = usePersistedState<boolean>(
    SIDEBAR_COLLAPSED_KEY,
    false
  );

  const [isResizing, setIsResizing] = useState(false);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);

  // Derive mobile mode from viewport width (< fold breakpoint = 717px)
  const isMobileNav = useIsMobileNav();

  // Track the last panel view so ⌘B can restore it
  const lastPanelViewRef = useRef<SidebarView>(
    viewHasPanel(activeView) ? activeView : "fleet"
  );

  // Derive panel visibility from the active view AND collapse state
  const panelOpen = viewHasPanel(activeView) && !isCollapsed;

  const setActiveView = useCallback(
    (view: SidebarView) => {
      if (viewHasPanel(view)) {
        lastPanelViewRef.current = view;
      }
      setActiveViewState(view);
    },
    [setActiveViewState]
  );

  const toggleCollapse = useCallback(() => {
    if (isMobileNav) {
      setMobileDrawerOpen((open) => !open);
      return;
    }
    // When expanding from a view that has no panel (e.g. welcome),
    // restore the last panel view so the panel actually appears.
    if (isCollapsed && !viewHasPanel(activeView)) {
      setActiveViewState(lastPanelViewRef.current);
      setIsCollapsed(false);
      return;
    }
    setIsCollapsed((prev) => !prev);
  }, [isMobileNav, isCollapsed, activeView, setActiveViewState, setIsCollapsed, setMobileDrawerOpen]);

  const toggleSidebar = useCallback(() => {
    if (isMobileNav) {
      // On mobile, ⌘B opens/closes the drawer
      setMobileDrawerOpen((open) => !open);
      return;
    }
    if (activeView === "welcome") {
      // On the welcome page, ⌘B restores last panel view and expands
      setActiveViewState(lastPanelViewRef.current);
      setIsCollapsed(false);
    } else {
      // On any panel view, ⌘B toggles collapse
      setIsCollapsed((prev) => !prev);
    }
  }, [isMobileNav, activeView, setActiveViewState, setIsCollapsed, setMobileDrawerOpen]);

  return (
    <SidebarContext.Provider
      value={{
        activeView,
        panelOpen,
        setActiveView,
        toggleSidebar,
        get collapsed() {
          return isCollapsed;
        },
        isCollapsed,
        setCollapsed: setIsCollapsed,
        toggleCollapse,
        width,
        setWidth,
        isResizing,
        setIsResizing,
        isMobileNav,
        mobileDrawerOpen,
        setMobileDrawerOpen,
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
