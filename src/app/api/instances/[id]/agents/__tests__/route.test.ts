import { describe, it, expect } from "vitest";
import { agentIdentityKey, dedupeAgents } from "@/app/api/instances/[id]/agents/route";
import type { AutocompleteAgent } from "@/lib/api-types";

const model = (id: string): { modelID: string; providerID: string } => ({
  modelID: id,
  providerID: "opencode-go",
});

const agent = (overrides: Partial<AutocompleteAgent> & { name: string }): AutocompleteAgent => ({
  mode: "subagent",
  ...overrides,
});

describe("agentIdentityKey", () => {
  it("strips a parenthetical role suffix and lower-cases", () => {
    expect(agentIdentityKey("Loom (Main Orchestrator)")).toBe("loom");
    expect(agentIdentityKey("Tapestry (Execution Orchestrator)")).toBe("tapestry");
    expect(agentIdentityKey("Shuttle (Domain Specialist)")).toBe("shuttle");
  });

  it("leaves bare names intact (lower-cased)", () => {
    expect(agentIdentityKey("loom")).toBe("loom");
    expect(agentIdentityKey("Loom")).toBe("loom");
    expect(agentIdentityKey("build")).toBe("build");
  });

  it("is a no-op for names without a trailing parenthetical", () => {
    expect(agentIdentityKey("spec-assistant")).toBe("spec-assistant");
    expect(agentIdentityKey("ultra-concise")).toBe("ultra-concise");
  });
});

describe("dedupeAgents", () => {
  it("collapses the plugin display-name variant with the bare config-override variant", () => {
    const loomPlugin = agent({
      name: "Loom (Main Orchestrator)",
      description: "Loom (Main Orchestrator)",
      mode: "primary",
      model: model("glm-5.2"),
    });
    const loomBare = agent({
      name: "loom",
      mode: "all",
      model: model("glm-5.2"),
    });

    const result = dedupeAgents([loomPlugin, loomBare]);

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Loom (Main Orchestrator)");
    expect(result[0].description).toBe("Loom (Main Orchestrator)");
    expect(result[0].mode).toBe("primary");
    expect(result[0].model).toEqual(model("glm-5.2"));
  });

  it("keeps the richer entry regardless of input order", () => {
    const loomPlugin = agent({
      name: "Loom (Main Orchestrator)",
      description: "Loom (Main Orchestrator)",
      mode: "primary",
      model: model("glm-5.2"),
    });
    const loomBare = agent({ name: "loom", mode: "all", model: model("glm-5.2") });

    const result = dedupeAgents([loomBare, loomPlugin]);

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Loom (Main Orchestrator)");
    expect(result[0].description).toBe("Loom (Main Orchestrator)");
  });

  it("merges a model override from the bare entry when the plugin entry lacks one", () => {
    const loomPlugin = agent({
      name: "Loom (Main Orchestrator)",
      description: "Loom (Main Orchestrator)",
      mode: "primary",
      // no model on the plugin side
    });
    const loomBare = agent({
      name: "loom",
      mode: "all",
      model: model("glm-5.2"),
    });

    const result = dedupeAgents([loomPlugin, loomBare]);

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Loom (Main Orchestrator)");
    expect(result[0].model).toEqual(model("glm-5.2"));
  });

  it("dedupes all eight weave built-in pairs", () => {
    const pairs: Array<[string, string, string]> = [
      ["Loom (Main Orchestrator)", "loom", "primary"],
      ["Tapestry (Execution Orchestrator)", "tapestry", "primary"],
      ["Shuttle (Domain Specialist)", "shuttle", "all"],
      ["Spindle (External Researcher)", "spindle", "subagent"],
      ["Warp (Security Auditor)", "warp", "subagent"],
      ["Weft (Reviewer/Auditor)", "weft", "subagent"],
      ["Thread (Codebase Explorer)", "thread", "subagent"],
      ["Pattern (Strategic Planner)", "pattern", "subagent"],
    ];
    const input: AutocompleteAgent[] = [];
    for (const [display, bare, mode] of pairs) {
      input.push(agent({ name: display, description: display, mode, model: model("x") }));
      input.push(agent({ name: bare, mode: "all", model: model("x") }));
    }

    const result = dedupeAgents(input);

    expect(result).toHaveLength(8);
    expect(result.map((a) => a.name).sort()).toEqual(
      pairs.map(([d]) => d).sort()
    );
    for (const a of result) {
      expect(a.description).toBe(a.name);
    }
  });

  it("leaves unrelated agents untouched", () => {
    const build = agent({ name: "build", description: "The default agent.", mode: "primary" });
    const plan = agent({ name: "plan", mode: "primary" });
    const explore = agent({ name: "explore", description: "Fast agent...", mode: "subagent" });

    const result = dedupeAgents([build, plan, explore]);

    expect(result).toHaveLength(3);
  });

  it("documents the shared-base-word heuristic: a bare built-in and a parenthetical custom variant collapse onto the richer entry", () => {
    // Heuristic trade-off: "summary" (built-in) and a hypothetical
    // "Summary (Weekly Report)" custom agent both normalize to "summary".
    // They collapse, keeping the richer (described) entry. In practice the
    // only parenthetical agents are the Weave built-ins whose bare twins are
    // the config-override duplicates, so this collision is the intended one.
    const summary = agent({ name: "summary", mode: "primary" });
    const summaryReport = agent({
      name: "Summary (Weekly Report)",
      description: "Weekly report",
      mode: "subagent",
    });

    const result = dedupeAgents([summary, summaryReport]);

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Summary (Weekly Report)");
  });
});