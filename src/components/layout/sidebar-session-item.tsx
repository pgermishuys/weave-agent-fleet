"use client";

import React, { useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Copy, GitFork, OctagonX, Pencil, Play, Square, StopCircle, Trash2, WifiOff } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { InlineEdit } from "@/components/ui/inline-edit";
import { ConfirmDeleteSessionDialog } from "@/components/fleet/confirm-delete-session-dialog";
import { ForkSessionDialog } from "@/components/session/fork-session-dialog";
import { OpenToolContextSubmenu } from "@/components/ui/open-tool-menu";
import { useRenameSession } from "@/hooks/use-rename-session";
import { useTerminateSession } from "@/hooks/use-terminate-session";
import { useAbortSession } from "@/hooks/use-abort-session";
import { useDeleteSession } from "@/hooks/use-delete-session";
import { useResumeSession } from "@/hooks/use-resume-session";
import { useOpenDirectory } from "@/hooks/use-open-directory";
import type { OpenTool } from "@/hooks/use-open-directory";
import type { SessionListItem } from "@/lib/api-types";
import { useSessionsContext } from "@/contexts/sessions-context";

interface SidebarSessionItemProps {
  item: SessionListItem;
  isActive: boolean;
  isChild?: boolean;
  refetch: () => void;
}

export const SidebarSessionItem = React.memo(function SidebarSessionItem({ item, isActive, isChild = false, refetch }: SidebarSessionItemProps) {
  const { instanceId, session, activityStatus, lifecycleStatus } = item;
  const connectionId = item.connectionId;
  const router = useRouter();
  const { renameSession } = useRenameSession();
  const { patchSessionTitle } = useSessionsContext();
  const { terminateSession } = useTerminateSession();
  const { abortSession } = useAbortSession();
  const { deleteSession, isDeleting } = useDeleteSession();
  const { resumeSession } = useResumeSession();
  const { openDirectory } = useOpenDirectory();
  const [isRenaming, setIsRenaming] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showForkDialog, setShowForkDialog] = useState(false);

  const isDisconnected = lifecycleStatus === "disconnected";
  const isStopped = lifecycleStatus === "stopped";
  const isCompleted = lifecycleStatus === "completed";
  const isRunning = lifecycleStatus === "running";

  // Conditional action visibility
  const canAbort = isRunning && activityStatus === "busy";
  const canStop = isRunning;
  const canResume = isStopped || isCompleted || isDisconnected;

  // Session status: purely about agent activity
  const isBusy = activityStatus === "busy";
  const sessionStatusDot = isBusy ? "bg-green-500 animate-pulse" : "bg-muted-foreground/50";

  // Connection status: only shown when unhealthy
  const ConnectionIcon = isDisconnected
    ? WifiOff
    : isStopped || isCompleted
    ? Square
    : null;
  const connectionTooltip = isDisconnected
    ? "Disconnected"
    : isStopped || isCompleted
    ? "Stopped"
    : null;

  const title = session.title || session.id.slice(0, 12);

  const handleRename = useCallback(
    async (newTitle: string) => {
      try {
        const dbId = item.dbId ?? item.session.id;
        // Optimistically update the title in the sidebar immediately
        patchSessionTitle(item.session.id, newTitle);
        await renameSession(dbId, newTitle, refetch);
      } catch {
        // error surfaced inside useRenameSession
      }
    },
    [item.dbId, item.session.id, renameSession, refetch, patchSessionTitle]
  );

  const handleStop = useCallback(async () => {
    try {
      await terminateSession(session.id, instanceId, undefined, connectionId);
      refetch();
    } catch {
      // error surfaced inside useTerminateSession
    }
  }, [terminateSession, session.id, instanceId, connectionId, refetch]);

  const handleAbort = useCallback(async () => {
    try {
      await abortSession(session.id, instanceId, connectionId);
    } catch {
      // error surfaced inside useAbortSession
    }
  }, [abortSession, session.id, instanceId, connectionId]);

  const handleDeleteConfirm = useCallback(async () => {
    try {
      await deleteSession(session.id, instanceId, connectionId);
      refetch();
    } catch {
      // error surfaced inside useDeleteSession
    } finally {
      setShowDeleteConfirm(false);
    }
  }, [deleteSession, session.id, instanceId, connectionId, refetch]);

  const handleResume = useCallback(async () => {
    try {
      const result = await resumeSession(session.id, connectionId);
      refetch();
      const url = `/sessions/${encodeURIComponent(result.session.id)}?instanceId=${encodeURIComponent(result.instanceId)}${connectionId ? `&connectionId=${encodeURIComponent(connectionId)}` : ""}`;
      router.push(url);
    } catch {
      // error surfaced inside useResumeSession
      refetch();
    }
  }, [resumeSession, session.id, connectionId, router, refetch]);

  const handleCopyId = useCallback(() => {
    navigator.clipboard.writeText(session.id).catch(() => {});
  }, [session.id]);

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
          <Link
            href={`/sessions/${encodeURIComponent(session.id)}?instanceId=${encodeURIComponent(instanceId)}${connectionId ? `&connectionId=${encodeURIComponent(connectionId)}` : ""}`}
            data-tree-leaf
            tabIndex={0}
            onClick={(e) => {
              if (isRenaming) e.preventDefault();
            }}
            className={cn(
              "flex items-center gap-2 rounded-md pr-3 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
              isChild ? "pl-16" : "pl-12",
              isActive
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground"
            )}
          >
            {isChild && <span className="text-muted-foreground/50 text-[10px] shrink-0">↳</span>}
            <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${sessionStatusDot}`} />
            {ConnectionIcon && (
              <span title={connectionTooltip ?? undefined} className="text-muted-foreground shrink-0 pointer-events-none">
                <ConnectionIcon className="h-2.5 w-2.5" />
              </span>
            )}
            <InlineEdit
              value={title}
              onSave={handleRename}
              editing={isRenaming}
              onEditingChange={setIsRenaming}
              className="text-xs truncate block"
            />
            <button
              data-rename-trigger
              className="sr-only"
              tabIndex={-1}
              onClick={() => setIsRenaming(true)}
              aria-label={`Rename ${title}`}
            />
          </Link>
        </ContextMenuTrigger>

        <ContextMenuContent>
          {/* Always available */}
          <ContextMenuItem onClick={() => setIsRenaming(true)} className="gap-2 text-xs">
            <Pencil className="h-3.5 w-3.5" />
            Rename
          </ContextMenuItem>

          <ContextMenuSeparator />

          {/* Lifecycle actions — shown conditionally */}
          {canAbort && (
            <ContextMenuItem onClick={handleAbort} className="gap-2 text-xs">
              <OctagonX className="h-3.5 w-3.5" />
              Interrupt
            </ContextMenuItem>
          )}
          {canStop && (
            <ContextMenuItem onClick={handleStop} className="gap-2 text-xs">
              <StopCircle className="h-3.5 w-3.5" />
              Stop
            </ContextMenuItem>
          )}
          {canResume && (
            <ContextMenuItem onClick={handleResume} className="gap-2 text-xs">
              <Play className="h-3.5 w-3.5" />
              Resume
            </ContextMenuItem>
          )}

          <ContextMenuSeparator />

          {/* New context window */}
          <ContextMenuItem onClick={() => setShowForkDialog(true)} className="gap-2 text-xs">
            <GitFork className="h-3.5 w-3.5" />
            New context window
          </ContextMenuItem>

          <ContextMenuSeparator />

          {/* Utility */}
          <ContextMenuItem onClick={handleCopyId} className="gap-2 text-xs">
            <Copy className="h-3.5 w-3.5" />
            Copy Session ID
          </ContextMenuItem>

          <ContextMenuSeparator />

          {/* Open in tool */}
          <OpenToolContextSubmenu
            directory={item.workspaceDirectory}
            onOpen={handleOpen}
          />

          <ContextMenuSeparator />

          {/* Destructive */}
          <ContextMenuItem
            onClick={() => setShowDeleteConfirm(true)}
            variant="destructive"
            className="gap-2 text-xs"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      <ConfirmDeleteSessionDialog
        open={showDeleteConfirm}
        onOpenChange={setShowDeleteConfirm}
        sessionTitle={title}
        onConfirm={handleDeleteConfirm}
        isDeleting={isDeleting}
      />

      <ForkSessionDialog
        sourceSessionId={item.dbId ?? item.session.id}
        sourceSessionTitle={title}
        open={showForkDialog}
        onOpenChange={setShowForkDialog}
        connectionId={connectionId}
      />
    </>
  );
});
