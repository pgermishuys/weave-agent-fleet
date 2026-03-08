"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useSessionsContext } from "@/contexts/sessions-context";

/**
 * Returns the workspace directory of the session currently being viewed,
 * or undefined if the user is not on a session detail page.
 *
 * For worktree/clone sessions, prefers `sourceDirectory` (the original
 * project path) over `workspaceDirectory` (the derived worktree path).
 */
export function useCurrentSessionDirectory(): string | undefined {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { sessions } = useSessionsContext();

  // Only match /sessions/<id> routes
  const match = pathname.match(/^\/sessions\/([^/]+)/);
  if (!match) return undefined;

  const sessionId = decodeURIComponent(match[1]);
  const instanceId = searchParams.get("instanceId") ?? "";

  const session = sessions.find(
    (s) => s.session.id === sessionId && s.instanceId === instanceId
  );
  if (!session) {
    // Fallback: match by session ID only (instanceId may not be in the list yet)
    const byId = sessions.find((s) => s.session.id === sessionId);
    if (!byId) return undefined;
    return byId.sourceDirectory ?? byId.workspaceDirectory;
  }

  return session.sourceDirectory ?? session.workspaceDirectory;
}
