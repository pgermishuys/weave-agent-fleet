"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Github, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useIntegrationsContext } from "@/contexts/integrations-context";
import { useBookmarkedRepos } from "@/integrations/github/hooks/use-bookmarked-repos";
import { AddRepoDialog } from "@/integrations/github/components/add-repo-dialog";

export function GitHubPanel() {
  const pathname = usePathname();
  const { connectedIntegrations } = useIntegrationsContext();
  const { repos, removeRepo, error } = useBookmarkedRepos();
  const isGitHubConnected = connectedIntegrations.some((i) => i.id === "github");

  const isGitHubIndexActive = pathname === "/github";

  return (
    <nav className="flex-1 overflow-y-auto thin-scrollbar p-2 space-y-1">
      {/* Header row */}
      <div
        className={cn(
          "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
          isGitHubIndexActive
            ? "bg-sidebar-accent text-sidebar-accent-foreground"
            : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground"
        )}
      >
        <Link
          href="/github"
          className="flex flex-1 items-center gap-1 min-w-0"
        >
          <Github className="h-4 w-4 shrink-0" />
          <span className="flex-1 whitespace-nowrap">GitHub</span>
        </Link>

        <Tooltip>
          <TooltipTrigger asChild>
            <span className="shrink-0">
              <AddRepoDialog
                trigger={
                  <button aria-label="Add repository" className="rounded-md p-1 text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground transition-colors">
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                }
              />
            </span>
          </TooltipTrigger>
          <TooltipContent side="right">Add Repository</TooltipContent>
        </Tooltip>
      </div>

      {!isGitHubConnected && (
        <p className="px-3 py-2 text-xs text-muted-foreground">
          GitHub is not connected. Open Settings to reconnect.
        </p>
      )}

      {error && (
        <p className="px-3 py-1.5 text-xs text-destructive">{error}</p>
      )}

      {/* Repo list */}
      <div className="mt-0.5 space-y-0.5">
        {!isGitHubConnected ? null : repos.length === 0 ? (
          <p className="px-3 py-1.5 text-xs text-muted-foreground">
            No repositories added yet.
          </p>
        ) : (
          repos.map((repo) => {
            const repoPath = `/github/${repo.owner}/${repo.name}`;
            const isActive = pathname === repoPath;

            return (
              <ContextMenu key={repo.fullName}>
                <ContextMenuTrigger asChild>
                  <Link
                    href={repoPath}
                    className={cn(
                      "flex items-center gap-2 rounded-md pl-6 pr-3 py-1.5 text-xs transition-colors",
                      isActive
                        ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                        : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground"
                    )}
                  >
                    <span className="truncate">{repo.fullName}</span>
                  </Link>
                </ContextMenuTrigger>
                <ContextMenuContent>
                  <ContextMenuItem
                    className="text-destructive focus:text-destructive"
                    onSelect={() => removeRepo(repo.fullName)}
                  >
                    Remove
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            );
          })
        )}
      </div>
    </nav>
  );
}
