import { NextRequest, NextResponse } from "next/server";
import { ensureInstanceForSession } from "@/lib/server/opencode-client";
import { getSessionByOpencodeId, updateSessionStatus } from "@/lib/server/db-repository";
import { withTimeout, getSDKCallTimeoutMs } from "@/lib/server/async-utils";

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
    ({ client } = await ensureInstanceForSession(instanceId, sessionId));
  } catch {
    return NextResponse.json(
      { error: "Instance not found or unavailable" },
      { status: 404 }
    );
  }

  try {
    await withTimeout(
      client.session.abort({ sessionID: sessionId }),
      getSDKCallTimeoutMs(),
      `session.abort for ${sessionId}`,
    );

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
