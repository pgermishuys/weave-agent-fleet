"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/api-client";

export interface UseDeleteSessionResult {
  deleteSession: (sessionId: string, instanceId: string, connectionId?: string) => Promise<void>;
  isDeleting: boolean;
  error?: string;
}

export function useDeleteSession(): UseDeleteSessionResult {
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const deleteSession = async (
    sessionId: string,
    instanceId: string,
    connectionId?: string
  ): Promise<void> => {
    setIsDeleting(true);
    setError(undefined);

    try {
      const params = new URLSearchParams({ instanceId, permanent: "true" });

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
      const message = err instanceof Error ? err.message : "Failed to delete session";
      setError(message);
      throw err;
    } finally {
      setIsDeleting(false);
    }
  };

  return { deleteSession, isDeleting, error };
}
