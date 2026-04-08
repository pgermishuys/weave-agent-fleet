import { NextRequest } from "next/server";
import { ensureInstanceForSession } from "@/lib/server/opencode-client";
import { _recoveryComplete } from "@/lib/server/process-manager";
import { withTimeout, getSDKCallTimeoutMs } from "@/lib/server/async-utils";

interface RouteContext {
  params: Promise<{ id: string }>;
}

// GET /api/sessions/[id]/status?instanceId=xxx — fetch live session status from SDK
export async function GET(
  request: NextRequest,
  context: RouteContext
): Promise<Response> {
  // Wait for startup recovery before serving — ensures instances Map is populated
  await _recoveryComplete;

  const { id: sessionId } = await context.params;
  const instanceId = request.nextUrl.searchParams.get("instanceId");

  if (!instanceId) {
    return new Response(
      JSON.stringify({ error: "instanceId query parameter is required" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  // Lookup instance to get directory, then get client — try/catch pattern
  // consistent with [id]/events/route.ts
  let client;
  let instance;
  try {
    ({ client, instance } = await ensureInstanceForSession(instanceId, sessionId));
  } catch {
    return new Response(
      JSON.stringify({ error: "Instance not found or unavailable" }),
      { status: 404, headers: { "Content-Type": "application/json" } }
    );
  }

  try {
    const result = await withTimeout(
      client.session.status({ directory: instance.directory }),
      getSDKCallTimeoutMs(),
      `session.status for instance ${instanceId}`,
    );

    const statusMap = (result.data ?? {}) as Record<string, { type: string }>;
    const liveStatus = statusMap[sessionId];

    // busy or retry → "busy" for UI purposes; absent from map → "idle"
    if (liveStatus?.type === "busy" || liveStatus?.type === "retry") {
      return new Response(
        JSON.stringify({ status: "busy" }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ status: "idle" }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch {
    return new Response(
      JSON.stringify({ error: "Failed to fetch session status" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
