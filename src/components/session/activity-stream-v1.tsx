"use client";

import { Fragment, memo, useMemo, useCallback, useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Bot, User, SquareTerminal, Loader2, AlertCircle, RefreshCw, ChevronDown, ArrowUpRight, CheckCircle2, AlertTriangle } from "lucide-react";
import { useScrollAnchor } from "@/hooks/use-scroll-anchor";
import { useActivityFilter } from "@/hooks/use-activity-filter";
import { useKeyboardShortcut } from "@/hooks/use-keyboard-shortcut";
import type { AccumulatedMessage, AccumulatedPart, AccumulatedToolPart, AutocompleteAgent } from "@/lib/api-types";
import { isTaskToolCall, getTaskToolInput, getTaskToolSessionId } from "@/lib/api-types";
import Link from "next/link";
import type { SessionConnectionStatus } from "@/hooks/use-session-events";
import { isTodoWriteTool, parseTodoOutput } from "@/lib/todo-utils";
import { resolveAgentColor } from "@/lib/agent-colors";
import { TodoListInline } from "./todo-list-inline";
import { CollapsibleToolCall } from "./collapsible-tool-call";
import { MarkdownRenderer } from "./markdown-renderer";
import { RelativeTimestamp } from "./relative-timestamp";
import { ActivityStreamToolbar } from "./activity-stream-toolbar";

interface ActivityStreamV1Props {
  messages: AccumulatedMessage[];
  status: SessionConnectionStatus;
  sessionStatus: "idle" | "busy";
  error?: string;
  agents?: AutocompleteAgent[];
  /** Callback to trigger immediate SSE reconnection. */
  onReconnect?: () => void;
  /** Current reconnection attempt count (0 when connected). */
  reconnectAttempt?: number;
  /** Whether there are older messages that can be loaded. */
  hasMoreMessages?: boolean;
  /** Whether older messages are currently being fetched. */
  isLoadingOlder?: boolean;
  /** Callback to load older messages (scroll-up infinite scroll). */
  onLoadOlder?: () => void;
  /** Total number of messages in the session (null until first paginated load). */
  totalMessageCount?: number | null;
  /** Error from the last failed older-messages fetch (null when no error). */
  loadOlderError?: string | null;
}

function toTitleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function formatDuration(ms: number): string {
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

// ─── Task Delegation Block ─────────────────────────────────────────────────

function TaskDelegationItem({ part }: { part: AccumulatedToolPart }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const state = part.state as any;
  const input = getTaskToolInput(part);

  // The child session runs on the same OpenCode instance as the parent.
  // We can build the navigation URL directly from the extracted session ID
  // and the current page's instanceId — no DB lookup required.
  const searchParams = useSearchParams();
  const parentInstanceId = searchParams.get("instanceId");
  const childOpencodeSessionId = getTaskToolSessionId(part);

  if (!input) return null;

  const isRunning = state?.status === "running" || state?.status === "pending" || !state?.status;
  const isError = state?.status === "error";
  const isCompleted = !isRunning && !isError;

  const title = input.subagent_type
    ? `${toTitleCase(input.subagent_type)} Task`
    : "Subagent Task";

  const childUrl = childOpencodeSessionId && parentInstanceId
    ? `/sessions/${encodeURIComponent(childOpencodeSessionId)}?instanceId=${encodeURIComponent(parentInstanceId)}`
    : null;

  // Status summary from part.state (no API calls needed)
  const outputPreview = (() => {
    if (!state?.output) return null;
    const firstLine = String(state.output).split("\n")[0];
    return firstLine.length > 80 ? firstLine.slice(0, 80) + "…" : firstLine;
  })();

  const cardContent = (
    <>
      <div className="flex items-center gap-2 font-medium text-foreground/80">
        {isRunning && <Loader2 className="h-3 w-3 animate-spin text-indigo-400 shrink-0" />}
        {isCompleted && (
          <CheckCircle2 className="h-3 w-3 text-green-500 shrink-0" />
        )}
        {isError && (
          <AlertTriangle className="h-3 w-3 text-red-500 shrink-0" />
        )}
        <span className="flex-1">{title}</span>
        {childUrl && (
          <ArrowUpRight className="h-3 w-3 shrink-0 text-muted-foreground/60" />
        )}
      </div>
      {input.description && (
        <p className="mt-1 text-muted-foreground leading-relaxed">{input.description}</p>
      )}
      {outputPreview && !isRunning && (
        <p className={`mt-1 leading-relaxed truncate ${isError ? "text-red-500/80" : "text-muted-foreground/70"}`}>
          {outputPreview}
        </p>
      )}
    </>
  );

  if (childUrl) {
    return (
      <Link
        href={childUrl}
        className="my-1 rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs border-l-2 border-l-indigo-500/60 block hover:bg-muted/50 hover:border-border transition-colors"
      >
        {cardContent}
      </Link>
    );
  }

  return (
    <div className="my-1 rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs border-l-2 border-l-indigo-500/60">
      {cardContent}
    </div>
  );
}

// ─── Tool Call Item ─────────────────────────────────────────────────────────

function ToolCallItem({ part }: { part: AccumulatedPart & { type: "tool" } }) {
  // Delegate task tool calls to the delegation block renderer
  if (isTaskToolCall(part) && getTaskToolInput(part)) {
    return <TaskDelegationItem part={part} />;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const state = part.state as any;
  const isRunning = state?.status === "running" || !state?.status;

  // Special rendering for todowrite tool calls
  if (isTodoWriteTool(part.tool)) {
    const todos = parseTodoOutput(state?.output);
    if (todos !== null || isRunning) {
      return (
        <div className="py-0.5">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <SquareTerminal className="h-3 w-3 shrink-0 text-muted-foreground" />
            <span className="font-mono text-amber-500/90">{part.tool}</span>
            {isRunning && <Loader2 className="h-3 w-3 animate-spin" />}
            {todos && !isRunning && (
              <span className="text-muted-foreground/60">{todos.length} item{todos.length !== 1 ? "s" : ""}</span>
            )}
          </div>
          <TodoListInline items={todos ?? []} isRunning={isRunning} />
        </div>
      );
    }
  }

  return <CollapsibleToolCall part={part} />;
}

// ─── Message Item ───────────────────────────────────────────────────────────

interface MessageItemProps {
  message: AccumulatedMessage;
  agents?: AutocompleteAgent[];
  parentCreatedAt?: number;
  highlightQuery?: string;
  isMatchingMessage?: boolean;
}

const MessageItem = memo(function MessageItem({
  message,
  agents,
  parentCreatedAt,
  isMatchingMessage,
}: MessageItemProps) {
  const isUser = message.role === "user";
  const textParts = message.parts.filter((p) => p.type === "text");
  const toolParts = message.parts.filter(
    (p): p is AccumulatedPart & { type: "tool" } => p.type === "tool"
  );

  const fullText = textParts
    .map((p) => (p.type === "text" ? p.text : ""))
    .join("");

  // Look up agent metadata for color (with fallback)
  const agentMeta = message.agent ? agents?.find((a) => a.name === message.agent) : undefined;
  const agentColor = message.agent ? resolveAgentColor(message.agent, agentMeta?.color) : undefined;

  // Compute duration for assistant messages
  let durationStr: string | null = null;
  if (!isUser && message.completedAt && parentCreatedAt) {
    durationStr = formatDuration(message.completedAt - parentCreatedAt);
  }

  return (
    <div
      className={`flex gap-3 px-4 py-3 hover:bg-accent/20 border-b border-border/40 border-l-2${isMatchingMessage ? " bg-yellow-500/5" : ""}`}
      style={{ borderLeftColor: agentColor ?? "transparent" }}
    >
      <div className="mt-0.5 shrink-0">
        {isUser ? (
          <User className="h-4 w-4 text-foreground" />
        ) : (
          <Bot className="h-4 w-4 text-muted-foreground" />
        )}
      </div>
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          {isUser ? (
            <span className="text-xs font-medium">You</span>
          ) : (
            <>
              {/* TUI pattern: ▣ AgentName · modelID · duration */}
              <span
                className="text-xs font-medium"
                style={{ color: agentColor }}
              >
                ▣
              </span>
              <span className="text-xs font-medium">
                {message.agent ? toTitleCase(message.agent) : "Assistant"}
              </span>
              {message.modelID && (
                <span className="text-[10px] text-muted-foreground">
                  · {message.modelID}
                </span>
              )}
              {durationStr && (
                <span className="text-[10px] text-muted-foreground">
                  · {durationStr}
                </span>
              )}
            </>
          )}
          {message.cost != null && message.cost > 0 && (
            <span className="text-[10px] text-muted-foreground">
              ${message.cost.toFixed(4)}
            </span>
          )}
          {message.createdAt ? (
            <RelativeTimestamp timestamp={message.createdAt} />
          ) : null}
        </div>

        {/* Tool calls */}
        {toolParts.length > 0 && (
          <div className="space-y-0.5">
            {toolParts.map((part) => (
              <ToolCallItem key={part.partId} part={part} />
            ))}
          </div>
        )}

        {/* Text content */}
        {fullText && (
          <MarkdownRenderer content={fullText} />
        )}

        {/* Empty state for assistant — still streaming */}
        {!isUser && !fullText && toolParts.length === 0 && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            <span>
              {message.agent ? `${toTitleCase(message.agent)} thinking…` : "Thinking…"}
            </span>
          </div>
        )}
      </div>
    </div>
  );
});

// ─── Activity Stream ────────────────────────────────────────────────────────

function DurationSeparator({ durationMs }: { durationMs: number }) {
  return (
    <div className="flex items-center gap-2 px-4 py-1">
      <div className="flex-1 border-t border-border/30" />
      <span className="text-[10px] text-muted-foreground whitespace-nowrap">
        {formatDuration(durationMs)}
      </span>
      <div className="flex-1 border-t border-border/30" />
    </div>
  );
}

export function ActivityStreamV1({
  messages,
  status,
  sessionStatus,
  error,
  agents,
  onReconnect,
  reconnectAttempt,
  hasMoreMessages,
  isLoadingOlder,
  onLoadOlder,
  totalMessageCount,
  loadOlderError,
}: ActivityStreamV1Props) {
  const { scrollRef, isAtBottom, isNearTop, newMessageCount, scrollToBottom, preserveScrollPosition } =
    useScrollAnchor({ messageCount: messages.length });

  // Guard against double-firing onLoadOlder while isNearTop stays true
  const hasFiredLoadOlderRef = useRef(false);

  // Reset the guard when isNearTop transitions to false
  useEffect(() => {
    if (!isNearTop) {
      hasFiredLoadOlderRef.current = false;
    }
  }, [isNearTop]);

  // Trigger loading older messages when user scrolls near the top
  useEffect(() => {
    if (isNearTop && hasMoreMessages && !isLoadingOlder && onLoadOlder && !hasFiredLoadOlderRef.current) {
      hasFiredLoadOlderRef.current = true;
      preserveScrollPosition(() => {
        onLoadOlder();
      });
    }
  }, [isNearTop, hasMoreMessages, isLoadingOlder, onLoadOlder, preserveScrollPosition]);

  const {
    searchQuery,
    setSearchQuery,
    messageTypeFilter,
    toggleMessageType,
    agentFilter,
    setAgentFilter,
    filteredMessages,
    matchingPartIds,
    isFiltering,
    clearFilters,
    isOpen: toolbarOpen,
    setIsOpen: setToolbarOpen,
  } = useActivityFilter(messages);

  const handleOpenToolbar = useCallback(() => setToolbarOpen(true), [setToolbarOpen]);
  useKeyboardShortcut("f", handleOpenToolbar, { platformModifier: true });

  // Derive active agent from the latest user message when busy
  const activeAgentName = sessionStatus === "busy"
    ? [...messages].reverse().find((m) => m.role === "user" && m.agent)?.agent ?? null
    : null;
  const activeAgentMeta = activeAgentName ? agents?.find((a) => a.name === activeAgentName) : undefined;
  const activeAgentColor = activeAgentName ? resolveAgentColor(activeAgentName, activeAgentMeta?.color) : undefined;

  const createdAtByMessageId = useMemo(() => {
    const map = new Map<string, number>();
    for (const msg of messages) {
      if (msg.createdAt != null) map.set(msg.messageId, msg.createdAt);
    }
    return map;
  }, [messages]);

  return (
    <div className="flex flex-col h-full">
      {/* Connection status banner */}
      {status === "disconnected" && (
        <div className="px-4 py-2 bg-amber-500/10 border-b border-amber-500/20 text-xs text-amber-500 flex items-center gap-2">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          <span className="flex-1">
            Connection lost — reconnecting
            {reconnectAttempt != null && reconnectAttempt > 0
              ? ` (attempt ${reconnectAttempt})` : ""}…
          </span>
          {onReconnect && (
            <button
              onClick={onReconnect}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-amber-500/20 hover:bg-amber-500/30 text-amber-600 dark:text-amber-400 transition-colors"
            >
              <RefreshCw className="h-3 w-3" />
              Reconnect Now
            </button>
          )}
        </div>
      )}
      {status === "error" && error && (
        <div className="px-4 py-2 bg-red-500/10 border-b border-red-500/20 text-xs text-red-600 dark:text-red-400 flex items-center gap-2">
          <AlertCircle className="h-3.5 w-3.5" />
          {error}
        </div>
      )}

      {/* Search/filter toolbar */}
      {toolbarOpen && (
        <ActivityStreamToolbar
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          messageTypeFilter={messageTypeFilter}
          toggleMessageType={toggleMessageType}
          agentFilter={agentFilter}
          setAgentFilter={setAgentFilter}
          isFiltering={isFiltering}
          clearFilters={clearFilters}
          filteredCount={filteredMessages.length}
          totalCount={messages.length}
          agents={agents}
          onClose={() => { setToolbarOpen(false); clearFilters(); }}
        />
      )}

      <div className="relative flex-1 min-h-0" ref={scrollRef}>
        <ScrollArea className="h-full">
          <div>
            {/* Loading indicator for older messages */}
            {isLoadingOlder && (
              <div className="flex items-center justify-center py-3 text-xs text-muted-foreground gap-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>Loading older messages…</span>
              </div>
            )}
            {hasMoreMessages && !isLoadingOlder && (
              <div className="flex items-center justify-center py-2 text-xs text-muted-foreground">
                <span>Scroll up for older messages</span>
              </div>
            )}
            {loadOlderError && !isLoadingOlder && (
              <div className="flex items-center justify-center py-2 text-xs text-red-600 dark:text-red-400 gap-1.5">
                <AlertCircle className="h-3 w-3" />
                <span>{loadOlderError} — scroll up to retry</span>
              </div>
            )}

            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-48 text-muted-foreground text-sm gap-2">
                {status === "connecting" ? (
                  <>
                    <Loader2 className="h-5 w-5 animate-spin" />
                    <span>Connecting…</span>
                  </>
                ) : (
                  <span>No messages yet. Send a prompt to get started.</span>
                )}
              </div>
            )}

            {filteredMessages.map((message, index) => {
              const prevMessage = index > 0 ? filteredMessages[index - 1] : null;
              const gap = prevMessage && message.createdAt && (prevMessage.completedAt ?? prevMessage.createdAt)
                ? message.createdAt - (prevMessage.completedAt ?? prevMessage.createdAt!)
                : 0;

              // A message is highlighted if filtering is active and any of its parts matched
              const isMatchingMessage = isFiltering &&
                message.parts.some((p) => matchingPartIds.has(p.partId));

              return (
                <Fragment key={message.messageId}>
                  {gap > 30_000 && <DurationSeparator durationMs={gap} />}
                  <MessageItem
                    message={message}
                    agents={agents}
                    parentCreatedAt={message.parentID ? createdAtByMessageId.get(message.parentID) : undefined}
                    highlightQuery={isFiltering ? searchQuery : undefined}
                    isMatchingMessage={isMatchingMessage}
                  />
                </Fragment>
              );
            })}

            {/* "Thinking" indicator when agent is busy but no new message yet */}
            {sessionStatus === "busy" &&
              messages.length > 0 &&
              messages[messages.length - 1].role === "user" && (
                <div className="flex gap-3 px-4 py-3 border-b border-border/40">
                  <Bot className="h-4 w-4 text-muted-foreground mt-0.5" />
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    <span>
                      {activeAgentName
                        ? `${toTitleCase(activeAgentName)} thinking…`
                        : "Thinking…"}
                    </span>
                  </div>
                </div>
              )}
          </div>
        </ScrollArea>

        {/* Jump-to-bottom floating button */}
        {!isAtBottom && (
          <Button
            variant="outline"
            size="icon-sm"
            className="absolute bottom-4 right-4 z-10 rounded-full shadow-md"
            onClick={scrollToBottom}
            aria-label="Scroll to bottom"
          >
            <ChevronDown className="h-4 w-4" />
            {newMessageCount > 0 && (
              <span className="absolute -top-2 -right-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-medium text-primary-foreground">
                {newMessageCount > 99 ? "99+" : newMessageCount}
              </span>
            )}
          </Button>
        )}
      </div>

      {/* Status bar */}
      <div className="px-4 py-1.5 border-t border-border/40 flex items-center gap-2">
        <span
          className="h-1.5 w-1.5 rounded-full"
          style={{
            backgroundColor:
              sessionStatus === "busy"
                ? (activeAgentColor ?? "#22c55e")
                : status === "connected"
                ? "var(--color-zinc-500)"
                : "var(--color-amber-500)",
          }}
        />
        <span className="text-[10px] text-muted-foreground">
          {sessionStatus === "busy"
            ? activeAgentName
              ? `${toTitleCase(activeAgentName)} working…`
              : "Agent working…"
            : status === "connected"
            ? "Idle"
            : status === "connecting"
            ? "Connecting…"
            : "Disconnected"}
        </span>
        {messages.length > 0 && (
          <Badge
            variant="outline"
            className="ml-auto text-[10px] px-1.5 py-0"
          >
            {isFiltering
              ? `${filteredMessages.length} of ${messages.length} message${messages.length !== 1 ? "s" : ""}`
              : totalMessageCount != null && totalMessageCount > messages.length
              ? `${messages.length} of ${totalMessageCount} messages loaded`
              : `${messages.length} message${messages.length !== 1 ? "s" : ""}`}
          </Badge>
        )}
      </div>
    </div>
  );
}
