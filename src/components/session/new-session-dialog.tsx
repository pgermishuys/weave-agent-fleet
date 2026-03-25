"use client";

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DirectoryPicker } from "@/components/session/directory-picker";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Loader2, AlertCircle, FolderOpen, GitBranch } from "lucide-react";
import { useCreateSession } from "@/hooks/use-create-session";
import { usePersistedState } from "@/hooks/use-persisted-state";
import { useRepositories } from "@/hooks/use-repositories";
import type { ReactNode } from "react";
import type { ScannedRepository } from "@/lib/api-types";

// ─── Source mode: Repository vs Directory ─────────────────────────────────────

type SourceMode = "repository" | "directory";

// ─── Isolation strategies available for repository mode ───────────────────────

type RepoIsolationStrategy = "existing" | "worktree";

const REPO_STRATEGY_SHORT_LABELS: Record<RepoIsolationStrategy, string> = {
  existing: "Directory",
  worktree: "Worktree",
};

const REPO_STRATEGY_DESCRIPTIONS: Record<RepoIsolationStrategy, string> = {
  existing: "Use the repository directory as-is. Simple, no copy or branch.",
  worktree: "Creates a git worktree — ideal for parallel work on the same repo.",
};

const REPO_STRATEGY_ICONS: Record<RepoIsolationStrategy, typeof FolderOpen> = {
  existing: FolderOpen,
  worktree: GitBranch,
};

const REPO_STRATEGY_ORDER: RepoIsolationStrategy[] = ["worktree", "existing"];

const SOURCE_MODE_ORDER: SourceMode[] = ["repository", "directory"];

// ─── Component ────────────────────────────────────────────────────────────────

interface NewSessionDialogProps {
  trigger?: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  defaultDirectory?: string;
}

export function NewSessionDialog({ trigger, open: controlledOpen, onOpenChange, defaultDirectory }: NewSessionDialogProps) {
  const router = useRouter();
  const [internalOpen, setInternalOpen] = useState(false);
  const [directory, setDirectory] = usePersistedState("weave:new-session:lastDirectory", "");

  const open = controlledOpen ?? internalOpen;

  // Load scanned repositories
  const { repositories, isLoading: reposLoading, refresh: refreshRepos } = useRepositories();
  const hasRepos = repositories.length > 0;

  // Re-fetch repositories each time the dialog opens (picks up new roots/scans)
  useEffect(() => {
    if (open) {
      void refreshRepos();
    }
  }, [open, refreshRepos]);

  // Source mode: repository or directory — initial value derived from props/state
  const [sourceMode, setSourceMode] = useState<SourceMode>(() =>
    defaultDirectory ? "directory" : "directory" // updated below once repos load
  );

  // Repository-mode state
  const [selectedRepo, setSelectedRepo] = useState<ScannedRepository | null>(null);
  const [repoSearch, setRepoSearch] = useState("");
  const [repoDropdownOpen, setRepoDropdownOpen] = useState(false);
  const [repoHighlightIdx, setRepoHighlightIdx] = useState(0);
  const repoInputRef = useRef<HTMLInputElement>(null);
  const repoListRef = useRef<HTMLDivElement>(null);
  const [repoStrategy, setRepoStrategy] = useState<RepoIsolationStrategy>("worktree");

  // Filtered repositories based on search text
  const filteredRepos = useMemo(() => {
    if (!repoSearch.trim()) return repositories;
    const q = repoSearch.toLowerCase();
    return repositories.filter(
      (r) => r.name.toLowerCase().includes(q) || r.path.toLowerCase().includes(q)
    );
  }, [repositories, repoSearch]);

  // Scroll highlighted dropdown item into view
  useEffect(() => {
    if (repoDropdownOpen && repoListRef.current) {
      const items = repoListRef.current.children;
      const highlighted = items[repoHighlightIdx] as HTMLElement | undefined;
      highlighted?.scrollIntoView({ block: "nearest" });
    }
  }, [repoHighlightIdx, repoDropdownOpen]);

  /** Select a repo and close the dropdown */
  const selectRepo = useCallback((repo: ScannedRepository) => {
    setSelectedRepo(repo);
    setRepoSearch(repo.name);
    setRepoDropdownOpen(false);
  }, []);

  /** On blur/tab out: if typed text matches exactly one repo, auto-select it */
  const handleRepoBlur = useCallback(() => {
    // Delay to allow click on dropdown item to fire first
    setTimeout(() => {
      if (filteredRepos.length === 1) {
        selectRepo(filteredRepos[0]);
      } else if (selectedRepo && repoSearch !== selectedRepo.name) {
        // Text was changed but doesn't uniquely match — keep selection if text still matches
        const stillMatches = filteredRepos.find((r) => r.path === selectedRepo.path);
        if (stillMatches) {
          setRepoSearch(selectedRepo.name);
        } else {
          // Clear selection — typed text doesn't match any repo
          setSelectedRepo(null);
        }
      } else if (!selectedRepo && filteredRepos.length > 0) {
        // Auto-select highlighted item
        const highlighted = filteredRepos[repoHighlightIdx];
        if (highlighted) selectRepo(highlighted);
      }
      setRepoDropdownOpen(false);
    }, 150);
  }, [filteredRepos, selectedRepo, repoSearch, repoHighlightIdx, selectRepo]);

  /** Keyboard navigation in repo dropdown */
  const handleRepoKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (!repoDropdownOpen && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
        setRepoDropdownOpen(true);
        e.preventDefault();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setRepoHighlightIdx((i) => Math.min(i + 1, filteredRepos.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setRepoHighlightIdx((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter" && repoDropdownOpen) {
        e.preventDefault();
        const highlighted = filteredRepos[repoHighlightIdx];
        if (highlighted) selectRepo(highlighted);
      } else if (e.key === "Escape") {
        setRepoDropdownOpen(false);
      } else if (e.key === "Tab" && repoDropdownOpen) {
        // Tab off selects the highlighted item
        const highlighted = filteredRepos[repoHighlightIdx];
        if (highlighted) selectRepo(highlighted);
      }
    },
    [repoDropdownOpen, filteredRepos, repoHighlightIdx, selectRepo]
  );

  // Shared state
  const [title, setTitle] = useState("");
  const [branch, setBranch] = useState("");
  const [branchManuallyEdited, setBranchManuallyEdited] = useState(false);

  // Once repos finish loading for the first time, set the initial source mode.
  // We use a ref to ensure this only fires once (avoids the lint rule about
  // synchronous setState in effects — this is a one-shot initialisation).
  const sourceModeInitialized = useRef(false);
  useEffect(() => {
    if (!reposLoading && !sourceModeInitialized.current) {
      sourceModeInitialized.current = true;
      // Defer to next microtask to avoid synchronous cascading render
      queueMicrotask(() => {
        setSourceMode(hasRepos ? "repository" : "directory");
      });
    }
  }, [hasRepos, reposLoading]);

  // When the dialog opens with a defaultDirectory, pre-fill the directory field
  useEffect(() => {
    if (open && defaultDirectory) {
      setDirectory(defaultDirectory);
      // Defer mode switch to avoid synchronous cascading render
      queueMicrotask(() => setSourceMode("directory"));
    }
  }, [open, defaultDirectory, setDirectory]);

  /** Generate a branch name from the title: lowercase, hyphenated, trimmed */
  const generateBranchName = (text: string): string => {
    return text
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
  };

  const handleTitleChange = (value: string) => {
    setTitle(value);
    if (sourceMode === "repository" && repoStrategy === "worktree" && !branchManuallyEdited) {
      setBranch(generateBranchName(value));
    }
  };

  const handleBranchChange = (value: string) => {
    setBranch(value);
    setBranchManuallyEdited(true);
  };

  const { createSession, isLoading, error } = useCreateSession();

  /** Roving tabindex for source mode buttons */
  const handleSourceModeKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const idx = SOURCE_MODE_ORDER.indexOf(sourceMode);
      let next: number | null = null;

      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        next = (idx + 1) % SOURCE_MODE_ORDER.length;
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        next = (idx - 1 + SOURCE_MODE_ORDER.length) % SOURCE_MODE_ORDER.length;
      }

      if (next !== null) {
        const nextMode = SOURCE_MODE_ORDER[next];
        // Skip disabled options (repository disabled when no repos)
        if (nextMode === "repository" && !hasRepos) return;
        e.preventDefault();
        setSourceMode(nextMode);
        const container = e.currentTarget;
        const buttons = container.querySelectorAll<HTMLButtonElement>("[role=radio]");
        buttons[next]?.focus();
      }
    },
    [sourceMode, hasRepos]
  );

  /** Roving tabindex for isolation strategy buttons */
  const handleStrategyKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const idx = REPO_STRATEGY_ORDER.indexOf(repoStrategy);
      let next: number | null = null;

      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        next = (idx + 1) % REPO_STRATEGY_ORDER.length;
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        next = (idx - 1 + REPO_STRATEGY_ORDER.length) % REPO_STRATEGY_ORDER.length;
      }

      if (next !== null) {
        e.preventDefault();
        const nextStrategy = REPO_STRATEGY_ORDER[next];
        setRepoStrategy(nextStrategy);
        const container = e.currentTarget;
        const buttons = container.querySelectorAll<HTMLButtonElement>("[role=radio]");
        buttons[next]?.focus();
      }
    },
    [repoStrategy]
  );

  const setOpen = (value: boolean) => {
    if (!value) {
      setTitle("");
      setBranch("");
      setBranchManuallyEdited(false);
      setSelectedRepo(null);
      setRepoSearch("");
      setRepoDropdownOpen(false);
      setRepoStrategy("worktree");
    }
    setInternalOpen(value);
    onOpenChange?.(value);
  };

  // Determine the effective directory for submission
  const effectiveDirectory = sourceMode === "repository"
    ? selectedRepo?.path ?? ""
    : directory.trim();

  // Determine the effective isolation strategy
  const effectiveIsolation = sourceMode === "repository" ? repoStrategy : "existing";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!effectiveDirectory || isLoading) return;

    try {
      const { instanceId, session } = await createSession(effectiveDirectory, {
        title: title.trim() || undefined,
        isolationStrategy: effectiveIsolation,
        branch: effectiveIsolation === "worktree" && branch.trim() ? branch.trim() : undefined,
      });
      setOpen(false);
      router.push(
        `/sessions/${encodeURIComponent(session.id)}?instanceId=${encodeURIComponent(instanceId)}`
      );
    } catch {
      // error is already set by useCreateSession
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent className="sm:max-w-md top-[10%] translate-y-0">
        <DialogHeader>
          <DialogTitle>New Session</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Source Mode: Repository or Directory */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium" id="source-mode-label">
              Source
            </label>
            <div
              className="flex gap-1"
              role="radiogroup"
              aria-labelledby="source-mode-label"
              onKeyDown={handleSourceModeKeyDown}
            >
              <button
                type="button"
                role="radio"
                aria-checked={sourceMode === "repository"}
                tabIndex={sourceMode === "repository" ? 0 : -1}
                onClick={() => hasRepos && setSourceMode("repository")}
                disabled={isLoading || !hasRepos}
                title={!hasRepos ? "No repositories scanned — configure workspace roots in Settings" : undefined}
                className={`flex-1 flex flex-col items-center justify-center rounded-md border px-3 py-2 transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                  sourceMode === "repository"
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-input bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                }`}
              >
                <GitBranch className="h-4 w-4" />
                <span className="text-xs mt-1">Repository</span>
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={sourceMode === "directory"}
                tabIndex={sourceMode === "directory" ? 0 : -1}
                onClick={() => setSourceMode("directory")}
                disabled={isLoading}
                className={`flex-1 flex flex-col items-center justify-center rounded-md border px-3 py-2 transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                  sourceMode === "directory"
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-input bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                }`}
              >
                <FolderOpen className="h-4 w-4" />
                <span className="text-xs mt-1">Directory</span>
              </button>
            </div>
          </div>

          {/* ── Repository mode fields ──────────────────────────────────── */}
          {sourceMode === "repository" && (
            <>
              {/* Repository selector — type-ahead filter */}
              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="repo-select">
                  Repository
                </label>
                <div className="relative">
                  <Input
                    ref={repoInputRef}
                    id="repo-select"
                    value={repoSearch}
                    onChange={(e) => {
                      setRepoSearch(e.target.value);
                      setRepoDropdownOpen(true);
                      setRepoHighlightIdx(0);
                      // Clear selection if the user is typing something different
                      if (selectedRepo && e.target.value !== selectedRepo.name) {
                        setSelectedRepo(null);
                      }
                    }}
                    onFocus={() => setRepoDropdownOpen(true)}
                    onBlur={handleRepoBlur}
                    onKeyDown={handleRepoKeyDown}
                    placeholder="Type to filter repositories…"
                    disabled={isLoading}
                    autoComplete="off"
                  />
                  {repoDropdownOpen && filteredRepos.length > 0 && (
                    <div
                      ref={repoListRef}
                      className="absolute z-50 mt-1 w-full max-h-48 overflow-auto rounded-md border border-input bg-popover shadow-md thin-scrollbar"
                    >
                      {filteredRepos.map((repo, idx) => (
                        <button
                          key={repo.path}
                          type="button"
                          onMouseDown={(e) => {
                            e.preventDefault(); // prevent blur before click fires
                            selectRepo(repo);
                          }}
                          onMouseEnter={() => setRepoHighlightIdx(idx)}
                          className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                            idx === repoHighlightIdx
                              ? "bg-accent text-accent-foreground"
                              : "text-popover-foreground hover:bg-accent/50"
                          } ${selectedRepo?.path === repo.path ? "font-medium" : ""}`}
                        >
                          <div className="font-mono text-xs">{repo.name}</div>
                          <div className="text-[10px] text-muted-foreground truncate">{repo.path}</div>
                        </button>
                      ))}
                    </div>
                  )}
                  {repoDropdownOpen && repoSearch.trim() && filteredRepos.length === 0 && (
                    <div className="absolute z-50 mt-1 w-full rounded-md border border-input bg-popover shadow-md px-3 py-2">
                      <p className="text-xs text-muted-foreground">No matching repositories.</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Isolation Strategy */}
              <div className="space-y-1.5">
                <label className="text-sm font-medium" id="repo-strategy-label">
                  Isolation Strategy
                </label>
                <div
                  className="flex gap-1"
                  role="radiogroup"
                  aria-labelledby="repo-strategy-label"
                  onKeyDown={handleStrategyKeyDown}
                >
                  {REPO_STRATEGY_ORDER.map((s) => {
                    const Icon = REPO_STRATEGY_ICONS[s];
                    const isActive = repoStrategy === s;
                    return (
                      <button
                        key={s}
                        type="button"
                        role="radio"
                        aria-checked={isActive}
                        tabIndex={isActive ? 0 : -1}
                        onClick={() => setRepoStrategy(s)}
                        disabled={isLoading}
                        className={`flex-1 flex flex-col items-center justify-center rounded-md border px-3 py-2 transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                          isActive
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-input bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                        }`}
                      >
                        <Icon className="h-4 w-4" />
                        <span className="text-xs mt-1">{REPO_STRATEGY_SHORT_LABELS[s]}</span>
                      </button>
                    );
                  })}
                </div>
                <p className="text-xs text-muted-foreground">
                  {REPO_STRATEGY_DESCRIPTIONS[repoStrategy]}
                </p>
              </div>
            </>
          )}

          {/* ── Directory mode fields ───────────────────────────────────── */}
          {sourceMode === "directory" && (
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="directory">
                Directory
              </label>
              <DirectoryPicker
                id="directory"
                value={directory}
                onChange={setDirectory}
                placeholder="/path/to/project"
                disabled={isLoading}
              />
            </div>
          )}

          {/* Title — always shown */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="session-title">
              Title{" "}
              <span className="text-muted-foreground font-normal">(optional)</span>
            </label>
            <Input
              id="session-title"
              value={title}
              onChange={(e) => handleTitleChange(e.target.value)}
              placeholder="What are you working on?"
              disabled={isLoading}
            />
          </div>

          {/* Branch name — only for repository + worktree */}
          {sourceMode === "repository" && repoStrategy === "worktree" && (
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="branch">
                Branch{" "}
                <span className="text-muted-foreground font-normal">(optional)</span>
              </label>
              <Input
                id="branch"
                value={branch}
                onChange={(e) => handleBranchChange(e.target.value)}
                placeholder="feature/my-branch"
                disabled={isLoading}
              />
              <p className="text-xs text-muted-foreground">
                {branchManuallyEdited
                  ? "A unique branch name will be generated if left blank."
                  : "Auto-generated from title. Edit to override."}
              </p>
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 rounded-md bg-red-500/10 border border-red-500/20 px-3 py-2 text-xs text-red-600 dark:text-red-400">
              <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <Button
            type="submit"
            className="w-full weave-gradient-bg hover:opacity-90 border-0"
            disabled={!effectiveDirectory || isLoading}
          >
            {isLoading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Spawning…
              </>
            ) : (
              "Create Session"
            )}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
