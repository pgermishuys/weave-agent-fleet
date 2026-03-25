"use client";

import { useEffect, useState } from "react";
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

  useEffect(() => {
    if (path === null) {
      setInfo(null);
      setIsLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    setError(null);
    setInfo(null);

    apiFetch(`/api/repositories/info?path=${encodeURIComponent(path)}`)
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) {
          const data: { error?: string } = await res.json().catch(() => ({}));
          throw new Error(data.error ?? "Failed to load repository info");
        }
        const data: RepositoryInfoResponse = await res.json();
        if (!cancelled) setInfo(data.repository);
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

  return { info, isLoading, error };
}
