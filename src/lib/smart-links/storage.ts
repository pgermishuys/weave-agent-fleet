"use client";

/**
 * Client-side smart links storage hook.
 *
 * Manages the lifecycle of smart link references for a session:
 *   - Loads from server on mount (source of truth)
 *   - Uses localStorage as a write-through cache for instant render
 *   - Merges newly-detected links (excluding dismissed URLs)
 *   - Persists detected links back to server (debounced)
 *   - Exposes `dismiss(url)` to remove and suppress a link
 *
 * v1 localStorage migration: on first server load, if localStorage v1 data
 * exists for this session it is pushed to the server then cleared.
 */

import {
  useState,
  useEffect,
  useCallback,
  useRef,
} from "react";
import type { SmartLinkReference } from "@/lib/smart-links/types";
import { mergeSmartLinkReferences } from "@/lib/smart-links/registry";
import { apiFetch } from "@/lib/api-client";

// ─── localStorage cache (v2) ──────────────────────────────────────────────────

const CACHE_KEY_PREFIX = "weave:smart-links:v2:";

function cacheKey(sessionId: string): string {
  return `${CACHE_KEY_PREFIX}${sessionId}`;
}

function readCache(sessionId: string): SmartLinkReference[] | null {
  try {
    const raw = localStorage.getItem(cacheKey(sessionId));
    if (!raw) return null;
    return JSON.parse(raw) as SmartLinkReference[];
  } catch {
    return null;
  }
}

function writeCache(sessionId: string, links: SmartLinkReference[]): void {
  try {
    localStorage.setItem(cacheKey(sessionId), JSON.stringify(links));
  } catch {
    // Graceful degradation
  }
}

// ─── localStorage v1 migration ────────────────────────────────────────────────

const V1_KEY_PREFIX = "weave:session-links:";

interface StoredSessionLinksV1 {
  version: 1;
  prs?: Array<{ url: string; owner: string; repo: string; number: number }>;
  issues?: Array<{ url: string; owner: string; repo: string; number: number }>;
}

function migrateV1(sessionId: string): SmartLinkReference[] {
  try {
    const raw = localStorage.getItem(`${V1_KEY_PREFIX}${sessionId}`);
    if (!raw) return [];

    const v1 = JSON.parse(raw) as StoredSessionLinksV1;
    if (v1.version !== 1) return [];

    const refs: SmartLinkReference[] = [];

    for (const pr of v1.prs ?? []) {
      refs.push({
        provider: "github",
        linkType: "pull-request",
        url: pr.url,
        displayLabel: `#${pr.number}`,
        metadata: { owner: pr.owner, repo: pr.repo, number: pr.number },
      });
    }

    for (const issue of v1.issues ?? []) {
      refs.push({
        provider: "github",
        linkType: "issue",
        url: issue.url,
        displayLabel: `#${issue.number}`,
        metadata: {
          owner: issue.owner,
          repo: issue.repo,
          number: issue.number,
        },
      });
    }

    // Clear v1 after successful migration
    localStorage.removeItem(`${V1_KEY_PREFIX}${sessionId}`);
    return refs;
  } catch {
    return [];
  }
}

// ─── API helpers ──────────────────────────────────────────────────────────────

async function fetchServerLinks(sessionId: string): Promise<{
  links: SmartLinkReference[];
  dismissed: string[];
}> {
  const res = await apiFetch(`/api/sessions/${sessionId}/smart-links`);
  if (!res.ok) return { links: [], dismissed: [] };
  return res.json() as Promise<{ links: SmartLinkReference[]; dismissed: string[] }>;
}

async function putServerLinks(
  sessionId: string,
  links: SmartLinkReference[]
): Promise<void> {
  await apiFetch(`/api/sessions/${sessionId}/smart-links`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ links }),
  });
}

async function deleteServerLink(sessionId: string, url: string): Promise<void> {
  await apiFetch(
    `/api/sessions/${sessionId}/smart-links?url=${encodeURIComponent(url)}`,
    { method: "DELETE" }
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export interface UseSmartLinkStorageResult {
  /** Merged, deduplicated, non-dismissed link references */
  links: SmartLinkReference[];
  /** Dismiss a link — removes it from the panel and suppresses future re-detection */
  dismiss: (url: string) => void;
  /** Whether the initial server load is still in progress */
  isLoading: boolean;
}

/**
 * Manage smart link persistence for a session.
 *
 * @param sessionId    Fleet session DB id
 * @param detectedRefs Links freshly detected from current messages
 */
export function useSmartLinkStorage(
  sessionId: string,
  detectedRefs: SmartLinkReference[]
): UseSmartLinkStorageResult {
  const [links, setLinks] = useState<SmartLinkReference[]>(() => {
    // Hydrate instantly from cache while server loads
    return readCache(sessionId) ?? [];
  });
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const dismissedRef = useRef<Set<string>>(new Set());
  dismissedRef.current = new Set(dismissed);

  const putDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Initial server load ───────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const { links: serverLinks, dismissed: serverDismissed } =
          await fetchServerLinks(sessionId);

        if (cancelled) return;

        const dismissedSet = new Set(serverDismissed);

        // Migrate v1 localStorage → server (one-time)
        const v1Links = migrateV1(sessionId);
        const cache = readCache(sessionId) ?? [];

        const merged = mergeSmartLinkReferences(
          serverLinks,
          v1Links,
          cache
        ).filter((ref) => !dismissedSet.has(ref.url));

        setLinks(merged);
        setDismissed(serverDismissed);
        writeCache(sessionId, merged);

        // Push v1 migration data to server if any
        if (v1Links.length > 0) {
          await putServerLinks(sessionId, merged);
        }
      } catch {
        // Server unavailable — fall back to cache
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // ── Merge newly-detected refs (excludes dismissed) ────────────────────────

  useEffect(() => {
    if (isLoading) return; // Don't merge until server has loaded
    if (detectedRefs.length === 0) return;

    setLinks((prev) => {
      const freshFiltered = detectedRefs.filter(
        (r) => !dismissedRef.current.has(r.url)
      );
      const merged = mergeSmartLinkReferences(prev, freshFiltered);
      // Only update state (and trigger server persist) when something changed
      if (merged.length === prev.length) return prev;

      writeCache(sessionId, merged);

      // Debounced server PUT
      if (putDebounceRef.current) clearTimeout(putDebounceRef.current);
      putDebounceRef.current = setTimeout(() => {
        void putServerLinks(sessionId, merged);
      }, 1_500);

      return merged;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detectedRefs, isLoading, sessionId]);

  // ── Cleanup debounce timer on unmount ────────────────────────────────────

  useEffect(() => {
    return () => {
      if (putDebounceRef.current !== null) {
        clearTimeout(putDebounceRef.current);
        putDebounceRef.current = null;
      }
    };
  }, []);

  // ── Dismiss ───────────────────────────────────────────────────────────────

  const dismiss = useCallback(
    (url: string) => {
      setLinks((prev) => {
        const updated = prev.filter((ref) => ref.url !== url);
        writeCache(sessionId, updated);
        return updated;
      });
      setDismissed((prev) => {
        if (prev.includes(url)) return prev;
        return [...prev, url];
      });
      void deleteServerLink(sessionId, url);
    },
    [sessionId]
  );

  return { links, dismiss, isLoading };
}
