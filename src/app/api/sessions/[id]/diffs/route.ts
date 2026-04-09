import { NextRequest, NextResponse } from "next/server";
import { ensureInstanceForSession } from "@/lib/server/opencode-client";
import type { FileDiffItem } from "@/lib/api-types";
import { withTimeout, getSDKCallTimeoutMs } from "@/lib/server/async-utils";

interface RouteContext {
  params: Promise<{ id: string }>;
}

// GET /api/sessions/[id]/diffs?instanceId=xxx — get file diffs for a session
export async function GET(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse> {
  const { id: sessionId } = await context.params;
  const instanceId = request.nextUrl.searchParams.get("instanceId");
  const messageID = request.nextUrl.searchParams.get("messageID");

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
    const result = await withTimeout(
      client.session.diff({ sessionID: sessionId, ...(messageID ? { messageID } : {}) }),
      getSDKCallTimeoutMs(),
      `session.diff for ${sessionId}`,
    );

    const sdkDiffs = result.data ?? [];

    const fileDiffItems: FileDiffItem[] = sdkDiffs.map((d) => {
      let status: FileDiffItem["status"];
      if (!d.before) {
        status = "added";
      } else if (!d.after) {
        status = "deleted";
      } else {
        status = "modified";
      }

      return {
        file: d.file,
        before: d.before,
        after: d.after,
        additions: d.additions,
        deletions: d.deletions,
        status,
      };
    });

    return NextResponse.json(fileDiffItems, { status: 200 });
  } catch (err) {
    console.error(`[GET /api/sessions/${sessionId}/diffs] Error:`, err);
    return NextResponse.json(
      { error: "Failed to retrieve diffs" },
      { status: 500 }
    );
  }
}
