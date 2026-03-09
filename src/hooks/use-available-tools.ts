"use client";

import { useState, useEffect, useCallback } from "react";
import { apiFetch } from "@/lib/api-client";

// ── Types ───────────────────────────────────────────────────────────────────

export interface AvailableTool {
  id: string;
  label: string;
  iconName: string;
  category: "editor" | "terminal" | "explorer";
}

interface AvailableToolsState {
  tools: AvailableTool[];
  isLoading: boolean;
  error?: string;
}

// ── Module-level cache (shared across all hook instances) ───────────────────

let moduleCache: AvailableTool[] | null = null;
let moduleFetchPromise: Promise<AvailableTool[]> | null = null;

async function fetchAvailableTools(): Promise<AvailableTool[]> {
  const response = await apiFetch("/api/available-tools");
  if (!response.ok) {
    throw new Error(`Failed to fetch available tools: HTTP ${response.status}`);
  }
  const data = (await response.json()) as { tools: AvailableTool[] };
  return data.tools;
}

// ── Hook ────────────────────────────────────────────────────────────────────

export function useAvailableTools(): AvailableToolsState {
  const [state, setState] = useState<AvailableToolsState>(() => ({
    tools: moduleCache ?? [],
    isLoading: !moduleCache,
    error: undefined,
  }));

  useEffect(() => {
    let cancelled = false;

    async function load() {
      // If we have cache, return it immediately but still revalidate
      if (moduleCache) {
        if (!cancelled) {
          setState({ tools: moduleCache, isLoading: false, error: undefined });
        }
      }

      // Deduplicate: if a fetch is already in-flight, reuse it
      if (!moduleFetchPromise) {
        moduleFetchPromise = fetchAvailableTools();
      }

      try {
        const tools = await moduleFetchPromise;
        moduleCache = tools;
        if (!cancelled) {
          setState({ tools, isLoading: false, error: undefined });
        }
      } catch (err) {
        if (!cancelled) {
          setState((prev) => ({
            tools: prev.tools, // keep stale data
            isLoading: false,
            error: err instanceof Error ? err.message : "Failed to load tools",
          }));
        }
      } finally {
        moduleFetchPromise = null;
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Filter tools by category. */
export function getToolsByCategory(
  tools: AvailableTool[],
  category: AvailableTool["category"]
): AvailableTool[] {
  return tools.filter((t) => t.category === category);
}

/**
 * Pick a sensible default tool from the available list.
 * Falls back: first editor → first tool → "vscode".
 */
export function getDefaultTool(available: AvailableTool[]): string {
  if (available.length === 0) return "vscode";
  const firstEditor = available.find((t) => t.category === "editor");
  if (firstEditor) return firstEditor.id;
  return available[0].id;
}

/** Find the label for a tool ID, or return the ID capitalized. */
export function getToolLabel(
  toolId: string,
  available: AvailableTool[]
): string {
  const tool = available.find((t) => t.id === toolId);
  return tool?.label ?? toolId.charAt(0).toUpperCase() + toolId.slice(1);
}

/**
 * Invalidate the client-side cache so the next render re-fetches.
 * Useful after config changes.
 */
export function invalidateToolsCache(): void {
  moduleCache = null;
  moduleFetchPromise = null;
}
