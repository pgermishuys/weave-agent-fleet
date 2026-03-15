"use client";

import { useCallback, useState } from "react";
import type { ResumeSessionResponse } from "@/lib/api-types";
import { apiFetch } from "@/lib/api-client";

export interface UseResumeSessionResult {
  resumeSession: (sessionId: string, connectionId?: string) => Promise<ResumeSessionResponse>;
  isResuming: boolean;
  resumingSessionId: string | null;
  error?: string;
}

export function useResumeSession(): UseResumeSessionResult {
  const [resumingSessionId, setResumingSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | undefined>(undefined);

  const isResuming = resumingSessionId !== null;

  const resumeSession = useCallback(async (sessionId: string, connectionId?: string): Promise<ResumeSessionResponse> => {
    setResumingSessionId(sessionId);
    setError(undefined);

    try {
      const response = await apiFetch(
        `/api/sessions/${encodeURIComponent(sessionId)}/resume`,
        { method: "POST" },
        connectionId
      );

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        const message =
          response.status === 409
            ? "Session is already active"
            : ((body as { error?: string }).error ?? `HTTP ${response.status}`);
        throw new Error(message);
      }

      return (await response.json()) as ResumeSessionResponse;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to resume session";
      setError(message);
      throw err;
    } finally {
      setResumingSessionId(null);
    }
  }, []);

  return { resumeSession, isResuming, resumingSessionId, error };
}
