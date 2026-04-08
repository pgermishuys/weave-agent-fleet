"use client";

import { memo, useMemo, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Bot, User, SquareTerminal, Loader2, AlertCircle, RefreshCw, ChevronDown, ArrowUpRight, CheckCircle2, AlertTriangle } from "lucide-react";
import { useScrollAnchor } from "@/hooks/use-scroll-anchor";
import { useActivityFilter } from "@/hooks/use-activity-filter";
import { useKeyboardShortcut } from "@/hooks/use-keyboard-shortcut";
import { useTextSelection } from "@/hooks/use-text-selection";
import type { AccumulatedMessage, AccumulatedPart, AccumulatedToolPart, AccumulatedFilePart, AutocompleteAgent } from "@/lib/api-types";
import { isTaskToolCall, getTaskToolInput, getTaskToolSessionId } from "@/lib/api-types";
import Link from "next/link";
import type { SessionConnectionStatus } from "@/hooks/use-session-events";
import { isTodoWriteTool, parseTodoOutput } from "@/lib/todo-utils";
import { resolveAgentColor } from "@/lib/agent-colors";
import { TodoListInline } from "./todo-list-inline";
import { ToolCardRouter } from "./tool-cards/tool-card-router";
import { MarkdownRenderer } from "./markdown-renderer";
import { RelativeTimestamp } from "./relative-timestamp";
import { ActivityStreamToolbar } from "./activity-stream-toolbar";
import { ImageLightbox } from "./image-lightbox";
import { SelectionToolbar } from "./selection-toolbar";

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
  /** The current page's OpenCode session ID — threaded to TaskDelegationItem for parent breadcrumbs. */
  currentSessionId?: string;

  /**
   * Ref written by the calling component with the current scroll position.
   * ActivityStreamV1 keeps this up to date on every scroll so that the parent
   * can read the last known position on unmount for cache storage.
   */
  scrollPositionRef?: React.MutableRefObject<{ scrollTop: number; scrollHeight: number } | null>;
  /**
   * Whether this session was hydrated from the cache.
   * When true, auto-scroll is suppressed and initialScrollPosition is restored.
   */
  cacheHit?: boolean;
  /**
   * The scroll position to restore when cacheHit is true.
   * Null if the cache was invalidated (gap-fill fell back to full reload).
   */
  initialScrollPosition?: { scrollTop: number; scrollHeight: number } | null;
  /**
   * External ref for suppressing auto-scroll. Set synchronously by
   * useSessionEvents before cached messages are hydrated, so that the
   * messageCount auto-scroll effect in useScrollAnchor is suppressed
   * on the same render cycle.
   */
  suppressAutoScrollRef?: React.MutableRefObject<boolean>;
  /**
   * Called when the user selects text in the activity stream and clicks the
   * floating "Spawn Session" toolbar button.  The parent component uses this
   * to open the SpawnSessionDialog.
   */
  onSpawnFromSelection?: (selectedText: string) => void;
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

// ─── Inference Step Collapsing ──────────────────────────────────────────────

/** A message is collapsible if it's an assistant message with no renderable content. */
function isCollapsibleMessage(message: AccumulatedMessage): boolean {
  if (message.role !== "assistant") return false;
  const hasText = message.parts.some(
    (p) => p.type === "text" && p.text.trim().length > 0
  );
  const hasTool = message.parts.some((p) => p.type === "tool");
  const hasFile = message.parts.some((p) => p.type === "file");
  return !hasText && !hasTool && !hasFile;
}

type ActivityStreamEntry =
  | { type: "message"; message: AccumulatedMessage }
  | { type: "inference-summary"; messages: AccumulatedMessage[] }
  | { type: "thinking"; message: AccumulatedMessage };

/**
 * A message is "effectively completed" if it has an explicit completedAt
 * timestamp, OR if it already carries cost/token data (meaning the LLM
 * inference step finished and reported usage — the completedAt just wasn't
 * propagated via SSE).  When the session is idle, ALL collapsible messages
 * are treated as completed since the LLM is no longer running.
 */
function isEffectivelyCompleted(
  message: AccumulatedMessage,
  sessionIdle: boolean
): boolean {
  if (message.completedAt) return true;
  if (sessionIdle) return true;
  // Has cost/token data → inference step finished, completedAt just missing
  if ((message.cost ?? 0) > 0) return true;
  if (
    message.tokens &&
    (message.tokens.input > 0 ||
      message.tokens.output > 0 ||
      message.tokens.reasoning > 0)
  )
    return true;
  return false;
}

function groupMessages(
  messages: AccumulatedMessage[],
  sessionStatus: "idle" | "busy"
): ActivityStreamEntry[] {
  const entries: ActivityStreamEntry[] = [];
  let run: AccumulatedMessage[] = [];
  const sessionIdle = sessionStatus === "idle";

  const flushRun = () => {
    if (run.length === 0) return;
    const completed = run.filter((m) => isEffectivelyCompleted(m, sessionIdle));
    const incomplete = run.filter(
      (m) => !isEffectivelyCompleted(m, sessionIdle)
    );

    if (completed.length > 0) {
      entries.push({ type: "inference-summary", messages: completed });
    }
    // Show thinking for the last incomplete message only
    if (incomplete.length > 0) {
      entries.push({
        type: "thinking",
        message: incomplete[incomplete.length - 1],
      });
    }
    run = [];
  };

  for (const message of messages) {
    if (isCollapsibleMessage(message)) {
      run.push(message);
    } else {
      flushRun();
      entries.push({ type: "message", message });
    }
  }
  flushRun(); // flush any trailing run

  return entries;
}

const InferenceStepsSummary = memo(function InferenceStepsSummary({
  messages,
}: {
  messages: AccumulatedMessage[];
}) {
  const count = messages.length;

  const totalCost = messages.reduce((sum, m) => sum + (m.cost ?? 0), 0);

  const totalTokens = messages.reduce(
    (sum, m) =>
      sum + (m.tokens?.input ?? 0) + (m.tokens?.output ?? 0) + (m.tokens?.reasoning ?? 0),
    0
  );

  // Duration: from first message's createdAt to last message's completedAt
  const first = messages[0];
  const last = messages[messages.length - 1];
  const durationMs =
    first?.createdAt && last?.completedAt
      ? last.completedAt - first.createdAt
      : null;

  // Build the summary segments
  const segments: string[] = [];
  segments.push(`${count} inference step${count !== 1 ? "s" : ""}`);
  if (totalCost > 0) segments.push(`$${totalCost.toFixed(4)}`);
  if (totalTokens > 0) {
    const formatted =
      totalTokens < 1000
        ? String(totalTokens)
        : totalTokens < 1_000_000
        ? `${(totalTokens / 1000).toFixed(1)}k`
        : `${(totalTokens / 1_000_000).toFixed(1)}M`;
    segments.push(`${formatted} tokens`);
  }
  if (durationMs != null && durationMs > 0) {
    segments.push(formatDuration(durationMs));
  }

  return (
    <div className="flex items-center gap-2 px-4 py-1.5 text-[10px] text-muted-foreground/70">
      <Bot className="h-3 w-3 text-muted-foreground/40 shrink-0" />
      <span>{segments.join(" · ")}</span>
    </div>
  );
});

function CollapsedThinkingIndicator({ message }: { message: AccumulatedMessage }) {
  const agentLabel = message.agent ? `${toTitleCase(message.agent)} thinking…` : "Thinking…";
  return (
    <div className="flex items-center gap-2 px-4 py-2 text-xs text-muted-foreground">
      <Bot className="h-4 w-4 text-muted-foreground shrink-0" />
      <Loader2 className="h-3 w-3 animate-spin" />
      <span>{agentLabel}</span>
    </div>
  );
}

// ─── Task Delegation Block ─────────────────────────────────────────────────

function TaskDelegationItem({ part, currentSessionId }: { part: AccumulatedToolPart; currentSessionId?: string }) {
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
    ? `/sessions/${encodeURIComponent(childOpencodeSessionId)}?instanceId=${encodeURIComponent(parentInstanceId)}${currentSessionId ? `&parentSessionId=${encodeURIComponent(currentSessionId)}` : ""}`
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

function ToolCallItem({ part, currentSessionId }: { part: AccumulatedPart & { type: "tool" }; currentSessionId?: string }) {
  // Delegate task tool calls to the delegation block renderer
  if (isTaskToolCall(part) && getTaskToolInput(part)) {
    return <TaskDelegationItem part={part} currentSessionId={currentSessionId} />;
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

  return <ToolCardRouter part={part} />;
}

// ─── Message Item ───────────────────────────────────────────────────────────

interface MessageItemProps {
  message: AccumulatedMessage;
  agents?: AutocompleteAgent[];
  parentCreatedAt?: number;
  highlightQuery?: string;
  isMatchingMessage?: boolean;
  currentSessionId?: string;
}

const MessageItem = memo(function MessageItem({
  message,
  agents,
  parentCreatedAt,
  isMatchingMessage,
  currentSessionId,
}: MessageItemProps) {
  const isUser = message.role === "user";

  const [lightboxImage, setLightboxImage] = useState<AccumulatedFilePart | null>(null);

  // Group consecutive parts of the same type into runs for rendering.
  // This preserves the original interleaved order from the LLM (text→tool→text→tool)
  // instead of separating by type which causes visual interleaving bugs.
  const partRuns = useMemo(() => {
    const runs: Array<
      | { type: "text"; text: string }
      | { type: "tools"; parts: Array<AccumulatedPart & { type: "tool" }> }
      | { type: "files"; parts: AccumulatedFilePart[] }
    > = [];

    for (const part of message.parts) {
      if (part.type === "text") {
        const trimmed = part.text;
        if (!trimmed) continue;
        // Merge consecutive text parts into one run
        const last = runs[runs.length - 1];
        if (last?.type === "text") {
          last.text += trimmed;
        } else {
          runs.push({ type: "text", text: trimmed });
        }
      } else if (part.type === "tool") {
        // Merge consecutive tool parts into one run
        const last = runs[runs.length - 1];
        if (last?.type === "tools") {
          last.parts.push(part as AccumulatedPart & { type: "tool" });
        } else {
          runs.push({ type: "tools", parts: [part as AccumulatedPart & { type: "tool" }] });
        }
      } else if (part.type === "file") {
        // Merge consecutive file parts into one run
        const last = runs[runs.length - 1];
        if (last?.type === "files") {
          last.parts.push(part as AccumulatedFilePart);
        } else {
          runs.push({ type: "files", parts: [part as AccumulatedFilePart] });
        }
      }
    }

    return runs;
  }, [message.parts]);

  const hasContent = partRuns.length > 0;

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

        {/* Render parts in their original interleaved order */}
        {partRuns.map((run, i) => {
          if (run.type === "tools") {
            return (
              <div key={`tools-${i}`} className="space-y-0.5">
                {run.parts.map((part) => (
                  <ToolCallItem key={part.partId} part={part} currentSessionId={currentSessionId} />
                ))}
              </div>
            );
          }
          if (run.type === "files") {
            return (
              <div key={`files-${i}`} className="flex gap-2 flex-wrap">
                {run.parts.map((part) => (
                  <button
                    key={part.partId}
                    type="button"
                    className="block cursor-pointer"
                    onClick={() => setLightboxImage(part)}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={part.url}
                      alt={part.filename ?? "Image attachment"}
                      className="max-h-48 max-w-xs rounded-md border border-border object-contain hover:opacity-90 transition-opacity"
                    />
                  </button>
                ))}
              </div>
            );
          }
          // run.type === "text"
          return <MarkdownRenderer key={`text-${i}`} content={run.text} />;
        })}

        {lightboxImage && (
          <ImageLightbox
            src={lightboxImage.url}
            alt={lightboxImage.filename ?? "Image attachment"}
            open
            onOpenChange={(open) => { if (!open) setLightboxImage(null); }}
          />
        )}

        {/* Empty state for assistant — still streaming (only show for incomplete messages) */}
        {!isUser && !message.completedAt && !hasContent && (
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
  currentSessionId,
  scrollPositionRef,
  cacheHit,
  initialScrollPosition,
  suppressAutoScrollRef,
  onSpawnFromSelection,
}: ActivityStreamV1Props) {
  const { scrollRef, isAtBottom, isNearTop, newMessageCount, scrollToBottom, preserveScrollPosition, getScrollPosition, restoreScrollPosition, suppressAutoScroll: suppressAutoScrollLocalRef, viewportElement } =
    useScrollAnchor({ messageCount: messages.length, externalSuppressAutoScroll: suppressAutoScrollRef });

  // Text selection detection — scoped to the scroll area container.
  // Only active when a spawn callback is provided (avoids overhead otherwise).
  const selectionContainerRef = useRef<HTMLElement | null>(null);
  const selection = useTextSelection(
    onSpawnFromSelection ? selectionContainerRef : { current: null }
  );

  // Guard against double-firing onLoadOlder while isNearTop stays true
  const hasFiredLoadOlderRef = useRef(false);

  // Throttle timer ref for the document-level scroll position capture (Task 2)
  const scrollThrottleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // ── Cache scroll restore: suppress auto-scroll and restore position ───────
  // Set suppressAutoScroll before the first render that delivers cached messages,
  // then restore the scroll position after mount.
  const scrollRestoreAttemptedRef = useRef(false);
  useEffect(() => {
    if (!cacheHit || scrollRestoreAttemptedRef.current) return;
    scrollRestoreAttemptedRef.current = true;

    // Suppress auto-scroll triggered by the initial batch of cached messages.
    suppressAutoScrollLocalRef.current = true;

    if (initialScrollPosition) {
      // Defer to let the DOM render the cached messages before scrolling.
      requestAnimationFrame(() => {
        restoreScrollPosition(initialScrollPosition);
        suppressAutoScrollLocalRef.current = false;
      });
    } else {
      // Cache was invalidated (gap-fill fell back to full reload) — allow
      // normal auto-scroll-to-bottom behavior.
      suppressAutoScrollLocalRef.current = false;
    }
  }, [cacheHit, initialScrollPosition, restoreScrollPosition, suppressAutoScrollLocalRef]);

  // ── Keep scrollPositionRef up to date with the latest scroll position ─────
  // This ref is read by useSessionEvents on unmount to save to the cache.
  // We capture position on every scroll event (including between renders)
  // via a document-level capture listener.
  // Throttled to fire at most once per 100ms to avoid 60+ calls/sec during
  // smooth scroll — the position is only read on unmount so high frequency is wasteful.
  useEffect(() => {
    if (!scrollPositionRef) return;
    const capturePosition = () => {
      const pos = getScrollPosition();
      if (pos !== null) {
        scrollPositionRef.current = pos;
      }
    };
    const handleScroll = () => {
      if (scrollThrottleTimerRef.current !== null) return;
      scrollThrottleTimerRef.current = setTimeout(() => {
        scrollThrottleTimerRef.current = null;
        capturePosition();
      }, 100);
    };
    // Capture initial position before any scroll events fire.
    capturePosition();
    // The scroll event fires on the viewport element inside the ScrollArea.
    // We add it on the document level with capture:true to intercept all scroll events
    // since we don't have direct access to the inner viewport here.
    document.addEventListener("scroll", handleScroll, { capture: true, passive: true });
    return () => {
      document.removeEventListener("scroll", handleScroll, { capture: true });
      // Flush any pending throttle so the final position is captured before unmount.
      if (scrollThrottleTimerRef.current !== null) {
        clearTimeout(scrollThrottleTimerRef.current);
        scrollThrottleTimerRef.current = null;
        capturePosition();
      }
    };
  }, [scrollPositionRef, getScrollPosition]);

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

  const groupedEntries = useMemo(
    () => groupMessages(filteredMessages, sessionStatus),
    [filteredMessages, sessionStatus]
  );

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

  // ── Virtualizer for the message list ──────────────────────────────────────
  // Only renders items visible in the viewport plus an overscan buffer,
  // keeping DOM node count ~30 regardless of session length.

  // NOTE: We previously built an entriesFingerprint and partsFingerprint
  // and called virtualizer.measure() when they changed.  That API clears
  // ALL cached sizes, resetting every item to the 120px estimate and
  // causing visible overlap until ResizeObserver re-measures.  The
  // virtualizer's measureElement ref (with its built-in ResizeObserver)
  // already handles dynamic element sizing automatically — structural
  // changes are handled by the count and getItemKey props.

  // Provide stable keys per item so the virtualizer can track them
  // across index shifts (e.g. when older messages are prepended).
  const getItemKey = useCallback(
    (index: number) => {
      const entry = groupedEntries[index];
      if (entry.type === "message") return entry.message.messageId;
      if (entry.type === "thinking") return `thinking-${entry.message.messageId}`;
      return `summary-${entry.messages[0].messageId}`;
    },
    [groupedEntries]
  );

  const virtualizer = useVirtualizer({
    count: groupedEntries.length,
    getScrollElement: () => viewportElement,
    estimateSize: () => 120,
    overscan: 10,
    getItemKey,
  });

  // Dynamic element heights (from streaming text, tool call updates, etc.)
  // are tracked automatically by the ResizeObserver that the virtualizer
  // attaches to each element via the measureElement ref.  We previously had
  // manual fingerprint-based virtualizer.measure() calls here, but that API
  // clears ALL cached sizes (resetting to 120px estimates), causing visible
  // overlap until the ResizeObserver re-measures.  Removed in favour of the
  // automatic approach.

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

      <div
        className="relative flex-1 min-h-0"
        ref={(node) => {
          scrollRef(node);
          selectionContainerRef.current = node;
        }}
      >
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

            {/* Virtualized message list — only ~30 DOM nodes at a time */}
            {groupedEntries.length > 0 && (
              <div
                style={{ position: "relative", height: `${virtualizer.getTotalSize()}px` }}
              >
                {virtualizer.getVirtualItems().map((virtualItem) => {
                  const entry = groupedEntries[virtualItem.index];

                  if (entry.type === "inference-summary") {
                    return (
                      <div
                        key={`summary-${entry.messages[0].messageId}`}
                        data-index={virtualItem.index}
                        ref={virtualizer.measureElement}
                        style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${virtualItem.start}px)` }}
                      >
                        <InferenceStepsSummary messages={entry.messages} />
                      </div>
                    );
                  }

                  if (entry.type === "thinking") {
                    return (
                      <div
                        key={`thinking-${entry.message.messageId}`}
                        data-index={virtualItem.index}
                        ref={virtualizer.measureElement}
                        style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${virtualItem.start}px)` }}
                      >
                        <CollapsedThinkingIndicator message={entry.message} />
                      </div>
                    );
                  }

                  // entry.type === "message"
                  const message = entry.message;
                  const index = virtualItem.index;

                  // DurationSeparator: find the previous entry for gap calculation
                  const prevEntry = index > 0 ? groupedEntries[index - 1] : null;
                  const prevMessage = prevEntry
                    ? prevEntry.type === "message"
                      ? prevEntry.message
                      : prevEntry.type === "inference-summary"
                      ? prevEntry.messages[prevEntry.messages.length - 1]
                      : prevEntry.type === "thinking"
                      ? prevEntry.message
                      : null
                    : null;
                  const gap = prevMessage && message.createdAt && (prevMessage.completedAt ?? prevMessage.createdAt)
                    ? message.createdAt - (prevMessage.completedAt ?? prevMessage.createdAt!)
                    : 0;

                  const isMatchingMessage = isFiltering &&
                    message.parts.some((p) => matchingPartIds.has(p.partId));

                  return (
                    <div
                      key={message.messageId}
                      data-index={virtualItem.index}
                      ref={virtualizer.measureElement}
                      style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${virtualItem.start}px)` }}
                    >
                      {gap > 30_000 && <DurationSeparator durationMs={gap} />}
                      <MessageItem
                        message={message}
                        agents={agents}
                        parentCreatedAt={message.parentID ? createdAtByMessageId.get(message.parentID) : undefined}
                        highlightQuery={isFiltering ? searchQuery : undefined}
                        isMatchingMessage={isMatchingMessage}
                        currentSessionId={currentSessionId}
                      />
                    </div>
                  );
                })}
              </div>
            )}

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

        {/* Floating "Spawn Session" toolbar — appears near text selections */}
        {onSpawnFromSelection && (
          <SelectionToolbar
            selection={selection}
            onSpawnClick={onSpawnFromSelection}
          />
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
