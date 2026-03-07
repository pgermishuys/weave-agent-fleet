"use client";

import { useCallback, useRef } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import {
  ChevronRight,
  LayoutGrid,
  Bell,
  History,
  Settings,
  AlertTriangle,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useNotifications } from "@/contexts/notifications-context";
import { useSessionsContext } from "@/contexts/sessions-context";
import { useWorkspaces } from "@/hooks/use-workspaces";
import { usePersistedState } from "@/hooks/use-persisted-state";
import {
  useSidebar,
  SIDEBAR_COLLAPSED_WIDTH,
  SIDEBAR_MIN_WIDTH,
  SIDEBAR_MAX_WIDTH,
} from "@/contexts/sidebar-context";
import { useSidebarResize } from "@/hooks/use-sidebar-resize";
import { SidebarWorkspaceItem } from "@/components/layout/sidebar-workspace-item";

const FLEET_EXPANDED_KEY = "weave:sidebar:fleet-expanded";

export function Sidebar() {
  const pathname = usePathname();
  const { unreadCount } = useNotifications();
  const { sessions, error, refetch } = useSessionsContext();
  const workspaces = useWorkspaces(sessions);
  const {
    collapsed,
    toggleSidebar,
    width,
    setWidth,
    isResizing,
    setIsResizing,
  } = useSidebar();
  const [fleetExpanded, setFleetExpanded] = usePersistedState<boolean>(
    FLEET_EXPANDED_KEY,
    true
  );

  const treeRef = useRef<HTMLDivElement>(null);

  const handleResizeStart = useCallback(() => {
    setIsResizing(true);
  }, [setIsResizing]);

  const handleResize = useCallback(
    (newWidth: number) => {
      setWidth(newWidth);
    },
    [setWidth]
  );

  const handleResizeEnd = useCallback(
    (finalWidth: number) => {
      setWidth(finalWidth);
      setIsResizing(false);
    },
    [setWidth, setIsResizing]
  );

  const { handlePointerDown, handlePointerMove, handlePointerUp } =
    useSidebarResize({
      minWidth: SIDEBAR_MIN_WIDTH,
      maxWidth: SIDEBAR_MAX_WIDTH,
      onResize: handleResize,
      onResizeEnd: handleResizeEnd,
      onResizeStart: handleResizeStart,
      disabled: collapsed,
    });

  // Keyboard navigation handler for the tree
  const handleTreeKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const tree = treeRef.current;
      if (!tree) return;

      // Collect all focusable tree items in DOM order
      const items = Array.from(
        tree.querySelectorAll<HTMLElement>(
          "[role='treeitem'], [data-tree-leaf]"
        )
      );
      const focused = document.activeElement as HTMLElement | null;
      const currentIndex = focused ? items.indexOf(focused) : -1;

      switch (e.key) {
        case "ArrowDown": {
          e.preventDefault();
          const next = items[currentIndex + 1];
          next?.focus();
          break;
        }
        case "ArrowUp": {
          e.preventDefault();
          const prev = items[currentIndex - 1];
          prev?.focus();
          break;
        }
        case "ArrowRight": {
          e.preventDefault();
          // If focused item is a treeitem that is collapsed, expand it
          if (focused?.getAttribute("role") === "treeitem") {
            const expanded = focused.getAttribute("aria-expanded");
            if (expanded === "false") {
              const trigger = focused.querySelector<HTMLElement>(
                "[data-tree-expand]"
              );
              trigger?.click();
            } else {
              // Already expanded — move to first child
              const next = items[currentIndex + 1];
              next?.focus();
            }
          }
          break;
        }
        case "ArrowLeft": {
          e.preventDefault();
          if (focused?.getAttribute("role") === "treeitem") {
            const expanded = focused.getAttribute("aria-expanded");
            if (expanded === "true") {
              const trigger = focused.querySelector<HTMLElement>(
                "[data-tree-expand]"
              );
              trigger?.click();
            } else {
              // Move to parent (tree root / All Sessions row)
              const allSessionsRow = tree.querySelector<HTMLElement>(
                "[data-all-sessions]"
              );
              allSessionsRow?.focus();
            }
          }
          break;
        }
        case "Enter": {
          e.preventDefault();
          focused?.click();
          break;
        }
        case "F2": {
          e.preventDefault();
          // Trigger rename on focused workspace item
          if (focused?.getAttribute("role") === "treeitem") {
            const renameTrigger = focused.querySelector<HTMLElement>(
              "[data-rename-trigger]"
            );
            renameTrigger?.click();
          }
          break;
        }
      }
    },
    []
  );

  const isFleetActive = pathname === "/" || pathname.startsWith("/?");

  const sidebarWidth = collapsed ? SIDEBAR_COLLAPSED_WIDTH : width;

  return (
    <aside
      className={cn(
        "relative flex h-screen flex-col border-r border-sidebar-border bg-sidebar overflow-hidden",
        !isResizing && "transition-all duration-200 ease-in-out"
      )}
      style={{ width: sidebarWidth }}
    >
      {/* Weave branding */}
      <Link
        href="/"
        className={cn(
          "flex items-center border-b border-sidebar-border px-4 py-4 cursor-pointer transition-opacity hover:opacity-80",
          collapsed ? "justify-center" : "gap-3"
        )}
      >
        <Image
          src="/weave_logo.png"
          alt="Weave"
          width={32}
          height={32}
          className="shrink-0 rounded-md"
        />
        {!collapsed && (
          <div>
            <h1 className="text-sm font-semibold font-mono weave-gradient-text whitespace-nowrap">
              Weave
            </h1>
            <p className="text-[10px] text-muted-foreground font-mono whitespace-nowrap">
              Agent Fleet
            </p>
          </div>
        )}
      </Link>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto p-2 space-y-1">
        {/* Fleet */}
        {collapsed ? (
          /* Collapsed: icon-only link with tooltip */
          <Tooltip>
            <TooltipTrigger asChild>
              <Link
                href="/"
                className={cn(
                  "flex items-center justify-center rounded-md py-2 text-sm font-medium transition-colors",
                  isFleetActive
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground"
                )}
              >
                <LayoutGrid className="h-4 w-4 shrink-0" />
              </Link>
            </TooltipTrigger>
            <TooltipContent side="right">Fleet</TooltipContent>
          </Tooltip>
        ) : (
          /* Expanded: full collapsible tree */
          <Collapsible open={fleetExpanded} onOpenChange={setFleetExpanded}>
            {/* Fleet header row */}
            <div
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                isFleetActive
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground"
              )}
            >
              {/* Expand/collapse chevron */}
              <CollapsibleTrigger asChild>
                <button
                  className="shrink-0 text-muted-foreground hover:text-foreground"
                  aria-label={fleetExpanded ? "Collapse Fleet" : "Expand Fleet"}
                >
                  <ChevronRight
                    className={cn(
                      "h-4 w-4 transition-transform duration-150",
                      fleetExpanded && "rotate-90"
                    )}
                  />
                </button>
              </CollapsibleTrigger>

              {/* All Sessions link */}
              <Link
                href="/"
                data-all-sessions
                tabIndex={0}
                className="flex flex-1 items-center gap-1 min-w-0"
              >
                <LayoutGrid className="h-4 w-4 shrink-0" />
                <span className="flex-1 whitespace-nowrap">Fleet</span>
                {/* Total session count badge */}
                {sessions.length > 0 && (
                  <Badge
                    variant="secondary"
                    className="h-5 min-w-5 justify-center px-1.5 text-xs shrink-0"
                  >
                    {sessions.length}
                  </Badge>
                )}
              </Link>
            </div>

            {/* Workspace tree */}
            <CollapsibleContent className="overflow-hidden data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 data-[state=open]:slide-in-from-top-1 data-[state=closed]:slide-out-to-top-1 transition-all">
              <div
                ref={treeRef}
                role="tree"
                aria-label="Workspaces"
                onKeyDown={handleTreeKeyDown}
                className="mt-0.5 space-y-0.5"
              >
                {error ? (
                  <div className="flex items-center gap-2 pl-8 pr-3 py-1.5 text-xs text-destructive">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                    <span>Failed to load</span>
                  </div>
                ) : workspaces.length === 0 ? (
                  <p className="pl-8 pr-3 py-1.5 text-xs text-muted-foreground">
                    No workspaces yet
                  </p>
                ) : (
                  workspaces.map((group) => (
                    <SidebarWorkspaceItem
                      key={group.workspaceDirectory}
                      group={group}
                      activeSessionPath={pathname}
                      refetch={refetch}
                    />
                  ))
                )}
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}

        {/* Alerts */}
        {collapsed ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Link
                href="/alerts"
                aria-label={
                  unreadCount > 0 ? `Alerts, ${unreadCount} unread` : "Alerts"
                }
                className={cn(
                  "relative flex items-center justify-center rounded-md py-2 text-sm font-medium transition-colors",
                  pathname.startsWith("/alerts")
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground"
                )}
              >
                <Bell className="h-4 w-4 shrink-0" />
                {unreadCount > 0 && (
                  <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-destructive" />
                )}
              </Link>
            </TooltipTrigger>
            <TooltipContent side="right">Alerts</TooltipContent>
          </Tooltip>
        ) : (
          <Link
            href="/alerts"
            className={cn(
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              pathname.startsWith("/alerts")
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground"
            )}
          >
            <Bell className="h-4 w-4" />
            <span className="flex-1 whitespace-nowrap">Alerts</span>
            {unreadCount > 0 && (
              <Badge
                variant="secondary"
                className="h-5 min-w-5 justify-center px-1.5 text-xs"
              >
                {unreadCount}
              </Badge>
            )}
          </Link>
        )}

        {/* History */}
        {collapsed ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Link
                href="/history"
                className={cn(
                  "flex items-center justify-center rounded-md py-2 text-sm font-medium transition-colors",
                  pathname.startsWith("/history")
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground"
                )}
              >
                <History className="h-4 w-4 shrink-0" />
              </Link>
            </TooltipTrigger>
            <TooltipContent side="right">History</TooltipContent>
          </Tooltip>
        ) : (
          <Link
            href="/history"
            className={cn(
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              pathname.startsWith("/history")
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground"
            )}
          >
            <History className="h-4 w-4" />
            <span className="whitespace-nowrap">History</span>
          </Link>
        )}
      </nav>

      {/* Footer */}
      <div className="border-t border-sidebar-border p-2 space-y-1">
        {/* Settings */}
        {collapsed ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Link
                href="/settings"
                className={cn(
                  "flex items-center justify-center rounded-md py-2 text-sm font-medium transition-colors",
                  pathname.startsWith("/settings")
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground"
                )}
              >
                <Settings className="h-4 w-4 shrink-0" />
              </Link>
            </TooltipTrigger>
            <TooltipContent side="right">Settings</TooltipContent>
          </Tooltip>
        ) : (
          <Link
            href="/settings"
            className={cn(
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
              pathname.startsWith("/settings")
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground"
            )}
          >
            <Settings className="h-4 w-4" />
            <span className="whitespace-nowrap">Settings</span>
          </Link>
        )}

        {/* Toggle button */}
        {collapsed ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={toggleSidebar}
                aria-label="Expand sidebar"
                className="flex w-full items-center justify-center rounded-md py-2 text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground transition-colors"
              >
                <PanelLeftOpen className="h-4 w-4 shrink-0" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">Expand sidebar (⌘B)</TooltipContent>
          </Tooltip>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={toggleSidebar}
                aria-label="Collapse sidebar"
                className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground transition-colors"
              >
                <PanelLeftClose className="h-4 w-4 shrink-0" />
                <span className="whitespace-nowrap">Collapse</span>
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">Collapse sidebar (⌘B)</TooltipContent>
          </Tooltip>
        )}

        {/* Version info */}
        {collapsed ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <p className="text-center text-[10px] text-muted-foreground/50 select-none py-1">
                v{process.env.NEXT_PUBLIC_APP_VERSION}
              </p>
            </TooltipTrigger>
            <TooltipContent side="right">
              v{process.env.NEXT_PUBLIC_APP_VERSION} · {process.env.NEXT_PUBLIC_COMMIT_SHA}
            </TooltipContent>
          </Tooltip>
        ) : (
          <p className="px-3 text-[10px] text-muted-foreground/50 select-none py-1">
            v{process.env.NEXT_PUBLIC_APP_VERSION} · {process.env.NEXT_PUBLIC_COMMIT_SHA}
          </p>
        )}
      </div>

      {/* Resize handle */}
      {!collapsed && (
        <div
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onDoubleClick={toggleSidebar}
          className="group absolute top-0 right-0 h-full w-1.5 cursor-col-resize z-10"
          aria-label="Resize sidebar"
          role="separator"
          aria-orientation="vertical"
        >
          {/* Visual indicator line */}
          <div
            className={cn(
              "absolute top-0 right-0 h-full w-0.5 transition-opacity duration-150",
              isResizing
                ? "bg-primary opacity-100"
                : "bg-primary/40 opacity-0 group-hover:opacity-100"
            )}
          />
        </div>
      )}
    </aside>
  );
}
