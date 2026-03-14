"use client";

import { useState, useEffect } from "react";
import { apiFetch } from "@/lib/api-client";

export interface FleetIdentity {
  name: string;
  version: string;
  description: string;
  capabilities: string[];
}

export interface UseFleetIdentityResult {
  identity: FleetIdentity | null;
  isLoading: boolean;
  error: string | undefined;
}

/**
 * Fetches GET /api/fleet/identity for the given connection.
 * Re-fetches when `connectionId` changes.
 */
export function useFleetIdentity(connectionId: string): UseFleetIdentityResult {
  const [identity, setIdentity] = useState<FleetIdentity | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    setIsLoading(true);
    setError(undefined);
    setIdentity(null);

    apiFetch("/api/fleet/identity", { signal: controller.signal }, connectionId)
      .then(async (response) => {
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          const message =
            (data as { error?: string }).error ?? `HTTP ${response.status}`;
          throw new Error(message);
        }
        return response.json() as Promise<FleetIdentity>;
      })
      .then((data) => {
        if (!cancelled) {
          setIdentity(data);
        }
      })
      .catch((err: unknown) => {
        if (
          !cancelled &&
          !(err instanceof DOMException && err.name === "AbortError")
        ) {
          setError(
            err instanceof Error ? err.message : "Failed to fetch fleet identity"
          );
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [connectionId]);

  return { identity, isLoading, error };
}
