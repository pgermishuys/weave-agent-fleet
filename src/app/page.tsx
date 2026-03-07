"use client";

import { useCallback, useMemo, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Header, NewSessionButton } from "@/components/layout/header";
import { SummaryBar } from "@/components/fleet/summary-bar";
import { FleetToolbar } from "@/components/fleet/fleet-toolbar";
import type { GroupBy, SortBy } from "@/components/fleet/fleet-toolbar";
import { SessionGroup } from "@/components/fleet/session-group";
import { LiveSessionCard } from "@/components/fleet/live-session-card";
import { useSessionsContext } from "@/contexts/sessions-context";
import { useTerminateSession } from "@/hooks/use-terminate-session";
import { useAbortSession } from "@/hooks/use-abort-session";
import { useResumeSession } from "@/hooks/use-resume-session";
import { useDeleteSession } from "@/hooks/use-delete-session";
import { useOpenDirectory, usePreferredOpenTool } from "@/hooks/use-open-directory";
import type { OpenTool } from "@/hooks/use-open-directory";
import { useWorkspaces } from "@/hooks/use-workspaces";
import { usePersistedState } from "@/hooks/use-persisted-state";
import { filterSessionsByWorkspace } from "@/lib/workspace-utils";
import { nestSessions } from "@/lib/session-utils";
import { ConfirmDeleteSessionDialog } from "@/components/fleet/confirm-delete-session-dialog";
import type { FleetSummary } from "@/lib/types";
import type { SessionListItem } from "@/lib/api-types";
import { Loader2 } from "lucide-react";

function FleetPageInner() {
  const { sessions, isLoading, error, refetch, summary: liveSummary } = useSessionsContext();
  const { terminateSession } = useTerminateSession();
  const { abortSession } = useAbortSession();
  const { resumeSession, resumingSessionId } = useResumeSession();
  const { deleteSession, isDeleting } = useDeleteSession();
  const { openDirectory } = useOpenDirectory();
  const [preferredTool, setPreferredTool] = usePreferredOpenTool();
  const router = useRouter();
  const searchParams = useSearchParams();
  const workspaceFilter = searchParams.get("workspace");

  const [deleteTarget, setDeleteTarget] = useState<{
    sessionId: string;
    instanceId: string;
    title: string;
  } | null>(null);

  // SSR-safe persisted prefs — useSyncExternalStore under the hood
  // ensures server renders defaults and client hydrates from localStorage.
  const [prefs, setPrefs] = usePersistedState<{ groupBy: GroupBy; sortBy: SortBy }>(
    "weave:fleet:prefs",
    { groupBy: "directory", sortBy: "recent" }
  );
  const [search, setSearch] = useState("");

  const handleGroupByChange = useCallback((groupBy: GroupBy) => {
    setPrefs((prev) => ({ ...prev, groupBy }));
  }, [setPrefs]);

  const handleSortByChange = useCallback((sortBy: SortBy) => {
    setPrefs((prev) => ({ ...prev, sortBy }));
  }, [setPrefs]);

  const handleTerminate = useCallback(async (sessionId: string, instanceId: string) => {
    try {
      await terminateSession(sessionId, instanceId);
      refetch();
    } catch {
      // error surfaced inside useTerminateSession
    }
  }, [terminateSession, refetch]);

  const handleAbort = useCallback(async (sessionId: string, instanceId: string) => {
    try {
      await abortSession(sessionId, instanceId);
    } catch {
      // error surfaced inside useAbortSession
    }
  }, [abortSession]);

  const handleResume = useCallback(async (sessionId: string) => {
    try {
      const result = await resumeSession(sessionId);
      router.push(
        `/sessions/${encodeURIComponent(result.session.id)}?instanceId=${encodeURIComponent(result.instanceId)}`
      );
    } catch {
      // error surfaced inside useResumeSession
      refetch();
    }
  }, [resumeSession, router, refetch]);

  const handleDeleteRequest = useCallback((sessionId: string, instanceId: string) => {
    const item = sessions.find((s) => s.session.id === sessionId);
    setDeleteTarget({
      sessionId,
      instanceId,
      title: item?.session.title || sessionId.slice(0, 12),
    });
  }, [sessions]);

  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteTarget) return;
    try {
      await deleteSession(deleteTarget.sessionId, deleteTarget.instanceId);
      refetch();
    } catch {
      // error surfaced inside useDeleteSession
    } finally {
      setDeleteTarget(null);
    }
  }, [deleteTarget, deleteSession, refetch]);

  const handleOpen = useCallback((directory: string, tool?: OpenTool) => {
    const t = tool ?? preferredTool;
    if (tool) setPreferredTool(t);
    openDirectory(directory, t);
  }, [preferredTool, setPreferredTool, openDirectory]);

  // Apply workspace URL filter — resolves workspaceId to directory so that all
  // sessions sharing the same workspace directory are included.
  const workspaceFiltered = useMemo(
    () => filterSessionsByWorkspace(sessions, workspaceFilter),
    [sessions, workspaceFilter]
  );

  // Apply search filter
  const searchFiltered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return workspaceFiltered;
    return workspaceFiltered.filter((s) => {
      const title = s.session.title?.toLowerCase() ?? "";
      const dir = (s.sourceDirectory ?? s.workspaceDirectory).toLowerCase();
      const displayName = s.workspaceDisplayName?.toLowerCase() ?? "";
      return title.includes(q) || dir.includes(q) || displayName.includes(q);
    });
  }, [workspaceFiltered, search]);

  // Apply sort within session arrays
  const sortSessions = useCallback((items: SessionListItem[]): SessionListItem[] => {
    const sorted = [...items];
    if (prefs.sortBy === "recent") {
      sorted.sort((a, b) => b.session.time.created - a.session.time.created);
    } else if (prefs.sortBy === "name") {
      sorted.sort((a, b) => {
        const aTitle = a.session.title ?? a.session.id;
        const bTitle = b.session.title ?? b.session.id;
        return aTitle.localeCompare(bTitle);
      });
    } else if (prefs.sortBy === "status") {
      const activityOrder: Record<string, number> = { busy: 0, waiting_input: 1, idle: 2 };
      const lifecycleOrder: Record<string, number> = { running: 0, completed: 1, stopped: 2, error: 3, disconnected: 4 };
      sorted.sort((a, b) => {
        const aLifecycle = lifecycleOrder[a.lifecycleStatus] ?? 4;
        const bLifecycle = lifecycleOrder[b.lifecycleStatus] ?? 4;
        if (aLifecycle !== bLifecycle) return aLifecycle - bLifecycle;
        const aActivity = activityOrder[a.activityStatus ?? "idle"] ?? 3;
        const bActivity = activityOrder[b.activityStatus ?? "idle"] ?? 3;
        return aActivity - bActivity;
      });
    }
    return sorted;
  }, [prefs.sortBy]);

  // Derive workspace groups from filtered sessions
  const allWorkspaces = useWorkspaces(searchFiltered);

  // Memoize sorted workspace groups to preserve object identity for React.memo
  const sortedWorkspaceGroups = useMemo(
    () => allWorkspaces.map((g) => ({ ...g, sessions: sortSessions(g.sessions) })),
    [allWorkspaces, sortSessions]
  );

  const liveCount = liveSummary?.activeSessions ?? sessions.filter((s) => s.activityStatus === "busy").length;

  const summary: FleetSummary = {
    activeSessions: liveSummary?.activeSessions ?? liveCount,
    idleSessions: liveSummary?.idleSessions ?? sessions.filter((s) => s.lifecycleStatus === "running" && s.activityStatus === "idle").length,
    totalTokens: liveSummary?.totalTokens ?? 0,
    totalCost: liveSummary?.totalCost ?? 0,
    queuedTasks: 0,
  };

  const subtitle =
    sessions.length > 0
      ? `${liveCount} active session${liveCount !== 1 ? "s" : ""}`
      : "No active sessions";

  // Group by "Session Status" (working / idle)
  const renderGroupedBySessionStatus = () => {
    const groups: Record<string, SessionListItem[]> = {
      working: [],
      idle: [],
    };
    for (const s of searchFiltered) {
      if (s.activityStatus === "busy") {
        groups.working.push(s);
      } else {
        groups.idle.push(s);
      }
    }
    return (
      <div className="space-y-4">
        {(["working", "idle"] as const).map((status) => {
          const items = sortSessions(groups[status]);
          if (items.length === 0) return null;
          return (
            <div key={status}>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {status}
                </span>
                <span className="text-xs text-muted-foreground">({items.length})</span>
              </div>
               <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                 {nestSessions(items).map(({ item, children }) => (
                   <div key={`${item.instanceId}-${item.session.id}`} className="contents">
                     <LiveSessionCard
                       item={item}
                       isParent={children.length > 0}
                       onTerminate={handleTerminate}
                       onResume={handleResume}
                       onDelete={handleDeleteRequest}
                       onOpen={handleOpen}
                       onAbort={handleAbort}
                       isResuming={resumingSessionId === item.session.id}
                     />
                     {children.map((child) => (
                       <LiveSessionCard
                         key={`${child.instanceId}-${child.session.id}`}
                         item={child}
                         isChild
                         onTerminate={handleTerminate}
                         onResume={handleResume}
                         onDelete={handleDeleteRequest}
                         onOpen={handleOpen}
                         onAbort={handleAbort}
                         isResuming={resumingSessionId === child.session.id}
                       />
                     ))}
                   </div>
                 ))}
               </div>
             </div>
           );
         })}
       </div>
     );
   };

  // Group by "Connection Status" (connected / disconnected / stopped)
  const renderGroupedByConnectionStatus = () => {
    const groups: Record<string, SessionListItem[]> = {
      connected: [],
      disconnected: [],
      stopped: [],
    };
    for (const s of searchFiltered) {
      const isDisconnected = s.lifecycleStatus === "disconnected";
      const isStopped = s.lifecycleStatus === "stopped" || s.lifecycleStatus === "completed";

      if (isDisconnected) {
        groups.disconnected.push(s);
      } else if (isStopped) {
        groups.stopped.push(s);
      } else {
        groups.connected.push(s);
      }
    }
    return (
      <div className="space-y-4">
        {(["connected", "disconnected", "stopped"] as const).map((status) => {
          const items = sortSessions(groups[status]);
          if (items.length === 0) return null;
          return (
            <div key={status}>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {status}
                </span>
                <span className="text-xs text-muted-foreground">({items.length})</span>
              </div>
               <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                 {nestSessions(items).map(({ item, children }) => (
                   <div key={`${item.instanceId}-${item.session.id}`} className="contents">
                     <LiveSessionCard
                       item={item}
                       isParent={children.length > 0}
                       onTerminate={handleTerminate}
                       onResume={handleResume}
                       onDelete={handleDeleteRequest}
                       onOpen={handleOpen}
                       onAbort={handleAbort}
                       isResuming={resumingSessionId === item.session.id}
                     />
                     {children.map((child) => (
                       <LiveSessionCard
                         key={`${child.instanceId}-${child.session.id}`}
                         item={child}
                         isChild
                         onTerminate={handleTerminate}
                         onResume={handleResume}
                         onDelete={handleDeleteRequest}
                         onOpen={handleOpen}
                         onAbort={handleAbort}
                         isResuming={resumingSessionId === child.session.id}
                       />
                     ))}
                   </div>
                 ))}
               </div>
             </div>
           );
         })}
       </div>
     );
   };

   // Group by "Source" (isolationStrategy)
   const renderGroupedBySource = () => {
    const sourceMap = new Map<string, SessionListItem[]>();
    for (const s of searchFiltered) {
      const key = s.isolationStrategy ?? "existing";
      const arr = sourceMap.get(key);
      if (arr) {
        arr.push(s);
      } else {
        sourceMap.set(key, [s]);
      }
    }
    return (
      <div className="space-y-4">
        {Array.from(sourceMap.entries()).map(([source, items]) => {
          const sorted = sortSessions(items);
          return (
            <div key={source}>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {source}
                </span>
                <span className="text-xs text-muted-foreground">({sorted.length})</span>
              </div>
               <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                 {nestSessions(sorted).map(({ item, children }) => (
                   <div key={`${item.instanceId}-${item.session.id}`} className="contents">
                     <LiveSessionCard
                       item={item}
                       isParent={children.length > 0}
                       onTerminate={handleTerminate}
                       onResume={handleResume}
                       onDelete={handleDeleteRequest}
                       onOpen={handleOpen}
                       onAbort={handleAbort}
                       isResuming={resumingSessionId === item.session.id}
                     />
                     {children.map((child) => (
                       <LiveSessionCard
                         key={`${child.instanceId}-${child.session.id}`}
                         item={child}
                         isChild
                         onTerminate={handleTerminate}
                         onResume={handleResume}
                         onDelete={handleDeleteRequest}
                         onOpen={handleOpen}
                         onAbort={handleAbort}
                         isResuming={resumingSessionId === child.session.id}
                       />
                     ))}
                   </div>
                 ))}
               </div>
            </div>
          );
        })}
      </div>
    );
  };

  const renderContent = () => {
    if (searchFiltered.length === 0 && !isLoading) {
      if (search.trim()) {
        return (
          <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
            No sessions match your search.
          </div>
        );
      }
      if (workspaceFilter) {
        return (
          <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
            No sessions in this workspace.
          </div>
        );
      }
      return null;
    }

    if (prefs.groupBy === "none") {
      const nested = nestSessions(sortSessions(searchFiltered));
      return (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {nested.map(({ item, children }) => (
            <div key={`${item.instanceId}-${item.session.id}`} className="contents">
              <LiveSessionCard
                item={item}
                isParent={children.length > 0}
                onTerminate={handleTerminate}
                onResume={handleResume}
                onDelete={handleDeleteRequest}
                onOpen={handleOpen}
                onAbort={handleAbort}
                isResuming={resumingSessionId === item.session.id}
              />
              {children.map((child) => (
                <LiveSessionCard
                  key={`${child.instanceId}-${child.session.id}`}
                  item={child}
                  isChild
                  onTerminate={handleTerminate}
                  onResume={handleResume}
                  onDelete={handleDeleteRequest}
                  onOpen={handleOpen}
                  onAbort={handleAbort}
                  isResuming={resumingSessionId === child.session.id}
                />
              ))}
            </div>
          ))}
        </div>
      );
    }

    if (prefs.groupBy === "session-status") {
      return renderGroupedBySessionStatus();
    }

    if (prefs.groupBy === "connection-status") {
      return renderGroupedByConnectionStatus();
    }

    if (prefs.groupBy === "source") {
      return renderGroupedBySource();
    }

    // Default: "directory" — render SessionGroup per workspace
    return (
      <div className="space-y-2">
        {sortedWorkspaceGroups.map((group) => (
          <SessionGroup
              key={group.workspaceDirectory}
              group={group}
              onTerminate={handleTerminate}
              onResume={handleResume}
              onDelete={handleDeleteRequest}
              onAbort={handleAbort}
              onOpen={handleOpen}
              resumingSessionId={resumingSessionId}
              refetch={refetch}
            />
        ))}
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full">
      <Header
        title="Agent Fleet"
        subtitle={subtitle}
        actions={<NewSessionButton />}
      />
      <div className="flex-1 overflow-auto p-6 space-y-6">
        <SummaryBar summary={summary} />

        <FleetToolbar
          groupBy={prefs.groupBy}
          sortBy={prefs.sortBy}
          search={search}
          onGroupByChange={handleGroupByChange}
          onSortByChange={handleSortByChange}
          onSearchChange={setSearch}
        />

        {isLoading && sessions.length === 0 && (
          <div className="flex items-center justify-center h-32 text-muted-foreground gap-2 text-sm">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading sessions…
          </div>
        )}

        {error && (
          <div className="rounded-md bg-red-500/10 border border-red-500/20 px-4 py-3 text-sm text-red-400">
            Failed to load sessions: {error}
          </div>
        )}

        {renderContent()}

        {!isLoading && sessions.length === 0 && !error && (
          <div className="flex flex-col items-center justify-center h-48 text-muted-foreground text-sm gap-3">
            <p>No sessions running.</p>
            <p className="text-xs">Click &ldquo;New Session&rdquo; to spawn an OpenCode instance.</p>
          </div>
        )}
      </div>

      <ConfirmDeleteSessionDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        sessionTitle={deleteTarget?.title ?? ""}
        onConfirm={handleDeleteConfirm}
        isDeleting={isDeleting}
      />
    </div>
  );
}

export default function FleetPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-full text-muted-foreground gap-2 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading…
        </div>
      }
    >
      <FleetPageInner />
    </Suspense>
  );
}
