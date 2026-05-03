"use client";

/**
 * Unified smart links status polling hook.
 *
 * Replaces the separate `usePrStatus` and `useIssueStatus` hooks.
 * Groups refs by provider, polls each via its status endpoint, and
 * uses per-provider rate-limit trackers for adaptive backoff.
 *
 * Preserves all existing behaviours:
 *   - Terminal state skipping
 *   - Tab visibility pause/resume
 *   - Adaptive rate-limit interval
 *   - Promise.allSettled (no single failure blocks others)
 */

import { useState, useEffect, useCallback, useRef } from "react";
import type { SmartLinkReference } from "@/lib/smart-links/types";
import { getProvider } from "@/lib/smart-links/registry";
import { getRateLimitTracker } from "@/lib/smart-links/rate-limit";
import { apiFetch } from "@/lib/api-client";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface UseSmartLinkStatusesResult {
  /** Keyed by link URL → raw status object from the provider API */
  statuses: Map<string, unknown>;
  isLoading: boolean;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const BASE_POLL_INTERVAL_MS = 30_000;
const RATE_LIMIT_RETRY_MS = 60_000;

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Poll status for a list of smart link references.
 * Returns a Map<url, rawStatus> that is updated as polls complete.
 */
export function useSmartLinkStatuses(
  refs: SmartLinkReference[]
): UseSmartLinkStatusesResult {
  const [statuses, setStatuses] = useState<Map<string, unknown>>(
    () => new Map()
  );
  const [isLoading, setIsLoading] = useState(false);

  const isMounted = useRef(true);
  const refsRef = useRef(refs);
  refsRef.current = refs;
  const statusesRef = useRef(statuses);
  statusesRef.current = statuses;
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Return the smallest recommended interval across all referenced providers. */
  const getNextInterval = useCallback((): number => {
    const providerNames = new Set(refsRef.current.map((r) => r.provider));
    let min = BASE_POLL_INTERVAL_MS;
    for (const name of providerNames) {
      const tracker = getRateLimitTracker(name);
      const interval = tracker.getRecommendedInterval(BASE_POLL_INTERVAL_MS);
      if (!isFinite(interval)) return Infinity;
      if (interval < min) min = interval;
    }
    return min;
  }, []);

  // eslint-disable-next-line prefer-const
  let fetchAndSchedule: () => Promise<void>;

  const scheduleNext = useCallback(() => {
    const interval = getNextInterval();
    if (!isFinite(interval)) {
      timeoutRef.current = setTimeout(() => {
        if (isMounted.current) void fetchAndSchedule();
      }, RATE_LIMIT_RETRY_MS);
      return;
    }
    timeoutRef.current = setTimeout(() => {
      if (isMounted.current) void fetchAndSchedule();
    }, interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getNextInterval]);

  fetchAndSchedule = useCallback(async () => {
    const currentRefs = refsRef.current;
    if (currentRefs.length === 0) return;

    // Pause when tab is hidden
    if (
      typeof document !== "undefined" &&
      document.visibilityState !== "visible"
    ) {
      scheduleNext();
      return;
    }

    // Gather refs that are non-terminal and for which a status URL exists
    const refsToFetch = currentRefs.filter((ref) => {
      const provider = getProvider(ref.provider);
      if (!provider) return false;

      const tracker = getRateLimitTracker(ref.provider);
      if (!tracker.shouldPoll()) return false;

      const existing = statusesRef.current.get(ref.url);
      if (existing && provider.isTerminalStatus(existing)) return false;

      return provider.buildStatusUrl(ref) !== null;
    });

    if (refsToFetch.length === 0) {
      // All current refs are terminal or unfetchable — schedule a check later
      // in case new non-terminal refs are added while the hook is mounted.
      scheduleNext();
      return;
    }

    try {
      const results = await Promise.allSettled(
        refsToFetch.map(async (ref) => {
          const provider = getProvider(ref.provider)!;
          const url = provider.buildStatusUrl(ref)!;
          const res = await apiFetch(url);
          if (!res.ok) {
            if (res.status === 401) return null; // Auth not configured — silent
            throw new Error(`HTTP ${res.status}`);
          }
          const body = await res.json();
          return { ref, result: provider.parseStatusResponse(body) };
        })
      );

      if (!isMounted.current) return;

      const newMap = new Map(statusesRef.current);
      let changed = false;

      for (const outcome of results) {
        if (outcome.status === "fulfilled" && outcome.value !== null) {
          const { ref, result } = outcome.value;
          newMap.set(ref.url, result.status);
          changed = true;

          // Update per-provider rate-limit tracker
          if (result.rateLimit) {
            getRateLimitTracker(ref.provider).update(
              result.rateLimit.remaining,
              result.rateLimit.resetAt
            );
          }
        }
      }

      if (changed) {
        setStatuses((prev) => {
          // Shallow equality: only re-render when something actually changed
          if (prev.size === newMap.size) {
            let same = true;
            for (const [url, status] of prev) {
              if (newMap.get(url) !== status) {
                same = false;
                break;
              }
            }
            if (same) return prev;
          }
          return newMap;
        });
      }
    } catch {
      // Non-fatal — errors surface per-ref via Promise.allSettled above
    } finally {
      if (isMounted.current) {
        setIsLoading(false);
        scheduleNext();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scheduleNext]);

  useEffect(() => {
    isMounted.current = true;

    if (refs.length === 0) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    void fetchAndSchedule();

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        if (timeoutRef.current !== null) {
          clearTimeout(timeoutRef.current);
          timeoutRef.current = null;
        }
        void fetchAndSchedule();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      isMounted.current = false;
      if (timeoutRef.current !== null) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchAndSchedule, refs.length]);

  return { statuses, isLoading };
}
