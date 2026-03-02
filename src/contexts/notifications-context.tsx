"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { DbNotification } from "@/lib/server/db-repository";
import { useBrowserNotifications } from "@/hooks/use-browser-notifications";
import { useNotificationPreferences } from "@/hooks/use-notification-preferences";

export type { DbNotification };

export interface NotificationsContextValue {
  unreadCount: number;
  notifications: DbNotification[];
  isLoading: boolean;
  fetchNotifications: (limit?: number) => Promise<void>;
  markAsRead: (id: string) => Promise<void>;
  markAllAsRead: () => Promise<void>;
  clearAll: () => Promise<void>;
}

const NotificationsContext = createContext<NotificationsContextValue | null>(
  null
);

const DEFAULT_POLL_INTERVAL_MS = 10_000;
const SSE_RECONNECT_DELAY_MS = 5_000;

interface NotificationsProviderProps {
  children: ReactNode;
  pollIntervalMs?: number;
}

export function NotificationsProvider({
  children,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
}: NotificationsProviderProps) {
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifications, setNotifications] = useState<DbNotification[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Defensive guard: although this provider wraps the entire app and is
  // effectively always mounted, React StrictMode (dev) and hot module
  // reload can trigger unmount->remount cycles. The ref prevents stale
  // setState calls from in-flight fetches or SSE events during those gaps.
  const isMounted = useRef(true);

  const eventSourceRef = useRef<EventSource | null>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Guard ref: prevents SSE onmessage from resurrecting notifications
  // that are being cleared by clearAll. Set true before the DELETE call,
  // reset in finally block after state is cleared.
  const clearingRef = useRef(false);

  // Browser notification hooks (called once here, not per-consumer)
  const { showNotification } = useBrowserNotifications();
  const { isTypeEnabled, preferences } = useNotificationPreferences();

  // Ref to track previous unread count for browser notification triggering
  const prevCountRef = useRef(0);

  const fetchUnreadCount = useCallback(async () => {
    try {
      const response = await fetch("/api/notifications/unread-count");
      if (!response.ok) return;
      const data = (await response.json()) as { count: number };
      if (isMounted.current) setUnreadCount(data.count);
    } catch {
      // Non-fatal — badge stays at last known value
    }
  }, []);

  const fetchNotifications = useCallback(async (limit: number = 10) => {
    if (isMounted.current) setIsLoading(true);
    try {
      const response = await fetch(`/api/notifications?limit=${limit}`);
      if (!response.ok) return;
      const data = (await response.json()) as DbNotification[];
      if (isMounted.current) {
        setNotifications(data);
        setUnreadCount(data.filter((n) => n.read === 0).length);
      }
    } catch {
      // Non-fatal
    } finally {
      if (isMounted.current) setIsLoading(false);
    }
  }, []);

  const markAsRead = useCallback(async (id: string) => {
    try {
      await fetch(`/api/notifications/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ read: true }),
      });
      if (isMounted.current) {
        setNotifications((prev) =>
          prev.map((n) => (n.id === id ? { ...n, read: 1 } : n))
        );
        setUnreadCount((prev) => Math.max(0, prev - 1));
      }
    } catch {
      // Non-fatal
    }
  }, []);

  const markAllAsRead = useCallback(async () => {
    try {
      await fetch("/api/notifications/all", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ read: true }),
      });
      if (isMounted.current) {
        setNotifications((prev) => prev.map((n) => ({ ...n, read: 1 })));
        setUnreadCount(0);
      }
    } catch {
      // Non-fatal
    }
  }, []);

  const clearAll = useCallback(async () => {
    clearingRef.current = true;
    try {
      await fetch("/api/notifications", { method: "DELETE" });
      if (isMounted.current) {
        setNotifications([]);
        setUnreadCount(0);
      }
    } catch {
      // Non-fatal
    } finally {
      clearingRef.current = false;
    }
  }, []);

  const startPolling = useCallback(() => {
    if (pollIntervalRef.current) return;
    pollIntervalRef.current = setInterval(fetchUnreadCount, pollIntervalMs);
  }, [fetchUnreadCount, pollIntervalMs]);

  const stopPolling = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  }, []);

  const connectSSE = useCallback(() => {
    if (eventSourceRef.current) return;
    const es = new EventSource("/api/notifications/stream");
    eventSourceRef.current = es;

    es.onopen = () => {
      stopPolling(); // SSE connected — stop polling
    };

    es.onmessage = (e: MessageEvent<string>) => {
      if (!isMounted.current) return;
      if (clearingRef.current) return; // Drop events during clearAll
      try {
        const data = JSON.parse(e.data) as {
          type: string;
          notification: DbNotification;
        };
        if (data.type === "notification" && data.notification) {
          setUnreadCount((prev) => Math.min(prev + 1, 9999));
          setNotifications((prev) =>
            [data.notification, ...prev].slice(0, 50)
          );
        }
      } catch {
        /* ignore parse errors */
      }
    };

    es.onerror = () => {
      if (!isMounted.current) return;
      es.close();
      eventSourceRef.current = null;
      // Fallback to polling
      fetchUnreadCount();
      startPolling();
      // Attempt SSE reconnect after delay
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      reconnectTimerRef.current = setTimeout(() => {
        reconnectTimerRef.current = null;
        if (isMounted.current && !eventSourceRef.current) connectSSE();
      }, SSE_RECONNECT_DELAY_MS);
    };
  }, [stopPolling, startPolling, fetchUnreadCount]);

  // SSE + polling lifecycle
  useEffect(() => {
    isMounted.current = true;
    fetchUnreadCount(); // Initial fetch
    connectSSE(); // Try SSE first
    startPolling(); // Start polling as initial fallback (SSE onopen will stop it)
    return () => {
      isMounted.current = false;
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      stopPolling();
    };
  }, [fetchUnreadCount, connectSSE, startPolling, stopPolling]);

  // Browser notification triggering — fires once here, not per consumer
  useEffect(() => {
    if (
      unreadCount > prevCountRef.current &&
      notifications.length > 0
    ) {
      const latest = notifications[0];
      if (
        latest &&
        preferences.browserEnabled &&
        isTypeEnabled(latest.type)
      ) {
        showNotification(latest);
      }
    }
    prevCountRef.current = unreadCount;
  }, [
    unreadCount,
    notifications,
    showNotification,
    isTypeEnabled,
    preferences.browserEnabled,
  ]);

  // PERF: Single context with useMemo. Actions are useCallback-stable so
  // they don't cause the memo to recompute. If profiling shows that consumers
  // needing only unreadCount re-render too often, split into state/actions contexts.
  const value = useMemo<NotificationsContextValue>(
    () => ({
      unreadCount,
      notifications,
      isLoading,
      fetchNotifications,
      markAsRead,
      markAllAsRead,
      clearAll,
    }),
    [
      unreadCount,
      notifications,
      isLoading,
      fetchNotifications,
      markAsRead,
      markAllAsRead,
      clearAll,
    ]
  );

  return (
    <NotificationsContext.Provider value={value}>
      {children}
    </NotificationsContext.Provider>
  );
}

export function useNotifications(): NotificationsContextValue {
  const ctx = useContext(NotificationsContext);
  if (!ctx) {
    throw new Error(
      "useNotifications must be used within a NotificationsProvider"
    );
  }
  return ctx;
}
