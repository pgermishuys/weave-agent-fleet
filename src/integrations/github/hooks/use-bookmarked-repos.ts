"use client";

import { useState, useEffect, useCallback } from "react";
import { removePersistedKey } from "@/hooks/use-persisted-state";
import type { BookmarkedRepo } from "@/integrations/github/types";
import { GITHUB_BOOKMARKED_REPOS_KEY } from "@/integrations/github/storage";

const BOOKMARKS_API = "/api/integrations/github/bookmarks";

interface UseBookmarkedReposResult {
  repos: BookmarkedRepo[];
  addRepo: (repo: BookmarkedRepo) => void;
  removeRepo: (fullName: string) => void;
  hasRepo: (fullName: string) => boolean;
}

function sortByName(repos: BookmarkedRepo[]): BookmarkedRepo[] {
  return repos.toSorted((a, b) => a.fullName.localeCompare(b.fullName));
}

async function syncToServer(repos: BookmarkedRepo[]): Promise<void> {
  try {
    await fetch(BOOKMARKS_API, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bookmarks: repos }),
    });
  } catch (err) {
    console.error("[useBookmarkedRepos] Failed to sync bookmarks to server", err);
  }
}

export function useBookmarkedRepos(): UseBookmarkedReposResult {
  const [repos, setRepos] = useState<BookmarkedRepo[]>([]);

  useEffect(() => {
    async function loadAndMigrate() {
      // 1. Fetch server bookmarks
      let serverRepos: BookmarkedRepo[] = [];
      try {
        const res = await fetch(BOOKMARKS_API);
        if (res.ok) {
          serverRepos = (await res.json()) as BookmarkedRepo[];
        }
      } catch (err) {
        console.error("[useBookmarkedRepos] Failed to fetch bookmarks from server", err);
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

      setRepos(sortByName(finalRepos));
    }

    void loadAndMigrate();
  }, []);

  const addRepo = useCallback((repo: BookmarkedRepo) => {
    setRepos((prev) => {
      if (prev.some((r) => r.fullName === repo.fullName)) return prev;
      const next = sortByName([...prev, repo]);
      void syncToServer(next);
      return next;
    });
  }, []);

  const removeRepo = useCallback((fullName: string) => {
    setRepos((prev) => {
      const next = prev.filter((r) => r.fullName !== fullName);
      void syncToServer(next);
      return next;
    });
  }, []);

  const hasRepo = useCallback(
    (fullName: string) => repos.some((r) => r.fullName === fullName),
    [repos]
  );

  return { repos, addRepo, removeRepo, hasRepo };
}
