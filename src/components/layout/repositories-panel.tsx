"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ChevronRight,
  FolderGit2,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useRepositories, groupByRoot } from "@/hooks/use-repositories";

export function RepositoriesPanel() {
  const pathname = usePathname();
  const { repositories, isLoading, error, refresh } = useRepositories();
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Track which roots are expanded; auto-expand new roots as they appear
  const grouped = groupByRoot(repositories);
  const allRoots = Array.from(grouped.keys());
  const [expandedRoots, setExpandedRoots] = useState<Set<string>>(new Set());

  // Whenever the roots list changes, expand any newly discovered roots
  useEffect(() => {
    if (allRoots.length === 0) return;
    setExpandedRoots((prev) => {
      const next = new Set(prev);
      let changed = false;
      for (const root of allRoots) {
        if (!next.has(root)) {
          next.add(root);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [allRoots.join("\0")]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleRoot = (root: string) => {
    setExpandedRoots((prev) => {
      const next = new Set(prev);
      if (next.has(root)) {
        next.delete(root);
      } else {
        next.add(root);
      }
      return next;
    });
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await refresh();
      // New roots will be auto-expanded by the useEffect above
    } finally {
      setIsRefreshing(false);
    }
  };

  const isIndexActive = pathname === "/repositories";

  return (
    <nav className="flex-1 overflow-y-auto thin-scrollbar p-2 space-y-1">
      {/* Header row */}
      <div
        className={cn(
          "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
          isIndexActive
            ? "bg-sidebar-accent text-sidebar-accent-foreground"
            : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground"
        )}
      >
        <Link
          href="/repositories"
          className="flex flex-1 items-center gap-1 min-w-0"
        >
          <FolderGit2 className="h-4 w-4 shrink-0" />
          <span className="flex-1 whitespace-nowrap">Repositories</span>
        </Link>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="Refresh repositories"
              disabled={isLoading || isRefreshing}
              onClick={() => void handleRefresh()}
              className="rounded-md p-1 text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground transition-colors disabled:opacity-50"
            >
              <RefreshCw
                className={cn(
                  "h-3.5 w-3.5",
                  (isLoading || isRefreshing) && "animate-spin"
                )}
              />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">Refresh</TooltipContent>
        </Tooltip>
      </div>

      {/* Loading state */}
      {isLoading && (
        <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Scanning repositories…
        </div>
      )}

      {/* Error state */}
      {!isLoading && error && (
        <div className="px-3 py-2 space-y-1">
          <p className="text-xs text-destructive">{error}</p>
          <button
            type="button"
            onClick={() => void handleRefresh()}
            className="text-xs text-muted-foreground underline hover:text-foreground"
          >
            Retry
          </button>
        </div>
      )}

      {/* Empty state */}
      {!isLoading && !error && repositories.length === 0 && (
        <p className="px-3 py-2 text-xs text-muted-foreground">
          No repositories found.{" "}
          <Link href="/settings" className="underline hover:text-foreground">
            Add workspace roots in Settings &rsaquo; Repositories.
          </Link>
        </p>
      )}

      {/* Repository groups */}
      {!isLoading && !error && (
        <div className="mt-0.5 space-y-0.5">
          {Array.from(grouped.entries()).map(([root, repos]) => {
            const isExpanded = expandedRoots.has(root);
            // Show only the last path segment for brevity, with full path as title
            const rootLabel = root.split(/[\\/]/).filter(Boolean).at(-1) ?? root;

            return (
              <div key={root}>
                {/* Root header — collapsible */}
                <button
                  type="button"
                  onClick={() => toggleRoot(root)}
                  className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground transition-colors"
                  title={root}
                >
                  <ChevronRight
                    className={cn(
                      "h-3 w-3 shrink-0 transition-transform duration-150",
                      isExpanded && "rotate-90"
                    )}
                  />
                  <span className="truncate font-medium">{rootLabel}</span>
                  <span className="ml-auto text-[10px] opacity-60">{repos.length}</span>
                </button>

                {/* Repo list */}
                {isExpanded && (
                  <div className="mt-0.5 space-y-0.5">
                    {repos.map((repo) => {
                      const encodedPath = encodeURIComponent(repo.path);
                      const repoHref = `/repositories/${encodedPath}`;
                      const isActive = pathname === repoHref;

                      return (
                        <Link
                          key={repo.path}
                          href={repoHref}
                          className={cn(
                            "flex items-center gap-2 rounded-md pl-6 pr-3 py-1.5 text-xs transition-colors",
                            isActive
                              ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                              : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground"
                          )}
                          title={repo.path}
                        >
                          <span className="truncate">{repo.name}</span>
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </nav>
  );
}
