import { NextRequest, NextResponse } from "next/server";
import { respondToQuestion } from "@/lib/server/opencode-client";
import { getSessionByOpencodeId } from "@/lib/server/db-repository";
import { log } from "@/lib/server/logger";

interface RouteContext {
  params: Promise<{ id: string; questionId: string }>;
}

// POST /api/sessions/[id]/questions/[questionId]/reply — answer a question posed by the agent
export async function POST(
  request: NextRequest,
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const answers = (body as Record<string, unknown>)?.answers;
  if (
    !Array.isArray(answers) ||
    !answers.every(
      (a) => Array.isArray(a) && a.every((item) => typeof item === "string")
    )
  ) {
    return NextResponse.json(
      { error: "answers must be string[][]" },
      { status: 400 }
    );
  }

  const dbSession = getSessionByOpencodeId(sessionId);
  if (!dbSession) {
    log.error("reply", "Session not found", { sessionId });
    return NextResponse.json(
      { error: "Session not found" },
      { status: 404 }
    );
  }

  try {
    const ok = await respondToQuestion(
      dbSession.instance_id,
      questionId,
      answers as string[][]
    );
    if (!ok) {
      log.error("reply", "respondToQuestion returned false", {
        instanceId: dbSession.instance_id,
        questionId,
      });
      return NextResponse.json(
        { error: "Question reply failed" },
        { status: 502 }
      );
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    log.error("reply", "Failed to reply to question", {
      err,
      instanceId: dbSession.instance_id,
      questionId,
    });
    return NextResponse.json(
      { error: "Failed to reply to question" },
      { status: 500 }
    );
  }
}
