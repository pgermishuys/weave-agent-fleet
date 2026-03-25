/**
 * Utilities for extracting GitHub PR references from bash tool call outputs.
 * These are pure functions with no React dependencies — safe to import anywhere.
 */

import type { AccumulatedMessage } from "@/lib/api-types";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface PrReference {
  owner: string;   // e.g. "damianh"
  repo: string;    // e.g. "weave-agent-fleet"
  number: number;  // e.g. 123
  url: string;     // full URL: "https://github.com/damianh/weave-agent-fleet/pull/123"
}

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Case-insensitive match for the bash tool name. */
export function isBashTool(toolName: string): boolean {
  return toolName.toLowerCase() === "bash";
}

/** Regex that matches GitHub PR URLs. */
const PR_URL_REGEX = /https:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+)/g;

/**
 * Extracts unique `PrReference` objects from a string (e.g. bash tool output).
 * Returns an empty array if the input is not a non-empty string or contains no PR URLs.
 */
export function parsePrUrlsFromOutput(output: unknown): PrReference[] {
  if (typeof output !== "string" || output.trim() === "") return [];

  const seen = new Set<string>();
  const results: PrReference[] = [];

  // Reset lastIndex since we reuse the regex (global flag)
  PR_URL_REGEX.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = PR_URL_REGEX.exec(output)) !== null) {
    const [url, owner, repo, numberStr] = match;
    if (!seen.has(url)) {
      seen.add(url);
      results.push({ owner, repo, number: parseInt(numberStr, 10), url });
    }
  }

  return results;
}

/**
 * Scans ALL accumulated messages (forward order) to collect every GitHub PR URL
 * that appeared in bash tool output or assistant text parts.
 * Deduplicates by URL and preserves first-appearance order.
 */
export function extractPrReferences(messages: AccumulatedMessage[]): PrReference[] {
  const seen = new Set<string>();
  const results: PrReference[] = [];

  function addRefs(refs: PrReference[]): void {
    for (const ref of refs) {
      if (!seen.has(ref.url)) {
        seen.add(ref.url);
        results.push(ref);
      }
    }
  }

  for (const msg of messages) {
    for (const part of msg.parts) {
      if (part.type === "tool" && isBashTool(part.tool)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const state = part.state as any;
        addRefs(parsePrUrlsFromOutput(state?.output));
      } else if (part.type === "text") {
        addRefs(parsePrUrlsFromOutput(part.text));
      }
    }
  }

  return results;
}
