/**
 * Core types for the provider-agnostic smart links system.
 *
 * A "smart link" is any URL detected in session messages that can be enriched
 * with live status from an external service (GitHub, Linear, Jira, etc.).
 *
 * Adding a new provider requires:
 *   1. Implementing `SmartLinkProvider`
 *   2. Registering it via `registerProvider()` in the registry
 */

import type React from "react";

// ─── Reference ───────────────────────────────────────────────────────────────

/**
 * A detected link reference — provider-agnostic.
 *
 * `metadata` carries provider-specific structured data
 * (e.g. owner/repo/number for GitHub, teamKey/issueId for Linear).
 */
export interface SmartLinkReference {
  /** Registered provider name (e.g. "github", "linear") */
  provider: string;
  /** Provider-specific link type (e.g. "pull-request", "issue") */
  linkType: string;
  /** Full canonical URL — used as the unique key everywhere */
  url: string;
  /** Short human-readable label (e.g. "#123", "TEAM-456") */
  displayLabel: string;
  /** Provider-specific structured data */
  metadata: Record<string, unknown>;
}

// ─── Rate-limit info ──────────────────────────────────────────────────────────

export interface RateLimitInfo {
  remaining: number;
  resetAt: number; // Unix epoch seconds
}

// ─── Status endpoint result ───────────────────────────────────────────────────

export interface StatusFetchResult {
  /** Status data from the provider API — shape is provider-specific */
  status: unknown;
  /** Rate-limit info if the provider returned it */
  rateLimit?: RateLimitInfo;
}

// ─── Provider interface ───────────────────────────────────────────────────────

/**
 * Interface that every smart link provider must implement.
 * Each provider handles its own detection, status fetching, and rendering.
 */
export interface SmartLinkProvider {
  /** Unique identifier (lowercase, no spaces) — e.g. "github", "linear" */
  readonly name: string;
  /** Human-readable display name — e.g. "GitHub", "Linear" */
  readonly displayName: string;
  /** Lucide-compatible icon component for the provider header */
  readonly icon: React.ComponentType<{ className?: string }>;

  /**
   * Detect all smart link references in a string of text.
   * Returns an empty array when no links are found.
   */
  detectLinks(text: string): SmartLinkReference[];

  /**
   * Build the API URL to fetch status for a reference.
   * Returns `null` when the reference cannot be fetched (e.g. missing auth).
   */
  buildStatusUrl(ref: SmartLinkReference): string | null;

  /**
   * Parse a raw status API response into a normalised `StatusFetchResult`.
   * Called with the JSON body returned by `buildStatusUrl`.
   */
  parseStatusResponse(body: unknown): StatusFetchResult;

  /**
   * Return `true` when the given status is terminal (won't change again).
   * Terminal links are excluded from future polling cycles.
   */
  isTerminalStatus(status: unknown): boolean;

  /**
   * Render a single link row in the sidebar panel.
   * Must be a React component (can be a function component).
   */
  LinkRow: React.ComponentType<LinkRowProps>;
}

// ─── LinkRow props ────────────────────────────────────────────────────────────

export interface LinkRowProps {
  ref_: SmartLinkReference; // named ref_ to avoid collision with React's ref
  /** Raw status from the provider API, or `undefined` while loading */
  status: unknown;
  /** Called when the user clicks the dismiss button */
  onDismiss: () => void;
}
