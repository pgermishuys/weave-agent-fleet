"use client";

import { useEffect, useState, useCallback } from "react";
import { apiFetch } from "@/lib/api-client";
import type { RepositoryDetail, RepositoryDetailResponse } from "@/lib/api-types";

interface UseRepositoryDetailResult {
  detail: RepositoryDetail | null;
  isLoading: boolean;
  error: string | null;
}

export function useRepositoryDetail(path: string | null): UseRepositoryDetailResult {
  const [detail, setDetail] = useState<RepositoryDetail | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchDetail = useCallback(async (repoPath: string, signal: AbortSignal) => {
    setIsLoading(true);
    setError(null);
    setDetail(null);

    try {
      const res = await apiFetch(
        `/api/repositories/detail?path=${encodeURIComponent(repoPath)}`,
        { signal }
      );
      if (signal.aborted) return;
      if (!res.ok) {
        const data: { error?: string } = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to load repository detail");
      }
      const data: RepositoryDetailResponse = await res.json();
      if (!signal.aborted) setDetail(data.repository);
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
    void fetchDetail(path, controller.signal);

    return () => {
      controller.abort();
    };
  }, [path, fetchDetail]);

  // When path becomes null, return defaults (no setState needed — values reset on next non-null path)
  if (path === null) {
    return { detail: null, isLoading: false, error: null };
  }

  return { detail, isLoading, error };
}
