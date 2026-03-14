"use client";

import { useState, useCallback, useEffect } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, AlertCircle, FolderOpen, GitBranch, Copy } from "lucide-react";
import { useCreateSession } from "@/hooks/use-create-session";
import { usePersistedState } from "@/hooks/use-persisted-state";
import { useFleetConnections } from "@/hooks/use-fleet-connections";
import type { ReactNode } from "react";

type IsolationStrategy = "existing" | "worktree" | "clone";

const STRATEGY_LABELS: Record<IsolationStrategy, string> = {
  existing: "Existing Directory",
  worktree: "Git Worktree",
  clone: "Git Clone",
};

const STRATEGY_SHORT_LABELS: Record<IsolationStrategy, string> = {
  existing: "Directory",
  worktree: "Worktree",
  clone: "Clone",
};

const DIRECTORY_LABELS: Record<IsolationStrategy, string> = {
  existing: "Project Directory",
  worktree: "Source Repository",
  clone: "Source Repository",
};

const DIRECTORY_PLACEHOLDERS: Record<IsolationStrategy, string> = {
  existing: "/path/to/project",
  worktree: "/path/to/git/repo",
  clone: "/path/to/git/repo or git URL",
};

const STRATEGY_DESCRIPTIONS: Record<IsolationStrategy, string> = {
  existing: "Use the directory as-is. Simple, no copy or clone.",
  worktree: "Creates a git worktree — ideal for parallel work on the same repo.",
  clone: "Shallow-clones the repo — fully isolated ephemeral workspace.",
};

const STRATEGY_ICONS: Record<IsolationStrategy, typeof FolderOpen> = {
  existing: FolderOpen,
  worktree: GitBranch,
  clone: Copy,
};

const STRATEGY_ORDER: IsolationStrategy[] = ["existing", "worktree", "clone"];

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

  const { connections, activeConnection } = useFleetConnections();
  const isMultiServer = connections.length >= 2;
  const [selectedConnectionId, setSelectedConnectionId] = useState<string>(activeConnection.id);

  // Sync selected connection to active connection when dialog opens
  useEffect(() => {
    if (open) {
      setSelectedConnectionId(activeConnection.id);
    }
  }, [open, activeConnection.id]);

  // When the dialog opens with a defaultDirectory, pre-fill the directory field.
  // This must live in an effect — calling setDirectory during render triggers
  // useSyncExternalStore listeners synchronously, which causes React to warn about
  // updating a component while rendering a different component.
  useEffect(() => {
    if (open && defaultDirectory) {
      setDirectory(defaultDirectory);
    }
  }, [open, defaultDirectory, setDirectory]);
  const [title, setTitle] = useState("");
  const [isolationStrategy, setIsolationStrategy] = useState<IsolationStrategy>("existing");
  const [branch, setBranch] = useState("");
  const [branchManuallyEdited, setBranchManuallyEdited] = useState(false);

  /** Generate a branch name from the title: lowercase, hyphenated, trimmed */
  const generateBranchName = (text: string): string => {
    return text
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s-]/g, "")  // strip non-alphanumeric (keep spaces and hyphens)
      .replace(/\s+/g, "-")           // spaces → hyphens
      .replace(/-+/g, "-")            // collapse multiple hyphens
      .replace(/^-|-$/g, "");         // trim leading/trailing hyphens
  };

  const handleTitleChange = (value: string) => {
    setTitle(value);
    if (isolationStrategy === "worktree" && !branchManuallyEdited) {
      setBranch(generateBranchName(value));
    }
  };

  const handleBranchChange = (value: string) => {
    setBranch(value);
    setBranchManuallyEdited(true);
  };
  const { createSession, isLoading, error } = useCreateSession();

  /** Roving tabindex: arrow keys move between isolation strategy buttons */
  const handleStrategyKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const idx = STRATEGY_ORDER.indexOf(isolationStrategy);
      let next: number | null = null;

      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        next = (idx + 1) % STRATEGY_ORDER.length;
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        next = (idx - 1 + STRATEGY_ORDER.length) % STRATEGY_ORDER.length;
      }

      if (next !== null) {
        e.preventDefault();
        const nextStrategy = STRATEGY_ORDER[next];
        setIsolationStrategy(nextStrategy);
        // Move focus to the newly-active button
        const container = e.currentTarget;
        const buttons = container.querySelectorAll<HTMLButtonElement>("[role=radio]");
        buttons[next]?.focus();
      }
    },
    [isolationStrategy]
  );

  const setOpen = (value: boolean) => {
    if (!value) {
      // Reset fields on dialog close so next open starts fresh
      setTitle("");
      setBranch("");
      setBranchManuallyEdited(false);
    }
    setInternalOpen(value);
    onOpenChange?.(value);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!directory.trim() || isLoading) return;

    const connectionId = isMultiServer ? selectedConnectionId : undefined;

    try {
      const { instanceId, session } = await createSession(
        directory.trim(),
        {
          title: title.trim() || undefined,
          isolationStrategy,
          branch: isolationStrategy === "worktree" && branch.trim() ? branch.trim() : undefined,
        },
        connectionId
      );
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
          {/* Server selector — shown only when 2+ connections */}
          {isMultiServer && (
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="fleet-server">
                Fleet Server
              </label>
              <Select
                value={selectedConnectionId}
                onValueChange={(id) => {
                  setSelectedConnectionId(id);
                  setDirectory("");
                }}
              >
                <SelectTrigger id="fleet-server" className="h-9 text-sm">
                  <SelectValue placeholder="Select server…" />
                </SelectTrigger>
                <SelectContent>
                  {connections.map((conn) => (
                    <SelectItem key={conn.id} value={conn.id} className="text-sm">
                      {conn.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Isolation Strategy — roving tabindex: single tab stop, arrow keys to switch */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium" id="isolation-strategy-label">
              Isolation Strategy
            </label>
            <div
              className="flex gap-1"
              role="radiogroup"
              aria-labelledby="isolation-strategy-label"
              onKeyDown={handleStrategyKeyDown}
            >
              {STRATEGY_ORDER.map((s) => {
                const Icon = STRATEGY_ICONS[s];
                const isActive = isolationStrategy === s;
                return (
                  <button
                    key={s}
                    type="button"
                    role="radio"
                    aria-checked={isActive}
                    tabIndex={isActive ? 0 : -1}
                    onClick={() => setIsolationStrategy(s)}
                    disabled={isLoading}
                    className={`flex-1 flex flex-col items-center justify-center rounded-md border px-3 py-2 transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                      isActive
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-input bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    <span className="text-xs mt-1">{STRATEGY_SHORT_LABELS[s]}</span>
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">
              {STRATEGY_DESCRIPTIONS[isolationStrategy]}
            </p>
          </div>

          {/* Directory / Source Repo */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="directory">
              {DIRECTORY_LABELS[isolationStrategy]}
            </label>
            <DirectoryPicker
              id="directory"
              value={directory}
              onChange={setDirectory}
              placeholder={DIRECTORY_PLACEHOLDERS[isolationStrategy]}
              disabled={isLoading}
              connectionId={isMultiServer ? selectedConnectionId : undefined}
            />
          </div>

          {/* Title */}
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

          {/* Branch name — only for worktree, auto-generated from title until manually edited */}
          {isolationStrategy === "worktree" && (
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
            disabled={!directory.trim() || isLoading}
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
