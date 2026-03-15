"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/api-client";

export interface TerminateSessionOptions {
  cleanupWorkspace?: boolean;
}

export interface UseTerminateSessionResult {
  terminateSession: (
    sessionId: string,
    instanceId: string,
    opts?: TerminateSessionOptions,
    connectionId?: string
  ) => Promise<void>;
  isTerminating: boolean;
  error?: string;
}

export function useTerminateSession(): UseTerminateSessionResult {
  const [isTerminating, setIsTerminating] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const terminateSession = async (
    sessionId: string,
    instanceId: string,
    opts?: TerminateSessionOptions,
    connectionId?: string
  ): Promise<void> => {
    setIsTerminating(true);
    setError(undefined);

    try {
      const params = new URLSearchParams({ instanceId });
      if (opts?.cleanupWorkspace) {
        params.set("cleanupWorkspace", "true");
      }

      const response = await apiFetch(
        `/api/sessions/${encodeURIComponent(sessionId)}?${params.toString()}`,
        { method: "DELETE" },
        connectionId
      );

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(
          (body as { error?: string }).error ?? `HTTP ${response.status}`
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to terminate session";
      setError(message);
      throw err;
    } finally {
      setIsTerminating(false);
    }
  };

  return { terminateSession, isTerminating, error };
}
