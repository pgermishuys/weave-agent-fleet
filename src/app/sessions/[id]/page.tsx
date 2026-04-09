"use client";

import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Header } from "@/components/layout/header";
import { ActivityStreamV1 } from "@/components/session/activity-stream-v1";
import { PromptInput } from "@/components/session/prompt-input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useSessionEvents } from "@/hooks/use-session-events";
import { useSendPrompt } from "@/hooks/use-send-prompt";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAgents } from "@/hooks/use-agents";
import { useModels } from "@/hooks/use-models";
import { useDiffs } from "@/hooks/use-diffs";
import { apiFetch } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { FolderOpen, GitBranch, GitCompare, GitFork, Server, Clock, Hash, Square, RotateCcw, Trash2, MessageSquare, OctagonX, AlertTriangle, RefreshCw, ArrowLeft, ChevronRight, ArrowUpToLine, ArrowDownToLine, ListTodo, Eraser, ScrollText, PanelRight, MoreHorizontal, FileCode } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useFoldableScreen } from "@/hooks/use-foldable-screen";
import { useTerminateSession } from "@/hooks/use-terminate-session";
import { useAbortSession } from "@/hooks/use-abort-session";
import { useResumeSession } from "@/hooks/use-resume-session";
import { useDeleteSession } from "@/hooks/use-delete-session";
import { ConfirmDeleteSessionDialog } from "@/components/fleet/confirm-delete-session-dialog";
import { ForkSessionDialog } from "@/components/session/fork-session-dialog";
import { SpawnSessionDialog } from "@/components/session/spawn-session-dialog";
import { extractLatestTodos } from "@/lib/todo-utils";
import { TodoSidebarPanel } from "@/components/session/todo-sidebar-panel";
import { extractPrReferences } from "@/lib/pr-utils";
import { extractIssueReferences } from "@/lib/issue-utils";
import { GitHubLinksSidebarPanel } from "@/components/session/github-links-sidebar-panel";
import { usePrStatus } from "@/hooks/use-pr-status";
import { useIssueStatus } from "@/hooks/use-issue-status";
import { sessionCache } from "@/lib/session-cache";
import {
  loadSessionLinks,
  saveSessionLinks,
  cleanupStaleLinks,
  mergePrReferences,
  mergeIssueReferences,
} from "@/lib/link-storage";
import { DiffViewer } from "@/components/session/diff-viewer";
import { FilesTabContent } from "@/components/session/files-tab-content";
import { DiffModeToggle } from "@/components/session/diff-mode-toggle";
import type { DiffMode } from "@/components/session/diff-mode-toggle";
import { TokenCostBreakdown } from "@/components/session/token-cost-breakdown";
import { useCommandRegistry } from "@/contexts/command-registry-context";
import { useKeybindings } from "@/contexts/keybindings-context";
import { useSessionsContext } from "@/contexts/sessions-context";
import { SlashCommandProvider } from "@/contexts/slash-command-context";
import { usePersistedState } from "@/hooks/use-persisted-state";
import type { SelectedModel } from "@/components/session/model-selector";
import type { ImageAttachment } from "@/lib/api-types";
import Link from "next/link";

interface AncestorInfo {
  dbId: string;
  instanceId: string;
  opencodeSessionId: string;
  title: string;
}

interface SessionMetadata {
  workspaceId: string | null;
  workspaceDirectory: string | null;
  sourceDirectory: string | null;
  isolationStrategy: string | null;
  title?: string;
  createdAt?: number;
  ancestors?: AncestorInfo[];
}

export default function SessionDetailPage() {
  const params = useParams();
  const searchParams = useSearchParams();

  const sessionId = params.id as string;
  const instanceId = searchParams.get("instanceId") ?? "";

  // Subscribe to sessions context so optimistic title patches (from rename)
  // are reflected immediately on the detail page header.
  const { sessions: contextSessions } = useSessionsContext();
  const contextTitle = useMemo(() => {
    const match = contextSessions.find((s) => s.session.id === sessionId);
    return match?.session.title;
  }, [contextSessions, sessionId]);

  const { sendPrompt, isSending, error: sendError } = useSendPrompt();
  const { agents } = useAgents(instanceId);
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const { providers } = useModels(instanceId);
  const [selectedModel, setSelectedModel] = usePersistedState<SelectedModel | null>(
    `model-override:${sessionId}`,
    null
  );

  // Shared ref: useSessionEvents sets this synchronously before hydrating
  // cached messages, and useScrollAnchor reads it on the same render to
  // suppress auto-scroll-to-bottom during cache hydration.
  const suppressAutoScrollRef = useRef(false);

  const { messages, status, sessionStatus, error, forceIdle, reconnect, reconnectAttempt, hasMoreMessages, isLoadingOlder, loadOlderMessages, totalMessageCount, loadOlderError, cacheHit, initialScrollPosition, scrollPositionRef } = useSessionEvents(
    sessionId,
    instanceId,
    setSelectedAgent,
    suppressAutoScrollRef,
  );
  const { terminateSession, isTerminating } = useTerminateSession();
  const { abortSession, isAborting } = useAbortSession();
  const { resumeSession, isResuming } = useResumeSession();
  const { deleteSession: permanentDelete, isDeleting } = useDeleteSession();
  const router = useRouter();
  const [diffMode, setDiffMode] = useState<DiffMode>("session");
  const [activeTab, setActiveTab] = useState("activity");

  // Derive the first user message ID for session-scoped diffs
  const firstUserMessageId = useMemo(
    () => messages.find((m) => m.role === "user")?.messageId ?? null,
    [messages]
  );

  const effectiveMessageID = useMemo(
    () => diffMode === "session" ? (firstUserMessageId ?? undefined) : undefined,
    [diffMode, firstUserMessageId]
  );
  const { diffs, isLoading: diffsLoading, error: diffsError, fetchDiffs } = useDiffs(sessionId, instanceId, effectiveMessageID);

  // Auto-fetch diffs when instanceId changes (e.g. after session resume)
  useEffect(() => {
    if (instanceId) {
      fetchDiffs();
    }
  }, [instanceId, fetchDiffs]);

  const [isStopped, setIsStopped] = useState(false);
  const [stopConfirm, setStopConfirm] = useState(false);
  const [abortConfirm, setAbortConfirm] = useState(false);
  const [isResumable, setIsResumable] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showForkDialog, setShowForkDialog] = useState(false);
  const [spawnSelection, setSpawnSelection] = useState<string | null>(null);
  const [sessionInfoOpen, setSessionInfoOpen] = useState(false);
  const { isFolded } = useFoldableScreen();

  const promptFocusRef = useRef<(() => void) | null>(null);
  const { registerCommand, unregisterCommand } = useCommandRegistry();
  const { bindings } = useKeybindings();

  // Register "Focus Prompt Input" command for this session page
  useEffect(() => {
    registerCommand({
      id: "focus-prompt",
      label: "Focus Prompt Input",
      icon: MessageSquare,
      category: "Session",
      paletteHotkey: bindings["focus-prompt"]?.paletteHotkey ?? undefined,
      keywords: ["message", "chat", "type", "input"],
      action: () => {
        promptFocusRef.current?.();
      },
    });
    return () => {
      unregisterCommand("focus-prompt");
    };
  }, [registerCommand, unregisterCommand, bindings]);

  // Register "Interrupt Session" command (Escape key by default)
  useEffect(() => {
    registerCommand({
      id: "interrupt-session",
      label: "Interrupt Session",
      icon: OctagonX,
      category: "Session",
      paletteHotkey: bindings["interrupt-session"]?.paletteHotkey ?? undefined,
      globalShortcut: bindings["interrupt-session"]?.globalShortcut ?? undefined,
      keywords: ["abort", "cancel", "stop", "interrupt"],
      disabled: isStopped || sessionStatus !== "busy",
      action: () => {
        abortSession(sessionId, instanceId).catch(() => {
          // error surfaced via useAbortSession
        });
      },
    });
    return () => {
      unregisterCommand("interrupt-session");
    };
  }, [registerCommand, unregisterCommand, bindings, sessionStatus, isStopped, abortSession, sessionId, instanceId]);

  // Register additional session-page commands
  useEffect(() => {
    registerCommand({
      id: "copy-session-id",
      label: "Copy Session ID",
      icon: Hash,
      category: "Session",
      globalShortcut: bindings["copy-session-id"]?.globalShortcut ?? undefined,
      keywords: ["clipboard", "id", "copy"],
      action: () => {
        navigator.clipboard.writeText(sessionId).catch(() => {});
      },
    });
    registerCommand({
      id: "copy-session-url",
      label: "Copy Session URL",
      icon: Hash,
      category: "Session",
      keywords: ["clipboard", "link", "share", "url"],
      action: () => {
        navigator.clipboard.writeText(window.location.href).catch(() => {});
      },
    });
    registerCommand({
      id: "fork-session",
      label: "Fork Session (New Context Window)",
      icon: GitFork,
      category: "Session",
      keywords: ["branch", "clone", "context", "window"],
      action: () => setShowForkDialog(true),
    });
    registerCommand({
      id: "toggle-diff-view",
      label: "Toggle Diff View",
      icon: GitCompare,
      category: "Session",
      globalShortcut: bindings["toggle-diff-view"]?.globalShortcut ?? undefined,
      keywords: ["changes", "git", "diff", "compare"],
      action: () => {
        // Toggle to diffs tab or back to activity
        const tabList = document.querySelector('[role="tablist"]');
        const diffsTab = tabList?.querySelector('[value="diffs"]') as HTMLElement | null;
        const activityTab = tabList?.querySelector('[value="activity"]') as HTMLElement | null;
        if (diffsTab && activityTab) {
          // Simple toggle heuristic: if diffs tab is selected, go to activity
          const isDiffsActive = diffsTab.getAttribute("data-state") === "active";
          (isDiffsActive ? activityTab : diffsTab).click();
        }
      },
    });
    registerCommand({
      id: "toggle-files-view",
      label: "Toggle Files View",
      icon: FileCode,
      category: "Session",
      keywords: ["files", "editor", "tree", "browse", "monaco"],
      action: () => {
        const tabList = document.querySelector('[role="tablist"]');
        const filesTab = tabList?.querySelector('[value="files"]') as HTMLElement | null;
        const activityTab = tabList?.querySelector('[value="activity"]') as HTMLElement | null;
        if (filesTab && activityTab) {
          const isFilesActive = filesTab.getAttribute("data-state") === "active";
          (isFilesActive ? activityTab : filesTab).click();
        }
      },
    });
    registerCommand({
      id: "scroll-to-top",
      label: "Scroll to Top",
      icon: ArrowUpToLine,
      category: "Session",
      keywords: ["beginning", "start", "first", "top"],
      action: () => {
        const scrollArea = document.querySelector('[data-radix-scroll-area-viewport]');
        scrollArea?.scrollTo({ top: 0, behavior: "smooth" });
      },
    });
    registerCommand({
      id: "scroll-to-bottom",
      label: "Scroll to Bottom",
      icon: ArrowDownToLine,
      category: "Session",
      keywords: ["end", "latest", "bottom", "last"],
      action: () => {
        const scrollArea = document.querySelector('[data-radix-scroll-area-viewport]');
        if (scrollArea) {
          scrollArea.scrollTo({ top: scrollArea.scrollHeight, behavior: "smooth" });
        }
      },
    });
    registerCommand({
      id: "clear-conversation",
      label: "Clear Conversation (Fork Empty)",
      icon: Eraser,
      category: "Session",
      keywords: ["reset", "clear", "clean", "new"],
      action: () => setShowForkDialog(true),
    });

    return () => {
      unregisterCommand("copy-session-id");
      unregisterCommand("copy-session-url");
      unregisterCommand("fork-session");
      unregisterCommand("toggle-diff-view");
      unregisterCommand("toggle-files-view");
      unregisterCommand("scroll-to-top");
      unregisterCommand("scroll-to-bottom");
      unregisterCommand("clear-conversation");
    };
  }, [registerCommand, unregisterCommand, bindings, sessionId]);

  // Export conversation command — separate useEffect since it depends on messages
  useEffect(() => {
    registerCommand({
      id: "export-conversation",
      label: "Export Conversation",
      icon: ScrollText,
      category: "Session",
      keywords: ["download", "save", "export", "json", "markdown"],
      action: () => {
        // Export messages as markdown
        const lines: string[] = [];
        for (const msg of messages) {
          const role = msg.role === "user" ? "**You**" : `**${msg.agent ?? "Assistant"}**`;
          const text = msg.parts
            .filter((p) => p.type === "text")
            .map((p) => (p.type === "text" ? p.text : ""))
            .join("");
          if (text) {
            lines.push(`${role}:\n${text}\n`);
          }
        }
        const blob = new Blob([lines.join("\n---\n\n")], { type: "text/markdown" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `session-${sessionId.slice(0, 8)}.md`;
        a.click();
        URL.revokeObjectURL(url);
      },
    });
    return () => {
      unregisterCommand("export-conversation");
    };
  }, [registerCommand, unregisterCommand, sessionId, messages]);

  const [metadata, setMetadata] = useState<SessionMetadata>({
    workspaceId: null,
    workspaceDirectory: null,
    sourceDirectory: null,
    isolationStrategy: null,
  });
  // Track whether metadata has been fetched at least once (distinguishes
  // "not yet loaded" from "loaded but empty ancestors").
  const metadataFetchedRef = useRef(false);

  // Stable callback to fetch session metadata from the API.
  // Used on initial mount and retried when SSE connects but metadata is missing
  // (e.g. subagent session wasn't ready on the first attempt).
  const fetchMetadata = useCallback(() => {
    if (!sessionId || !instanceId) return;
    const parentSessionId = searchParams.get("parentSessionId");
    let url = `/api/sessions/${encodeURIComponent(sessionId)}?instanceId=${encodeURIComponent(instanceId)}`;
    if (parentSessionId) {
      url += `&parentSessionId=${encodeURIComponent(parentSessionId)}`;
    }
    apiFetch(url)
      .then((r) => {
        if (!r.ok) {
          // Instance dead — show resume banner
          setIsResumable(true);
          return null;
        }
        return r.json();
      })
      .then((data: { workspaceId?: string; workspaceDirectory?: string; sourceDirectory?: string; isolationStrategy?: string; session?: { title?: string; time?: { created?: number } }; ancestors?: AncestorInfo[]; dbTitle?: string } | null) => {
        if (!data) return;
        metadataFetchedRef.current = true;
        setMetadata({
          workspaceId: data.workspaceId ?? null,
          workspaceDirectory: data.workspaceDirectory ?? null,
          sourceDirectory: data.sourceDirectory ?? null,
          isolationStrategy: data.isolationStrategy ?? null,
          title: data.dbTitle ?? data.session?.title,
          createdAt: data.session?.time?.created,
          ancestors: data.ancestors,
        });
      })
      .catch(() => {
        setIsResumable(true);
      });
  }, [sessionId, instanceId, searchParams]);

  // Reset metadata state when sessionId changes (e.g. client-side navigation
  // from a parent session to a child session).  Without this, the stale
  // metadataFetchedRef from the previous session prevents the retry logic and
  // stale ancestors from the parent session linger.
  useEffect(() => {
    metadataFetchedRef.current = false;
    setMetadata({
      workspaceId: null,
      workspaceDirectory: null,
      sourceDirectory: null,
      isolationStrategy: null,
    });
  }, [sessionId]);

  // Fetch session metadata on mount and whenever sessionId changes
  useEffect(() => {
    fetchMetadata();
  }, [fetchMetadata]);

  // Safety net: if SSE connects successfully, the instance is alive.
  // Clear any false isResumable flag from a transient metadata fetch failure
  // (e.g. caused by module re-evaluation during dev HMR).
  // Also retry metadata fetch if it hasn't succeeded yet — this handles
  // subagent sessions where the initial fetch may have raced against
  // session creation.
  useEffect(() => {
    if (status === "connected" && isResumable && !isStopped) {
      setIsResumable(false);
    }
    if (status === "connected" && !metadataFetchedRef.current) {
      fetchMetadata();
    }
    if (status === "abandoned" && !isResumable && !isStopped) {
      setIsResumable(true);
    }
  }, [status, isResumable, isStopped, fetchMetadata]);

  // Compute aggregate tokens by type from accumulated messages
  const tokenBreakdown = useMemo(() => {
    let input = 0;
    let output = 0;
    let reasoning = 0;
    for (const m of messages) {
      input += m.tokens?.input ?? 0;
      output += m.tokens?.output ?? 0;
      reasoning += m.tokens?.reasoning ?? 0;
    }
    return { input, output, reasoning };
  }, [messages]);
  const totalTokens = tokenBreakdown.input + tokenBreakdown.output + tokenBreakdown.reasoning;
  const totalCost = useMemo(
    () => messages.reduce((sum, m) => sum + (m.cost ?? 0), 0),
    [messages]
  );
  const latestTodos = useMemo(() => extractLatestTodos(messages), [messages]);

  // PR detection: merge localStorage-persisted → in-memory cache → message-extracted
  // so that PRs survive page refreshes and message pagination/trimming.
  const messagesPrs = useMemo(() => extractPrReferences(messages), [messages]);
  const detectedPrs = useMemo(() => {
    const persisted = loadSessionLinks(sessionId);
    const cachedPrs = sessionCache.getPrReferences(sessionId, instanceId);
    return mergePrReferences(
      persisted?.prs,
      cachedPrs,
      messagesPrs
    );
  }, [messagesPrs, sessionId, instanceId]);

  // Issue detection: same merge strategy as PRs.
  const messagesIssues = useMemo(() => extractIssueReferences(messages), [messages]);
  const detectedIssues = useMemo(() => {
    const persisted = loadSessionLinks(sessionId);
    return mergeIssueReferences(
      persisted?.issues,
      messagesIssues
    );
  }, [messagesIssues, sessionId]);

  // Persist detected links (PRs + issues) to both session cache and localStorage
  useEffect(() => {
    if (detectedPrs.length > 0 || detectedIssues.length > 0) {
      sessionCache.patchPrReferences(sessionId, instanceId, detectedPrs);
      saveSessionLinks(sessionId, {
        version: 1,
        updatedAt: Date.now(),
        prs: detectedPrs,
        issues: detectedIssues,
      });
    }
  }, [detectedPrs, detectedIssues, sessionId, instanceId]);

  // Clean up stale localStorage entries on mount (7-day expiry)
  useEffect(() => {
    cleanupStaleLinks();
  }, []);

  const { statuses: prStatuses } = usePrStatus(detectedPrs);
  const { statuses: issueStatuses } = useIssueStatus(detectedIssues);

  // Register toggle-todo-panel command (depends on latestTodos)
  useEffect(() => {
    registerCommand({
      id: "toggle-todo-panel",
      label: "Toggle Todo Panel",
      icon: ListTodo,
      category: "Session",
      globalShortcut: bindings["toggle-todo-panel"]?.globalShortcut ?? undefined,
      keywords: ["tasks", "checklist", "todos", "panel"],
      disabled: !latestTodos || latestTodos.length === 0,
      action: () => {
        const todoPanel = document.querySelector('[data-testid="todo-sidebar-panel"]');
        todoPanel?.scrollIntoView({ behavior: "smooth", block: "start" });
      },
    });
    return () => {
      unregisterCommand("toggle-todo-panel");
    };
  }, [registerCommand, unregisterCommand, bindings, latestTodos]);

  // Aggregate diff stats for sidebar
  const { totalDiffAdditions, totalDiffDeletions } = useMemo(() => {
    let additions = 0;
    let deletions = 0;
    for (const d of diffs) {
      additions += d.additions;
      deletions += d.deletions;
    }
    return { totalDiffAdditions: additions, totalDiffDeletions: deletions };
  }, [diffs]);

  // Derive active agent from the last user message
  const activeAgentName = sessionStatus === "busy"
    ? [...messages].reverse().find((m) => m.role === "user" && m.agent)?.agent ?? null
    : null;
  const activeAgentMeta = activeAgentName
    ? agents.find((a) => a.name === activeAgentName)
    : null;

  // Compute participating agents with message counts for sidebar
  const participatingAgents = (() => {
    const counts = new Map<string, number>();
    for (const m of messages) {
      if (m.agent) counts.set(m.agent, (counts.get(m.agent) ?? 0) + 1);
    }
    return Array.from(counts.entries()).map(([name, count]) => ({
      name,
      count,
      meta: agents.find((a) => a.name === name),
    }));
  })();

  const handleSend = useCallback(
    async (text: string, agent?: string, model?: SelectedModel, attachments?: ImageAttachment[]) => {
      await sendPrompt(sessionId, instanceId, text, agent, model ?? undefined, attachments);
    },
    [sendPrompt, sessionId, instanceId]
  );

  const handleStop = useCallback(async () => {
    if (!stopConfirm) {
      setStopConfirm(true);
      return;
    }
    try {
      await terminateSession(sessionId, instanceId);
      setIsStopped(true);
    } catch {
      // error visible via isTerminating pattern
    } finally {
      setStopConfirm(false);
    }
  }, [stopConfirm, terminateSession, sessionId, instanceId]);

  const handleAbort = useCallback(async () => {
    if (!abortConfirm) {
      setAbortConfirm(true);
      return;
    }
    try {
      await abortSession(sessionId, instanceId);
      forceIdle();
    } catch {
      // error surfaced via useAbortSession
    } finally {
      setAbortConfirm(false);
    }
  }, [abortConfirm, abortSession, sessionId, instanceId, forceIdle]);

  // Reset abort confirmation when session leaves busy state
  useEffect(() => {
    if (sessionStatus !== "busy") {
      setAbortConfirm(false);
    }
  }, [sessionStatus]);

  const handleResume = useCallback(async () => {
    try {
      const result = await resumeSession(sessionId);
      router.replace(
        `/sessions/${encodeURIComponent(result.session.id)}?instanceId=${encodeURIComponent(result.instanceId)}`
      );
    } catch {
      // error surfaced via useResumeSession
    }
  }, [resumeSession, router, sessionId]);

  const handlePermanentDelete = useCallback(async () => {
    try {
      await permanentDelete(sessionId, instanceId);
      router.push("/");
    } catch {
      // error surfaced via useDeleteSession
    }
  }, [permanentDelete, router, sessionId, instanceId]);

  if (!instanceId) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-muted-foreground">
          Missing instanceId — navigate here via the fleet page.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <Header
        title={contextTitle || metadata.title || sessionId.slice(0, 12)}
        actions={
          <div className="flex items-center gap-2">
            <span
              className={`h-2 w-2 rounded-full ${
                sessionStatus === "busy"
                  ? "bg-green-500 animate-pulse"
                  : "bg-muted-foreground/50"
              }`}
            />
            <Badge variant="secondary" className="text-xs">
              {sessionStatus === "busy" ? "Working" : "Idle"}
            </Badge>
            {activeAgentName && (
              <Badge variant="outline" className="hidden xs:inline-flex text-xs gap-1">
                <span
                  className="inline-block h-1.5 w-1.5 rounded-full"
                  style={{ backgroundColor: activeAgentMeta?.color ?? "currentColor" }}
                />
                {activeAgentName.charAt(0).toUpperCase() + activeAgentName.slice(1)}
              </Badge>
            )}
            {/* Session Info trigger — mobile only */}
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 px-0 fold:hidden"
              onClick={() => setSessionInfoOpen(true)}
              title="Session info"
              aria-label="Open session info"
            >
              <PanelRight className="h-3.5 w-3.5" />
            </Button>
            {/* Desktop action buttons */}
            <Button
              variant="ghost"
              size="sm"
              className="hidden sm:inline-flex h-7 px-2 text-xs gap-1"
              onClick={() => setShowForkDialog(true)}
              title="New context window — start a fresh session in the same workspace"
            >
              <GitFork className="h-3 w-3" />
              New context window
            </Button>
            {!isStopped && sessionStatus === "busy" && (
              <Button
                variant={abortConfirm ? "destructive" : "outline"}
                size="sm"
                className="hidden sm:inline-flex h-7 px-2 text-xs gap-1"
                onClick={handleAbort}
                disabled={isAborting}
              >
                <OctagonX className="h-3 w-3" />
                {abortConfirm ? "Confirm interrupt?" : "Interrupt"}
              </Button>
            )}
            {abortConfirm && (
              <Button
                variant="ghost"
                size="sm"
                className="hidden sm:inline-flex h-7 px-2 text-xs"
                onClick={() => setAbortConfirm(false)}
                disabled={isAborting}
              >
                Cancel
              </Button>
            )}
            {!isStopped && (
              <Button
                variant={stopConfirm ? "destructive" : "ghost"}
                size="sm"
                className="hidden sm:inline-flex h-7 px-2 text-xs gap-1"
                onClick={handleStop}
                disabled={isTerminating}
              >
                <Square className="h-3 w-3" />
                {stopConfirm ? "Confirm stop?" : "Stop"}
              </Button>
            )}
            {stopConfirm && (
              <Button
                variant="ghost"
                size="sm"
                className="hidden sm:inline-flex h-7 px-2 text-xs"
                onClick={() => setStopConfirm(false)}
                disabled={isTerminating}
              >
                Cancel
              </Button>
            )}
            {(isStopped || isResumable) && (
              <Button
                variant="ghost"
                size="sm"
                className="hidden sm:inline-flex h-7 px-2 text-xs gap-1 text-red-600 dark:text-red-400 hover:text-red-500 hover:bg-red-500/10"
                onClick={() => setShowDeleteConfirm(true)}
              >
                <Trash2 className="h-3 w-3" />
                Delete
              </Button>
            )}
            {/* Mobile overflow menu */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="sm:hidden h-7 w-7 px-0"
                  aria-label="More actions"
                >
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {!isStopped && sessionStatus === "busy" && (
                  <DropdownMenuItem
                    onClick={handleAbort}
                    disabled={isAborting}
                    className="gap-2 text-destructive focus:text-destructive"
                  >
                    <OctagonX className="h-3.5 w-3.5" />
                    {abortConfirm ? "Confirm interrupt?" : "Interrupt"}
                  </DropdownMenuItem>
                )}
                {!isStopped && (
                  <DropdownMenuItem
                    onClick={handleStop}
                    disabled={isTerminating}
                    className="gap-2"
                  >
                    <Square className="h-3.5 w-3.5" />
                    {stopConfirm ? "Confirm stop?" : "Stop"}
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  onClick={() => setShowForkDialog(true)}
                  className="gap-2"
                >
                  <GitFork className="h-3.5 w-3.5" />
                  New context window
                </DropdownMenuItem>
                {(isStopped || isResumable) && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => setShowDeleteConfirm(true)}
                      className="gap-2 text-destructive focus:text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Delete session
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        }
      />
      <div className={`flex flex-1 overflow-hidden${isFolded ? " fold-gap" : ""}`}>
        {/* Main content with tabs */}
        <div className={`flex flex-1 flex-col overflow-hidden${isFolded ? " fold-left" : ""}`}>
          {isStopped && (
            <div className="px-4 py-2 bg-muted/50 border-b border-border text-sm text-muted-foreground text-center">
              Session stopped — conversation history preserved above.
            </div>
          )}
          {isResumable && !isStopped && (
            <div className="px-4 py-3 bg-amber-500/10 border-b border-amber-500/20 flex items-center justify-between">
              <span className="text-sm text-amber-600 dark:text-amber-400">
                Session disconnected — the opencode instance is no longer running.
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={handleResume}
                disabled={isResuming}
                className="gap-1.5"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                {isResuming ? "Resuming…" : "Resume Session"}
              </Button>
            </div>
          )}
          {metadata.ancestors && metadata.ancestors.length > 0 && (
            <div className="flex items-center gap-1.5 px-4 py-1.5 text-xs text-muted-foreground border-b border-border/40 overflow-x-auto">
              <Link
                href={(() => {
                  const parent = metadata.ancestors!.at(-1);
                  return parent
                    ? `/sessions/${encodeURIComponent(parent.opencodeSessionId)}?instanceId=${encodeURIComponent(parent.instanceId)}`
                    : "/";
                })()}
                className="shrink-0 hover:text-foreground transition-colors"
              >
                <ArrowLeft className="h-3 w-3" />
              </Link>
              {metadata.ancestors.map((ancestor, i) => (
                <Fragment key={ancestor.dbId}>
                  {i > 0 && <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground/50" />}
                  <Link
                    href={`/sessions/${encodeURIComponent(ancestor.opencodeSessionId)}?instanceId=${encodeURIComponent(ancestor.instanceId)}`}
                    className="shrink-0 hover:text-foreground transition-colors truncate max-w-[200px]"
                    title={ancestor.title}
                  >
                    {ancestor.title}
                  </Link>
                </Fragment>
              ))}
              <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground/50" />
              <span className="shrink-0 text-foreground font-medium truncate max-w-[200px]">Current</span>
            </div>
          )}
          <Tabs
            defaultValue="activity"
            className="flex flex-1 flex-col overflow-hidden"
            onValueChange={(value) => {
              setActiveTab(value);
              if (value === "changes" || value === "files") fetchDiffs();
            }}
          >
            <TabsList variant="line" className="px-4 border-b border-border/50">
              <TabsTrigger value="activity">Activity</TabsTrigger>
              <TabsTrigger value="changes" className="gap-1.5">
                <GitCompare className="h-3.5 w-3.5" />
                Changes
              </TabsTrigger>
              <TabsTrigger value="files" className="gap-1.5">
                <FileCode className="h-3.5 w-3.5" />
                Files
              </TabsTrigger>
              {(activeTab === "changes" || activeTab === "files") && (
                <div className="ml-auto flex items-center">
                  <DiffModeToggle mode={diffMode} onModeChange={setDiffMode} />
                </div>
              )}
            </TabsList>
            <TabsContent value="activity" className="flex-1 overflow-hidden flex flex-col">
              <div className="flex-1 overflow-hidden">
                <SlashCommandProvider
                  sessionId={sessionId}
                  instanceId={instanceId}
                  disabled={isStopped || isResumable || status === "error"}
                >
                  <ActivityStreamV1
                    messages={messages}
                    status={status}
                    sessionStatus={sessionStatus}
                    error={error}
                    agents={agents}
                    onReconnect={reconnect}
                    reconnectAttempt={reconnectAttempt}
                    hasMoreMessages={hasMoreMessages}
                    isLoadingOlder={isLoadingOlder}
                    onLoadOlder={loadOlderMessages}
                    totalMessageCount={totalMessageCount}
                    loadOlderError={loadOlderError}
                    currentSessionId={sessionId}
                    scrollPositionRef={scrollPositionRef}
                    cacheHit={cacheHit}
                    initialScrollPosition={initialScrollPosition}
                    suppressAutoScrollRef={suppressAutoScrollRef}
                    onSpawnFromSelection={setSpawnSelection}
                  />
                </SlashCommandProvider>
              </div>
              <PromptInput
                sessionId={sessionId}
                instanceId={instanceId}
                onSend={handleSend}
                disabled={isStopped || isResumable || status === "error"}
                sendError={sendError}
                agents={agents}
                selectedAgent={selectedAgent}
                onAgentChange={setSelectedAgent}
                providers={providers}
                selectedModel={selectedModel}
                onModelChange={setSelectedModel}
                sessionStatus={sessionStatus}
                onFocusRequest={(focus) => {
                  promptFocusRef.current = focus;
                }}
              />
            </TabsContent>
            <TabsContent value="changes" className="flex-1 overflow-hidden">
              <DiffViewer diffs={diffs} isLoading={diffsLoading} error={diffsError} totalAdditions={totalDiffAdditions} totalDeletions={totalDiffDeletions} />
            </TabsContent>
            <TabsContent value="files" className="flex-1 overflow-hidden">
              <FilesTabContent
                sessionId={sessionId}
                instanceId={instanceId}
                fetchDiffs={fetchDiffs}
                diffs={diffs}
                recentParts={messages.flatMap((m) => m.parts)}
              />
            </TabsContent>
          </Tabs>
        </div>

        {/* Sidebar — real session metadata — desktop only (or foldable right pane); mobile uses Sheet */}
        <aside className={isFolded ? "flex fold-right w-auto border-l overflow-auto flex-shrink-0 flex-col" : "hidden md:flex w-72 border-l overflow-auto flex-shrink-0 flex-col"}>
          <ScrollArea className="h-full">
            <div className="p-4 space-y-4">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Session Info
              </p>

              {/* Workspace */}
              {metadata.workspaceDirectory && (
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5">
                    <FolderOpen className="h-3 w-3 text-muted-foreground" />
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Workspace</p>
                  </div>
                  <p className="text-xs font-mono break-all">{metadata.workspaceDirectory}</p>
                </div>
              )}

              {/* Isolation Strategy */}
              {metadata.isolationStrategy && (
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5">
                    <GitBranch className="h-3 w-3 text-muted-foreground" />
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Isolation</p>
                  </div>
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                    {metadata.isolationStrategy}
                  </Badge>
                </div>
              )}

              {/* Created At */}
              {metadata.createdAt && (
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5">
                    <Clock className="h-3 w-3 text-muted-foreground" />
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Created</p>
                  </div>
                  <p className="text-xs">{new Date(metadata.createdAt).toLocaleString()}</p>
                </div>
              )}

              <Separator />

              {/* Tokens & Cost */}
              <div className="space-y-1">
                <div className="flex items-center gap-1.5">
                  <Hash className="h-3 w-3 text-muted-foreground" />
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Tokens & Cost</p>
                </div>
                <TokenCostBreakdown tokens={tokenBreakdown} cost={totalCost} variant="sidebar" />
              </div>

              {/* Changes summary */}
              {diffs.length > 0 && (
                <>
                  <Separator />
                  <div className="space-y-1">
                    <div className="flex items-center gap-1.5">
                      <GitCompare className="h-3 w-3 text-muted-foreground" />
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Changes {diffMode === "session" ? "(session)" : "(uncommitted)"}</p>
                    </div>
                    <p className="text-xs font-mono">
                      {diffs.length} file{diffs.length !== 1 ? "s" : ""}
                    </p>
                    <p className="text-xs font-mono">
                      <span className="text-green-500">+{totalDiffAdditions}</span>{" "}
                      <span className="text-red-500">-{totalDiffDeletions}</span>
                    </p>
                  </div>
                </>
              )}

              {/* Active Agents */}
              {participatingAgents.length > 0 && (
                <>
                  <Separator />
                  <div className="space-y-2">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Agents</p>
                    {participatingAgents.map(({ name, count, meta }) => (
                      <div key={name} className="flex items-center gap-1.5">
                        <span
                          className="h-1.5 w-1.5 rounded-full flex-shrink-0"
                          style={{ backgroundColor: meta?.color ?? "var(--muted-foreground)" }}
                        />
                        <span className="text-xs flex-1">
                          {name.charAt(0).toUpperCase() + name.slice(1)}
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          {count} msg{count !== 1 ? "s" : ""}
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              )}

              <Separator />

              {/* Connection status */}
              <div className="space-y-1">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Connection</p>
                <div className="flex items-center gap-1.5">
                  {status === "error" ? (
                    <AlertTriangle className="h-3 w-3 text-red-500 shrink-0" />
                  ) : status === "disconnected" || status === "abandoned" ? (
                    <AlertTriangle className="h-3 w-3 text-amber-600 dark:text-amber-400 shrink-0" />
                  ) : (
                    <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${
                      status === "connected" ? "bg-green-500" :
                      status === "connecting" ? "bg-amber-500 animate-pulse" :
                      status === "recovering" ? "bg-blue-500 animate-pulse" :
                      "bg-red-500"
                    }`} />
                  )}
                  <p className={`text-xs ${
                    status === "error" ? "text-red-500 font-medium" :
                    status === "disconnected" || status === "abandoned" ? "text-amber-600 dark:text-amber-400" :
                    ""
                  }`}>
                    {status === "error" ? "Error" :
                     status === "abandoned"
                       ? "Instance unreachable"
                       : status === "disconnected"
                       ? `Disconnected${reconnectAttempt > 0 ? ` (retry ${reconnectAttempt})` : ""}`
                       : status === "recovering" ? "Recovering…"
                       : status === "connecting" ? "Connecting…"
                       : "Connected"}
                  </p>
                </div>
                {(status === "disconnected" || status === "abandoned") && (
                  <button
                    onClick={reconnect}
                    className="mt-1 inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium bg-amber-500/10 hover:bg-amber-500/20 text-amber-600 dark:text-amber-400 transition-colors"
                  >
                    <RefreshCw className="h-2.5 w-2.5" />
                    Reconnect
                  </button>
                )}
                {status === "error" && error && (
                  <p className="text-[10px] text-red-600/70 dark:text-red-400/70 break-words mt-0.5">{error}</p>
                )}
              </div>

              {/* Todos — shown when agent has used todowrite */}
              {latestTodos && latestTodos.length > 0 && (
                <>
                  <Separator />
                  <TodoSidebarPanel todos={latestTodos} />
                </>
              )}

              {/* GitHub Links — shown when PRs or issues are detected in this session */}
              {(detectedPrs.length > 0 || detectedIssues.length > 0) && (
                <>
                  <Separator />
                  <GitHubLinksSidebarPanel
                    prs={detectedPrs}
                    prStatuses={prStatuses}
                    issues={detectedIssues}
                    issueStatuses={issueStatuses}
                  />
                </>
              )}
            </div>
          </ScrollArea>
        </aside>
      </div>

      {/* Session Info Sheet — mobile only */}
      <Sheet open={sessionInfoOpen} onOpenChange={setSessionInfoOpen}>
        <SheetContent side="right" className="w-[300px] p-0 md:hidden">
          <SheetHeader className="px-4 pt-4 pb-2">
            <SheetTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Session Info</SheetTitle>
          </SheetHeader>
          <ScrollArea className="h-[calc(100%-3rem)]">
            <div className="px-4 pb-4 space-y-4">
              {/* Workspace */}
              {metadata.workspaceDirectory && (
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5">
                    <FolderOpen className="h-3 w-3 text-muted-foreground" />
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Workspace</p>
                  </div>
                  <p className="text-xs font-mono break-all">{metadata.workspaceDirectory}</p>
                </div>
              )}

              {/* Isolation Strategy */}
              {metadata.isolationStrategy && (
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5">
                    <GitBranch className="h-3 w-3 text-muted-foreground" />
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Isolation</p>
                  </div>
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                    {metadata.isolationStrategy}
                  </Badge>
                </div>
              )}

              {/* Created At */}
              {metadata.createdAt && (
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5">
                    <Clock className="h-3 w-3 text-muted-foreground" />
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Created</p>
                  </div>
                  <p className="text-xs">{new Date(metadata.createdAt).toLocaleString()}</p>
                </div>
              )}

              <Separator />

              {/* Tokens & Cost */}
              <div className="space-y-1">
                <div className="flex items-center gap-1.5">
                  <Hash className="h-3 w-3 text-muted-foreground" />
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Tokens & Cost</p>
                </div>
                <TokenCostBreakdown tokens={tokenBreakdown} cost={totalCost} variant="sidebar" />
              </div>

              {/* Changes summary */}
              {diffs.length > 0 && (
                <>
                  <Separator />
                  <div className="space-y-1">
                    <div className="flex items-center gap-1.5">
                      <GitCompare className="h-3 w-3 text-muted-foreground" />
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Changes {diffMode === "session" ? "(session)" : "(uncommitted)"}</p>
                    </div>
                    <p className="text-xs font-mono">
                      {diffs.length} file{diffs.length !== 1 ? "s" : ""}
                    </p>
                    <p className="text-xs font-mono">
                      <span className="text-green-500">+{totalDiffAdditions}</span>{" "}
                      <span className="text-red-500">-{totalDiffDeletions}</span>
                    </p>
                  </div>
                </>
              )}

              {/* Active Agents */}
              {participatingAgents.length > 0 && (
                <>
                  <Separator />
                  <div className="space-y-2">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Agents</p>
                    {participatingAgents.map(({ name, count, meta }) => (
                      <div key={name} className="flex items-center gap-1.5">
                        <span
                          className="h-1.5 w-1.5 rounded-full flex-shrink-0"
                          style={{ backgroundColor: meta?.color ?? "var(--muted-foreground)" }}
                        />
                        <span className="text-xs flex-1">
                          {name.charAt(0).toUpperCase() + name.slice(1)}
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          {count} msg{count !== 1 ? "s" : ""}
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              )}

              <Separator />

              {/* Connection status */}
              <div className="space-y-1">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Connection</p>
                <div className="flex items-center gap-1.5">
                  {status === "error" ? (
                    <AlertTriangle className="h-3 w-3 text-red-500 shrink-0" />
                  ) : status === "disconnected" || status === "abandoned" ? (
                    <AlertTriangle className="h-3 w-3 text-amber-600 dark:text-amber-400 shrink-0" />
                  ) : (
                    <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${
                      status === "connected" ? "bg-green-500" :
                      status === "connecting" ? "bg-amber-500 animate-pulse" :
                      status === "recovering" ? "bg-blue-500 animate-pulse" :
                      "bg-red-500"
                    }`} />
                  )}
                  <p className={`text-xs ${
                    status === "error" ? "text-red-500 font-medium" :
                    status === "disconnected" || status === "abandoned" ? "text-amber-600 dark:text-amber-400" :
                    ""
                  }`}>
                    {status === "error" ? "Error" :
                     status === "abandoned"
                       ? "Instance unreachable"
                       : status === "disconnected"
                       ? `Disconnected${reconnectAttempt > 0 ? ` (retry ${reconnectAttempt})` : ""}`
                       : status === "recovering" ? "Recovering…"
                       : status === "connecting" ? "Connecting…"
                       : "Connected"}
                  </p>
                </div>
                {(status === "disconnected" || status === "abandoned") && (
                  <button
                    onClick={reconnect}
                    className="mt-1 inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium bg-amber-500/10 hover:bg-amber-500/20 text-amber-600 dark:text-amber-400 transition-colors"
                  >
                    <RefreshCw className="h-2.5 w-2.5" />
                    Reconnect
                  </button>
                )}
                {status === "error" && error && (
                  <p className="text-[10px] text-red-600/70 dark:text-red-400/70 break-words mt-0.5">{error}</p>
                )}
              </div>

              {/* Todos — shown when agent has used todowrite */}
              {latestTodos && latestTodos.length > 0 && (
                <>
                  <Separator />
                  <TodoSidebarPanel todos={latestTodos} />
                </>
              )}

              {/* GitHub Links — shown when PRs or issues are detected in this session */}
              {(detectedPrs.length > 0 || detectedIssues.length > 0) && (
                <>
                  <Separator />
                  <GitHubLinksSidebarPanel
                    prs={detectedPrs}
                    prStatuses={prStatuses}
                    issues={detectedIssues}
                    issueStatuses={issueStatuses}
                  />
                </>
              )}
            </div>
          </ScrollArea>
        </SheetContent>
      </Sheet>

      <ConfirmDeleteSessionDialog
        open={showDeleteConfirm}
        onOpenChange={setShowDeleteConfirm}
        sessionTitle={sessionId.slice(0, 12)}
        onConfirm={handlePermanentDelete}
        isDeleting={isDeleting}
      />

      <ForkSessionDialog
        sourceSessionId={sessionId}
        sourceSessionTitle={metadata.title}
        open={showForkDialog}
        onOpenChange={setShowForkDialog}
      />

      <SpawnSessionDialog
        open={spawnSelection !== null}
        onOpenChange={(open) => { if (!open) setSpawnSelection(null); }}
        selectedText={spawnSelection ?? ""}
        sessionTitle={metadata.title ?? sessionId}
        sourceSessionId={sessionId}
        sourceDirectory={metadata.sourceDirectory}
      />
    </div>
  );
}
