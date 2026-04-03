"use client";

import { useCallback, useSyncExternalStore } from "react";
import { apiFetch } from "@/lib/api-client";
import type { GoogleChatSpace } from "../types";

const PAGE_SIZE = 100;
const SESSION_CACHE_MAX_AGE_MS = 15 * 60 * 1000;

interface SpacesCacheState {
  spaces: GoogleChatSpace[];
  isLoading: boolean;
  error: string | null;
  lastUpdated: number | null;
}

let state: SpacesCacheState = {
  spaces: [],
  isLoading: false,
  error: null,
  lastUpdated: null,
};

let inFlightFetch: Promise<void> | null = null;
let cacheGeneration = 0;

const listeners = new Set<() => void>();

function emitChange() {
  for (const listener of listeners) {
    listener();
  }
}

function setState(patch: Partial<SpacesCacheState>) {
  state = { ...state, ...patch };
  emitChange();
}

function subscribe(callback: () => void) {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

function getSnapshot() {
  return state;
}

interface ListSpacesResponse {
  spaces?: GoogleChatSpace[];
  nextPageToken?: string;
}

export interface UseGoogleChatSpacesResult {
  spaces: GoogleChatSpace[];
  isLoading: boolean;
  error: string | null;
  lastUpdated: number | null;
  isStale: boolean;
  refresh: () => void;
  clear: () => void;
}

export function useGoogleChatSpaces(): UseGoogleChatSpacesResult {
  const cache = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const fetchAll = useCallback(async () => {
    if (inFlightFetch) {
      await inFlightFetch;
      return;
    }

    const generation = cacheGeneration;

    inFlightFetch = (async () => {
      setState({ isLoading: true, error: null });

      try {
        const all: GoogleChatSpace[] = [];
        let pageToken: string | undefined;

        do {
          const url = new URL(
            "/api/integrations/google-chat/spaces",
            typeof window !== "undefined" ? window.location.origin : "http://localhost"
          );
          url.searchParams.set("pageSize", String(PAGE_SIZE));
          if (pageToken) {
            url.searchParams.set("pageToken", pageToken);
          }

          const res = await apiFetch(url.pathname + url.search);
          if (!res.ok) {
            throw new Error("Failed to fetch spaces");
          }

          const data: ListSpacesResponse = await res.json();
          if (data.spaces) {
            all.push(...data.spaces);
          }
          pageToken = data.nextPageToken;
        } while (pageToken);

        if (generation !== cacheGeneration) return;

        setState({
          spaces: all,
          lastUpdated: Date.now(),
          isLoading: false,
          error: null,
        });
      } catch (err: unknown) {
        if (generation !== cacheGeneration) return;
        setState({
          isLoading: false,
          error: err instanceof Error ? err.message : "Failed to load spaces",
        });
      } finally {
        inFlightFetch = null;
      }
    })();

    await inFlightFetch;
  }, []);

  const isStale =
    cache.lastUpdated === null ||
    Date.now() - cache.lastUpdated > SESSION_CACHE_MAX_AGE_MS;

  const refresh = useCallback(() => {
    void fetchAll();
  }, [fetchAll]);

  const clear = useCallback(() => {
    cacheGeneration += 1;
    inFlightFetch = null;
    setState({ spaces: [], isLoading: false, error: null, lastUpdated: null });
  }, []);

  return {
    spaces: cache.spaces,
    isLoading: cache.isLoading,
    error: cache.error,
    lastUpdated: cache.lastUpdated,
    isStale,
    refresh,
    clear,
  };
}
