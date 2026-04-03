"use client";

import { useState, useEffect, useCallback } from "react";
import { apiFetch } from "@/lib/api-client";
import type { GoogleChatMessage } from "../types";

const PAGE_SIZE = 50;

interface ListMessagesResponse {
  messages?: GoogleChatMessage[];
  nextPageToken?: string;
}

export interface UseGoogleChatMessagesResult {
  messages: GoogleChatMessage[];
  isLoading: boolean;
  error: string | null;
  hasMore: boolean;
  loadMore: () => void;
  refetch: () => void;
}

export function useGoogleChatMessages(
  spaceId: string | null
): UseGoogleChatMessagesResult {
  const [messages, setMessages] = useState<GoogleChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pageToken, setPageToken] = useState<string | undefined>(undefined);
  const [hasMore, setHasMore] = useState(false);
  const [fetchKey, setFetchKey] = useState(0);
  const [isLoadMore, setIsLoadMore] = useState(false);

  // Reset when spaceId changes
  useEffect(() => {
    setMessages([]);
    setPageToken(undefined);
    setHasMore(false);
    setError(null);
    setIsLoadMore(false);
  }, [spaceId]);

  // Main fetch effect
  useEffect(() => {
    if (!spaceId) return;

    let cancelled = false;

    const fetchMessages = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const url = new URL(
          `/api/integrations/google-chat/spaces/${spaceId}/messages`,
          typeof window !== "undefined" ? window.location.origin : "http://localhost"
        );
        url.searchParams.set("pageSize", String(PAGE_SIZE));
        url.searchParams.set("orderBy", "createTime desc");
        if (isLoadMore && pageToken) {
          url.searchParams.set("pageToken", pageToken);
        }

        const res = await apiFetch(url.pathname + url.search);
        if (!res.ok) {
          const errBody = await res.json().catch(() => ({}));
          throw new Error(
            (errBody as { error?: string }).error ?? "Failed to load messages"
          );
        }

        const data: ListMessagesResponse = await res.json();
        if (cancelled) return;

        const incoming = data.messages ?? [];
        if (isLoadMore) {
          setMessages((prev) => [...prev, ...incoming]);
        } else {
          setMessages(incoming);
        }

        setPageToken(data.nextPageToken);
        setHasMore(!!data.nextPageToken);
      } catch (err: unknown) {
        if (cancelled) return;
        setError(
          err instanceof Error ? err.message : "Failed to load messages"
        );
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    fetchMessages();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spaceId, fetchKey]);

  const loadMore = useCallback(() => {
    if (!isLoading && hasMore) {
      setIsLoadMore(true);
      setFetchKey((k) => k + 1);
    }
  }, [isLoading, hasMore]);

  const refetch = useCallback(() => {
    setMessages([]);
    setPageToken(undefined);
    setHasMore(false);
    setIsLoadMore(false);
    setFetchKey((k) => k + 1);
  }, []);

  return { messages, isLoading, error, hasMore, loadMore, refetch };
}
