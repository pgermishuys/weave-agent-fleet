"use client";

import { useState, useEffect, useCallback } from "react";
import type { DirectoryEntry, DirectoryListResponse } from "@/lib/api-types";
import { apiFetch } from "@/lib/api-client";

export interface UseDirectoryBrowserResult {
  /** The path currently being browsed (null = showing roots) */
  currentPath: string | null;
  /** Listed directory entries */
  entries: DirectoryEntry[];
  /** Whether a fetch is in progress */
  isLoading: boolean;
  /** Error message from the last fetch, if any */
  error: string | undefined;
  /** Allowed workspace roots */
  roots: string[];
  /** Parent path for "go up" navigation, or null if at root level */
  parentPath: string | null;
  /** Navigate into a directory (pass null to return to roots) */
  browse: (path: string | null) => void;
  /** Navigate to the parent directory */
  goUp: () => void;
  /** Re-fetch the current path */
  refresh: () => void;
  /** Current search filter text */
  search: string;
  /** Update the search filter (debounced internally) */
  setSearch: (s: string) => void;
}

/**
 * Client-side hook for browsing directories via GET /api/directories.
 * Follows the useFindFiles pattern: useState + useEffect, AbortController
 * for cancellation, debounced search.
 *
 * @param enabled - Whether to start fetching (e.g. when a popover is open)
 * @param connectionId - Optional connection id for multi-fleet support.
 *   When omitted, uses the local/default Fleet Server.
 */
export function useDirectoryBrowser(enabled = false, connectionId?: string): UseDirectoryBrowserResult {
  const [currentPath, setCurrentPath] = useState<string | null>(null);
  const [entries, setEntries] = useState<DirectoryEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [roots, setRoots] = useState<string[]>([]);
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [fetchTrigger, setFetchTrigger] = useState(0);
  // Track whether the user has explicitly browsed at least once
  const [hasActivated, setHasActivated] = useState(false);

  // Fetch directory listing when enabled and active
  useEffect(() => {
    if (!enabled && !hasActivated) return;
    let cancelled = false;
    let controller: AbortController | null = null;

    const timer = setTimeout(
      () => {
        controller = new AbortController();
        setIsLoading(true);
        setError(undefined);

        const params = new URLSearchParams();
        if (currentPath !== null) {
          params.set("path", currentPath);
        }
        const trimmedSearch = search.trim();
        if (trimmedSearch) {
          params.set("search", trimmedSearch);
        }

        const url = `/api/directories${params.toString() ? `?${params.toString()}` : ""}`;

        apiFetch(url, { signal: controller.signal }, connectionId)
          .then(async (response) => {
            if (!response.ok) {
              const data = await response.json().catch(() => ({}));
              const message =
                (data as { error?: string }).error ?? `HTTP ${response.status}`;
              throw new Error(message);
            }
            return response.json() as Promise<DirectoryListResponse>;
          })
          .then((data) => {
            if (!cancelled) {
              setEntries(data.entries);
              setRoots(data.roots);
              setParentPath(data.parentPath);
            }
          })
          .catch((err: unknown) => {
            if (
              !cancelled &&
              !(err instanceof DOMException && err.name === "AbortError")
            ) {
              setError(
                err instanceof Error ? err.message : "Failed to browse directories"
              );
            }
          })
          .finally(() => {
            if (!cancelled) setIsLoading(false);
          });
      },
      search.trim() ? 200 : 0 // Debounce search, but navigate immediately
    );

    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller?.abort();
    };
  }, [currentPath, search, fetchTrigger, enabled, hasActivated, connectionId]);

  const browse = useCallback((path: string | null) => {
    setHasActivated(true);
    setCurrentPath(path);
    setSearch("");
  }, []);

  const goUp = useCallback(() => {
    setCurrentPath(parentPath);
    setSearch("");
  }, [parentPath]);

  const refresh = useCallback(() => {
    setFetchTrigger((n) => n + 1);
  }, []);

  return {
    currentPath,
    entries,
    isLoading,
    error,
    roots,
    parentPath,
    browse,
    goUp,
    refresh,
    search,
    setSearch,
  };
}
