"use client";

import { BookOpen, GitBranch, GitCommit, Tag } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { formatRelativeTime } from "@/lib/format-utils";
import type { RepositoryDetail } from "@/lib/api-types";

interface RepositorySummaryProps {
  detail: RepositoryDetail;
  now: number;
}

export function RepositorySummary({ detail, now }: RepositorySummaryProps) {
  return (
    <div className="space-y-6">
      {/* ── Branches ─────────────────────────────────────────────────────── */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <GitBranch className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Branches</h3>
          <Badge variant="secondary" className="text-xs">
            {detail.branches.length}
          </Badge>
        </div>

        {detail.branches.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">No branches found.</p>
        ) : (
          <div className="space-y-1">
            {detail.branches.map((branch) => (
              <div
                key={branch.name}
                className={`flex items-start justify-between gap-3 rounded-md px-3 py-2 text-sm ${
                  branch.isRemote ? "opacity-60" : ""
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-mono text-xs shrink-0">
                    {branch.name}
                  </span>
                  {branch.isCurrent && (
                    <Badge variant="outline" className="text-[10px] h-4 px-1 shrink-0">
                      HEAD
                    </Badge>
                  )}
                  {branch.message && (
                    <span className="text-muted-foreground truncate text-xs">
                      {branch.message}
                    </span>
                  )}
                </div>
                <div className="flex flex-col items-end gap-0.5 shrink-0 text-xs text-muted-foreground">
                  {branch.author && <span>{branch.author}</span>}
                  {branch.date && (
                    <span>{formatRelativeTime(branch.date, now)}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Tags ─────────────────────────────────────────────────────────── */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <Tag className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Tags</h3>
          <Badge variant="secondary" className="text-xs">
            {detail.tags.length}
          </Badge>
        </div>

        {detail.tags.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">No tags.</p>
        ) : (
          <div className="space-y-1">
            {detail.tags.map((tag) => (
              <div
                key={tag.name}
                className="flex items-center justify-between gap-3 rounded-md px-3 py-2 text-sm"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-mono text-xs shrink-0">{tag.name}</span>
                  <span className="text-muted-foreground text-xs truncate">
                    {tag.tagger ? tag.tagger : "lightweight tag"}
                  </span>
                </div>
                <div className="shrink-0 text-xs text-muted-foreground">
                  {tag.date && formatRelativeTime(tag.date, now)}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Recent Commits ───────────────────────────────────────────────── */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <GitCommit className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Recent Commits</h3>
        </div>

        {detail.recentCommits.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">No commits yet.</p>
        ) : (
          <div className="space-y-1">
            {detail.recentCommits.map((commit) => (
              <div
                key={commit.hash}
                className="flex items-start justify-between gap-3 rounded-md px-3 py-2 text-sm"
              >
                <div className="flex items-start gap-2 min-w-0">
                  <code className="text-[10px] font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded shrink-0">
                    {commit.shortHash}
                  </code>
                  <span className="truncate text-xs">{commit.message}</span>
                </div>
                <div className="flex flex-col items-end gap-0.5 shrink-0 text-xs text-muted-foreground">
                  {commit.author && <span>{commit.author}</span>}
                  {commit.date && (
                    <span>{formatRelativeTime(commit.date, now)}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── README ───────────────────────────────────────────────────────── */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <BookOpen className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">README</h3>
          {detail.readmeFilename && (
            <span className="text-xs text-muted-foreground">
              {detail.readmeFilename}
            </span>
          )}
        </div>

        {detail.readmeContent ? (
          <Card>
            <CardContent className="p-0">
              <pre className="text-xs font-mono whitespace-pre-wrap p-4 max-h-96 overflow-auto thin-scrollbar leading-relaxed">
                {detail.readmeContent}
              </pre>
            </CardContent>
          </Card>
        ) : (
          <p className="text-sm text-muted-foreground italic">No README found.</p>
        )}
      </section>
    </div>
  );
}
