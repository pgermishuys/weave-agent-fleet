"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { SessionListItem } from "@/lib/api-types";
import { apiFetch } from "@/lib/api-client";
import { sessionsChanged } from "@/lib/session-utils";
import { connectionRegistry } from "@/lib/fleet-connection-registry";

export interface UseSessionsResult {
  sessions: SessionListItem[];
  isLoading: boolean;
  error?: string;
  refetch: () => void;
}

const DEFAULT_POLL_INTERVAL_MS = 5_000;

export function useSessions(
  pollIntervalMs: number = DEFAULT_POLL_INTERVAL_MS
): UseSessionsResult {
  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const isMounted = useRef(true);

  const fetchSessions = useCallback(async () => {
    try {
      const connections = connectionRegistry.getConnections();

      // Fetch from every registered connection in parallel
      const results = await Promise.allSettled(
        connections.map(async (conn) => {
          const connId = conn.isLocal ? undefined : conn.id;
          const response = await apiFetch("/api/sessions", undefined, connId);
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }
          const data = (await response.json()) as SessionListItem[];
          // Stamp connectionId on items from remote connections
          if (!conn.isLocal) {
            return data.map((item) => ({ ...item, connectionId: conn.id }));
          }
          return data;
        })
      );

      const merged: SessionListItem[] = [];
      let fetchError: string | undefined;

      for (const result of results) {
        if (result.status === "fulfilled") {
          merged.push(...result.value);
        } else {
          // Record last error but don't bail — partial results are still useful
          fetchError = result.reason instanceof Error ? result.reason.message : String(result.reason);
        }
      }

      if (isMounted.current) {
        setSessions(prev => sessionsChanged(prev, merged) ? merged : prev);
        // Only surface an error when ALL connections failed
        if (merged.length === 0 && fetchError) {
          setError(fetchError);
        } else {
          setError(undefined);
        }
      }
    } catch (err) {
      if (isMounted.current) {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (isMounted.current) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    isMounted.current = true;
    fetchSessions();

    const interval = setInterval(fetchSessions, pollIntervalMs);
    return () => {
      isMounted.current = false;
      clearInterval(interval);
    };
  }, [fetchSessions, pollIntervalMs]);

  return { sessions, isLoading, error, refetch: fetchSessions };
}
