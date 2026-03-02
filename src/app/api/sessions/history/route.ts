import { NextRequest, NextResponse } from "next/server";
import { _recoveryComplete } from "@/lib/server/process-manager";
import { searchSessions, getWorkspace } from "@/lib/server/db-repository";
import type { HistorySession, HistoryResponse } from "@/lib/api-types";

// GET /api/sessions/history — search/filter session history
// Query params:
//   ?search=...   — title LIKE search
//   ?status=...   — exact status filter
//   ?from=...     — created_at >= from (ISO date string)
//   ?to=...       — created_at <= to (ISO date string)
//   ?limit=N      — page size (default 20, max 100)
//   ?offset=N     — pagination offset (default 0)
export async function GET(request: NextRequest): Promise<NextResponse> {
  await _recoveryComplete;

  const params = request.nextUrl.searchParams;

  const search = params.get("search") || undefined;
  const status = params.get("status") || undefined;
  const fromDate = params.get("from") || undefined;
  const toDate = params.get("to") || undefined;

  const limitParam = params.get("limit");
  const parsedLimit = limitParam ? parseInt(limitParam, 10) : 20;
  const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 100) : 20;

  const offsetParam = params.get("offset");
  const parsedOffset = offsetParam ? parseInt(offsetParam, 10) : 0;
  const offset = Number.isFinite(parsedOffset) && parsedOffset >= 0 ? parsedOffset : 0;

  try {
    const result = searchSessions({ search, status, fromDate, toDate, limit, offset });

    const sessions: HistorySession[] = result.sessions.map((dbSession) => {
      let workspaceDisplayName: string | null = null;
      try {
        const ws = getWorkspace(dbSession.workspace_id);
        if (ws) {
          workspaceDisplayName = ws.display_name;
        }
      } catch {
        // Non-fatal — workspace lookup can fail
      }

      return {
        id: dbSession.id,
        opencodeSessionId: dbSession.opencode_session_id,
        instanceId: dbSession.instance_id,
        title: dbSession.title,
        status: dbSession.status,
        directory: dbSession.directory,
        workspaceDisplayName,
        createdAt: dbSession.created_at,
        stoppedAt: dbSession.stopped_at,
      };
    });

    const response: HistoryResponse = { sessions, total: result.total };
    return NextResponse.json(response, { status: 200 });
  } catch (err) {
    console.error("[GET /api/sessions/history] Error:", err);
    return NextResponse.json(
      { error: "Failed to fetch session history" },
      { status: 500 }
    );
  }
}
