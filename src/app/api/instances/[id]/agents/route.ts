import { NextRequest, NextResponse } from "next/server";
import { ensureInstanceById } from "@/lib/server/opencode-client";
import type { AutocompleteAgent } from "@/lib/api-types";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * Deduplicate agents by name, preferring entries that carry richer metadata
 * (description or color). OpenCode merges configs from multiple sources and
 * array-merges the `plugin` key, so when both the Weave plugin (which
 * registers built-in agents like "Loom (Main Orchestrator)" with description
 * and color) and an `OPENCODE_CONFIG_CONTENT.agent.<name>` override (which
 * only carries `model`) are present, two agents with the same `name` but
 * differing metadata appear. The bare one is a side-effect of the deadlock
 * workaround in process-manager.ts:buildAgentModelConfig and is missing the
 * prompt_append/skills/description the plugin's entry has, so drop it.
 */
function dedupeAgents(agents: AutocompleteAgent[]): AutocompleteAgent[] {
  const byName = new Map<string, AutocompleteAgent>();
  for (const agent of agents) {
    const existing = byName.get(agent.name);
    if (!existing) {
      byName.set(agent.name, agent);
      continue;
    }
    // Prefer the entry that has a description; tie-break on color, then mode.
    const score = (a: AutocompleteAgent): number =>
      (a.description ? 2 : 0) + (a.color ? 1 : 0);
    if (score(agent) > score(existing)) {
      byName.set(agent.name, agent);
    }
  }
  return [...byName.values()];
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
    return NextResponse.json(dedupeAgents(response), { status: 200 });
  } catch (err) {
    console.error(`[GET /api/instances/${instanceId}/agents] Error:`, err);
    return NextResponse.json(
      { error: "Failed to list agents" },
      { status: 500 }
    );
  }
}
