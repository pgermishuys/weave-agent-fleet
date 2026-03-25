"use client";

import {
  GitPullRequest,
  GitPullRequestClosed,
  GitMerge,
  Clock,
  CircleX,
  ExternalLink,
  Loader2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { PrReference } from "@/lib/pr-utils";
import type { PrStatusResponse } from "@/integrations/github/types";

// ─── Types ─────────────────────────────────────────────────────────────────

interface PrSidebarPanelProps {
  prs: PrReference[];
  statuses: Map<string, PrStatusResponse>;
}

// ─── Status icon ───────────────────────────────────────────────────────────

function PrStatusIcon({
  status,
}: {
  status: PrStatusResponse | undefined;
}) {
  // Still loading
  if (status === undefined) {
    return (
      <Loader2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground animate-spin mt-0.5" />
    );
  }

  // Merged — purple merge icon
  if (status.merged) {
    return <GitMerge className="h-3.5 w-3.5 shrink-0 text-purple-500 mt-0.5" />;
  }

  // Closed but not merged — grey closed icon
  if (status.state === "closed") {
    return (
      <GitPullRequestClosed className="h-3.5 w-3.5 shrink-0 text-muted-foreground mt-0.5" />
    );
  }

  // Open PR — icon depends on CI status
  switch (status.checksStatus) {
    case "running":
    case "pending":
      return <Clock className="h-3.5 w-3.5 shrink-0 text-amber-500 mt-0.5" />;
    case "failure":
      return <CircleX className="h-3.5 w-3.5 shrink-0 text-red-500 mt-0.5" />;
    case "success":
    case "none":
    default:
      return <GitPullRequest className="h-3.5 w-3.5 shrink-0 text-green-500 mt-0.5" />;
  }
}

function statusLabel(status: PrStatusResponse | undefined): string {
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

// ─── Component ─────────────────────────────────────────────────────────────

export function PrSidebarPanel({ prs, statuses }: PrSidebarPanelProps) {
  return (
    <section data-testid="pr-sidebar-panel">
      {/* Header */}
      <div className="flex items-center gap-1.5 mb-2">
        <GitPullRequest className="h-3.5 w-3.5 text-muted-foreground" />
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Pull Requests
        </p>
        <span className="ml-auto text-[10px] text-muted-foreground">
          {prs.length}
        </span>
      </div>

      {/* PR items */}
      <div className="space-y-1.5">
        {prs.map((pr) => {
          const status = statuses.get(pr.url);
          const title = status?.title ?? `#${pr.number}`;
          const label = statusLabel(status);
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
    </section>
  );
}
