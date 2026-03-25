"use client";

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { DirectoryPicker } from "@/components/session/directory-picker";
import { Loader2, AlertCircle, Rocket, FolderOpen, GitBranch, Copy } from "lucide-react";
import { useCreateSession } from "@/hooks/use-create-session";
import { usePersistedState } from "@/hooks/use-persisted-state";
import { useRepositories } from "@/hooks/use-repositories";
import type { ContextSource } from "@/integrations/types";
import type { ScannedRepository } from "@/lib/api-types";

// ─── Source mode ──────────────────────────────────────────────────────────────

type SourceMode = "repository" | "directory";

const SOURCE_MODE_ORDER: SourceMode[] = ["repository", "directory"];

// ─── Isolation strategies ─────────────────────────────────────────────────────

type RepoIsolationStrategy = "worktree" | "existing";

const REPO_STRATEGY_ORDER: RepoIsolationStrategy[] = ["worktree", "existing"];
const REPO_STRATEGY_LABELS: Record<RepoIsolationStrategy, string> = {
  worktree: "Worktree",
  existing: "Directory",
};
const REPO_STRATEGY_DESCRIPTIONS: Record<RepoIsolationStrategy, string> = {
  worktree: "Creates a git worktree — ideal for parallel work on the same repo.",
  existing: "Use the repository directory as-is. Simple, no copy or branch.",
};
const REPO_STRATEGY_ICONS: Record<RepoIsolationStrategy, typeof FolderOpen> = {
  worktree: GitBranch,
  existing: FolderOpen,
};

type DirIsolationStrategy = "existing" | "clone";

const DIR_STRATEGY_ORDER: DirIsolationStrategy[] = ["existing", "clone"];
const DIR_STRATEGY_LABELS: Record<DirIsolationStrategy, string> = {
  existing: "Directory",
  clone: "Clone",
};
const DIR_STRATEGY_DESCRIPTIONS: Record<DirIsolationStrategy, string> = {
  existing: "Use the directory as-is. Simple, no copy or branch.",
  clone: "Clones the GitHub repository into a new directory.",
};
const DIR_STRATEGY_ICONS: Record<DirIsolationStrategy, typeof FolderOpen> = {
  existing: FolderOpen,
  clone: Copy,
};

// ─── Branch name generation ───────────────────────────────────────────────────

function generateBranchName(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

// ─── Component ────────────────────────────────────────────────────────────────

interface CreateSessionButtonProps {
  contextSource: ContextSource;
  directory?: string;
}

export function CreateSessionButton({ contextSource, directory: defaultDir }: CreateSessionButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [directory, setDirectory] = usePersistedState("weave:new-session:lastDirectory", defaultDir ?? "");

  // Title — pre-filled from context, user can override
  const [titleOverride, setTitleOverride] = useState<string | null>(null);
  const title = titleOverride ?? contextSource.title;

  // Load scanned repositories
  const { repositories, isLoading: reposLoading, refresh: refreshRepos } = useRepositories();
  const hasRepos = repositories.length > 0;

  // Re-fetch repositories each time the dialog opens
  useEffect(() => {
    if (open) {
      void refreshRepos();
    }
  }, [open, refreshRepos]);

  // Source mode
  const [sourceMode, setSourceMode] = useState<SourceMode>("directory");

  // Repository-mode state
  const [selectedRepo, setSelectedRepo] = useState<ScannedRepository | null>(null);
  const [repoSearch, setRepoSearch] = useState("");
  const [repoDropdownOpen, setRepoDropdownOpen] = useState(false);
  const [repoHighlightIdx, setRepoHighlightIdx] = useState(0);
  const repoInputRef = useRef<HTMLInputElement>(null);
  const repoListRef = useRef<HTMLDivElement>(null);
  const [repoStrategy, setRepoStrategy] = useState<RepoIsolationStrategy>("worktree");

  // Directory-mode state
  const [dirStrategy, setDirStrategy] = useState<DirIsolationStrategy>("existing");

  // Branch
  const [branch, setBranch] = useState("");
  const [branchManuallyEdited, setBranchManuallyEdited] = useState(false);

  const { createSession, isLoading, error } = useCreateSession();

  // ── Auto-matching: set initial source mode + repo once repos load ────────

  const sourceModeInitialized = useRef(false);
  useEffect(() => {
    if (!open) return;
    if (reposLoading) return;
    if (sourceModeInitialized.current) return;
    sourceModeInitialized.current = true;

    const ghRepo = contextSource.metadata.repo as string | undefined;

    if (defaultDir) {
      // Explicit directory prop → directory mode
      queueMicrotask(() => setSourceMode("directory"));
      return;
    }

    if (!hasRepos) {
      queueMicrotask(() => setSourceMode("directory"));
      return;
    }

    // Try to find a matching scanned repo by name
    const matchedRepo = ghRepo
      ? repositories.find((r) => r.name.toLowerCase() === ghRepo.toLowerCase())
      : null;

    queueMicrotask(() => {
      setSourceMode("repository");
      if (matchedRepo) {
        setSelectedRepo(matchedRepo);
        setRepoSearch(matchedRepo.name);
      }
    });
  }, [open, reposLoading, hasRepos, repositories, contextSource.metadata, defaultDir]);

  // Auto-generate initial branch from context title
  useEffect(() => {
    if (open && !branchManuallyEdited) {
      setBranch(generateBranchName(contextSource.title));
    }
  }, [open, contextSource.title, branchManuallyEdited]);

  // ── Filtered repos ──────────────────────────────────────────────────────

  const filteredRepos = useMemo(() => {
    if (!repoSearch.trim()) return repositories;
    const q = repoSearch.toLowerCase();
    return repositories.filter(
      (r) => r.name.toLowerCase().includes(q) || r.path.toLowerCase().includes(q)
    );
  }, [repositories, repoSearch]);

  // Scroll highlighted item into view
  useEffect(() => {
    if (repoDropdownOpen && repoListRef.current) {
      const items = repoListRef.current.children;
      const highlighted = items[repoHighlightIdx] as HTMLElement | undefined;
      highlighted?.scrollIntoView({ block: "nearest" });
    }
  }, [repoHighlightIdx, repoDropdownOpen]);

  // ── Repo selector callbacks ─────────────────────────────────────────────

  const selectRepo = useCallback((repo: ScannedRepository) => {
    setSelectedRepo(repo);
    setRepoSearch(repo.name);
    setRepoDropdownOpen(false);
  }, []);

  const handleRepoBlur = useCallback(() => {
    setTimeout(() => {
      if (filteredRepos.length === 1) {
        selectRepo(filteredRepos[0]);
      } else if (selectedRepo && repoSearch !== selectedRepo.name) {
        const stillMatches = filteredRepos.find((r) => r.path === selectedRepo.path);
        if (stillMatches) {
          setRepoSearch(selectedRepo.name);
        } else {
          setSelectedRepo(null);
        }
      } else if (!selectedRepo && filteredRepos.length > 0) {
        const highlighted = filteredRepos[repoHighlightIdx];
        if (highlighted) selectRepo(highlighted);
      }
      setRepoDropdownOpen(false);
    }, 150);
  }, [filteredRepos, selectedRepo, repoSearch, repoHighlightIdx, selectRepo]);

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
        const highlighted = filteredRepos[repoHighlightIdx];
        if (highlighted) selectRepo(highlighted);
      }
    },
    [repoDropdownOpen, filteredRepos, repoHighlightIdx, selectRepo]
  );

  // ── Title + branch change handlers ──────────────────────────────────────

  const handleTitleChange = (value: string) => {
    setTitleOverride(value);
    if (sourceMode === "repository" && repoStrategy === "worktree" && !branchManuallyEdited) {
      setBranch(generateBranchName(value));
    }
  };

  const handleBranchChange = (value: string) => {
    setBranch(value);
    setBranchManuallyEdited(true);
  };

  // ── Keyboard handlers for radio groups ──────────────────────────────────

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

  const handleRepoStrategyKeyDown = useCallback(
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
        setRepoStrategy(REPO_STRATEGY_ORDER[next]);
        const container = e.currentTarget;
        const buttons = container.querySelectorAll<HTMLButtonElement>("[role=radio]");
        buttons[next]?.focus();
      }
    },
    [repoStrategy]
  );

  const handleDirStrategyKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const idx = DIR_STRATEGY_ORDER.indexOf(dirStrategy);
      let next: number | null = null;
      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        next = (idx + 1) % DIR_STRATEGY_ORDER.length;
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        next = (idx - 1 + DIR_STRATEGY_ORDER.length) % DIR_STRATEGY_ORDER.length;
      }
      if (next !== null) {
        e.preventDefault();
        setDirStrategy(DIR_STRATEGY_ORDER[next]);
        const container = e.currentTarget;
        const buttons = container.querySelectorAll<HTMLButtonElement>("[role=radio]");
        buttons[next]?.focus();
      }
    },
    [dirStrategy]
  );

  // ── Effective values for submission ─────────────────────────────────────

  const effectiveDirectory = sourceMode === "repository"
    ? selectedRepo?.path ?? ""
    : directory.trim();

  const effectiveIsolation = sourceMode === "repository" ? repoStrategy : dirStrategy;

  const effectiveBranch =
    sourceMode === "repository" && repoStrategy === "worktree" && branch.trim()
      ? branch.trim()
      : undefined;

  // ── Submit ──────────────────────────────────────────────────────────────

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!effectiveDirectory || isLoading) return;
      try {
        const { instanceId, session } = await createSession(effectiveDirectory, {
          title: title.trim() || contextSource.title,
          isolationStrategy: effectiveIsolation,
          branch: effectiveBranch,
          context: contextSource,
        });
        setOpen(false);
        router.push(
          `/sessions/${encodeURIComponent(session.id)}?instanceId=${encodeURIComponent(instanceId)}`
        );
      } catch {
        // error is set by useCreateSession
      }
    },
    [effectiveDirectory, isLoading, title, effectiveIsolation, effectiveBranch, contextSource, createSession, router]
  );

  // ── Open/close management ───────────────────────────────────────────────

  const handleOpenChange = useCallback((value: boolean) => {
    if (!value) {
      setTitleOverride(null);
      setSelectedRepo(null);
      setRepoSearch("");
      setRepoDropdownOpen(false);
      setRepoStrategy("worktree");
      setDirStrategy("existing");
      setBranch("");
      setBranchManuallyEdited(false);
      sourceModeInitialized.current = false;
    }
    setOpen(value);
  }, []);

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <>
      <Button
        size="xs"
        variant="outline"
        className="gap-1"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
      >
        <Rocket className="h-3 w-3" />
        Create Session
      </Button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-md top-[10%] translate-y-0">
          <DialogHeader>
            <DialogTitle>Create Session From Context</DialogTitle>
          </DialogHeader>

          {/* Context badge */}
          <div className="mb-2">
            <Badge variant="secondary" className="text-xs gap-1">
              {contextSource.type === "github-issue" ? "GitHub Issue" : "GitHub PR"}
            </Badge>
            <p className="text-xs text-muted-foreground mt-1 truncate">
              {contextSource.url}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Source Mode: Repository or Directory */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium" id="ctx-source-mode-label">
                Source
              </label>
              <div
                className="flex gap-1"
                role="radiogroup"
                aria-labelledby="ctx-source-mode-label"
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

            {/* ── Repository mode fields ──────────────────────────────── */}
            {sourceMode === "repository" && (
              <>
                {/* Repository selector — type-ahead filter */}
                <div className="space-y-1.5">
                  <label className="text-sm font-medium" htmlFor="ctx-repo-select">
                    Repository
                  </label>
                  <div className="relative">
                    <Input
                      ref={repoInputRef}
                      id="ctx-repo-select"
                      value={repoSearch}
                      onChange={(e) => {
                        setRepoSearch(e.target.value);
                        setRepoDropdownOpen(true);
                        setRepoHighlightIdx(0);
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
                              e.preventDefault();
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

                {/* Isolation Strategy — repo mode */}
                <div className="space-y-1.5">
                  <label className="text-sm font-medium" id="ctx-repo-strategy-label">
                    Isolation Strategy
                  </label>
                  <div
                    className="flex gap-1"
                    role="radiogroup"
                    aria-labelledby="ctx-repo-strategy-label"
                    onKeyDown={handleRepoStrategyKeyDown}
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
                          <span className="text-xs mt-1">{REPO_STRATEGY_LABELS[s]}</span>
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

            {/* ── Directory mode fields ──────────────────────────────── */}
            {sourceMode === "directory" && (
              <>
                {/* Isolation Strategy — directory mode */}
                <div className="space-y-1.5">
                  <label className="text-sm font-medium" id="ctx-dir-strategy-label">
                    Isolation Strategy
                  </label>
                  <div
                    className="flex gap-1"
                    role="radiogroup"
                    aria-labelledby="ctx-dir-strategy-label"
                    onKeyDown={handleDirStrategyKeyDown}
                  >
                    {DIR_STRATEGY_ORDER.map((s) => {
                      const Icon = DIR_STRATEGY_ICONS[s];
                      const isActive = dirStrategy === s;
                      return (
                        <button
                          key={s}
                          type="button"
                          role="radio"
                          aria-checked={isActive}
                          tabIndex={isActive ? 0 : -1}
                          onClick={() => setDirStrategy(s)}
                          disabled={isLoading}
                          className={`flex-1 flex flex-col items-center justify-center rounded-md border px-3 py-2 transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                            isActive
                              ? "border-primary bg-primary/10 text-primary"
                              : "border-input bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                          }`}
                        >
                          <Icon className="h-4 w-4" />
                          <span className="text-xs mt-1">{DIR_STRATEGY_LABELS[s]}</span>
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {DIR_STRATEGY_DESCRIPTIONS[dirStrategy]}
                  </p>
                </div>

                {/* Directory picker */}
                <div className="space-y-1.5">
                  <label className="text-sm font-medium" htmlFor="ctx-directory">
                    Project Directory
                  </label>
                  <DirectoryPicker
                    id="ctx-directory"
                    value={directory}
                    onChange={setDirectory}
                    placeholder="/path/to/project"
                    disabled={isLoading}
                  />
                </div>
              </>
            )}

            {/* Title — always shown */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="ctx-title">
                Title
              </label>
              <Input
                id="ctx-title"
                value={title}
                onChange={(e) => handleTitleChange(e.target.value)}
                placeholder={contextSource.title}
                disabled={isLoading}
              />
            </div>

            {/* Branch name — only for repository + worktree */}
            {sourceMode === "repository" && repoStrategy === "worktree" && (
              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="ctx-branch">
                  Branch{" "}
                  <span className="text-muted-foreground font-normal">(optional)</span>
                </label>
                <Input
                  id="ctx-branch"
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
                  Creating…
                </>
              ) : (
                "Create Session"
              )}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
