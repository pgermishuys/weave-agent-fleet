"use client";

import { useEffect, useState, useCallback } from "react";
import { apiFetch } from "@/lib/api-client";
import type { RepositoryInfo, RepositoryInfoResponse } from "@/lib/api-types";

interface UseRepositoryInfoResult {
  info: RepositoryInfo | null;
  isLoading: boolean;
  error: string | null;
}

export function useRepositoryInfo(path: string | null): UseRepositoryInfoResult {
  const [info, setInfo] = useState<RepositoryInfo | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchInfo = useCallback(async (repoPath: string, signal: AbortSignal) => {
    setIsLoading(true);
    setError(null);
    setInfo(null);

    try {
      const res = await apiFetch(
        `/api/repositories/info?path=${encodeURIComponent(repoPath)}`,
        { signal }
      );
      if (signal.aborted) return;
      if (!res.ok) {
        const data: { error?: string } = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to load repository info");
      }
      const data: RepositoryInfoResponse = await res.json();
      if (!signal.aborted) setInfo(data.repository);
    } catch (err: unknown) {
      if (signal.aborted) return;
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      if (!signal.aborted) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (path === null) return;

    const controller = new AbortController();
    void fetchInfo(path, controller.signal);

    return () => {
      controller.abort();
    };
  }, [path, fetchInfo]);

  // When path is null, return defaults without triggering setState
  if (path === null) {
    return { info: null, isLoading: false, error: null };
  }

  return { info, isLoading, error };
}
