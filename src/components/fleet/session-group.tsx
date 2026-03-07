"use client";

import { useCallback } from "react";
import { ChevronRight, MoreHorizontal, Plus, Trash2 } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InlineEdit } from "@/components/ui/inline-edit";
import { LiveSessionCard } from "@/components/fleet/live-session-card";
import { useRenameWorkspace } from "@/hooks/use-rename-workspace";
import { useSessionsContext } from "@/contexts/sessions-context";
import { usePersistedState } from "@/hooks/use-persisted-state";
import { useTerminateSession } from "@/hooks/use-terminate-session";
import type { WorkspaceGroup } from "@/hooks/use-workspaces";
import type { OpenTool } from "@/hooks/use-open-directory";
import { OpenToolDropdownSubmenu } from "@/components/ui/open-tool-menu";
import { nestSessions } from "@/lib/session-utils";
import { cn } from "@/lib/utils";

const COLLAPSED_KEY = "weave:fleet:collapsed";

interface SessionGroupProps {
  group: WorkspaceGroup;
  onTerminate: (sessionId: string, instanceId: string) => void;
  onNewSession?: (workspaceDirectory: string) => void;
  onResume?: (sessionId: string) => void;
  onDelete?: (sessionId: string, instanceId: string) => void;
  onAbort?: (sessionId: string, instanceId: string) => void;
  onOpen?: (directory: string, tool: OpenTool) => void;
  resumingSessionId?: string | null;
}

export function SessionGroup({ group, onTerminate, onNewSession, onResume, onDelete, onAbort, onOpen, resumingSessionId }: SessionGroupProps) {
  const { refetch } = useSessionsContext();
  const { renameWorkspace } = useRenameWorkspace();
  const { terminateSession } = useTerminateSession();

  const [collapsedIds, setCollapsedIds] = usePersistedState<string[]>(
    COLLAPSED_KEY,
    []
  );

  const isCollapsed = collapsedIds.includes(group.workspaceId);

  const handleOpenChange = useCallback(
    (open: boolean) => {
      setCollapsedIds((prev) =>
        open
          ? prev.filter((id) => id !== group.workspaceId)
          : [...prev, group.workspaceId]
      );
    },
    [group.workspaceId, setCollapsedIds]
  );

  const handleRename = useCallback(
    async (newName: string) => {
      try {
        await renameWorkspace(group.workspaceId, newName, refetch);
      } catch {
        // error surfaced inside useRenameWorkspace
      }
    },
    [group.workspaceId, renameWorkspace, refetch]
  );

  const handleTerminateAll = useCallback(async () => {
    const active = group.sessions.filter((s) => s.lifecycleStatus !== "stopped" && s.lifecycleStatus !== "completed" && s.lifecycleStatus !== "disconnected");
    await Promise.allSettled(
      active.map((s) => terminateSession(s.session.id, s.instanceId))
    );
    refetch();
  }, [group.sessions, terminateSession, refetch]);

  const handleOpenVscode = useCallback(
    (dir: string) => onOpen?.(dir, "vscode"),
    [onOpen]
  );

  const hasRunning = group.hasRunningSession;

  return (
    <Collapsible open={!isCollapsed} onOpenChange={handleOpenChange}>
      <div className="flex items-center gap-2 py-1.5 px-1 group/header rounded-md hover:bg-accent/50 transition-colors">
        {/* Expand/collapse chevron */}
        <CollapsibleTrigger asChild>
          <Button
            variant="ghost"
            size="icon-xs"
            className="shrink-0 text-muted-foreground hover:text-foreground"
            onClick={(e) => e.stopPropagation()}
          >
            <ChevronRight
              className={cn(
                "size-3.5 transition-transform duration-150",
                !isCollapsed && "rotate-90"
              )}
            />
          </Button>
        </CollapsibleTrigger>

        {/* Status dot */}
        <span
          className={cn(
            "h-2 w-2 rounded-full shrink-0",
            hasRunning ? "bg-green-500 animate-pulse" : "bg-slate-500"
          )}
        />

        {/* Workspace display name (inline-editable) */}
        <InlineEdit
          value={group.displayName}
          onSave={handleRename}
          className="flex-1 min-w-0 font-medium text-sm truncate"
        />

        {/* Session count badge */}
        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 shrink-0">
          {group.sessionCount}
        </Badge>

        {/* Overflow menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              className="shrink-0 opacity-0 group-hover/header:opacity-100 transition-opacity text-muted-foreground"
              onClick={(e) => e.stopPropagation()}
            >
              <MoreHorizontal className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {onNewSession && (
              <DropdownMenuItem
                onClick={() => onNewSession(group.sessions[0]?.workspaceDirectory ?? group.workspaceDirectory)}
                className="gap-2 text-xs"
              >
                <Plus className="size-3.5" />
                New Session
              </DropdownMenuItem>
            )}
            {onNewSession && <DropdownMenuSeparator />}
            {onOpen && (
              <>
                <OpenToolDropdownSubmenu
                  directory={group.sessions[0]?.workspaceDirectory ?? group.workspaceDirectory}
                  onOpen={onOpen}
                />
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuItem
              onClick={handleTerminateAll}
              variant="destructive"
              className="gap-2 text-xs"
            >
              <Trash2 className="size-3.5" />
              Terminate All
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <CollapsibleContent className="overflow-hidden data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 data-[state=open]:slide-in-from-top-1 data-[state=closed]:slide-out-to-top-1 transition-all">
        {group.sessions.length === 0 ? (
          <div className="mt-2 ml-6 py-3 text-xs text-muted-foreground/70 italic">
            No sessions in this workspace.
          </div>
        ) : (
          <div className="mt-2 ml-6 space-y-4">
            {nestSessions(group.sessions).map(({ item, children }) => (
              <div key={`${item.instanceId}-${item.session.id}`}>
                <LiveSessionCard
                  item={item}
                  isParent={children.length > 0}
                  onTerminate={onTerminate}
                  onResume={onResume}
                  onDelete={onDelete}
                  onAbort={onAbort}
                  onOpen={onOpen ? handleOpenVscode : undefined}
                  isResuming={resumingSessionId === item.session.id}
                />
                {children.length > 0 && (
                  <div className="ml-4 mt-1 space-y-2 border-l-2 border-muted-foreground/20 pl-3">
                    {children.map((child) => (
                      <LiveSessionCard
                        key={`${child.instanceId}-${child.session.id}`}
                        item={child}
                        isChild
                        onTerminate={onTerminate}
                        onResume={onResume}
                        onDelete={onDelete}
                        onAbort={onAbort}
                        onOpen={onOpen ? handleOpenVscode : undefined}
                        isResuming={resumingSessionId === child.session.id}
                      />
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
