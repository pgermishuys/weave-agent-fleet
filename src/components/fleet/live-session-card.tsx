"use client";

import React from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import { ArrowRight, Clock, Copy, ExternalLink, GitBranch, Loader2, OctagonX, RotateCcw, Square, Trash2, WifiOff } from "lucide-react";
import type { SessionListItem } from "@/lib/api-types";
import { formatRelativeTime } from "@/lib/format-utils";

export const LiveSessionCard = React.memo(function LiveSessionCard({
  item,
  onTerminate,
  onResume,
  onDelete,
  onOpen,
  onAbort,
  isResuming = false,
  isParent = false,
  isChild = false,
}: {
  item: SessionListItem;
  onTerminate: (sessionId: string, instanceId: string) => void;
  onResume?: (sessionId: string) => void;
  onDelete?: (sessionId: string, instanceId: string) => void;
  onOpen?: (directory: string) => void;
  onAbort?: (sessionId: string, instanceId: string) => void;
  isResuming?: boolean;
  isParent?: boolean;
  isChild?: boolean;
}) {
  const { instanceId, session, isolationStrategy, activityStatus, lifecycleStatus } = item;
  const isDisconnected = lifecycleStatus === "disconnected";
  const isStopped = lifecycleStatus === "stopped";
  const isCompleted = lifecycleStatus === "completed";
  const isInactive = isDisconnected || isStopped || isCompleted;

  // Session status: purely about agent activity
  const isBusy = activityStatus === "busy";
  const sessionStatusDot = isBusy ? "bg-green-500 animate-pulse" : "bg-slate-400";
  const sessionStatusLabel = isBusy ? "working" : "idle";
  const badgeVariant: "destructive" | "secondary" | "outline" = "secondary";

  // Connection status: only shown when unhealthy
  const ConnectionIcon = isDisconnected
    ? WifiOff
    : isStopped || isCompleted
    ? Square
    : null;
  const connectionTooltip = isDisconnected
    ? "Disconnected"
    : isStopped
    ? "Stopped"
    : isCompleted
    ? "Stopped"
    : null;

  const canTerminate = !isStopped && !isCompleted;
  const canDelete = (isStopped || isCompleted || isDisconnected) && !!onDelete;
  const canAbort = activityStatus === "busy" && !!onAbort;

  return (
    <div className={`relative group ${isInactive ? "opacity-60" : ""}`}>
      <Link href={`/sessions/${encodeURIComponent(session.id)}?instanceId=${encodeURIComponent(instanceId)}`}>
        <Card className="transition-all hover:border-foreground/20 hover:shadow-md cursor-pointer">
          <CardHeader className="pb-2 pt-4 px-4">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2">
                <span className={`h-2.5 w-2.5 rounded-full ${sessionStatusDot}`} />
                <h3 className="font-semibold text-sm font-mono truncate max-w-[140px]">
                  {session.title || session.id.slice(0, 12)}
                </h3>
              </div>
              <ArrowRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
            <div className="flex items-center gap-1.5 mt-1">
              <Badge variant={badgeVariant} className="text-[10px] px-1.5 py-0">
                {sessionStatusLabel}
              </Badge>
              {ConnectionIcon && (
                <span title={connectionTooltip ?? undefined} className="text-muted-foreground">
                  <ConnectionIcon className="h-3 w-3" />
                </span>
              )}
              {isolationStrategy && isolationStrategy !== "existing" && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="text-purple-400 cursor-default">
                        {isolationStrategy === "worktree" ? (
                          <GitBranch className="h-3 w-3" />
                        ) : (
                          <Copy className="h-3 w-3" />
                        )}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>{isolationStrategy}</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
              {isParent && (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-cyan-400 border-cyan-400/40">
                  conductor
                </Badge>
              )}
              {isChild && (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-orange-400 border-orange-400/40">
                  child
                </Badge>
              )}
              {isolationStrategy === "existing" && (
                <span className="text-[10px] text-muted-foreground font-mono truncate max-w-[120px]">
                  {session.directory}
                </span>
              )}
            </div>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" />
              <span>{formatRelativeTime(session.time.created)}</span>
              <span className="ml-auto text-[10px] font-mono text-muted-foreground/60">
                {session.id.slice(0, 8)}…
              </span>
            </div>
          </CardContent>
        </Card>
      </Link>
      {canTerminate && (
        <Button
          variant="ghost"
          size="icon"
          className="absolute top-2 right-2 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive hover:bg-destructive/10"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onTerminate(session.id, instanceId);
          }}
          title="Terminate session"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      )}
      {canAbort && (
        <Button
          variant="ghost"
          size="icon"
          className="absolute top-2 right-10 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-amber-500 hover:bg-amber-500/10"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onAbort!(session.id, instanceId);
          }}
          title="Interrupt session"
        >
          <OctagonX className="h-3.5 w-3.5" />
        </Button>
      )}
      {canDelete && (
        <Button
          variant="ghost"
          size="icon"
          className="absolute top-2 right-2 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity text-red-400 hover:text-red-500 hover:bg-red-500/10"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onDelete!(session.id, instanceId);
          }}
          title="Permanently delete session"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      )}
      {isInactive && onResume && (
        <Button
          variant="ghost"
          size="icon"
          className={`absolute top-2 right-10 h-6 w-6 transition-opacity text-muted-foreground ${
            isResuming
              ? "opacity-100 cursor-not-allowed"
              : "opacity-0 group-hover:opacity-100 hover:text-green-500 hover:bg-green-500/10"
          }`}
          disabled={isResuming}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onResume(session.id);
          }}
          title={isResuming ? "Resuming…" : "Resume session"}
        >
          {isResuming ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-green-500" />
          ) : (
            <RotateCcw className="h-3.5 w-3.5" />
          )}
        </Button>
      )}
      {onOpen && (
        <Button
          variant="ghost"
          size="icon"
          className={`absolute top-2 ${
            isInactive && onResume ? "right-[4.5rem]" : canAbort ? "right-[4.5rem]" : "right-10"
          } h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-blue-500 hover:bg-blue-500/10`}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onOpen(item.workspaceDirectory);
          }}
          title="Open in editor"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );
});
