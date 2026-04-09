import { NextRequest, NextResponse } from "next/server";
import { ensureInstanceForSession } from "@/lib/server/opencode-client";
import type { SendCommandRequest, SendCommandResponse } from "@/lib/api-types";

interface RouteContext {
  params: Promise<{ id: string }>;
}

// POST /api/sessions/[id]/command — execute a slash command via session.command()
//
// Invokes the command through the dedicated SDK method (fire-and-forget).
// session.command() is BLOCKING on the server (it awaits the full LLM response),
// so we intentionally do NOT await it — we fire it and return 200 immediately.
// The frontend receives live updates via the opencode SSE event bus regardless.
export async function POST(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse> {
  const { id: sessionId } = await context.params;

  let body: SendCommandRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { instanceId, command, args, agent, model } = body;

  if (!instanceId || typeof instanceId !== "string") {
    return NextResponse.json(
      { error: "instanceId is required" },
      { status: 400 }
    );
  }

  if (!command || typeof command !== "string" || !command.trim()) {
    return NextResponse.json(
      { error: "command is required and must be non-empty" },
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

  // Fire-and-forget: session.command() blocks until the full LLM response
  // completes (unlike promptAsync which returns immediately). We fire it
  // without awaiting so the HTTP response returns instantly. Errors are
  // logged but cannot be surfaced to the caller.
  const modelString =
    model ? `${model.providerID}/${model.modelID}` : undefined;

  client.session
    .command({
      sessionID: sessionId,
      command: command.trim(),
      arguments: args ?? "",
      ...(agent ? { agent } : {}),
      ...(modelString ? { model: modelString } : {}),
    })
    .catch((err: unknown) => {
      console.error(`[POST /api/sessions/${sessionId}/command] Error:`, err);
    });

  const responseBody: SendCommandResponse = { success: true, sessionId };
  return NextResponse.json(responseBody, { status: 200 });
}
