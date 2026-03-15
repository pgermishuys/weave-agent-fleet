"use client";

import { useCallback, useState } from "react";
import type { ForkSessionRequest, ForkSessionResponse } from "@/lib/api-types";
import { apiFetch } from "@/lib/api-client";

export interface UseForkSessionResult {
  forkSession: (sessionId: string, opts?: ForkSessionRequest, connectionId?: string) => Promise<ForkSessionResponse>;
  clearError: () => void;
  isForking: boolean;
  forkingSessionId: string | null;
  error?: string;
}

export function useForkSession(): UseForkSessionResult {
  const [forkingSessionId, setForkingSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | undefined>(undefined);

  const isForking = forkingSessionId !== null;

  const forkSession = useCallback(
    async (sessionId: string, opts?: ForkSessionRequest, connectionId?: string): Promise<ForkSessionResponse> => {
      setForkingSessionId(sessionId);
      setError(undefined);

      try {
        const response = await apiFetch(
          `/api/sessions/${encodeURIComponent(sessionId)}/fork`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(opts ?? {}),
          },
          connectionId
        );

        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          const message =
            (body as { error?: string }).error ?? `HTTP ${response.status}`;
          throw new Error(message);
        }

        return (await response.json()) as ForkSessionResponse;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to fork session";
        setError(message);
        throw err;
      } finally {
        setForkingSessionId(null);
      }
    },
    []
  );

  const clearError = useCallback(() => setError(undefined), []);

  return { forkSession, clearError, isForking, forkingSessionId, error };
}
