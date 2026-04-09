/**
 * Utilities for extracting GitHub issue references from bash tool call outputs
 * and assistant text parts.
 * These are pure functions with no React dependencies — safe to import anywhere.
 */

import type { AccumulatedMessage } from "@/lib/api-types";
import { isBashTool } from "@/lib/pr-utils";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface IssueReference {
  owner: string; // e.g. "damianh"
  repo: string; // e.g. "weave-agent-fleet"
  number: number; // e.g. 42
  url: string; // full URL: "https://github.com/damianh/weave-agent-fleet/issues/42"
}

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Regex that matches GitHub issue URLs (but NOT pull request URLs). */
const ISSUE_URL_REGEX =
  /https:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/issues\/(\d+)/g;

/**
 * Extracts unique `IssueReference` objects from a string (e.g. bash tool output).
 * Returns an empty array if the input is not a non-empty string or contains no
 * issue URLs.
 */
export function parseIssueUrlsFromOutput(output: unknown): IssueReference[] {
  if (typeof output !== "string" || output.trim() === "") return [];

  const seen = new Set<string>();
  const results: IssueReference[] = [];

  // Reset lastIndex since we reuse the regex (global flag)
  ISSUE_URL_REGEX.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = ISSUE_URL_REGEX.exec(output)) !== null) {
    const [url, owner, repo, numberStr] = match;
    if (!seen.has(url)) {
      seen.add(url);
      results.push({ owner, repo, number: parseInt(numberStr, 10), url });
    }
  }

  return results;
}

/**
 * Scans ALL accumulated messages (forward order) to collect every GitHub issue URL
 * that appeared in bash tool output or assistant text parts.
 * Deduplicates by URL and preserves first-appearance order.
 */
export function extractIssueReferences(
  messages: AccumulatedMessage[]
): IssueReference[] {
  const seen = new Set<string>();
  const results: IssueReference[] = [];

  function addRefs(refs: IssueReference[]): void {
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
        addRefs(parseIssueUrlsFromOutput(state?.output));
      } else if (part.type === "text") {
        addRefs(parseIssueUrlsFromOutput(part.text));
      }
    }
  }

  return results;
}
