"use client";

import { useCallback, useState } from "react";
import { apiFetch } from "@/lib/api-client";

export interface UseAbortSessionResult {
  abortSession: (
    sessionId: string,
    instanceId: string,
    connectionId?: string
  ) => Promise<void>;
  isAborting: boolean;
  error?: string;
}

export function useAbortSession(): UseAbortSessionResult {
  const [isAborting, setIsAborting] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const abortSession = useCallback(async (
    sessionId: string,
    instanceId: string,
    connectionId?: string
  ): Promise<void> => {
    setIsAborting(true);
    setError(undefined);

    try {
      const params = new URLSearchParams({ instanceId });

      const response = await apiFetch(
        `/api/sessions/${encodeURIComponent(sessionId)}/abort?${params.toString()}`,
        { method: "POST" },
        connectionId
      );

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(
          (body as { error?: string }).error ?? `HTTP ${response.status}`
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to abort session";
      setError(message);
      throw err;
    } finally {
      setIsAborting(false);
    }
  }, []);

  return { abortSession, isAborting, error };
}
