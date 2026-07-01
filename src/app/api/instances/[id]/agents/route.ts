import { NextRequest, NextResponse } from "next/server";
import { ensureInstanceById } from "@/lib/server/opencode-client";
import type { AutocompleteAgent } from "@/lib/api-types";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * Normalize an agent name into a stable identity key used for deduplication.
 *
 * The Weave plugin registers built-in agents under their bare config key
 * (e.g. "loom") but exposes them via OpenCode's `/agent` endpoint using the
 * display name (e.g. "Loom (Main Orchestrator)"). Meanwhile the deadlock
 * workaround in process-manager.ts:buildAgentModelConfig injects
 * `OPENCODE_CONFIG_CONTENT.agent.<name> = { model }`, which OpenCode treats
 * as a *separate* agent registration keyed by the bare name ("loom") rather
 * than an override of the plugin's entry. The result is two agents that are
 * the same logical agent but with different `name` strings:
 *   - "Loom (Main Orchestrator)" — from the plugin, has description + model
 *   - "loom"                     — from the config override, model only
 *
 * Stripping the " (...)" role suffix and lower-casing collapses both forms
 * onto the same key ("loom") so they can be deduplicated.
 */
export function agentIdentityKey(name: string): string {
  return name.replace(/\s*\([^)]*\)\s*$/, "").trim().toLowerCase();
}

/**
 * Deduplicate agents by identity key, preferring entries that carry richer
 * metadata (description, then color). When the winning entry is missing a
 * `model` that the discarded duplicate carried, the model is merged in so the
 * override is not lost.
 */
export function dedupeAgents(agents: AutocompleteAgent[]): AutocompleteAgent[] {
  const byKey = new Map<string, AutocompleteAgent>();
  for (const agent of agents) {
    const key = agentIdentityKey(agent.name);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, agent);
      continue;
    }
    // Prefer the entry that has a description; tie-break on color.
    const score = (a: AutocompleteAgent): number =>
      (a.description ? 2 : 0) + (a.color ? 1 : 0);
    const winner = score(agent) > score(existing) ? agent : existing;
    const loser = winner === agent ? existing : agent;
    // Preserve a model override that only the discarded entry carried.
    if (!winner.model && loser.model) {
      byKey.set(key, { ...winner, model: loser.model });
    } else {
      byKey.set(key, winner);
    }
  }
  return [...byKey.values()];
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
