"use client";

import { LayoutGrid, Monitor, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { useFleetConnections } from "@/hooks/use-fleet-connections";
import type { ConnectionStatus } from "@/lib/fleet-connection-registry";

function statusDotClass(status: ConnectionStatus): string {
  switch (status) {
    case "online":
      return "text-green-500";
    case "error":
      return "text-red-500";
    default:
      return "text-muted-foreground";
  }
}

interface FleetServerTabsProps {
  /** Called when the ghost "Connect a server" tab is clicked */
  onAddServerClick: () => void;
}

/**
 * Horizontal tab row — one tab per Fleet Server connection.
 * Hidden when only 1 connection is registered.
 * Shows a ghost "Connect a server" tab alongside Local when only 1 connection exists.
 */
export function FleetServerTabs({ onAddServerClick }: FleetServerTabsProps) {
  const {
    connections,
    activeConnection,
    setActiveConnection,
    activeServerFilter,
    setActiveServerFilter,
  } = useFleetConnections();

  // Ghost tab only when there's exactly 1 connection (Local only)
  const showGhostTab = connections.length === 1;

  // Hidden once there are 2+ real connections; show tabs
  if (connections.length < 2 && !showGhostTab) {
    return null;
  }

  // If only 1 connection, show Local + ghost tab (no filter needed)
  if (showGhostTab) {
    return (
      <div className="flex items-center gap-0.5 px-2 pb-1">
        {/* Local tab */}
        <button
          type="button"
          onClick={() => setActiveConnection("local")}
          className={cn(
            "flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors",
            "bg-sidebar-accent text-sidebar-accent-foreground"
          )}
        >
          <Monitor className="h-3 w-3 shrink-0" />
          <span>Local</span>
        </button>

        {/* Ghost tab */}
        <button
          type="button"
          onClick={onAddServerClick}
          className={cn(
            "flex items-center gap-1 rounded-md border border-dashed px-2 py-1 text-xs",
            "text-muted-foreground hover:text-foreground hover:border-foreground/40 transition-colors"
          )}
        >
          <Plus className="h-3 w-3 shrink-0" />
          <span>Connect a server</span>
        </button>
      </div>
    );
  }

  // 2+ connections — render "All" tab + one tab per connection
  return (
    <div className="flex items-center gap-0.5 px-2 pb-1 flex-wrap">
      {/* All tab */}
      <button
        type="button"
        onClick={() => setActiveServerFilter("all")}
        className={cn(
          "flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors",
          activeServerFilter === "all"
            ? "bg-sidebar-accent text-sidebar-accent-foreground"
            : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground"
        )}
      >
        <LayoutGrid className="h-3 w-3 shrink-0" />
        <span>All</span>
      </button>

      {connections.map((conn) => {
        const isActive = activeServerFilter === conn.id;
        return (
          <button
            key={conn.id}
            type="button"
            onClick={() => {
              setActiveServerFilter(conn.id);
              setActiveConnection(conn.id);
            }}
            className={cn(
              "flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors",
              isActive
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground"
            )}
          >
            {conn.isLocal && <Monitor className="h-3 w-3 shrink-0" />}
            <span
              className={cn("text-[10px] leading-none", statusDotClass(conn.status))}
              aria-label={`Status: ${conn.status}`}
            >
              ●
            </span>
            <span>{conn.name}</span>
          </button>
        );
      })}
    </div>
  );
}
