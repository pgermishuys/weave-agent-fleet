import { NextRequest, NextResponse } from "next/server";
import { getClientForInstance } from "@/lib/server/opencode-client";
import { _recoveryComplete } from "@/lib/server/process-manager";
import { sliceMessages } from "@/lib/pagination-utils";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

// GET /api/sessions/[id]/messages?instanceId=xxx&limit=50&before=<messageId>&after=<messageId>
export async function GET(
  request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  // Wait for startup recovery before serving
  await _recoveryComplete;

  const { id: sessionId } = await context.params;
  const searchParams = request.nextUrl.searchParams;
  const instanceId = searchParams.get("instanceId");
  const limitParam = searchParams.get("limit");
  const before = searchParams.get("before") ?? undefined;
  const after = searchParams.get("after") ?? undefined;

  if (!instanceId) {
    return NextResponse.json(
      { error: "instanceId query parameter is required" },
      { status: 400 },
    );
  }

  const parsed = parseInt(limitParam ?? "", 10);
  const limit = Number.isFinite(parsed) ? Math.min(Math.max(1, parsed), MAX_LIMIT) : DEFAULT_LIMIT;

  let client;
  try {
    client = getClientForInstance(instanceId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      `[GET /api/sessions/${sessionId}/messages] getClientForInstance failed for instanceId=${instanceId}:`,
      msg,
    );
    return NextResponse.json(
      { error: "Instance not found or unavailable" },
      { status: 404 },
    );
  }

  try {
    const messagesResult = await client.session.messages({ sessionID: sessionId });
    const allMessages = messagesResult.data ?? [];

    // If `after` is specified, return all messages after the given ID (for incremental reconnect loading)
    if (after) {
      const afterIndex = allMessages.findIndex((m: { info: { id: string } }) => m.info.id === after);
      if (afterIndex === -1) {
        // Cursor not found (stale) — return ALL messages so the client can reconcile.
        // Using sliceMessages here would silently under-fetch (capped at `limit`).
        return NextResponse.json({
          messages: allMessages,
          pagination: {
            hasMore: false,
            oldestMessageId: allMessages.length > 0 ? allMessages[0].info.id : null,
            totalCount: allMessages.length,
          },
        }, { status: 200 });
      }
      const messagesAfter = allMessages.slice(afterIndex + 1);
      return NextResponse.json({
        messages: messagesAfter,
        pagination: {
          hasMore: false,
          oldestMessageId: messagesAfter.length > 0 ? messagesAfter[0].info.id : null,
          totalCount: allMessages.length,
        },
      }, { status: 200 });
    }

    const result = sliceMessages(allMessages, { limit, before });

    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    console.error(`[GET /api/sessions/${sessionId}/messages] Error:`, err);
    return NextResponse.json(
      { error: "Failed to retrieve messages" },
      { status: 500 },
    );
  }
}
