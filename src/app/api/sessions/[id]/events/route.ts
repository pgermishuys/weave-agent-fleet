import { NextRequest } from "next/server";
import { ensureInstanceForSession } from "@/lib/server/opencode-client";
import { _recoveryComplete } from "@/lib/server/process-manager";
import { addListener } from "@/lib/server/instance-event-hub";
import { isRelevantToSession } from "@/lib/event-state";
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

  // Lookup instance to verify it exists
  let instance;
  try {
    ({ instance } = await ensureInstanceForSession(instanceId, sessionId));
  } catch {
    return new Response(
      JSON.stringify({ error: "Instance not found or unavailable" }),
      { status: 404, headers: { "Content-Type": "application/json" } }
    );
  }

  const abortController = new AbortController();
  request.signal.addEventListener("abort", () => abortController.abort());

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      // Send an immediate comment so the browser/proxy recognizes the stream
      // as active. Without this, some environments buffer the response until
      // real data arrives, delaying the EventSource onopen callback.
      controller.enqueue(encoder.encode(`: connected\n\n`));

      function send(event: SSEEvent) {
        if (abortController.signal.aborted) return;
        try {
          const data = `data: ${JSON.stringify(event)}\n\n`;
          controller.enqueue(encoder.encode(data));
        } catch {
          // Controller already closed — browser disconnected between abort check and enqueue
        }
      }

      function sendComment(comment: string) {
        if (abortController.signal.aborted) return;
        try {
          controller.enqueue(encoder.encode(`: ${comment}\n\n`));
        } catch {
          // Controller already closed
        }
      }

      // Keepalive timer to prevent proxies from closing idle connections
      const keepalive = setInterval(() => {
        if (abortController.signal.aborted) {
          clearInterval(keepalive);
          return;
        }
        sendComment("keepalive");
      }, KEEPALIVE_INTERVAL_MS);

      // Register as a listener on the instance event hub.
      // The hub owns the SDK subscription and handles reconnection transparently.
      // The browser SSE connection survives transient SDK stream interruptions.
      // Use instance.id (the live/recovered instance) — not the stale instanceId query param.
      const unsubscribe = addListener(instance.id, ({ type, properties }) => {
        if (abortController.signal.aborted) return;

        // Filter: only forward events relevant to this session
        if (!isRelevantToSession(type, properties, sessionId)) return;

        send({ type, properties });
      });

      // Clean up when browser disconnects
      abortController.signal.addEventListener("abort", () => {
        clearInterval(keepalive);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // already closed
        }
      });
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
    },
  });
}
