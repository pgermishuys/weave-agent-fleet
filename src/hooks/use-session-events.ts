"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import type {
  AccumulatedMessage,
  SSEEvent,
} from "@/lib/api-types";
import {
  ensureMessage,
  mergeMessageUpdate,
  applyPartUpdate,
  applyTextDelta,
} from "@/lib/event-state";
import { useMessagePagination } from "@/hooks/use-message-pagination";
import { prependMessages, convertSDKMessageToAccumulated } from "@/lib/pagination-utils";
import type { SDKMessage } from "@/lib/pagination-utils";

export type SessionConnectionStatus =
  | "connecting"
  | "connected"
  | "recovering"
  | "disconnected"
  | "error"
  | "abandoned";

export interface UseSessionEventsResult {
  messages: AccumulatedMessage[];
  status: SessionConnectionStatus;
  sessionStatus: "idle" | "busy";
  error?: string;
  /** Imperatively transition sessionStatus to "idle" (e.g. after a successful abort). */
  forceIdle: () => void;
  /** Close the current EventSource, reset reconnect delay, and reconnect immediately. */
  reconnect: () => void;
  /** Number of reconnection attempts since last successful connection. */
  reconnectAttempt: number;
  /** Whether there are older messages that can be loaded. */
  hasMoreMessages: boolean;
  /** Whether older messages are currently being fetched. */
  isLoadingOlder: boolean;
  /** Load the next older batch of messages. */
  loadOlderMessages: () => Promise<void>;
  /** Total number of messages in the session (null until first paginated load). */
  totalMessageCount: number | null;
  /** Error from the last failed older-messages fetch (null when no error). */
  loadOlderError: string | null;
}

const MAX_RECONNECT_DELAY_MS = 30_000;
const BASE_RECONNECT_DELAY_MS = 1_000;
const MAX_RECONNECT_ATTEMPTS = 5;
/** Maximum messages held in memory — oldest are evicted when exceeded. */
const MAX_MESSAGES = 500;

export function useSessionEvents(
  sessionId: string,
  instanceId: string,
  onAgentSwitch?: (agent: string) => void
): UseSessionEventsResult {
  const [messages, setMessages] = useState<AccumulatedMessage[]>([]);
  const [status, setStatus] = useState<SessionConnectionStatus>("connecting");
  const [sessionStatus, setSessionStatus] = useState<"idle" | "busy">("idle");
  const [error, setError] = useState<string | undefined>();
  const [reconnectAttempt, setReconnectAttempt] = useState(0);

  const pagination = useMessagePagination();
  // Destructure stable function references to avoid unstable object identity in deps
  const {
    resetPagination,
    loadInitialMessages: paginationLoadInitial,
    loadOlderMessages: paginationLoadOlder,
  } = pagination;

  const reconnectDelay = useRef(BASE_RECONNECT_DELAY_MS);
  const isMounted = useRef(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track whether we've ever successfully connected — if so, do state recovery on reconnect
  const hasConnectedOnce = useRef(false);
  const connectRef = useRef<(() => void) | null>(null);
  // Keep onAgentSwitch in a ref to avoid stale closures in the event handler
  const onAgentSwitchRef = useRef(onAgentSwitch);
  useEffect(() => { onAgentSwitchRef.current = onAgentSwitch; }, [onAgentSwitch]);
  // Track the last known message ID for incremental reconnect loading
  const lastMessageIdRef = useRef<string | null>(null);

  /**
   * Fetch existing messages from the API and convert to AccumulatedMessage[].
   * Used on reconnect (to fill gaps) — fetches ALL messages for gap-free state.
   */
  const loadAllMessages = useCallback(async (): Promise<void> => {
    if (!sessionId || !instanceId) return;
    try {
      const url = `/api/sessions/${encodeURIComponent(sessionId)}?instanceId=${encodeURIComponent(instanceId)}`;
      const response = await fetch(url);
      if (!response.ok) return;
      const data = await response.json() as {
        messages?: SDKMessage[];
      };
      if (!data.messages?.length) return;

      const accumulated = data.messages.map(convertSDKMessageToAccumulated);
      setMessages(
        accumulated.length > MAX_MESSAGES
          ? accumulated.slice(accumulated.length - MAX_MESSAGES)
          : accumulated
      );
      // Reset pagination state since we loaded everything
      resetPagination();
    } catch {
      // Best-effort — if loading fails, we still have the live stream
    }
  }, [sessionId, instanceId, resetPagination]);

  /**
   * Load only messages that arrived since the last known message.
   * Falls back to loadAllMessages if there's no reference point or if the API call fails.
   */
  const loadMessagesSince = useCallback(async (afterId: string | null): Promise<void> => {
    if (!sessionId || !instanceId) return;
    if (!afterId) {
      // No reference point — fall back to full load
      return loadAllMessages();
    }
    try {
      const url = `/api/sessions/${encodeURIComponent(sessionId)}/messages?instanceId=${encodeURIComponent(instanceId)}&after=${encodeURIComponent(afterId)}`;
      const response = await fetch(url);
      if (!response.ok) return loadAllMessages(); // fallback
      const data = await response.json() as { messages?: SDKMessage[] };
      if (!data.messages?.length) return; // no gap

      const accumulated = data.messages.map(convertSDKMessageToAccumulated);
      setMessages(prev => {
        // Append new messages, avoiding duplicates
        const existingIds = new Set(prev.map(m => m.messageId));
        const newMessages = accumulated.filter(m => !existingIds.has(m.messageId));
        const merged = [...prev, ...newMessages];
        // Apply cap
        return merged.length > MAX_MESSAGES
          ? merged.slice(merged.length - MAX_MESSAGES)
          : merged;
      });
    } catch {
      return loadAllMessages(); // fallback on error
    }
  }, [sessionId, instanceId, loadAllMessages]);

  /**
   * Load the initial batch of messages (paginated — last N messages).
   * Used on first connect for fast initial load.
   */
  const loadInitialMessages = useCallback(async (): Promise<void> => {
    if (!sessionId || !instanceId) return;
    try {
      const accumulated = await paginationLoadInitial(sessionId, instanceId);
      if (accumulated.length > 0) {
        setMessages(accumulated);
      }
    } catch {
      // Best-effort — if loading fails, we still have the live stream
    }
  }, [sessionId, instanceId, paginationLoadInitial]);

  const connect = useCallback(() => {
    if (!isMounted.current) return;

    const url = `/api/sessions/${encodeURIComponent(sessionId)}/events?instanceId=${encodeURIComponent(instanceId)}`;
    const es = new EventSource(url);
    eventSourceRef.current = es;
    setStatus("connecting");

    es.onopen = () => {
      if (!isMounted.current) return;
      reconnectDelay.current = BASE_RECONNECT_DELAY_MS;
      setReconnectAttempt(0);

      if (hasConnectedOnce.current) {
        // Reconnect after a drop — load only the gap since last known message
        setStatus("recovering");
        loadMessagesSince(lastMessageIdRef.current).then(() => {
          if (isMounted.current) {
            setStatus("connected");
            setError(undefined);
          }
        });
      } else {
        // First connect — load initial batch (paginated)
        hasConnectedOnce.current = true;
        setStatus("connected");
        setError(undefined);
        loadInitialMessages();
      }
    };

    es.onmessage = (e: MessageEvent<string>) => {
      if (!isMounted.current) return;
      let event: SSEEvent;
      try {
        event = JSON.parse(e.data) as SSEEvent;
      } catch {
        return;
      }
      handleEvent(event, sessionId, setMessages, setStatus, setSessionStatus, setError, onAgentSwitchRef, lastMessageIdRef);
    };

    es.onerror = () => {
      if (!isMounted.current) return;
      es.close();
      eventSourceRef.current = null;

      setReconnectAttempt((prev) => {
        const next = prev + 1;
        if (next >= MAX_RECONNECT_ATTEMPTS) {
          setStatus("abandoned");
          // Don't schedule any more retries
          return next;
        }
        setStatus("disconnected");
        const delay = reconnectDelay.current;
        reconnectDelay.current = Math.min(delay * 2, MAX_RECONNECT_DELAY_MS);
        reconnectTimerRef.current = setTimeout(() => {
          if (isMounted.current) connectRef.current?.();
        }, delay);
        return next;
      });
    };
  }, [sessionId, instanceId, loadMessagesSince, loadInitialMessages]);

  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  useEffect(() => {
    isMounted.current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- connect subscribes to EventSource (external system), setState is called asynchronously in event callbacks
    connect();
    return () => {
      isMounted.current = false;
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };
  }, [connect]);

  const forceIdle = useCallback(() => setSessionStatus("idle"), []);

  const loadOlderMessages = useCallback(async () => {
    if (!sessionId || !instanceId) return;
    const older = await paginationLoadOlder(sessionId, instanceId);
    if (older.length > 0) {
      setMessages((prev) => prependMessages(prev, older));
    }
  }, [sessionId, instanceId, paginationLoadOlder]);

  const reconnect = useCallback(() => {
    // Close existing connection
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
    // Clear any pending reconnect timer
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    // Reset delay and attempt counter so manual reconnect starts fresh
    reconnectDelay.current = BASE_RECONNECT_DELAY_MS;
    setReconnectAttempt(0);
    // Immediately reconnect
    connectRef.current?.();
  }, []);

  return {
    messages,
    status,
    sessionStatus,
    error,
    forceIdle,
    reconnect,
    reconnectAttempt,
    hasMoreMessages: pagination.hasMore,
    isLoadingOlder: pagination.isLoadingOlder,
    loadOlderMessages,
    totalMessageCount: pagination.totalCount,
    loadOlderError: pagination.loadError,
  };
}

// ─── Event handler (pure — receives setters to avoid stale closures) ──────

type SetMessages = React.Dispatch<React.SetStateAction<AccumulatedMessage[]>>;
type SetStatus = React.Dispatch<React.SetStateAction<SessionConnectionStatus>>;
type SetSessionStatus = React.Dispatch<React.SetStateAction<"idle" | "busy">>;
type SetError = React.Dispatch<React.SetStateAction<string | undefined>>;

function handleEvent(
  event: SSEEvent,
  sessionId: string,
  setMessages: SetMessages,
  setStatus: SetStatus,
  setSessionStatus: SetSessionStatus,
  setError: SetError,
  onAgentSwitchRef: React.MutableRefObject<((agent: string) => void) | undefined>,
  lastMessageIdRef: React.MutableRefObject<string | null>,
): void {
  const { type, properties } = event;

  if (type === "server.connected") {
    setStatus("connected");
    return;
  }

  if (type === "error") {
    setError(properties?.message ?? "Unknown error");
    setStatus("error");
    return;
  }

  if (type === "session.status") {
    const statusType = properties?.status?.type;
    if (statusType === "idle") setSessionStatus("idle");
    else if (statusType === "busy") setSessionStatus("busy");
    return;
  }

  if (type === "session.idle") {
    setSessionStatus("idle");
    return;
  }

  if (type === "message.updated") {
    const info = properties?.info;
    if (!info?.id) return;
    lastMessageIdRef.current = info.id;
    setMessages((prev) => {
      const next = mergeMessageUpdate(ensureMessage(prev, info), info);
      if (next.length > MAX_MESSAGES) {
        return next.slice(next.length - MAX_MESSAGES);
      }
      return next;
    });
    return;
  }

  if (type === "message.part.updated") {
    const part = properties?.part;
    if (!part?.messageID || !part?.sessionID) return;
    setMessages((prev) => applyPartUpdate(prev, part));

    // Auto-switch agent on plan_exit/plan_enter tool completions (matching TUI behavior)
    if (part.type === "tool" && part.state?.status === "completed") {
      if (part.tool === "plan_exit") {
        onAgentSwitchRef.current?.("build");
      } else if (part.tool === "plan_enter") {
        onAgentSwitchRef.current?.("plan");
      }
    }
    return;
  }

  // message.part.delta — real-time text delta (not in SDK types but emitted during streaming)
  if (type === "message.part.delta") {
    const { sessionID, messageID, partID, field, delta } = properties ?? {};
    if (sessionID !== sessionId) return;
    if (field !== "text" || !messageID || !partID) return;
    setMessages((prev) =>
      applyTextDelta(prev, messageID, partID, sessionID, delta ?? "")
    );
    return;
  }
}
