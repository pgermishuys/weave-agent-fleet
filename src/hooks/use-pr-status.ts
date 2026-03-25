"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { PrReference } from "@/lib/pr-utils";
import type { PrStatusResponse } from "@/integrations/github/types";
import { apiFetch } from "@/lib/api-client";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface UsePrStatusResult {
  /** Keyed by PR URL */
  statuses: Map<string, PrStatusResponse>;
  isLoading: boolean;
  error?: string;
}

// ─── Constants ─────────────────────────────────────────────────────────────

const PR_POLL_INTERVAL_MS = 15_000;

// ─── Helpers ───────────────────────────────────────────────────────────────

/** PRs in terminal states (merged or closed) won't change — no need to keep polling them. */
function isTerminalState(status: PrStatusResponse): boolean {
  return status.merged || status.state === "closed";
}

/** Shallow equality check for two Maps keyed by PR URL. */
function mapsEqual(
  a: Map<string, PrStatusResponse>,
  b: Map<string, PrStatusResponse>
): boolean {
  if (a.size !== b.size) return false;
  for (const [url, aStatus] of a) {
    const bStatus = b.get(url);
    if (!bStatus) return false;
    if (
      aStatus.state !== bStatus.state ||
      aStatus.merged !== bStatus.merged ||
      aStatus.checksStatus !== bStatus.checksStatus ||
      aStatus.draft !== bStatus.draft ||
      aStatus.title !== bStatus.title
    ) {
      return false;
    }
  }
  return true;
}

// ─── Hook ──────────────────────────────────────────────────────────────────

/**
 * Polls GitHub status for a list of PRs every 15 seconds.
 * Automatically skips polling when:
 *   - the PR list is empty
 *   - the browser tab is hidden
 *   - all PRs are in terminal states (merged/closed)
 */
export function usePrStatus(prs: PrReference[]): UsePrStatusResult {
  const [statuses, setStatuses] = useState<Map<string, PrStatusResponse>>(
    () => new Map()
  );
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const isMounted = useRef(true);
  // Hold latest prs in a ref so fetchStatuses closure doesn't go stale
  const prsRef = useRef(prs);
  prsRef.current = prs;
  // Hold latest statuses in a ref to check terminal states without stale closure
  const statusesRef = useRef(statuses);
  statusesRef.current = statuses;

  const fetchStatuses = useCallback(async () => {
    const currentPrs = prsRef.current;
    if (currentPrs.length === 0) return;

    // Skip when tab is hidden — resume when it becomes visible again
    if (typeof document !== "undefined" && document.visibilityState !== "visible") {
      return;
    }

    // Only poll PRs that are not in a terminal state
    const prsToFetch = currentPrs.filter((pr) => {
      const existing = statusesRef.current.get(pr.url);
      return !existing || !isTerminalState(existing);
    });

    if (prsToFetch.length === 0) return;

    try {
      const results = await Promise.allSettled(
        prsToFetch.map((pr) =>
          apiFetch(
            `/api/integrations/github/repos/${pr.owner}/${pr.repo}/pulls/${pr.number}/status`
          ).then(async (res) => {
            if (!res.ok) {
              // Silently ignore auth errors (GitHub not connected)
              if (res.status === 401) return null;
              throw new Error(`HTTP ${res.status}`);
            }
            return res.json() as Promise<PrStatusResponse>;
          })
        )
      );

      if (!isMounted.current) return;

      const newMap = new Map(statusesRef.current);
      let changed = false;

      for (let i = 0; i < prsToFetch.length; i++) {
        const result = results[i];
        if (result.status === "fulfilled" && result.value !== null) {
          newMap.set(prsToFetch[i].url, result.value);
          changed = true;
        }
      }

      if (changed) {
        setStatuses((prev) => {
          const candidate = newMap;
          if (mapsEqual(prev, candidate)) return prev;
          return candidate;
        });
        setError(undefined);
      }
    } catch (err) {
      if (isMounted.current) {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (isMounted.current) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    isMounted.current = true;

    if (prs.length === 0) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    fetchStatuses();

    const interval = setInterval(fetchStatuses, PR_POLL_INTERVAL_MS);

    // Pause/resume polling on visibility change
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        fetchStatuses();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      isMounted.current = false;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchStatuses, prs.length]);

  return { statuses, isLoading, error };
}
