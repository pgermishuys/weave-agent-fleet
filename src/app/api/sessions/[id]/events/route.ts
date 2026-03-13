import { NextRequest } from "next/server";
import { getClientForInstance } from "@/lib/server/opencode-client";
import { getInstance, _recoveryComplete } from "@/lib/server/process-manager";
import { isRelevantToSession } from "@/lib/event-state";
import { getSessionByOpencodeId, updateSessionStatus } from "@/lib/server/db-repository";
import {
  fireSessionCallbacks,
  fireSessionErrorCallbacks,
} from "@/lib/server/callback-service";
import type { SSEEvent } from "@/lib/api-types";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const KEEPALIVE_INTERVAL_MS = 15_000;

// GET /api/sessions/[id]/events?instanceId=xxx — SSE proxy for OpenCode event stream
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

  // Lookup instance first to get both client and directory atomically
  const instance = getInstance(instanceId);
  if (!instance || instance.status === "dead") {
    return new Response(
      JSON.stringify({ error: "Instance not found or unavailable" }),
      { status: 404, headers: { "Content-Type": "application/json" } }
    );
  }

  let client;
  try {
    client = getClientForInstance(instanceId);
  } catch {
    return new Response(
      JSON.stringify({ error: "Instance not found or unavailable" }),
      { status: 404, headers: { "Content-Type": "application/json" } }
    );
  }

  const directory = instance.directory;

  const abortController = new AbortController();
  request.signal.addEventListener("abort", () => abortController.abort());

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      function send(event: SSEEvent) {
        const data = `data: ${JSON.stringify(event)}\n\n`;
        controller.enqueue(encoder.encode(data));
      }

      function sendComment(comment: string) {
        controller.enqueue(encoder.encode(`: ${comment}\n\n`));
      }

      // Keepalive timer to prevent proxies from closing idle connections
      const keepalive = setInterval(() => {
        if (abortController.signal.aborted) {
          clearInterval(keepalive);
          return;
        }
        sendComment("keepalive");
      }, KEEPALIVE_INTERVAL_MS);

      try {
        const subscribeResult = await client.event.subscribe({
          directory,
        });

        // SDK returns { stream: AsyncGenerator } or the generator directly
        const eventStream =
          "stream" in subscribeResult
            ? (subscribeResult as { stream: AsyncIterable<unknown> }).stream
            : (subscribeResult as AsyncIterable<unknown>);

        // Track session busy state for completion detection
        let lastSessionStatus: "idle" | "busy" = "idle";

        for await (const rawEvent of eventStream) {
          if (abortController.signal.aborted) break;

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const event = rawEvent as any;
          const type: string = event?.type ?? "unknown";
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const properties: Record<string, any> = event?.properties ?? event ?? {};

          // Filter: only forward events relevant to this session
          if (!isRelevantToSession(type, properties, sessionId)) continue;

          send({ type, properties });

          // Trigger side effects (best-effort, after forwarding)
          try {
            if (type === "session.status") {
              const statusType: string = properties?.status?.type ?? "";
              if (statusType === "busy") {
                lastSessionStatus = "busy";
                // Transition back to active when session becomes busy again
                const dbSession = getSessionByOpencodeId(sessionId);
                if (dbSession && dbSession.status === "idle") {
                  updateSessionStatus(dbSession.id, "active");
                }
              } else if (statusType === "idle" && lastSessionStatus === "busy") {
                lastSessionStatus = "idle";
                const dbSession = getSessionByOpencodeId(sessionId);
                if (dbSession) {
                  updateSessionStatus(dbSession.id, "idle");
                  void fireSessionCallbacks(dbSession.opencode_session_id, instanceId);
                }
              }
            } else if (type === "session.idle" && lastSessionStatus === "busy") {
              lastSessionStatus = "idle";
              const dbSession = getSessionByOpencodeId(sessionId);
              if (dbSession) {
                updateSessionStatus(dbSession.id, "idle");
                void fireSessionCallbacks(dbSession.opencode_session_id, instanceId);
              }
            } else if (type === "error") {
              const dbSession = getSessionByOpencodeId(sessionId);
              if (dbSession) {
                void fireSessionErrorCallbacks(dbSession.opencode_session_id, instanceId);
              }
            }
          } catch {
            // Side effect failure must never break the SSE stream
          }
        }
      } catch (err) {
        if (!abortController.signal.aborted) {
          console.error(`[SSE /api/sessions/${sessionId}/events] Stream error:`, err);
          send({ type: "error", properties: { message: "Event stream interrupted" } });
        }
      } finally {
        clearInterval(keepalive);
        try {
          controller.close();
        } catch {
          // already closed
        }
      }
    },

    cancel() {
      abortController.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}
