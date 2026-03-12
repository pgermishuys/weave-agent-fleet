"use client";

import React, { useState, useCallback } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Pencil, Pin, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { InlineEdit } from "@/components/ui/inline-edit";
import { SidebarSessionItem } from "@/components/layout/sidebar-session-item";
import { NewSessionDialog } from "@/components/session/new-session-dialog";
import { useRenameWorkspace } from "@/hooks/use-rename-workspace";
import { useTerminateSession } from "@/hooks/use-terminate-session";
import { usePersistedState } from "@/hooks/use-persisted-state";
import { useSessionsContext } from "@/contexts/sessions-context";
import { useOpenDirectory } from "@/hooks/use-open-directory";
import type { OpenTool } from "@/hooks/use-open-directory";
import { OpenToolContextSubmenu } from "@/components/ui/open-tool-menu";
import type { WorkspaceGroup } from "@/hooks/use-workspaces";
import { nestSessions } from "@/lib/session-utils";

const PINNED_KEY = "weave:sidebar:pinned";

interface SidebarWorkspaceItemProps {
  group: WorkspaceGroup;
  activeSessionPath: string;
  refetch: () => void;
}

export const SidebarWorkspaceItem = React.memo(function SidebarWorkspaceItem({
  group,
  activeSessionPath,
  refetch,
}: SidebarWorkspaceItemProps) {
  const searchParams = useSearchParams();
  const workspaceFilter = searchParams.get("workspace");
  const isActiveWorkspace = workspaceFilter
    ? group.sessions.some((s) => s.workspaceId === workspaceFilter)
    : false;

  const { renameWorkspace } = useRenameWorkspace();
  const { patchWorkspaceDisplayName } = useSessionsContext();
  const { terminateSession } = useTerminateSession();
  const { openDirectory } = useOpenDirectory();

  const [isRenaming, setIsRenaming] = useState(false);
  const [newSessionOpen, setNewSessionOpen] = useState(false);

  const [pinnedIds, setPinnedIds] = usePersistedState<string[]>(PINNED_KEY, []);
  const isPinned = pinnedIds.includes(group.workspaceId);

  const handleRename = useCallback(
    async (newName: string) => {
      try {
        patchWorkspaceDisplayName(group.workspaceId, newName);
        await renameWorkspace(group.workspaceId, newName, refetch);
      } catch {
        // error surfaced inside useRenameWorkspace
      }
    },
    [group.workspaceId, renameWorkspace, refetch, patchWorkspaceDisplayName]
  );

  const handleTogglePin = useCallback(() => {
    setPinnedIds((prev) =>
      prev.includes(group.workspaceId)
        ? prev.filter((id) => id !== group.workspaceId)
        : [...prev, group.workspaceId]
    );
  }, [group.workspaceId, setPinnedIds]);

  const handleTerminateAll = useCallback(async () => {
    const active = group.sessions.filter((s) => s.lifecycleStatus !== "stopped" && s.lifecycleStatus !== "completed" && s.lifecycleStatus !== "disconnected");
    if (active.length === 0) return;
    const confirmed = window.confirm(
      `Terminate all ${active.length} active session${active.length !== 1 ? "s" : ""} in "${group.displayName}"?`
    );
    if (!confirmed) return;
    await Promise.allSettled(
      active.map((s) => terminateSession(s.session.id, s.instanceId))
    );
    refetch();
  }, [group.sessions, group.displayName, terminateSession, refetch]);

  const handleOpen = useCallback(
    (directory: string, tool: OpenTool) => {
      openDirectory(directory, tool);
    },
    [openDirectory]
  );

  return (
    <>
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          role="treeitem"
          aria-label={group.displayName}
          tabIndex={0}
          className="focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded-md"
        >
          {/* Workspace row */}
          <div
            className={cn(
              "flex items-center gap-2 rounded-md pl-8 pr-3 py-1.5 text-sm transition-colors",
              isActiveWorkspace
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground"
            )}
          >
            {/* Display name with tooltip for full path */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Link
                  href={`/?workspace=${encodeURIComponent(group.workspaceId)}`}
                  className="flex-1 min-w-0"
                  onClick={(e) => {
                    if (isRenaming) {
                      e.preventDefault();
                    }
                  }}
                >
                  <InlineEdit
                    value={group.displayName}
                    onSave={handleRename}
                    editing={isRenaming}
                    onEditingChange={setIsRenaming}
                    className="text-xs truncate block"
                  />
                </Link>
              </TooltipTrigger>
              <TooltipContent side="right" className="text-xs font-mono">
                {group.workspaceDirectory}
              </TooltipContent>
            </Tooltip>

            {/* Hidden trigger for F2 rename via keyboard navigation */}
            <button
              data-rename-trigger
              className="sr-only"
              tabIndex={-1}
              onClick={() => setIsRenaming(true)}
              aria-label={`Rename ${group.displayName}`}
            />
          </div>

          {/* Session list — always visible */}
          <div className="space-y-0.5 mt-0.5" role="group">
            {nestSessions(group.sessions).map(({ item, children }) => (
              <div key={`${item.instanceId}-${item.session.id}`}>
                <SidebarSessionItem
                  item={item}
                  isActive={activeSessionPath === `/sessions/${item.session.id}`}
                  refetch={refetch}
                />
                {children.map((child) => (
                  <SidebarSessionItem
                    key={`${child.instanceId}-${child.session.id}`}
                    item={child}
                    isActive={activeSessionPath === `/sessions/${child.session.id}`}
                    isChild
                    refetch={refetch}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      </ContextMenuTrigger>

      <ContextMenuContent>
        <ContextMenuItem
          onClick={() => setIsRenaming(true)}
          className="gap-2 text-xs"
        >
          <Pencil className="h-3.5 w-3.5" />
          Rename
        </ContextMenuItem>
        <ContextMenuItem
          onClick={handleTogglePin}
          className="gap-2 text-xs"
        >
          <Pin className="h-3.5 w-3.5" />
          {isPinned ? "Unpin" : "Pin to top"}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          onClick={() => setNewSessionOpen(true)}
          className="gap-2 text-xs"
        >
          <Plus className="h-3.5 w-3.5" />
          New Session
        </ContextMenuItem>
        <OpenToolContextSubmenu
          directory={group.sessions[0]?.workspaceDirectory ?? group.workspaceDirectory}
          onOpen={handleOpen}
        />
        <ContextMenuSeparator />
        <ContextMenuItem
          onClick={handleTerminateAll}
          variant="destructive"
          className="gap-2 text-xs"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Terminate All
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
    <NewSessionDialog
      open={newSessionOpen}
      onOpenChange={setNewSessionOpen}
      defaultDirectory={group.sessions[0]?.workspaceDirectory ?? group.workspaceDirectory}
    />
    </>
  );
});
