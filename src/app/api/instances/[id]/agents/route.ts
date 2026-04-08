import { NextRequest, NextResponse } from "next/server";
import { ensureInstanceById } from "@/lib/server/opencode-client";
import type { AutocompleteAgent } from "@/lib/api-types";

interface RouteContext {
  params: Promise<{ id: string }>;
}

// GET /api/instances/[id]/agents — list available agents for an instance
export async function GET(
  _request: NextRequest,
  context: RouteContext
): Promise<NextResponse> {
  const { id: instanceId } = await context.params;

  if (!instanceId) {
    return NextResponse.json({ error: "instanceId is required" }, { status: 400 });
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
    const result = await client.app.agents();
    const agents = result.data ?? [];
    const response: AutocompleteAgent[] = agents.map((agent) => ({
      name: agent.name,
      description: agent.description,
      mode: agent.mode,
      color: agent.color,
      model: agent.model,
      hidden: agent.hidden,
    }));
    return NextResponse.json(response, { status: 200 });
  } catch (err) {
    console.error(`[GET /api/instances/${instanceId}/agents] Error:`, err);
    return NextResponse.json(
      { error: "Failed to list agents" },
      { status: 500 }
    );
  }
}
