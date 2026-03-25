"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import type { ScannedRepository, RepositoryScanResponse } from "@/lib/api-types";

// ─── Pure utility ─────────────────────────────────────────────────────────────

/**
 * Group a flat list of repositories by their parent root directory.
 * Repos within each group are sorted alphabetically by name.
 */
export function groupByRoot(repos: ScannedRepository[]): Map<string, ScannedRepository[]> {
  const map = new Map<string, ScannedRepository[]>();
  for (const repo of repos) {
    const group = map.get(repo.parentRoot) ?? [];
    group.push(repo);
    map.set(repo.parentRoot, group);
  }
  // Sort within each group
  for (const [key, group] of map) {
    map.set(key, [...group].sort((a, b) => a.name.localeCompare(b.name)));
  }
  return map;
}

// ─── Cross-instance notification ──────────────────────────────────────────────

/**
 * Singleton event target shared by all useRepositories instances.
 * When any instance completes a refresh, it broadcasts the latest data
 * so every other mounted instance updates without re-fetching.
 */
const reposBus = new EventTarget();

function broadcastReposUpdate(data: RepositoryScanResponse) {
  reposBus.dispatchEvent(
    new CustomEvent("repos-updated", { detail: data })
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

interface UseRepositoriesResult {
  repositories: ScannedRepository[];
  isLoading: boolean;
  error: string | null;
  scannedAt: number | null;
  refresh: () => Promise<void>;
}

export function useRepositories(): UseRepositoriesResult {
  const [repositories, setRepositories] = useState<ScannedRepository[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scannedAt, setScannedAt] = useState<number | null>(null);

  const applyData = useCallback((data: RepositoryScanResponse) => {
    setRepositories(data.repositories);
    setScannedAt(data.scannedAt);
  }, []);

  const loadRepositories = useCallback(async (endpoint: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await apiFetch(endpoint, {
        method: endpoint.includes("refresh") ? "POST" : "GET",
      });
      if (!res.ok) {
        const data: { error?: string } = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to load repositories");
      }
      const data: RepositoryScanResponse = await res.json();
      applyData(data);
      // Notify other mounted useRepositories instances
      broadcastReposUpdate(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setIsLoading(false);
    }
  }, [applyData]);

  // Initial load (cached)
  useEffect(() => {
    void loadRepositories("/api/repositories");
  }, [loadRepositories]);

  // Listen for broadcasts from other instances (e.g., Settings triggers refresh)
  useEffect(() => {
    const handler = (e: Event) => {
      const data = (e as CustomEvent<RepositoryScanResponse>).detail;
      applyData(data);
    };
    reposBus.addEventListener("repos-updated", handler);
    return () => reposBus.removeEventListener("repos-updated", handler);
  }, [applyData]);

  const refresh = useCallback(async () => {
    await loadRepositories("/api/repositories/refresh");
  }, [loadRepositories]);

  return { repositories, isLoading, error, scannedAt, refresh };
}
