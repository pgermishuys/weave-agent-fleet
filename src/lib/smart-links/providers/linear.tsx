"use client";

/**
 * Linear smart link provider.
 *
 * Detects Linear issue URLs from session messages, builds status endpoint URLs,
 * and renders link rows with state-type icons.
 *
 * Linear URL format: https://linear.app/{workspace}/issue/{TEAM-123}
 * The UUID required for the API is resolved via the issue identifier.
 *
 * Registered automatically when this module is imported.
 */

import {
  CircleDot,
  CircleCheck,
  CircleX,
  Loader2,
  ExternalLink,
  X,
  LayoutList,
} from "lucide-react";
import type {
  SmartLinkProvider,
  SmartLinkReference,
  StatusFetchResult,
  LinkRowProps,
} from "@/lib/smart-links/types";
import { registerProvider } from "@/lib/smart-links/registry";
import type { LinearIssueStatusResponse } from "@/integrations/linear/types";

// ─── Constants ────────────────────────────────────────────────────────────────

const PROVIDER_NAME = "linear";

// ─── Regex ────────────────────────────────────────────────────────────────────

// Matches: https://linear.app/{workspace}/issue/{TEAM-123}
// Captures: workspace, identifier (e.g. "TEAM-123")
const LINEAR_ISSUE_REGEX =
  /https:\/\/linear\.app\/([^/\s]+)\/issue\/([A-Z][A-Z0-9]*-\d+)/g;

// ─── Status helpers ───────────────────────────────────────────────────────────

function isLinearStatus(status: unknown): status is LinearIssueStatusResponse {
  return (
    typeof status === "object" &&
    status !== null &&
    "identifier" in status &&
    "state" in status
  );
}

function isTerminalLinearState(
  stateType: LinearIssueStatusResponse["state"]["type"]
): boolean {
  return stateType === "completed" || stateType === "cancelled";
}

// ─── Status icon ──────────────────────────────────────────────────────────────

function LinearStatusIcon({
  status,
}: {
  status: LinearIssueStatusResponse | undefined;
}) {
  if (!status) {
    return (
      <Loader2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground animate-spin mt-0.5" />
    );
  }

  switch (status.state.type) {
    case "completed":
      return (
        <CircleCheck className="h-3.5 w-3.5 shrink-0 text-purple-500 mt-0.5" />
      );
    case "cancelled":
      return (
        <CircleX className="h-3.5 w-3.5 shrink-0 text-muted-foreground mt-0.5" />
      );
    case "started":
      return (
        <CircleDot
          className="h-3.5 w-3.5 shrink-0 mt-0.5"
          style={{ color: status.state.color }}
        />
      );
    default:
      return (
        <CircleDot className="h-3.5 w-3.5 shrink-0 text-muted-foreground mt-0.5" />
      );
  }
}

// ─── Link row ─────────────────────────────────────────────────────────────────

function LinearLinkRow({ ref_, status, onDismiss }: LinkRowProps) {
  const linearStatus = isLinearStatus(status) ? status : undefined;
  const title = linearStatus?.title ?? ref_.displayLabel;
  const stateName = linearStatus?.state.name ?? "Loading…";

  return (
    <div className="flex items-start gap-2 text-xs group hover:bg-accent/50 rounded-sm px-1 py-0.5 -mx-1 transition-colors">
      <LinearStatusIcon status={linearStatus} />
      <a
        href={ref_.url}
        target="_blank"
        rel="noopener noreferrer"
        title={`${title} — ${stateName}`}
        className="flex-1 min-w-0 text-foreground/90 break-words group-hover:text-foreground"
      >
        <span className="line-clamp-2">
          <span className="text-muted-foreground mr-1">{ref_.displayLabel}</span>
          {title !== ref_.displayLabel && title}
        </span>
      </a>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDismiss();
        }}
        title="Dismiss link"
        className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0 text-muted-foreground/60 hover:text-muted-foreground mt-0.5"
      >
        <X className="h-3 w-3" />
      </button>
      <a
        href={ref_.url}
        target="_blank"
        rel="noopener noreferrer"
        className="shrink-0 mt-0.5"
        tabIndex={-1}
      >
        <ExternalLink className="h-3 w-3 text-muted-foreground/50 opacity-0 group-hover:opacity-100 transition-opacity" />
      </a>
    </div>
  );
}

// ─── Provider implementation ──────────────────────────────────────────────────

export const linearProvider: SmartLinkProvider = {
  name: PROVIDER_NAME,
  displayName: "Linear",
  icon: LayoutList,

  detectLinks(text: string): SmartLinkReference[] {
    LINEAR_ISSUE_REGEX.lastIndex = 0;
    const seen = new Set<string>();
    const results: SmartLinkReference[] = [];
    let match: RegExpExecArray | null;

    while ((match = LINEAR_ISSUE_REGEX.exec(text)) !== null) {
      const [url, workspace, identifier] = match;
      if (!seen.has(url)) {
        seen.add(url);
        results.push({
          provider: PROVIDER_NAME,
          linkType: "issue",
          url,
          displayLabel: identifier,
          metadata: { workspace, identifier },
        });
      }
    }

    return results;
  },

  buildStatusUrl(ref: SmartLinkReference): string | null {
    const { identifier } = ref.metadata as { identifier: string };
    if (!identifier) return null;
    // Use the identifier as the path param; the API route resolves it
    return `/api/integrations/linear/issues/${encodeURIComponent(identifier)}/status`;
  },

  parseStatusResponse(body: unknown): StatusFetchResult {
    const statusBody = body as LinearIssueStatusResponse;
    const rateLimit =
      statusBody.rateLimitRemaining !== undefined &&
      statusBody.rateLimitReset !== undefined
        ? {
            remaining: statusBody.rateLimitRemaining,
            resetAt: statusBody.rateLimitReset,
          }
        : undefined;

    return { status: body, rateLimit };
  },

  isTerminalStatus(status: unknown): boolean {
    if (!isLinearStatus(status)) return false;
    return isTerminalLinearState(status.state.type);
  },

  LinkRow: LinearLinkRow,
};

// ─── Auto-register ────────────────────────────────────────────────────────────

registerProvider(linearProvider);
