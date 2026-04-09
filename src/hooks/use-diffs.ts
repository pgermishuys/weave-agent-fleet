"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import type { FileDiffItem } from "@/lib/api-types";
import { apiFetch } from "@/lib/api-client";

export interface UseDiffsResult {
  diffs: FileDiffItem[];
  isLoading: boolean;
  error?: string;
  fetchDiffs: () => void;
}

/**
 * Fetches file diffs for a session on demand (not auto-polling).
 * Call `fetchDiffs()` when the user activates the "Changes" tab.
 * Pass `messageID` to fetch session-scoped diffs (cumulative from that message).
 *
 * `fetchDiffs` identity changes when `messageID` changes, which automatically
 * triggers a refetch via the effect below.
 */
export function useDiffs(sessionId: string, instanceId: string, messageID?: string): UseDiffsResult {
  const [diffs, setDiffs] = useState<FileDiffItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const isMounted = useRef(true);

  const fetchDiffs = useCallback(async () => {
    if (!sessionId || !instanceId) return;
    setIsLoading(true);
    setError(undefined);

    try {
      const url = `/api/sessions/${encodeURIComponent(sessionId)}/diffs?instanceId=${encodeURIComponent(instanceId)}${messageID ? `&messageID=${encodeURIComponent(messageID)}` : ""}`;
      const response = await apiFetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = (await response.json()) as FileDiffItem[];
      if (isMounted.current) {
        setDiffs(data);
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
  }, [sessionId, instanceId, messageID]);

  // Auto-refetch when messageID changes (diff mode toggle)
  useEffect(() => {
    if (sessionId && instanceId) {
      fetchDiffs();
    }
  }, [fetchDiffs, sessionId, instanceId]);

  return { diffs, isLoading, error, fetchDiffs };
}
