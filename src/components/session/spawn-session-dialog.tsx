"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, GitBranch, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useSpawnSession } from "@/hooks/use-spawn-session";
import { formatSpawnPrompt, generateBranchName, deriveTitle } from "@/lib/spawn-prompt-utils";

interface SpawnSessionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The text the user selected in the conversation. */
  selectedText: string;
  /** Human-readable title of the source session. */
  sessionTitle: string;
  /** OpenCode session ID (or Fleet DB id) of the source session. */
  sourceSessionId: string;
  /**
   * The directory to create the worktree from.
   * For worktree/clone sessions this is the original repo; for "existing" it's
   * the workspace directory.  When null the spawn button is disabled.
   */
  sourceDirectory: string | null;
}

export function SpawnSessionDialog({
  open,
  onOpenChange,
  selectedText,
  sessionTitle,
  sourceSessionId,
  sourceDirectory,
}: SpawnSessionDialogProps) {
  const router = useRouter();
  const { spawnSession, isSpawning, error, clearError } = useSpawnSession();

  // Derive initial values from the selected text
  const initialTitle = deriveTitle(selectedText);
  const initialBranch = generateBranchName(initialTitle);
  const initialPrompt = formatSpawnPrompt({ selectedText, sessionTitle, sourceSessionId });

  const [title, setTitle] = useState(initialTitle);
  const [branch, setBranch] = useState(initialBranch);
  const [prompt, setPrompt] = useState(initialPrompt);
  // Track whether the user has manually edited the branch field
  const branchEditedRef = useRef(false);

  const titleInputRef = useRef<HTMLInputElement>(null);

  // Reset fields whenever the dialog opens with new content
  useEffect(() => {
    if (open) {
      const t = deriveTitle(selectedText);
      const b = generateBranchName(t);
      const p = formatSpawnPrompt({ selectedText, sessionTitle, sourceSessionId });
      setTitle(t);
      setBranch(b);
      setPrompt(p);
      branchEditedRef.current = false;
      clearError();
    }
  // We deliberately only reset when `open` changes to true.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleTitleChange = (value: string) => {
    setTitle(value);
    // Auto-update branch from title unless the user has manually edited it
    if (!branchEditedRef.current) {
      setBranch(generateBranchName(value));
    }
  };

  const handleBranchChange = (value: string) => {
    branchEditedRef.current = true;
    setBranch(value);
  };

  const handleClose = (value: boolean) => {
    if (!value) {
      clearError();
    }
    onOpenChange(value);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSpawning || !sourceDirectory) return;

    try {
      const { instanceId, session } = await spawnSession({
        directory: sourceDirectory,
        title: title.trim() || "New Session",
        branch: branch.trim() || generateBranchName(title),
        initialPrompt: prompt,
      });
      handleClose(false);
      router.push(
        `/sessions/${encodeURIComponent(session.id)}?instanceId=${encodeURIComponent(instanceId)}`
      );
    } catch {
      // error is set by useSpawnSession
    }
  };

  const isDisabled = isSpawning || !sourceDirectory;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent
        className="sm:max-w-lg"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          titleInputRef.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitBranch className="h-4 w-4" />
            Spawn Session
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <p className="text-xs text-muted-foreground">
            From:{" "}
            <span className="font-medium text-foreground">{sessionTitle}</span>
            {" "}· Isolation: Worktree
          </p>

          {!sourceDirectory && (
            <div className="flex items-start gap-2 rounded-md bg-amber-500/10 border border-amber-500/20 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
              <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>Source directory unavailable — cannot create a worktree session.</span>
            </div>
          )}

          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="spawn-session-title">
              Title
            </label>
            <Input
              ref={titleInputRef}
              id="spawn-session-title"
              value={title}
              onChange={(e) => handleTitleChange(e.target.value)}
              placeholder="Session title"
              disabled={isSpawning}
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="spawn-session-branch">
              Branch
            </label>
            <Input
              id="spawn-session-branch"
              value={branch}
              onChange={(e) => handleBranchChange(e.target.value)}
              placeholder="weave/my-task"
              disabled={isSpawning}
              className="font-mono text-xs"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="spawn-session-prompt">
              Initial Prompt
              <span className="ml-1 text-muted-foreground font-normal">(editable)</span>
            </label>
            <Textarea
              id="spawn-session-prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={12}
              disabled={isSpawning}
              className="font-mono text-xs leading-relaxed thin-scrollbar"
            />
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-md bg-red-500/10 border border-red-500/20 px-3 py-2 text-xs text-red-600 dark:text-red-400">
              <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => handleClose(false)}
              disabled={isSpawning}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              className="weave-gradient-bg hover:opacity-90 border-0"
              disabled={isDisabled}
            >
              {isSpawning ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                  Spawning…
                </>
              ) : (
                "Spawn Session"
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
