"use client";

import { useCallback, useRef, useState } from "react";
import type { AccumulatedMessage } from "@/lib/api-types";
import { convertSDKMessageToAccumulated } from "@/lib/pagination-utils";
import type { SDKMessage } from "@/lib/pagination-utils";
import { apiFetch } from "@/lib/api-client";
import type { PaginationSnapshot } from "@/lib/session-cache";

// ─── Types ──────────────────────────────────────────────────────────────────

// Re-export PaginationSnapshot so consumers can import it from this module.
export type { PaginationSnapshot } from "@/lib/session-cache";

export interface PaginationState {
  hasMore: boolean;
  isLoadingOlder: boolean;
  oldestMessageId: string | null;
  totalCount: number | null;
  /** Error message from the last failed fetch (cleared on next successful fetch). */
  loadError: string | null;
}

export interface UseMessagePaginationReturn extends PaginationState {
  /**
   * Load the initial (most recent) batch of messages.
   * Returns the converted AccumulatedMessage[] for the caller to set into state.
   */
  loadInitialMessages: (
    sessionId: string,
    instanceId: string,
  ) => Promise<AccumulatedMessage[]>;
  /**
   * Load the next older batch of messages.
   * Returns the converted AccumulatedMessage[] for the caller to prepend.
   * No-op if !hasMore or isLoadingOlder.
   */
  loadOlderMessages: (
    sessionId: string,
    instanceId: string,
  ) => Promise<AccumulatedMessage[]>;
  /** Reset pagination state (e.g. on full reconnect recovery). */
  resetPagination: () => void;
  /** Returns a snapshot of the current pagination state for cache storage. */
  snapshotPagination: () => PaginationSnapshot;
  /** Restores pagination state from a previously captured snapshot. */
  hydratePagination: (snapshot: PaginationSnapshot) => void;
}

const DEFAULT_PAGE_SIZE = 50;
const MIN_FETCH_INTERVAL_MS = 500;

// ─── Hook ───────────────────────────────────────────────────────────────────

export function useMessagePagination(): UseMessagePaginationReturn {
  const [hasMore, setHasMore] = useState(false);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [oldestMessageId, setOldestMessageId] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const lastFetchTime = useRef(0);

  const loadInitialMessages = useCallback(
    async (
      sessionId: string,
      instanceId: string,
    ): Promise<AccumulatedMessage[]> => {
      try {
        const url = `/api/sessions/${encodeURIComponent(sessionId)}/messages?instanceId=${encodeURIComponent(instanceId)}&limit=${DEFAULT_PAGE_SIZE}`;
        const response = await apiFetch(url);
        if (!response.ok) {
          setLoadError("Failed to load initial messages");
          return [];
        }

        const data = (await response.json()) as {
          messages: SDKMessage[];
          pagination: {
            hasMore: boolean;
            oldestMessageId: string | null;
            totalCount: number;
          };
        };

        setHasMore(data.pagination.hasMore);
        setOldestMessageId(data.pagination.oldestMessageId);
        setTotalCount(data.pagination.totalCount);
        setLoadError(null);

        return data.messages.map(convertSDKMessageToAccumulated);
      } catch {
        return [];
      }
    },
    [],
  );

  const loadOlderMessages = useCallback(
    async (
      sessionId: string,
      instanceId: string,
    ): Promise<AccumulatedMessage[]> => {
      // Guards: no more messages, already loading, or too soon after last fetch
      if (!hasMore || isLoadingOlder) return [];

      const now = Date.now();
      if (now - lastFetchTime.current < MIN_FETCH_INTERVAL_MS) return [];

      setIsLoadingOlder(true);
      lastFetchTime.current = now;

      try {
        const params = new URLSearchParams({
          instanceId,
          limit: String(DEFAULT_PAGE_SIZE),
        });
        if (oldestMessageId) {
          params.set("before", oldestMessageId);
        }

        const url = `/api/sessions/${encodeURIComponent(sessionId)}/messages?${params.toString()}`;
        const response = await apiFetch(url);
        if (!response.ok) {
          // Don't change hasMore on error — allow retry
          setLoadError("Failed to load older messages");
          return [];
        }

        const data = (await response.json()) as {
          messages: SDKMessage[];
          pagination: {
            hasMore: boolean;
            oldestMessageId: string | null;
            totalCount: number;
          };
        };

        setHasMore(data.pagination.hasMore);
        setOldestMessageId(data.pagination.oldestMessageId);
        setTotalCount(data.pagination.totalCount);
        setLoadError(null);

        return data.messages.map(convertSDKMessageToAccumulated);
      } catch {
        // Don't change hasMore on error — allow retry
        setLoadError("Failed to load older messages");
        return [];
      } finally {
        setIsLoadingOlder(false);
      }
    },
    [hasMore, isLoadingOlder, oldestMessageId],
  );

  const resetPagination = useCallback(() => {
    setHasMore(false);
    setIsLoadingOlder(false);
    setOldestMessageId(null);
    setTotalCount(null);
    setLoadError(null);
    lastFetchTime.current = 0;
  }, []);

  const snapshotPagination = useCallback((): PaginationSnapshot => {
    return { hasMore, oldestMessageId, totalCount };
  }, [hasMore, oldestMessageId, totalCount]);

  const hydratePagination = useCallback((snapshot: PaginationSnapshot): void => {
    setHasMore(snapshot.hasMore);
    setOldestMessageId(snapshot.oldestMessageId);
    setTotalCount(snapshot.totalCount);
    // Clear any stale error state from a previous session view.
    setLoadError(null);
  }, []);

  return {
    hasMore,
    isLoadingOlder,
    oldestMessageId,
    totalCount,
    loadError,
    loadInitialMessages,
    loadOlderMessages,
    resetPagination,
    snapshotPagination,
    hydratePagination,
  };
}
