import { NextRequest, NextResponse } from "next/server";
import { rejectQuestion } from "@/lib/server/opencode-client";
import { getSessionByOpencodeId } from "@/lib/server/db-repository";
import { log } from "@/lib/server/logger";

interface RouteContext {
  params: Promise<{ id: string; questionId: string }>;
}

// POST /api/sessions/[id]/questions/[questionId]/reject — reject/skip a question posed by the agent
export async function POST(
  _request: NextRequest,
  context: RouteContext
): Promise<NextResponse> {
  const { id: sessionId, questionId } = await context.params;

  // Validate questionId to prevent path traversal via encoded slashes
  if (!/^[a-zA-Z0-9_-]+$/.test(questionId)) {
    return NextResponse.json(
      { error: "Invalid question ID" },
      { status: 400 }
    );
  }

  const dbSession = getSessionByOpencodeId(sessionId);
  if (!dbSession) {
    log.error("reject", "Session not found", { sessionId });
    return NextResponse.json(
      { error: "Session not found" },
      { status: 404 }
    );
  }

  try {
    const ok = await rejectQuestion(dbSession.instance_id, questionId);
    if (!ok) {
      log.error("reject", "rejectQuestion returned false", {
        instanceId: dbSession.instance_id,
        questionId,
      });
      return NextResponse.json(
        { error: "Question rejection failed" },
        { status: 502 }
      );
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    log.error("reject", "Failed to reject question", {
      err,
      instanceId: dbSession.instance_id,
      questionId,
    });
    return NextResponse.json(
      { error: "Failed to reject question" },
      { status: 500 }
    );
  }
}
