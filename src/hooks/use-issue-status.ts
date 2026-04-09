"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { IssueReference } from "@/lib/issue-utils";
import type { IssueStatusResponse } from "@/integrations/github/types";
import { apiFetch } from "@/lib/api-client";
import {
  updateRateLimit,
  getRecommendedInterval,
  shouldPoll,
} from "@/lib/github-rate-limit";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface UseIssueStatusResult {
  /** Keyed by issue URL */
  statuses: Map<string, IssueStatusResponse>;
  isLoading: boolean;
  error?: string;
}

// ─── Constants ─────────────────────────────────────────────────────────────

/** Base polling interval — dynamically adjusted by rate-limit pressure. */
const BASE_POLL_INTERVAL_MS = 30_000;

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Issues in closed state are terminal — no need to keep polling. */
function isTerminalState(status: IssueStatusResponse): boolean {
  return status.state === "closed";
}

/** Shallow equality check for two Maps keyed by issue URL. */
function mapsEqual(
  a: Map<string, IssueStatusResponse>,
  b: Map<string, IssueStatusResponse>
): boolean {
  if (a.size !== b.size) return false;
  for (const [url, aStatus] of a) {
    const bStatus = b.get(url);
    if (!bStatus) return false;
    if (
      aStatus.state !== bStatus.state ||
      aStatus.title !== bStatus.title ||
      aStatus.labels.length !== bStatus.labels.length
    ) {
      return false;
    }
  }
  return true;
}

// ─── Hook ──────────────────────────────────────────────────────────────────

/**
 * Polls GitHub status for a list of issues with adaptive rate-limit backoff.
 *
 * Base interval is 30 seconds, automatically increased when the GitHub API
 * rate-limit budget is low, and paused entirely when critically low (< 10
 * remaining).
 *
 * Automatically skips polling when:
 *   - the issue list is empty
 *   - the browser tab is hidden
 *   - all issues are in terminal states (closed)
 *   - the rate-limit budget is exhausted
 */
export function useIssueStatus(
  issues: IssueReference[]
): UseIssueStatusResult {
  const [statuses, setStatuses] = useState<
    Map<string, IssueStatusResponse>
  >(() => new Map());
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const isMounted = useRef(true);
  const issuesRef = useRef(issues);
  issuesRef.current = issues;
  const statusesRef = useRef(statuses);
  statusesRef.current = statuses;
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleNext = useCallback(() => {
    const interval = getRecommendedInterval(BASE_POLL_INTERVAL_MS);
    if (!isFinite(interval)) {
      // Rate limit exhausted — retry after 60s to re-check
      timeoutRef.current = setTimeout(() => {
        if (isMounted.current) {
          fetchAndSchedule();
        }
      }, 60_000);
      return;
    }
    timeoutRef.current = setTimeout(() => {
      if (isMounted.current) {
        fetchAndSchedule();
      }
    }, interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchAndSchedule = useCallback(async () => {
    const currentIssues = issuesRef.current;
    if (currentIssues.length === 0) return;

    // Skip when tab is hidden
    if (
      typeof document !== "undefined" &&
      document.visibilityState !== "visible"
    ) {
      scheduleNext();
      return;
    }

    // Skip when rate-limit budget is exhausted
    if (!shouldPoll()) {
      scheduleNext();
      return;
    }

    // Only poll issues that are not in a terminal state
    const issuesToFetch = currentIssues.filter((issue) => {
      const existing = statusesRef.current.get(issue.url);
      return !existing || !isTerminalState(existing);
    });

    if (issuesToFetch.length === 0) return; // All terminal — stop polling

    try {
      const results = await Promise.allSettled(
        issuesToFetch.map((issue) =>
          apiFetch(
            `/api/integrations/github/repos/${issue.owner}/${issue.repo}/issues/${issue.number}/status`
          ).then(async (res) => {
            if (!res.ok) {
              if (res.status === 401) return null;
              throw new Error(`HTTP ${res.status}`);
            }
            return res.json() as Promise<IssueStatusResponse>;
          })
        )
      );

      if (!isMounted.current) return;

      const newMap = new Map(statusesRef.current);
      let changed = false;

      for (let i = 0; i < issuesToFetch.length; i++) {
        const result = results[i];
        if (result.status === "fulfilled" && result.value !== null) {
          const status = result.value;
          newMap.set(issuesToFetch[i].url, status);
          changed = true;

          // Feed rate-limit info into the shared tracker
          if (
            status.rateLimitRemaining !== undefined &&
            status.rateLimitReset !== undefined
          ) {
            updateRateLimit(
              status.rateLimitRemaining,
              status.rateLimitReset
            );
          }
        }
      }

      if (changed) {
        setStatuses((prev) => {
          if (mapsEqual(prev, newMap)) return prev;
          return newMap;
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
        scheduleNext();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    isMounted.current = true;

    if (issues.length === 0) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    fetchAndSchedule();

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        if (timeoutRef.current !== null) {
          clearTimeout(timeoutRef.current);
          timeoutRef.current = null;
        }
        fetchAndSchedule();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      isMounted.current = false;
      if (timeoutRef.current !== null) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      document.removeEventListener(
        "visibilitychange",
        handleVisibilityChange
      );
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchAndSchedule, issues.length]);

  return { statuses, isLoading, error };
}
