/**
 * Provider registry for the smart links system.
 *
 * Providers register themselves here. The registry exposes convenience
 * functions for detecting links from text and from accumulated messages.
 *
 * Built-in providers are imported and auto-registered at the bottom of
 * this file so callers only need to import the registry module.
 */

import type { AccumulatedMessage } from "@/lib/api-types";
import type { SmartLinkProvider, SmartLinkReference } from "./types";

// ─── Registry state ───────────────────────────────────────────────────────────

const _providers: SmartLinkProvider[] = [];

// ─── Public API ───────────────────────────────────────────────────────────────

/** Register a provider. Safe to call multiple times for the same provider (idempotent by name). */
export function registerProvider(provider: SmartLinkProvider): void {
  if (!_providers.find((p) => p.name === provider.name)) {
    _providers.push(provider);
  }
}

/** Return a copy of all registered providers. */
export function getProviders(): SmartLinkProvider[] {
  return [..._providers];
}

/** Look up a provider by name. Returns `undefined` when not found. */
export function getProvider(name: string): SmartLinkProvider | undefined {
  return _providers.find((p) => p.name === name);
}

/**
 * Detect all smart links from a string of text.
 * Runs every registered provider's detector and merges results, deduped by URL.
 */
export function detectSmartLinks(text: string): SmartLinkReference[] {
  const seen = new Set<string>();
  const results: SmartLinkReference[] = [];

  for (const provider of _providers) {
    for (const ref of provider.detectLinks(text)) {
      if (!seen.has(ref.url)) {
        seen.add(ref.url);
        results.push(ref);
      }
    }
  }

  return results;
}

/**
 * Scan all accumulated messages (bash tool outputs + assistant text parts)
 * and return every smart link found, deduped by URL, in first-appearance order.
 *
 * Consolidates the duplicated logic previously in `pr-utils.ts` and
 * `issue-utils.ts`.
 */
export function extractSmartLinksFromMessages(
  messages: AccumulatedMessage[]
): SmartLinkReference[] {
  const seen = new Set<string>();
  const results: SmartLinkReference[] = [];

  function addRefs(refs: SmartLinkReference[]): void {
    for (const ref of refs) {
      if (!seen.has(ref.url)) {
        seen.add(ref.url);
        results.push(ref);
      }
    }
  }

  for (const msg of messages) {
    for (const part of msg.parts) {
      if (part.type === "tool" && part.tool.toLowerCase() === "bash") {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const state = part.state as any;
        if (typeof state?.output === "string") {
          addRefs(detectSmartLinks(state.output));
        }
      } else if (part.type === "text") {
        addRefs(detectSmartLinks(part.text));
      }
    }
  }

  return results;
}

/**
 * Merge multiple arrays of smart link references into a single deduplicated
 * list. First source wins (preserves earlier-detected items first).
 */
export function mergeSmartLinkReferences(
  ...sources: (SmartLinkReference[] | undefined | null)[]
): SmartLinkReference[] {
  const seen = new Set<string>();
  const merged: SmartLinkReference[] = [];

  for (const source of sources) {
    if (!source) continue;
    for (const ref of source) {
      if (!seen.has(ref.url)) {
        seen.add(ref.url);
        merged.push(ref);
      }
    }
  }

  return merged;
}

// ─── Auto-register built-in providers ────────────────────────────────────────
// Import side-effects: each provider module calls registerProvider() on import.
// New providers: add an import here + implement SmartLinkProvider.

import "@/lib/smart-links/providers/github";
import "@/lib/smart-links/providers/linear";
