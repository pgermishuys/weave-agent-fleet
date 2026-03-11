import { removePersistedKey } from "@/hooks/use-persisted-state";

const DRAFT_PREFIX = "weave:draft:";

export interface DraftValue {
  text: string;
  updatedAt: number;
}

export function buildDraftKey(sessionId: string): string {
  return `${DRAFT_PREFIX}${sessionId}`;
}

/**
 * Scans localStorage for `weave:draft:*` keys. If more than `maxCount` exist,
 * removes the oldest entries (by `updatedAt` timestamp) until only `maxCount`
 * remain. Corrupt entries are treated as the oldest (updatedAt = 0).
 */
export function pruneDrafts(maxCount: number = 20): void {
  try {
    const drafts: { key: string; updatedAt: number }[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith(DRAFT_PREFIX)) continue;
      try {
        const val = JSON.parse(localStorage.getItem(key)!) as Partial<DraftValue>;
        drafts.push({ key, updatedAt: val.updatedAt ?? 0 });
      } catch {
        // Corrupt entry — treat as oldest
        drafts.push({ key, updatedAt: 0 });
      }
    }
    if (drafts.length <= maxCount) return;
    // Sort ascending by updatedAt (oldest first)
    drafts.sort((a, b) => a.updatedAt - b.updatedAt);
    const toRemove = drafts.length - maxCount;
    for (let i = 0; i < toRemove; i++) {
      removePersistedKey(drafts[i].key);
    }
  } catch {
    // localStorage unavailable
  }
}
