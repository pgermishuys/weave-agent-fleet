import { NextRequest } from "next/server";
import { _recoveryComplete } from "@/lib/server/process-manager";
import { onActivityStatus } from "@/lib/server/activity-emitter";

const KEEPALIVE_INTERVAL_MS = 15_000;

// GET /api/activity-stream — global SSE endpoint for real-time activity status delivery.
// Clients receive activity_status events as sessions transition between busy/idle states,
// powering real-time sidebar updates without polling.
export async function GET(request: NextRequest): Promise<Response> {
  await _recoveryComplete;

  const abortController = new AbortController();
  request.signal.addEventListener("abort", () => abortController.abort());

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      function send(data: unknown) {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          // Controller may be closed
        }
      }

      function sendComment(comment: string) {
        try {
          controller.enqueue(encoder.encode(`: ${comment}\n\n`));
        } catch {
          // Controller may be closed
        }
      }

      // Keepalive to prevent proxies from closing idle connections
      const keepalive = setInterval(() => {
        if (abortController.signal.aborted) {
          clearInterval(keepalive);
          return;
        }
        sendComment("keepalive");
      }, KEEPALIVE_INTERVAL_MS);

      // Subscribe to ephemeral activity status events
      const unsubscribeActivity = onActivityStatus((payload) => {
        if (abortController.signal.aborted) return;
        send({ type: "activity_status", payload });
      });

      // Cleanup on abort
      abortController.signal.addEventListener("abort", () => {
        clearInterval(keepalive);
        unsubscribeActivity();
        try {
          controller.close();
        } catch {
          /* already closed */
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
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}
