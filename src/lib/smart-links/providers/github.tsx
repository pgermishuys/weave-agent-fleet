"use client";

/**
 * GitHub smart link provider.
 *
 * Detects GitHub PR and issue URLs from session messages, builds status
 * endpoint URLs, and renders link rows with PR/issue-specific status icons.
 *
 * Registered automatically when this module is imported (via the registry).
 */

import {
  GitPullRequest,
  GitPullRequestClosed,
  GitMerge,
  Clock,
  CircleX,
  CircleDot,
  CircleCheck,
  ExternalLink,
  Loader2,
  GitFork,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type {
  SmartLinkProvider,
  SmartLinkReference,
  StatusFetchResult,
  LinkRowProps,
} from "@/lib/smart-links/types";
import { registerProvider } from "@/lib/smart-links/registry";
import type {
  PrStatusResponse,
  IssueStatusResponse,
} from "@/integrations/github/types";

// ─── Constants ────────────────────────────────────────────────────────────────

const PROVIDER_NAME = "github";

// ─── Regexes ──────────────────────────────────────────────────────────────────

const PR_URL_REGEX =
  /https:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+)/g;
const ISSUE_URL_REGEX =
  /https:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/issues\/(\d+)/g;

// ─── Detection helpers ────────────────────────────────────────────────────────

function detectPrLinks(text: string): SmartLinkReference[] {
  PR_URL_REGEX.lastIndex = 0;
  const seen = new Set<string>();
  const results: SmartLinkReference[] = [];
  let match: RegExpExecArray | null;

  while ((match = PR_URL_REGEX.exec(text)) !== null) {
    const [url, owner, repo, numberStr] = match;
    if (!seen.has(url)) {
      seen.add(url);
      results.push({
        provider: PROVIDER_NAME,
        linkType: "pull-request",
        url,
        displayLabel: `#${numberStr}`,
        metadata: { owner, repo, number: parseInt(numberStr, 10) },
      });
    }
  }

  return results;
}

function detectIssueLinks(text: string): SmartLinkReference[] {
  ISSUE_URL_REGEX.lastIndex = 0;
  const seen = new Set<string>();
  const results: SmartLinkReference[] = [];
  let match: RegExpExecArray | null;

  while ((match = ISSUE_URL_REGEX.exec(text)) !== null) {
    const [url, owner, repo, numberStr] = match;
    if (!seen.has(url)) {
      seen.add(url);
      results.push({
        provider: PROVIDER_NAME,
        linkType: "issue",
        url,
        displayLabel: `#${numberStr}`,
        metadata: { owner, repo, number: parseInt(numberStr, 10) },
      });
    }
  }

  return results;
}

// ─── Status helpers ───────────────────────────────────────────────────────────

function isPrStatus(status: unknown): status is PrStatusResponse {
  return (
    typeof status === "object" &&
    status !== null &&
    "merged" in status &&
    "checksStatus" in status
  );
}

function isIssueStatus(status: unknown): status is IssueStatusResponse {
  return (
    typeof status === "object" &&
    status !== null &&
    "state" in status &&
    "labels" in status &&
    !("merged" in status)
  );
}

// ─── PR row component ─────────────────────────────────────────────────────────

function PrStatusIcon({ status }: { status: PrStatusResponse | undefined }) {
  if (status === undefined) {
    return (
      <Loader2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground animate-spin mt-0.5" />
    );
  }
  if (status.merged) {
    return <GitMerge className="h-3.5 w-3.5 shrink-0 text-purple-500 mt-0.5" />;
  }
  if (status.state === "closed") {
    return (
      <GitPullRequestClosed className="h-3.5 w-3.5 shrink-0 text-muted-foreground mt-0.5" />
    );
  }
  switch (status.checksStatus) {
    case "running":
    case "pending":
      return <Clock className="h-3.5 w-3.5 shrink-0 text-amber-500 mt-0.5" />;
    case "failure":
      return <CircleX className="h-3.5 w-3.5 shrink-0 text-red-500 mt-0.5" />;
    case "success":
    case "none":
    default:
      return (
        <GitPullRequest className="h-3.5 w-3.5 shrink-0 text-green-500 mt-0.5" />
      );
  }
}

function prStatusLabel(status: PrStatusResponse | undefined): string {
  if (!status) return "Loading…";
  if (status.merged) return "Merged";
  if (status.state === "closed") return "Closed";
  switch (status.checksStatus) {
    case "running":
    case "pending":
      return "Checks running";
    case "failure":
      return "Checks failed";
    case "success":
      return "Checks passed";
    default:
      return "Open";
  }
}

function PrLinkRow({ ref_, status, onDismiss }: LinkRowProps) {
  const prStatus = isPrStatus(status) ? status : undefined;
  const title = prStatus?.title ?? ref_.displayLabel;
  const label = prStatusLabel(prStatus);
  const isDraft = prStatus?.draft === true;

  return (
    <div className="flex items-start gap-2 text-xs group hover:bg-accent/50 rounded-sm px-1 py-0.5 -mx-1 transition-colors">
      <PrStatusIcon status={prStatus} />
      <a
        href={ref_.url}
        target="_blank"
        rel="noopener noreferrer"
        title={`${title} — ${label}`}
        className="flex-1 min-w-0 text-foreground/90 break-words group-hover:text-foreground"
      >
        <span className="line-clamp-2">{title}</span>
        {isDraft && (
          <Badge
            variant="outline"
            className="text-[10px] px-1 py-0 leading-tight shrink-0 text-muted-foreground border-border ml-1 align-middle"
          >
            draft
          </Badge>
        )}
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

// ─── Issue row component ──────────────────────────────────────────────────────

function IssueStatusIcon({
  status,
}: {
  status: IssueStatusResponse | undefined;
}) {
  if (status === undefined) {
    return (
      <Loader2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground animate-spin mt-0.5" />
    );
  }
  if (status.state === "closed") {
    return (
      <CircleCheck className="h-3.5 w-3.5 shrink-0 text-purple-500 mt-0.5" />
    );
  }
  return <CircleDot className="h-3.5 w-3.5 shrink-0 text-green-500 mt-0.5" />;
}

function issueStatusLabel(status: IssueStatusResponse | undefined): string {
  if (!status) return "Loading…";
  return status.state === "closed" ? "Closed" : "Open";
}

function IssueLinkRow({ ref_, status, onDismiss }: LinkRowProps) {
  const issueStatus = isIssueStatus(status) ? status : undefined;
  const title = issueStatus?.title ?? ref_.displayLabel;
  const label = issueStatusLabel(issueStatus);
  const labels = issueStatus?.labels ?? [];

  return (
    <div className="flex items-start gap-2 text-xs group hover:bg-accent/50 rounded-sm px-1 py-0.5 -mx-1 transition-colors">
      <IssueStatusIcon status={issueStatus} />
      <a
        href={ref_.url}
        target="_blank"
        rel="noopener noreferrer"
        title={`${title} — ${label}`}
        className="flex-1 min-w-0 text-foreground/90 break-words group-hover:text-foreground"
      >
        <span className="line-clamp-2">{title}</span>
        {labels.slice(0, 3).map((l) => (
          <Badge
            key={l.name}
            variant="outline"
            className="text-[10px] px-1 py-0 leading-tight shrink-0 border-border ml-1 align-middle"
            style={{ color: `#${l.color}`, borderColor: `#${l.color}40` }}
          >
            {l.name}
          </Badge>
        ))}
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

export const githubProvider: SmartLinkProvider = {
  name: PROVIDER_NAME,
  displayName: "GitHub",
  icon: GitFork,

  detectLinks(text: string): SmartLinkReference[] {
    const seen = new Set<string>();
    const results: SmartLinkReference[] = [];

    for (const ref of [...detectPrLinks(text), ...detectIssueLinks(text)]) {
      if (!seen.has(ref.url)) {
        seen.add(ref.url);
        results.push(ref);
      }
    }

    return results;
  },

  buildStatusUrl(ref: SmartLinkReference): string | null {
    const { owner, repo, number } = ref.metadata as {
      owner: string;
      repo: string;
      number: number;
    };

    if (!owner || !repo || !number) return null;

    if (ref.linkType === "pull-request") {
      return `/api/integrations/github/repos/${owner}/${repo}/pulls/${number}/status`;
    }
    if (ref.linkType === "issue") {
      return `/api/integrations/github/repos/${owner}/${repo}/issues/${number}/status`;
    }

    return null;
  },

  parseStatusResponse(body: unknown): StatusFetchResult {
    const statusBody = body as PrStatusResponse | IssueStatusResponse;
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
    if (isPrStatus(status)) return status.merged || status.state === "closed";
    if (isIssueStatus(status)) return status.state === "closed";
    return false;
  },

  LinkRow({ ref_, status, onDismiss }: LinkRowProps) {
    if (ref_.linkType === "pull-request") {
      return <PrLinkRow ref_={ref_} status={status} onDismiss={onDismiss} />;
    }
    return <IssueLinkRow ref_={ref_} status={status} onDismiss={onDismiss} />;
  },
};

// ─── Auto-register ────────────────────────────────────────────────────────────

registerProvider(githubProvider);
