"use client";

import { memo, useEffect, useMemo, useRef } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Bot, User, Wrench, Loader2, AlertCircle } from "lucide-react";
import type { AccumulatedMessage, AccumulatedPart, AccumulatedToolPart, AutocompleteAgent } from "@/lib/api-types";
import { isTaskToolCall, getTaskToolInput } from "@/lib/api-types";
import type { SessionConnectionStatus } from "@/hooks/use-session-events";
import { isTodoWriteTool, parseTodoOutput } from "@/lib/todo-utils";
import { resolveAgentColor } from "@/lib/agent-colors";
import { formatTimestamp } from "@/lib/format-utils";
import { TodoListInline } from "./todo-list-inline";
import { MarkdownRenderer } from "./markdown-renderer";

interface ActivityStreamV1Props {
  messages: AccumulatedMessage[];
  status: SessionConnectionStatus;
  sessionStatus: "idle" | "busy";
  error?: string;
  agents?: AutocompleteAgent[];
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
  if (!input) return null;

  const isRunning = state?.status === "running" || state?.status === "pending" || !state?.status;
  const isError = state?.status === "error";

  const title = input.subagent_type
    ? `${toTitleCase(input.subagent_type)} Task`
    : "Subagent Task";

  return (
    <div className="my-1 rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs border-l-2 border-l-indigo-500/60">
      <div className="flex items-center gap-2 font-medium text-foreground/80">
        {isRunning && <Loader2 className="h-3 w-3 animate-spin text-indigo-400 shrink-0" />}
        {!isRunning && !isError && (
          <span className="h-2 w-2 rounded-full bg-green-500 shrink-0 inline-block" />
        )}
        {isError && (
          <span className="h-2 w-2 rounded-full bg-red-500 shrink-0 inline-block" />
        )}
        <span>{title}</span>
      </div>
      {input.description && (
        <p className="mt-1 text-muted-foreground leading-relaxed">{input.description}</p>
      )}
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
  const isCompleted = state?.status === "completed";
  const isError = state?.status === "error";

  // Special rendering for todowrite tool calls
  if (isTodoWriteTool(part.tool)) {
    const todos = parseTodoOutput(state?.output);
    if (todos !== null || isRunning) {
      return (
        <div className="py-0.5">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Wrench className="h-3 w-3 shrink-0 text-amber-500" />
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

  return (
    <div className="flex items-center gap-2 py-0.5 text-xs text-muted-foreground">
      <Wrench className="h-3 w-3 shrink-0 text-amber-500" />
      <span className="font-mono text-amber-500/90">{part.tool}</span>
      {isRunning && <Loader2 className="h-3 w-3 animate-spin" />}
      {isCompleted && (
        <span className="text-green-500/80">
          {state?.output ? String(state.output).slice(0, 60) : "done"}
        </span>
      )}
      {isError && (
        <span className="text-red-500/80">
          {state?.error ? String(state.error).slice(0, 60) : "error"}
        </span>
      )}
    </div>
  );
}

// ─── Message Item ───────────────────────────────────────────────────────────

interface MessageItemProps {
  message: AccumulatedMessage;
  agents?: AutocompleteAgent[];
  parentCreatedAt?: number;
}

const MessageItem = memo(function MessageItem({ message, agents, parentCreatedAt }: MessageItemProps) {
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
      className="flex gap-3 px-4 py-3 hover:bg-accent/20 border-b border-border/40 border-l-2"
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
            <span className="text-[10px] text-muted-foreground ml-auto">
              {formatTimestamp(message.createdAt)}
            </span>
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

export function ActivityStreamV1({
  messages,
  status,
  sessionStatus,
  error,
  agents,
}: ActivityStreamV1Props) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevMessageCountRef = useRef(0);

  // Auto-scroll to bottom when new content arrives (debounced)
  useEffect(() => {
    const messageCount = messages.length;
    const isNewMessage = messageCount !== prevMessageCountRef.current;
    prevMessageCountRef.current = messageCount;

    if (scrollTimerRef.current) {
      clearTimeout(scrollTimerRef.current);
    }

    scrollTimerRef.current = setTimeout(() => {
      bottomRef.current?.scrollIntoView({
        behavior: isNewMessage ? "smooth" : "auto",
      });
      scrollTimerRef.current = null;
    }, 150);

    return () => {
      if (scrollTimerRef.current) {
        clearTimeout(scrollTimerRef.current);
        scrollTimerRef.current = null;
      }
    };
  }, [messages]);

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
          <AlertCircle className="h-3.5 w-3.5" />
          Connection lost — reconnecting…
        </div>
      )}
      {status === "error" && error && (
        <div className="px-4 py-2 bg-red-500/10 border-b border-red-500/20 text-xs text-red-400 flex items-center gap-2">
          <AlertCircle className="h-3.5 w-3.5" />
          {error}
        </div>
      )}

      <ScrollArea className="flex-1 min-h-0">
        <div>
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

          {messages.map((message) => (
            <MessageItem
              key={message.messageId}
              message={message}
              agents={agents}
              parentCreatedAt={message.parentID ? createdAtByMessageId.get(message.parentID) : undefined}
            />
          ))}

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

          <div ref={bottomRef} />
        </div>
      </ScrollArea>

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
            ...(sessionStatus === "busy" || status !== "connected"
              ? {}
              : {}),
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
            {messages.length} message{messages.length !== 1 ? "s" : ""}
          </Badge>
        )}
      </div>
    </div>
  );
}
