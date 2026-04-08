import { NextRequest, NextResponse } from "next/server";
import { ensureInstanceById } from "@/lib/server/opencode-client";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const MAX_FILE_RESULTS = 20;

// GET /api/instances/[id]/find/files?query=<q> — fuzzy-search files in an instance's workspace
export async function GET(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse> {
  const { id: instanceId } = await context.params;

  if (!instanceId) {
    return NextResponse.json({ error: "instanceId is required" }, { status: 400 });
  }

  const query = request.nextUrl.searchParams.get("query");
  if (!query || !query.trim()) {
    return NextResponse.json({ error: "query is required and must be non-empty" }, { status: 400 });
  }

  if (query.trim().length > 256) {
    return NextResponse.json({ error: "query must be 256 characters or fewer" }, { status: 400 });
  }

  let client;
  try {
    ({ client } = await ensureInstanceById(instanceId));
  } catch {
    return NextResponse.json(
      { error: "Instance not found or unavailable" },
      { status: 404 }
    );
  }

  try {
    const result = await client.find.files({ query: query.trim() });
    const files = result.data ?? [];
    // Cap results to prevent rendering extremely large lists
    const limited = files.slice(0, MAX_FILE_RESULTS);
    return NextResponse.json(limited, { status: 200 });
  } catch (err) {
    console.error(`[GET /api/instances/${instanceId}/find/files] Error:`, err);
    return NextResponse.json(
      { error: "Failed to search files" },
      { status: 500 }
    );
  }
}
