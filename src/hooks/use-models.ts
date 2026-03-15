"use client";

import { useState, useEffect } from "react";
import type { AvailableProvider } from "@/lib/api-types";
import { apiFetch } from "@/lib/api-client";

export interface UseModelsResult {
  providers: AvailableProvider[];
  isLoading: boolean;
  error?: string;
}

/**
 * Fetches connected providers and their models for an OpenCode instance.
 * Fetches once on mount; re-fetches if instanceId changes.
 */
export function useModels(instanceId: string, connectionId?: string): UseModelsResult {
  const [providers, setProviders] = useState<AvailableProvider[]>([]);
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

    async function fetchModels() {
      try {
        const response = await apiFetch(
          `/api/instances/${encodeURIComponent(instanceId)}/models`,
          { signal: controller.signal },
          connectionId
        );
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          const message = (data as { error?: string }).error ?? `HTTP ${response.status}`;
          throw new Error(message);
        }
        const data = (await response.json()) as AvailableProvider[];
        if (!cancelled) {
          setProviders(data);
          setError(undefined);
        }
      } catch (err: unknown) {
        if (!cancelled && !(err instanceof DOMException && err.name === "AbortError")) {
          setError(err instanceof Error ? err.message : "Failed to load models");
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void fetchModels();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [instanceId, connectionId]);

  return { providers, isLoading, error };
}
