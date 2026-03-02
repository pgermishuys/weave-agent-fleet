import { NextRequest, NextResponse } from "next/server";
import { getClientForInstance } from "@/lib/server/opencode-client";
import { getSessionByOpencodeId, updateSessionStatus } from "@/lib/server/db-repository";

interface RouteContext {
  params: Promise<{ id: string }>;
}

// POST /api/sessions/[id]/abort?instanceId=xxx — abort a running session (cancel stuck tool calls)
export async function POST(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse> {
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
  } catch {
    return NextResponse.json(
      { error: "Instance not found or unavailable" },
      { status: 404 }
    );
  }

  try {
    await client.session.abort({ sessionID: sessionId });

    try {
      const dbSession = getSessionByOpencodeId(sessionId);
      if (dbSession) {
        updateSessionStatus(dbSession.id, "idle");
      }
    } catch {
      // DB update failure must not fail the abort response
    }

    return NextResponse.json(
      { message: "Session aborted", sessionId, instanceId },
      { status: 200 }
    );
  } catch (err) {
    console.error(`[POST /api/sessions/${sessionId}/abort] Error:`, err);
    return NextResponse.json(
      { error: "Failed to abort session" },
      { status: 500 }
    );
  }
}
