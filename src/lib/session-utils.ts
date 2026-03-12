import type { SessionListItem } from "@/lib/api-types";

export interface NestedSession {
  item: SessionListItem;
  children: SessionListItem[];
}

export interface NestSessionsOptions {
  /** Sort top-level parents and children alphabetically by title. Default: false. */
  sort?: boolean;
}

function sessionSortKey(s: SessionListItem): string {
  return (s.session.title || s.session.id).toLowerCase();
}

/**
 * Returns true if the two session arrays differ in any UI-visible field.
 * Used for structural sharing: skip setState when poll data is unchanged.
 * Only compares fields the UI actually renders — avoids deep comparison of
 * large nested objects like session.messages.
 */
export function sessionsChanged(
  prev: SessionListItem[],
  next: SessionListItem[]
): boolean {
  if (prev.length !== next.length) return true;
  for (let i = 0; i < prev.length; i++) {
    const a = prev[i]!, b = next[i]!;
    if (
      a.session.id !== b.session.id ||
      a.sessionStatus !== b.sessionStatus ||
      a.activityStatus !== b.activityStatus ||
      a.lifecycleStatus !== b.lifecycleStatus ||
      a.instanceStatus !== b.instanceStatus ||
      a.session.title !== b.session.title
    ) return true;
  }
  return false;
}

/**
 * Groups a flat list of sessions into a nested parent-child structure.
 *
 * Sessions with a `parentSessionId` that matches a `dbId` in the same list
 * are treated as children of that parent. All other sessions are top-level.
 * Sessions without `dbId` or `parentSessionId` pass through unchanged.
 *
 * @param options.sort - When true, sorts top-level items and children
 *   alphabetically by title (falling back to session.id). Default: false.
 */
export function nestSessions(items: SessionListItem[], options?: NestSessionsOptions): NestedSession[] {
  // Build a map of dbId → SessionListItem for parent lookup
  const dbIdMap = new Map<string, SessionListItem>();
  for (const s of items) {
    if (s.dbId) dbIdMap.set(s.dbId, s);
  }

  // Identify child sessions and group them under their parent
  const childIds = new Set<string>();
  const childrenByParent = new Map<string, SessionListItem[]>();
  for (const s of items) {
    if (s.parentSessionId && dbIdMap.has(s.parentSessionId)) {
      childIds.add(s.session.id);
      const existing = childrenByParent.get(s.parentSessionId) ?? [];
      existing.push(s);
      childrenByParent.set(s.parentSessionId, existing);
    }
  }

  // Return top-level items (non-children) with their children attached
  const nested = items
    .filter((s) => !childIds.has(s.session.id))
    .map((s) => ({
      item: s,
      children: s.dbId ? (childrenByParent.get(s.dbId) ?? []) : [],
    }));

  if (options?.sort) {
    for (const entry of nested) {
      entry.children.sort((a, b) =>
        sessionSortKey(a).localeCompare(sessionSortKey(b))
      );
    }
    nested.sort((a, b) =>
      sessionSortKey(a.item).localeCompare(sessionSortKey(b.item))
    );
  }

  return nested;
}
