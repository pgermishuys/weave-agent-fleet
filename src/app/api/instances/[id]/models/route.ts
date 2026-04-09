import { NextRequest, NextResponse } from "next/server";
import { ensureInstanceById } from "@/lib/server/opencode-client";
import type { AvailableProvider } from "@/lib/api-types";

interface RouteContext {
  params: Promise<{ id: string }>;
}

// GET /api/instances/[id]/models — list models available on connected providers
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
    const result = await client.provider.list();
    const data = result.data;
    const connectedIds = new Set(data?.connected ?? []);

    const response: AvailableProvider[] = (data?.all ?? [])
      .filter((p) => connectedIds.has(p.id))
      .map((p) => ({
        id: p.id,
        name: p.name,
        models: Object.values(p.models).map((m) => ({
          id: m.id,
          name: m.name,
        })),
      }));

    return NextResponse.json(response, { status: 200 });
  } catch (err) {
    console.error(`[GET /api/instances/${instanceId}/models] Error:`, err);
    return NextResponse.json(
      { error: "Failed to list models" },
      { status: 500 }
    );
  }
}
