"use client";

import { useState, useEffect, useCallback } from "react";
import { apiFetch } from "@/lib/api-client";
import { removePersistedKey } from "@/hooks/use-persisted-state";
import type { BookmarkedRepo } from "@/integrations/github/types";
import { GITHUB_BOOKMARKED_REPOS_KEY } from "@/integrations/github/storage";

// ─── Pure utility ─────────────────────────────────────────────────────────────

const BOOKMARKS_API = "/api/integrations/github/bookmarks";

export function sortByName(repos: BookmarkedRepo[]): BookmarkedRepo[] {
  return repos.toSorted((a, b) => a.fullName.localeCompare(b.fullName));
}

// ─── Cross-instance notification ──────────────────────────────────────────────

/**
 * Singleton event target shared by all useBookmarkedRepos instances.
 * When any instance mutates bookmarks, it broadcasts the latest data
 * so every other mounted instance updates without re-fetching.
 */
const bookmarksBus = new EventTarget();

function broadcastBookmarksUpdate(repos: BookmarkedRepo[]) {
  bookmarksBus.dispatchEvent(
    new CustomEvent("bookmarks-updated", { detail: repos })
  );
}

function broadcastBookmarksError(message: string) {
  bookmarksBus.dispatchEvent(
    new CustomEvent("bookmarks-error", { detail: message })
  );
}

// ─── Server sync ──────────────────────────────────────────────────────────────

async function syncToServer(repos: BookmarkedRepo[]): Promise<void> {
  try {
    const res = await apiFetch(BOOKMARKS_API, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bookmarks: repos }),
    });
    if (!res.ok) {
      const data: { error?: string } = await res.json().catch(() => ({}));
      const msg = data.error ?? "Failed to sync bookmarks";
      broadcastBookmarksError(msg);
      return;
    }
    broadcastBookmarksUpdate(repos);
  } catch (err) {
    console.error("[useBookmarkedRepos] Failed to sync bookmarks to server", err);
    broadcastBookmarksError("Failed to sync bookmarks to server");
  }
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

interface UseBookmarkedReposResult {
  repos: BookmarkedRepo[];
  error: string | null;
  addRepo: (repo: BookmarkedRepo) => void;
  removeRepo: (fullName: string) => void;
  hasRepo: (fullName: string) => boolean;
}

export function useBookmarkedRepos(): UseBookmarkedReposResult {
  const [repos, setRepos] = useState<BookmarkedRepo[]>([]);
  const [error, setError] = useState<string | null>(null);

  const applyData = useCallback((incoming: BookmarkedRepo[]) => {
    setRepos(sortByName(incoming));
    setError(null);
  }, []);

  // Initial load with localStorage migration
  useEffect(() => {
    async function loadAndMigrate() {
      // 1. Fetch server bookmarks
      let serverRepos: BookmarkedRepo[] = [];
      let fetchFailed = false;
      try {
        const res = await apiFetch(BOOKMARKS_API);
        if (res.ok) {
          serverRepos = (await res.json()) as BookmarkedRepo[];
        }
      } catch (err) {
        fetchFailed = true;
        const msg = "Failed to fetch bookmarks from server";
        console.error("[useBookmarkedRepos]", msg, err);
        setError(msg);
        broadcastBookmarksError(msg);
        return;
      }

      // 2. Check for localStorage migration
      let finalRepos = serverRepos;
      try {
        const localRaw = localStorage.getItem(GITHUB_BOOKMARKED_REPOS_KEY);
        if (localRaw) {
          const localRepos = JSON.parse(localRaw) as BookmarkedRepo[];
          if (localRepos.length > 0) {
            // Merge: start with server list, add any local entries not already present
            const merged = [...serverRepos];
            for (const localRepo of localRepos) {
              if (!merged.some((r) => r.fullName === localRepo.fullName)) {
                merged.push(localRepo);
              }
            }
            // If merged is different from server, push to server
            if (merged.length !== serverRepos.length) {
              await syncToServer(merged);
            }
            finalRepos = merged;
          }
          // Clear localStorage regardless (migration complete or server already up-to-date)
          removePersistedKey(GITHUB_BOOKMARKED_REPOS_KEY);
        }
      } catch {
        // localStorage unavailable or parse error — skip migration
      }

      if (!fetchFailed) {
        const sorted = sortByName(finalRepos);
        setRepos(sorted);
        broadcastBookmarksUpdate(sorted);
      }
    }

    void loadAndMigrate();
  }, []);

  // Listen for broadcasts from other instances
  useEffect(() => {
    const handleUpdate = (e: Event) => {
      const data = (e as CustomEvent<BookmarkedRepo[]>).detail;
      applyData(data);
    };
    const handleError = (e: Event) => {
      const msg = (e as CustomEvent<string>).detail;
      setError(msg);
    };
    bookmarksBus.addEventListener("bookmarks-updated", handleUpdate);
    bookmarksBus.addEventListener("bookmarks-error", handleError);
    return () => {
      bookmarksBus.removeEventListener("bookmarks-updated", handleUpdate);
      bookmarksBus.removeEventListener("bookmarks-error", handleError);
    };
  }, [applyData]);

  const addRepo = useCallback((repo: BookmarkedRepo) => {
    setRepos((prev) => {
      if (prev.some((r) => r.fullName === repo.fullName)) return prev;
      const next = sortByName([...prev, repo]);
      setError(null);
      broadcastBookmarksUpdate(next);
      void syncToServer(next);
      return next;
    });
  }, []);

  const removeRepo = useCallback((fullName: string) => {
    setRepos((prev) => {
      const next = prev.filter((r) => r.fullName !== fullName);
      setError(null);
      broadcastBookmarksUpdate(next);
      void syncToServer(next);
      return next;
    });
  }, []);

  const hasRepo = useCallback(
    (fullName: string) => repos.some((r) => r.fullName === fullName),
    [repos]
  );

  return { repos, error, addRepo, removeRepo, hasRepo };
}
