/**
 * Pure workspace utility functions — no React dependencies.
 * Extracted from use-workspaces hook for testability and reuse.
 */

import type { SessionListItem } from "@/lib/api-types";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface WorkspaceGroup {
  workspaceId: string;
  workspaceDirectory: string;
  displayName: string;
  sessionCount: number;
  hasRunningSession: boolean;
  sessions: SessionListItem[];
}

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Derive a display name from the session's workspace metadata. */
export function deriveDisplayName(item: SessionListItem): string {
  if (item.workspaceDisplayName) {
    return item.workspaceDisplayName;
  }
  const dir = item.sourceDirectory ?? item.workspaceDirectory;
  const parts = dir.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? dir;
}

/**
 * Groups a flat list of sessions into workspace groups, keyed by directory path.
 * Multiple workspace IDs pointing at the same directory are merged into one group.
 * Groups are sorted alphabetically by display name.
 */
export function groupSessionsByWorkspace(
  sessions: SessionListItem[]
): WorkspaceGroup[] {
  const map = new Map<string, WorkspaceGroup>();
  // Track whether the group's displayName came from an explicit
  // workspaceDisplayName (custom rename) vs. a directory-derived fallback.
  const hasExplicitName = new Set<string>();

  for (const session of sessions) {
    const key = session.sourceDirectory ?? session.workspaceDirectory;
    const existing = map.get(key);
    if (existing) {
      existing.sessions.push(session);
      existing.sessionCount += 1;
      if (
        session.lifecycleStatus === "running" &&
        session.typedInstanceStatus === "running"
      ) {
        existing.hasRunningSession = true;
      }
      // An explicit (custom) name always wins over a derived name,
      // regardless of which session is processed first.
      if (session.workspaceDisplayName && !hasExplicitName.has(key)) {
        existing.displayName = session.workspaceDisplayName;
        hasExplicitName.add(key);
      }
    } else {
      if (session.workspaceDisplayName) {
        hasExplicitName.add(key);
      }
      map.set(key, {
        workspaceId: session.workspaceId,
        workspaceDirectory: key,
        displayName: deriveDisplayName(session),
        sessionCount: 1,
        hasRunningSession:
          session.lifecycleStatus === "running" &&
          session.typedInstanceStatus === "running",
        sessions: [session],
      });
    }
  }

  const groups = Array.from(map.values());

  groups.sort((a, b) => a.displayName.localeCompare(b.displayName));

  return groups;
}

/**
 * Filter sessions by a workspace ID, resolving to the workspace's directory
 * so that all sessions sharing the same directory are included — matching
 * the sidebar's directory-based grouping.
 *
 * Returns all sessions when workspaceFilter is null/undefined.
 * Returns [] when the workspaceFilter doesn't match any session.
 */
export function filterSessionsByWorkspace(
  sessions: SessionListItem[],
  workspaceFilter: string | null | undefined
): SessionListItem[] {
  if (!workspaceFilter) return sessions;
  const matched = sessions.find((s) => s.workspaceId === workspaceFilter);
  if (!matched) return [];
  const targetDir = matched.sourceDirectory ?? matched.workspaceDirectory;
  return sessions.filter((s) => (s.sourceDirectory ?? s.workspaceDirectory) === targetDir);
}
