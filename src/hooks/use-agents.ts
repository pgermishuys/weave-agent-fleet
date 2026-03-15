"use client";

import { useState, useEffect } from "react";
import type { AutocompleteAgent } from "@/lib/api-types";
import { apiFetch } from "@/lib/api-client";

export interface UseAgentsResult {
  agents: AutocompleteAgent[];
  isLoading: boolean;
  error?: string;
}

/**
 * Fetches the list of available agents for an OpenCode instance.
 * Fetches once on mount (agents are static for a session lifetime).
 * Re-fetches if instanceId changes.
 */
export function useAgents(instanceId: string, connectionId?: string): UseAgentsResult {
  const [agents, setAgents] = useState<AutocompleteAgent[]>([]);
  const [isLoading, setIsLoading] = useState(!!instanceId);
  const [error, setError] = useState<string | undefined>();
  const [prevInstanceId, setPrevInstanceId] = useState(instanceId);

  // Reset loading state when instanceId changes (derived state pattern)
  if (instanceId !== prevInstanceId) {
    setPrevInstanceId(instanceId);
    if (instanceId) {
      setIsLoading(true);
      setError(undefined);
    }
  }

  useEffect(() => {
    if (!instanceId) return;

    let cancelled = false;
    const controller = new AbortController();

    async function fetchAgents() {
      try {
        const response = await apiFetch(
          `/api/instances/${encodeURIComponent(instanceId)}/agents`,
          { signal: controller.signal },
          connectionId
        );
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          const message = (data as { error?: string }).error ?? `HTTP ${response.status}`;
          throw new Error(message);
        }
        const data = (await response.json()) as AutocompleteAgent[];
        if (!cancelled) {
          setAgents(data);
          setError(undefined);
        }
      } catch (err: unknown) {
        if (!cancelled && !(err instanceof DOMException && err.name === "AbortError")) {
          setError(err instanceof Error ? err.message : "Failed to load agents");
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void fetchAgents();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [instanceId, connectionId]);

  return { agents, isLoading, error };
}
