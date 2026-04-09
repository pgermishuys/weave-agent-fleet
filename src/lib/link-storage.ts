// ─── Link Storage — localStorage persistence for detected GitHub links ────
//
// Persists PR and issue references per session so they survive page
// refreshes and message pagination boundaries.
// ───────────────────────────────────────────────────────────────────────────

import type { PrReference } from "@/lib/pr-utils";
import type { IssueReference } from "@/lib/issue-utils";

// Re-export so consumers that previously imported from here continue working.
export type { IssueReference } from "@/lib/issue-utils";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface StoredSessionLinks {
  version: 1;
  updatedAt: number; // Date.now()
  prs: PrReference[];
  issues: IssueReference[];
}

// ─── Constants ─────────────────────────────────────────────────────────────

const KEY_PREFIX = "weave:session-links:";
const CURRENT_VERSION = 1;

// ─── Helpers ───────────────────────────────────────────────────────────────

function keyFor(sessionId: string): string {
  return `${KEY_PREFIX}${sessionId}`;
}

function isStorageAvailable(): boolean {
  try {
    const key = "__weave_storage_test__";
    localStorage.setItem(key, "1");
    localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * Load persisted links for a session.
 * Returns `null` when the key doesn't exist, the JSON is corrupt, or
 * localStorage is unavailable.
 */
export function loadSessionLinks(
  sessionId: string
): StoredSessionLinks | null {
  try {
    const raw = localStorage.getItem(keyFor(sessionId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredSessionLinks;
    if (parsed.version !== CURRENT_VERSION) return null;
    if (!Array.isArray(parsed.prs) || !Array.isArray(parsed.issues))
      return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Persist links for a session.
 * Silently no-ops when localStorage is unavailable (private browsing,
 * quota exceeded, etc.).
 */
export function saveSessionLinks(
  sessionId: string,
  links: StoredSessionLinks
): void {
  try {
    localStorage.setItem(keyFor(sessionId), JSON.stringify(links));
  } catch {
    // Graceful degradation — storage quota exceeded or private browsing.
  }
}

/** Remove persisted links for a single session. */
export function removeSessionLinks(sessionId: string): void {
  try {
    localStorage.removeItem(keyFor(sessionId));
  } catch {
    // Graceful degradation.
  }
}

/**
 * Remove link entries older than `maxAgeMs`.
 * Iterates localStorage keys matching the prefix and removes stale ones.
 * Intended to be called lazily (e.g. once on page mount) to bound storage
 * growth.
 */
export function cleanupStaleLinks(
  maxAgeMs: number = 7 * 24 * 60 * 60 * 1000
): void {
  try {
    const now = Date.now();
    const keysToRemove: string[] = [];

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(KEY_PREFIX)) continue;

      const raw = localStorage.getItem(key);
      if (!raw) continue;

      try {
        const parsed = JSON.parse(raw) as StoredSessionLinks;
        if (
          typeof parsed.updatedAt === "number" &&
          now - parsed.updatedAt > maxAgeMs
        ) {
          keysToRemove.push(key);
        }
      } catch {
        // Corrupt entry — remove it.
        keysToRemove.push(key);
      }
    }

    for (const key of keysToRemove) {
      localStorage.removeItem(key);
    }
  } catch {
    // Graceful degradation.
  }
}

// ─── Merge Helpers ─────────────────────────────────────────────────────────

/**
 * Merge multiple sources of PR references into a single deduplicated list.
 * Order: first source wins (preserves earlier-detected items first).
 */
export function mergePrReferences(
  ...sources: (PrReference[] | undefined | null)[]
): PrReference[] {
  const seen = new Set<string>();
  const merged: PrReference[] = [];
  for (const source of sources) {
    if (!source) continue;
    for (const pr of source) {
      if (!seen.has(pr.url)) {
        seen.add(pr.url);
        merged.push(pr);
      }
    }
  }
  return merged;
}

/**
 * Merge multiple sources of issue references into a single deduplicated list.
 */
export function mergeIssueReferences(
  ...sources: (IssueReference[] | undefined | null)[]
): IssueReference[] {
  const seen = new Set<string>();
  const merged: IssueReference[] = [];
  for (const source of sources) {
    if (!source) continue;
    for (const issue of source) {
      if (!seen.has(issue.url)) {
        seen.add(issue.url);
        merged.push(issue);
      }
    }
  }
  return merged;
}
