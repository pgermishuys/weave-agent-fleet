"use client";

import { useState, useCallback } from "react";
import type { CreateSessionRequest, CreateSessionResponse } from "@/lib/api-types";
import { apiFetch } from "@/lib/api-client";

export interface CreateSessionOptions {
  title?: string;
  isolationStrategy?: "existing" | "worktree" | "clone";
  branch?: string;
}

export interface UseCreateSessionResult {
  createSession: (
    directory: string,
    opts?: CreateSessionOptions,
    connectionId?: string
  ) => Promise<CreateSessionResponse>;
  isLoading: boolean;
  error?: string;
}

export function useCreateSession(): UseCreateSessionResult {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const createSession = useCallback(
    async (directory: string, opts?: CreateSessionOptions, connectionId?: string): Promise<CreateSessionResponse> => {
      setIsLoading(true);
      setError(undefined);
      try {
        const body: CreateSessionRequest = {
          directory,
          title: opts?.title,
          isolationStrategy: opts?.isolationStrategy,
          branch: opts?.branch,
        };

        const response = await apiFetch("/api/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }, connectionId);

        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          const message = (data as { error?: string }).error ?? `HTTP ${response.status}`;
          setError(message);
          throw new Error(message);
        }

        return (await response.json()) as CreateSessionResponse;
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  return { createSession, isLoading, error };
}
