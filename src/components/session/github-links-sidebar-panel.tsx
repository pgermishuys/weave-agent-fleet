"use client";

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
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { PrReference } from "@/lib/pr-utils";
import type { IssueReference } from "@/lib/issue-utils";
import type {
  PrStatusResponse,
  IssueStatusResponse,
} from "@/integrations/github/types";

// ─── Types ─────────────────────────────────────────────────────────────────

interface GitHubLinksSidebarPanelProps {
  prs: PrReference[];
  prStatuses: Map<string, PrStatusResponse>;
  issues: IssueReference[];
  issueStatuses: Map<string, IssueStatusResponse>;
}

// ─── PR Status helpers (reused from PrSidebarPanel) ────────────────────────

function PrStatusIcon({
  status,
}: {
  status: PrStatusResponse | undefined;
}) {
  if (status === undefined) {
    return (
      <Loader2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground animate-spin mt-0.5" />
    );
  }
  if (status.merged) {
    return (
      <GitMerge className="h-3.5 w-3.5 shrink-0 text-purple-500 mt-0.5" />
    );
  }
  if (status.state === "closed") {
    return (
      <GitPullRequestClosed className="h-3.5 w-3.5 shrink-0 text-muted-foreground mt-0.5" />
    );
  }
  switch (status.checksStatus) {
    case "running":
    case "pending":
      return (
        <Clock className="h-3.5 w-3.5 shrink-0 text-amber-500 mt-0.5" />
      );
    case "failure":
      return (
        <CircleX className="h-3.5 w-3.5 shrink-0 text-red-500 mt-0.5" />
      );
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

// ─── Issue Status helpers ──────────────────────────────────────────────────

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
  return (
    <CircleDot className="h-3.5 w-3.5 shrink-0 text-green-500 mt-0.5" />
  );
}

function issueStatusLabel(
  status: IssueStatusResponse | undefined
): string {
  if (!status) return "Loading…";
  return status.state === "closed" ? "Closed" : "Open";
}

// ─── Component ─────────────────────────────────────────────────────────────

export function GitHubLinksSidebarPanel({
  prs,
  prStatuses,
  issues,
  issueStatuses,
}: GitHubLinksSidebarPanelProps) {
  const totalCount = prs.length + issues.length;
  const hasBoth = prs.length > 0 && issues.length > 0;

  return (
    <section data-testid="github-links-sidebar-panel">
      {/* Panel header */}
      <div className="flex items-center gap-1.5 mb-2">
        <GitFork className="h-3.5 w-3.5 text-muted-foreground" />
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          GitHub
        </p>
        <span className="ml-auto text-[10px] text-muted-foreground">
          {totalCount}
        </span>
      </div>

      {/* Pull Requests section */}
      {prs.length > 0 && (
        <>
          {hasBoth && (
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1 mt-1">
              Pull Requests
            </p>
          )}
          <div className="space-y-1.5">
            {prs.map((pr) => {
              const status = prStatuses.get(pr.url);
              const title = status?.title ?? `#${pr.number}`;
              const label = prStatusLabel(status);
              const isDraft = status?.draft === true;

              return (
                <a
                  key={pr.url}
                  href={pr.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={`${title} — ${label}`}
                  className="flex items-start gap-2 text-xs group hover:bg-accent/50 rounded-sm px-1 py-0.5 -mx-1 transition-colors"
                >
                  <PrStatusIcon status={status} />
                  <span className="flex-1 min-w-0 text-foreground/90 break-words group-hover:text-foreground">
                    <span className="line-clamp-2">{title}</span>
                    {isDraft && (
                      <Badge
                        variant="outline"
                        className="text-[10px] px-1 py-0 leading-tight shrink-0 text-muted-foreground border-border ml-1 align-middle"
                      >
                        draft
                      </Badge>
                    )}
                  </span>
                  <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground/50 opacity-0 group-hover:opacity-100 transition-opacity mt-0.5" />
                </a>
              );
            })}
          </div>
        </>
      )}

      {/* Issues section */}
      {issues.length > 0 && (
        <>
          {hasBoth && (
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1 mt-2.5">
              Issues
            </p>
          )}
          <div className="space-y-1.5">
            {issues.map((issue) => {
              const status = issueStatuses.get(issue.url);
              const title = status?.title ?? `#${issue.number}`;
              const label = issueStatusLabel(status);
              const labels = status?.labels ?? [];

              return (
                <a
                  key={issue.url}
                  href={issue.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={`${title} — ${label}`}
                  className="flex items-start gap-2 text-xs group hover:bg-accent/50 rounded-sm px-1 py-0.5 -mx-1 transition-colors"
                >
                  <IssueStatusIcon status={status} />
                  <span className="flex-1 min-w-0 text-foreground/90 break-words group-hover:text-foreground">
                    <span className="line-clamp-2">{title}</span>
                    {labels.slice(0, 3).map((l) => (
                      <Badge
                        key={l.name}
                        variant="outline"
                        className="text-[10px] px-1 py-0 leading-tight shrink-0 border-border ml-1 align-middle"
                        style={{
                          color: `#${l.color}`,
                          borderColor: `#${l.color}40`,
                        }}
                      >
                        {l.name}
                      </Badge>
                    ))}
                  </span>
                  <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground/50 opacity-0 group-hover:opacity-100 transition-opacity mt-0.5" />
                </a>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}
