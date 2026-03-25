"use client";

import { useEffect, useState } from "react";
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

  useEffect(() => {
    if (path === null) {
      setDetail(null);
      setIsLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    setError(null);
    setDetail(null);

    apiFetch(`/api/repositories/detail?path=${encodeURIComponent(path)}`)
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) {
          const data: { error?: string } = await res.json().catch(() => ({}));
          throw new Error(data.error ?? "Failed to load repository detail");
        }
        const data: RepositoryDetailResponse = await res.json();
        if (!cancelled) setDetail(data.repository);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Unknown error");
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [path]);

  return { detail, isLoading, error };
}
