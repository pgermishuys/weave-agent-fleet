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
    const result = await respondToQuestion(
      dbSession.instance_id,
      questionId,
      answers as string[][]
    );
    if (!result.ok) {
      log.error("reply", "respondToQuestion returned non-2xx", {
        instanceId: dbSession.instance_id,
        questionId,
        status: result.status,
        alreadyAnswered: result.alreadyAnswered,
        body: result.body,
      });
      // 404/409 from the opencode server means the question is no longer
      // awaiting an answer (already replied/rejected/expired). Surface this
      // to the client so the UI can treat it as a benign race instead of an
      // error.
      if (result.alreadyAnswered) {
        return NextResponse.json(
          { ok: false, alreadyAnswered: true, status: result.status },
          { status: 200 }
        );
      }
      // status === 0 → upstream unreachable; map to 502. Otherwise proxy the
      // upstream status so the client shows something actionable.
      const proxyStatus =
        result.status === 0 ? 502 : Math.max(400, Math.min(599, result.status));
      return NextResponse.json(
        { error: "Question reply failed", status: result.status },
        { status: proxyStatus }
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
