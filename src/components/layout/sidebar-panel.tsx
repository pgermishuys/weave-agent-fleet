"use client";

import { useCallback } from "react";
import { cn } from "@/lib/utils";
import {
  useSidebar,
  SIDEBAR_MIN_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_RAIL_WIDTH,
} from "@/contexts/sidebar-context";
import { useSidebarResize } from "@/hooks/use-sidebar-resize";
import { FleetPanel } from "@/components/layout/fleet-panel";
import { GitHubPanel } from "@/components/layout/github-panel";
import { RepositoriesPanel } from "@/components/layout/repositories-panel";

export function ContextualPanel() {
  const { activeView, toggleSidebar, width, setWidth, isResizing, setIsResizing } =
    useSidebar();

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
      offset: SIDEBAR_RAIL_WIDTH,
      onResize: handleResize,
      onResizeEnd: handleResizeEnd,
      onResizeStart: handleResizeStart,
    });

  return (
    <div
      role="region"
      aria-label={
        activeView === "fleet"
          ? "Fleet panel"
          : activeView === "github"
          ? "GitHub panel"
          : activeView === "repositories"
          ? "Repositories panel"
          : "Sidebar panel"
      }
      style={{ width }}
      className="relative flex flex-col h-full overflow-hidden"
    >
      {/* Panel content */}
      {activeView === "fleet" && <FleetPanel />}
      {activeView === "github" && <GitHubPanel />}
      {activeView === "repositories" && <RepositoriesPanel />}

      {/* Resize handle */}
      <div
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onDoubleClick={toggleSidebar}
        className="group absolute top-0 right-0 h-full w-1.5 cursor-col-resize z-10"
        aria-label="Resize sidebar panel"
        role="separator"
        aria-orientation="vertical"
      >
        <div
          className={cn(
            "absolute top-0 right-0 h-full w-0.5 transition-opacity duration-150",
            isResizing
              ? "bg-primary opacity-100"
              : "bg-primary/40 opacity-0 group-hover:opacity-100"
          )}
        />
      </div>
    </div>
  );
}
