import { NextRequest, NextResponse } from "next/server";
import { getClientForInstance } from "@/lib/server/opencode-client";
import { destroyInstance, _recoveryComplete } from "@/lib/server/process-manager";
import {
  getSession,
  getSessionByOpencodeId,
  getWorkspace,
  updateSessionStatus,
  updateSessionTitle,
  getSessionsForInstance,
  getAnySessionForInstance,
  deleteSession,
  deleteNotificationsForSession,
  deleteCallbacksForSession,
  getSessionsForWorkspace,
} from "@/lib/server/db-repository";
import { stopMonitoring } from "@/lib/server/callback-monitor";
import { cleanupWorkspace } from "@/lib/server/workspace-manager";

interface RouteContext {
  params: Promise<{ id: string }>;
}

interface AncestorInfo {
  dbId: string;
  instanceId: string;
  opencodeSessionId: string;
  title: string;
}

/**
 * Walk the parent chain from a starting session ID, returning an array of
 * ancestor entries in root-first order (e.g. [grandparent, parent]).
 * The walk is bounded to prevent infinite loops from circular references.
 */
function walkAncestorChain(
  startSessionId: string | null | undefined,
  maxDepth = 10
): AncestorInfo[] {
  const chain: AncestorInfo[] = [];
  let currentId = startSessionId;
  let depth = 0;
  while (currentId && depth < maxDepth) {
    const parent = getSession(currentId);
    if (!parent) break;
    chain.push({
      dbId: parent.id,
      instanceId: parent.instance_id,
      opencodeSessionId: parent.opencode_session_id,
      title: parent.title,
    });
    currentId = parent.parent_session_id;
    depth++;
  }
  chain.reverse();
  return chain;
}

// PATCH /api/sessions/[id] — rename a session
export async function PATCH(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse> {
  const { id } = await context.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (
    typeof body !== "object" ||
    body === null ||
    !("title" in body) ||
    typeof (body as Record<string, unknown>).title !== "string" ||
    (body as Record<string, unknown>).title === ""
  ) {
    return NextResponse.json(
      { error: "title is required and must be a non-empty string" },
      { status: 400 }
    );
  }

  const title = (body as Record<string, unknown>).title as string;

  let session;
  try {
    session = getSession(id);
  } catch {
    return NextResponse.json(
      { error: "Failed to look up session" },
      { status: 500 }
    );
  }

  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  try {
    updateSessionTitle(id, title);
  } catch {
    return NextResponse.json(
      { error: "Failed to update session title" },
      { status: 500 }
    );
  }

  return NextResponse.json({ id, title }, { status: 200 });
}

// GET /api/sessions/[id]?instanceId=xxx — get session detail with messages
export async function GET(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse> {
  // Wait for startup recovery before serving — ensures instances Map is populated
  await _recoveryComplete;

  const { id: sessionId } = await context.params;
  const instanceId = request.nextUrl.searchParams.get("instanceId");

  if (!instanceId) {
    return NextResponse.json(
      { error: "instanceId query parameter is required" },
      { status: 400 }
    );
  }

  let client;
  try {
    client = getClientForInstance(instanceId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[GET /api/sessions/${sessionId}] getClientForInstance failed for instanceId=${instanceId}:`, msg);
    return NextResponse.json(
      { error: "Instance not found or unavailable" },
      { status: 404 }
    );
  }

  try {
    const [sessionResult, messagesResult] = await Promise.all([
      client.session.get({ sessionID: sessionId }),
      client.session.messages({ sessionID: sessionId }),
    ]);

    const session = sessionResult.data;
    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    // Enrich with DB metadata if available
    let workspaceId: string | null = null;
    let workspaceDirectory: string | null = null;
    let isolationStrategy: string | null = null;
    let branch: string | null = null;
    const ancestors: AncestorInfo[] = [];

    try {
      const dbSession = getSession(sessionId) ?? getSessionByOpencodeId(sessionId);
      if (dbSession) {
        workspaceId = dbSession.workspace_id;
        const ws = getWorkspace(dbSession.workspace_id);
        if (ws) {
          workspaceDirectory = ws.directory;
          isolationStrategy = ws.isolation_strategy;
          branch = ws.branch;
        }

        // Walk parent chain to build ancestors array (root-first)
        ancestors.push(...walkAncestorChain(dbSession.parent_session_id));
      } else {
        // Session exists in OpenCode but not in Fleet DB — this is a subagent
        // session spawned by the Task tool within OpenCode.

        // 1. Try explicit parentSessionId hint from query params (set by TaskDelegationItem)
        const parentSessionIdHint = request.nextUrl.searchParams.get("parentSessionId");
        let directParent = parentSessionIdHint
          ? getSessionByOpencodeId(parentSessionIdHint)
          : undefined;

        // 2. Fallback: find the oldest session on this instance (regardless of status)
        if (!directParent) {
          const fallback = getAnySessionForInstance(instanceId);
          if (fallback && fallback.opencode_session_id !== sessionId) {
            directParent = fallback;
          }
        }

        if (directParent) {
          // Include the direct parent itself, then walk its ancestors
          const parentEntry = {
            dbId: directParent.id,
            instanceId: directParent.instance_id,
            opencodeSessionId: directParent.opencode_session_id,
            title: directParent.title,
          };
          const parentAncestors = walkAncestorChain(directParent.parent_session_id);
          // parentAncestors is root-first; append direct parent at the end
          ancestors.push(...parentAncestors, parentEntry);

          // Also populate workspace metadata from the parent
          const parentWs = getWorkspace(directParent.workspace_id);
          if (parentWs) {
            workspaceId = directParent.workspace_id;
            workspaceDirectory = parentWs.directory;
            isolationStrategy = parentWs.isolation_strategy;
            branch = parentWs.branch;
          }
        }
      }
    } catch (err) {
      // DB metadata enrichment is best-effort
      console.error("[GET /api/sessions] DB enrichment failed:", err);
    }

    return NextResponse.json(
      {
        session,
        messages: messagesResult.data ?? [],
        workspaceId,
        workspaceDirectory,
        isolationStrategy,
        branch,
        ancestors,
      },
      { status: 200 }
    );
  } catch (err) {
    console.error(`[GET /api/sessions/${sessionId}] Error:`, err);
    return NextResponse.json(
      { error: "Failed to retrieve session" },
      { status: 500 }
    );
  }
}

// DELETE /api/sessions/[id]?instanceId=xxx&cleanupWorkspace=true&permanent=true — terminate (and optionally permanently delete) a session
export async function DELETE(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse> {
  const { id: sessionId } = await context.params;
  const instanceId = request.nextUrl.searchParams.get("instanceId");
  const shouldCleanupWorkspace =
    request.nextUrl.searchParams.get("cleanupWorkspace") === "true";
  const permanent = request.nextUrl.searchParams.get("permanent") === "true";

  if (!instanceId) {
    return NextResponse.json(
      { error: "instanceId query parameter is required" },
      { status: 400 }
    );
  }

  // Look up session in DB to get workspace ID and resolved DB id
  let workspaceId: string | null = null;
  let resolvedDbId: string | null = null;
  try {
    const dbSession = getSession(sessionId) ?? getSessionByOpencodeId(sessionId);
    if (dbSession) {
      workspaceId = dbSession.workspace_id;
      resolvedDbId = dbSession.id;
    }
  } catch {
    // DB lookup failure — proceed with process kill only
  }

  // Determine if session is already in a terminal state (stopped/completed/disconnected).
  // For permanent deletes of terminal sessions, skip abort+destroy to avoid killing a live
  // instance that shares the same instanceId with other active sessions.
  let isAlreadyTerminal = false;
  try {
    const dbSession = resolvedDbId ? getSession(resolvedDbId) : null;
    if (dbSession) {
      isAlreadyTerminal = ["stopped", "completed", "disconnected"].includes(dbSession.status);
    }
  } catch {
    // Non-fatal
  }

  // Step 1: Check if other sessions are still using this instance before killing
  let otherActiveSessions = 0;
  try {
    const activeSessions = getSessionsForInstance(instanceId);
    // Filter out this session
    const others = activeSessions.filter(
      (s) => s.id !== sessionId && s.opencode_session_id !== sessionId
    );
    otherActiveSessions = others.length;
  } catch {
    // Non-fatal
  }

  // Step 2: Gracefully abort the session before killing, then destroy instance if safe.
  // Skip entirely for permanent deletes of already-terminal sessions — the process is already
  // dead, and getSessionsForInstance (active/idle only) would return 0 even if other active
  // sessions share this instance, incorrectly triggering destroyInstance.
  const skipAbortAndDestroy = permanent && isAlreadyTerminal;
  if (!skipAbortAndDestroy) {
    try {
      const sessionClient = getClientForInstance(instanceId);
      await sessionClient.session.abort({ sessionID: sessionId });
    } catch {
      // Abort is best-effort — instance may already be dead or session may not be running
    }

    if (otherActiveSessions === 0) {
      try {
        destroyInstance(instanceId);
      } catch {
        // Instance may already be dead — that's fine
      }
    }
    // If other sessions exist, keep the instance running — don't touch it
  }

  // Step 3: Update session status in DB (only for non-permanent termination)
  // If session was idle (finished its task), mark as "completed".
  // If session was active (still processing), mark as "stopped" (user-interrupted).
  if (resolvedDbId && !permanent) {
    // Stop monitoring — terminated session shouldn't fire callbacks
    try {
      stopMonitoring(resolvedDbId);
    } catch {
      // Non-fatal
    }

    try {
      const now = new Date().toISOString();
      const currentSession = getSession(resolvedDbId);
      if (currentSession?.status === "idle") {
        updateSessionStatus(resolvedDbId, "completed", now);
      } else {
        updateSessionStatus(resolvedDbId, "stopped", now);
      }
    } catch {
      // DB update failure is non-fatal
    }
  }

  // Step 4: Optionally clean up workspace (worktree/clone only) — for non-permanent terminate
  if (!permanent && shouldCleanupWorkspace && workspaceId) {
    try {
      await cleanupWorkspace(workspaceId);
    } catch (err) {
      console.warn(`[DELETE /api/sessions/${sessionId}] Workspace cleanup failed:`, err);
    }
  }

  if (!permanent) {
    return NextResponse.json(
      { message: "Session terminated", sessionId, instanceId },
      { status: 200 }
    );
  }

  // ── Permanent delete ─────────────────────────────────────────────────────────
  // Step 5: Delete related notifications
  if (resolvedDbId) {
    // Stop server-side callback monitoring before deleting callback rows
    try {
      stopMonitoring(resolvedDbId);
    } catch {
      // Non-fatal
    }

    try {
      deleteNotificationsForSession(resolvedDbId);
    } catch (err) {
      console.warn(`[DELETE /api/sessions/${sessionId}] Notification cleanup failed:`, err);
    }

    // Step 5.5: Delete related callbacks
    try {
      deleteCallbacksForSession(resolvedDbId);
    } catch (err) {
      console.warn(`[DELETE /api/sessions/${sessionId}] Callback cleanup failed:`, err);
    }

    // Step 6: Delete the session row itself
    try {
      deleteSession(resolvedDbId);
    } catch (err) {
      console.warn(`[DELETE /api/sessions/${sessionId}] Session deletion failed:`, err);
    }
  }

  // Step 7: Always clean up workspace for non-"existing" isolation strategies,
  // but only if no other sessions still reference the same workspace.
  if (workspaceId) {
    try {
      const workspace = getWorkspace(workspaceId);
      if (workspace && workspace.isolation_strategy !== "existing") {
        // Session row is already deleted — any remaining sessions belong to other agents
        const remainingSessions = getSessionsForWorkspace(workspaceId);
        if (remainingSessions.length === 0) {
          await cleanupWorkspace(workspaceId);
        }
      }
    } catch (err) {
      console.warn(`[DELETE /api/sessions/${sessionId}] Workspace cleanup failed:`, err);
    }
  }

  return NextResponse.json(
    { message: "Session permanently deleted", sessionId, instanceId },
    { status: 200 }
  );
}
