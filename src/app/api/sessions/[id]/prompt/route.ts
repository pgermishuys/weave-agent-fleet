import { NextRequest, NextResponse } from "next/server";
import { ensureInstanceForSession } from "@/lib/server/opencode-client";
import { validateAttachments } from "@/lib/image-validation";
import type { SendPromptRequest } from "@/lib/api-types";
import type { TextPartInput, FilePartInput } from "@opencode-ai/sdk/v2";

interface RouteContext {
  params: Promise<{ id: string }>;
}

// POST /api/sessions/[id]/prompt — send a prompt (fire-and-forget, results come via SSE)
export async function POST(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse> {
  const { id: sessionId } = await context.params;

  let body: SendPromptRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { instanceId, text, agent, model, attachments } = body;

  if (!instanceId || typeof instanceId !== "string") {
    return NextResponse.json(
      { error: "instanceId is required" },
      { status: 400 }
    );
  }

  // Text is required unless attachments are present
  const hasText = text && typeof text === "string" && text.trim().length > 0;
  const hasAttachments = Array.isArray(attachments) && attachments.length > 0;

  if (!hasText && !hasAttachments) {
    return NextResponse.json(
      { error: "text or attachments required" },
      { status: 400 }
    );
  }

  // Validate attachments if present
  if (hasAttachments) {
    const validationErrors = validateAttachments(attachments);
    if (validationErrors.length > 0) {
      return NextResponse.json(
        { error: validationErrors.map((e) => e.message).join("; ") },
        { status: 400 }
      );
    }
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
    // Build parts array: text (if any) + file attachments (if any)
    const parts: Array<TextPartInput | FilePartInput> = [];

    if (hasText) {
      parts.push({ type: "text", text: text.trim() });
    }

    if (hasAttachments) {
      for (const att of attachments) {
        parts.push({
          type: "file",
          mime: att.mime,
          ...(att.filename ? { filename: att.filename } : {}),
          url: `data:${att.mime};base64,${att.data}`,
        });
      }
    }

    await client.session.promptAsync({
      sessionID: sessionId,
      parts,
      ...(agent ? { agent } : {}),
      ...(model ? { model } : {}),
    });
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    console.error(`[POST /api/sessions/${sessionId}/prompt] Error:`, err);
    return NextResponse.json(
      { error: "Failed to send prompt" },
      { status: 500 }
    );
  }
}
