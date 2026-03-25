"use client";

import { use } from "react";
import {
  Calendar,
  Clock,
  ExternalLink,
  FileWarning,
  GitCommit,
  Loader2,
} from "lucide-react";
import { Header } from "@/components/layout/header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useRepositoryDetail } from "@/hooks/use-repository-detail";
import { useRelativeTime } from "@/hooks/use-relative-time";
import { formatRelativeTime } from "@/lib/format-utils";
import { RepositorySummary } from "@/components/repositories/repository-summary";

interface PageProps {
  params: Promise<{ path: string }>;
}

export default function RepositoryDetailPage({ params }: PageProps) {
  const { path: encodedPath } = use(params);
  const repoPath = decodeURIComponent(encodedPath);

  const repoName = repoPath.split(/[\\/]/).filter(Boolean).at(-1) ?? repoPath;
  const { detail, isLoading, error } = useRepositoryDetail(repoPath);
  const now = useRelativeTime();

  return (
    <div className="flex flex-col h-full">
      <Header title={repoName} subtitle={repoPath} />
      <div className="flex-1 overflow-auto thin-scrollbar p-6">
        {isLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground py-8">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm">Loading repository info…</span>
          </div>
        ) : error ? (
          <div className="py-8">
            <p className="text-sm text-destructive">{error}</p>
            <p className="text-xs text-muted-foreground mt-1">{repoPath}</p>
          </div>
        ) : detail ? (
          <div className="space-y-6">
            {/* Stats Banner */}
            <Card>
              <CardContent className="pt-4 pb-4">
                <div className="flex flex-wrap items-center gap-0">
                  {/* Uncommitted */}
                  <div className="flex flex-col items-center px-4 py-1 min-w-[120px]">
                    <div className="flex items-center gap-1.5 text-muted-foreground mb-0.5">
                      <FileWarning className="h-4 w-4" />
                      <span className="text-xs">Uncommitted</span>
                    </div>
                    <span className="text-2xl font-semibold tabular-nums">
                      {detail.uncommittedCount}
                    </span>
                    <span className="text-xs text-muted-foreground">files</span>
                  </div>

                  <Separator orientation="vertical" className="h-12 self-center" />

                  {/* Total Commits */}
                  <div className="flex flex-col items-center px-4 py-1 min-w-[120px]">
                    <div className="flex items-center gap-1.5 text-muted-foreground mb-0.5">
                      <GitCommit className="h-4 w-4" />
                      <span className="text-xs">Commits</span>
                    </div>
                    <span className="text-2xl font-semibold tabular-nums">
                      {detail.totalCommitCount}
                    </span>
                    <span className="text-xs text-muted-foreground">total</span>
                  </div>

                  <Separator orientation="vertical" className="h-12 self-center" />

                  {/* First Commit */}
                  <div className="flex flex-col items-center px-4 py-1 min-w-[120px]">
                    <div className="flex items-center gap-1.5 text-muted-foreground mb-0.5">
                      <Calendar className="h-4 w-4" />
                      <span className="text-xs">First Commit</span>
                    </div>
                    <span className="text-sm font-medium">
                      {detail.firstCommitDate
                        ? new Date(detail.firstCommitDate).toLocaleDateString()
                        : "—"}
                    </span>
                  </div>

                  <Separator orientation="vertical" className="h-12 self-center" />

                  {/* Last Commit */}
                  <div className="flex flex-col items-center px-4 py-1 min-w-[120px]">
                    <div className="flex items-center gap-1.5 text-muted-foreground mb-0.5">
                      <Clock className="h-4 w-4" />
                      <span className="text-xs">Last Commit</span>
                    </div>
                    <span className="text-sm font-medium">
                      {detail.lastCommitDate
                        ? formatRelativeTime(detail.lastCommitDate, now)
                        : "—"}
                    </span>
                  </div>

                  {/* Remotes (GitHub links) */}
                  {detail.remotes.length > 0 && (
                    <>
                      <Separator orientation="vertical" className="h-12 self-center" />
                      <div className="flex flex-col px-4 py-1 gap-1">
                        {detail.remotes.map((remote) => (
                          <div key={remote.name} className="flex flex-col gap-0.5">
                            <span className="text-xs text-muted-foreground font-mono">
                              {remote.name}
                            </span>
                            {remote.github ? (
                              <div className="flex items-center gap-1 flex-wrap">
                                <Button
                                  variant="link"
                                  size="sm"
                                  className="h-auto p-0 text-xs"
                                  asChild
                                >
                                  <a
                                    href={remote.github.repoUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                  >
                                    <ExternalLink className="h-3 w-3 mr-1" />
                                    GitHub
                                  </a>
                                </Button>
                                <Button
                                  variant="link"
                                  size="sm"
                                  className="h-auto p-0 text-xs"
                                  asChild
                                >
                                  <a
                                    href={remote.github.issuesUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                  >
                                    Issues
                                  </a>
                                </Button>
                                <Button
                                  variant="link"
                                  size="sm"
                                  className="h-auto p-0 text-xs"
                                  asChild
                                >
                                  <a
                                    href={remote.github.pullsUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                  >
                                    PRs
                                  </a>
                                </Button>
                              </div>
                            ) : (
                              <span className="text-xs font-mono text-muted-foreground break-all">
                                {remote.url}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Summary content */}
            <RepositorySummary detail={detail} now={now} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
