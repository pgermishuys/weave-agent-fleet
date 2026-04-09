import { NextRequest, NextResponse } from "next/server";
import { ensureInstanceById } from "@/lib/server/opencode-client";
import type { AutocompleteCommand } from "@/lib/api-types";

interface RouteContext {
  params: Promise<{ id: string }>;
}

// GET /api/instances/[id]/commands — list available slash commands for an instance
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
    const result = await client.command.list();
    const commands = result.data ?? [];
    const response: AutocompleteCommand[] = commands.map((cmd) => ({
      name: cmd.name,
      description: cmd.description,
    }));
    return NextResponse.json(response, { status: 200 });
  } catch (err) {
    console.error(`[GET /api/instances/${instanceId}/commands] Error:`, err);
    return NextResponse.json(
      { error: "Failed to list commands" },
      { status: 500 }
    );
  }
}
