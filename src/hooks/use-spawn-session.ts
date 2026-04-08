"use client";

import { useCallback, useState } from "react";
import type { CreateSessionResponse } from "@/lib/api-types";
import { apiFetch } from "@/lib/api-client";

export interface SpawnSessionOptions {
  /** The source repo or workspace directory to create the worktree from. */
  directory: string;
  /** Human-readable session title. */
  title: string;
  /** Branch name for the new worktree (e.g. "weave/refactor-auth"). */
  branch: string;
  /** The structured initial prompt for the spawned session. */
  initialPrompt: string;
}

export interface UseSpawnSessionResult {
  spawnSession: (opts: SpawnSessionOptions) => Promise<CreateSessionResponse>;
  isSpawning: boolean;
  error: string | undefined;
  clearError: () => void;
}

/**
 * A thin hook that wraps `POST /api/sessions` specifically for the
 * "spawn session from selection" flow.
 *
 * Always uses `isolationStrategy: "worktree"` — each spawned session gets its
 * own git worktree branch.  There is no parent-child relationship; the spawned
 * session is fully independent.
 */
export function useSpawnSession(): UseSpawnSessionResult {
  const [isSpawning, setIsSpawning] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const spawnSession = useCallback(async (opts: SpawnSessionOptions): Promise<CreateSessionResponse> => {
    setIsSpawning(true);
    setError(undefined);

    try {
      const response = await apiFetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          directory: opts.directory,
          title: opts.title,
          isolationStrategy: "worktree",
          branch: opts.branch,
          initialPrompt: opts.initialPrompt,
        }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        const message = (body as { error?: string }).error ?? `HTTP ${response.status}`;
        throw new Error(message);
      }

      return (await response.json()) as CreateSessionResponse;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to spawn session";
      setError(message);
      throw err;
    } finally {
      setIsSpawning(false);
    }
  }, []);

  const clearError = useCallback(() => setError(undefined), []);

  return { spawnSession, isSpawning, error, clearError };
}
