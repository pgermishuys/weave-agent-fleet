"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { Loader2, AlertCircle, GitFork } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useForkSession } from "@/hooks/use-fork-session";

interface ForkSessionDialogProps {
  /** Fleet DB id or opencode session id of the session to fork */
  sourceSessionId: string;
  /** Human-readable title of the source session — shown in the dialog */
  sourceSessionTitle?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Connection the session lives on — forwarded to forkSession and the navigation URL */
  connectionId?: string;
}

export function ForkSessionDialog({
  sourceSessionId,
  sourceSessionTitle,
  open,
  onOpenChange,
  connectionId,
}: ForkSessionDialogProps) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const { forkSession, clearError, isForking, error } = useForkSession();
  const inputRef = useRef<HTMLInputElement>(null);

  const handleClose = (value: boolean) => {
    if (!value) {
      setTitle("");
      clearError();
    }
    onOpenChange(value);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isForking) return;

    try {
      const { instanceId, session } = await forkSession(sourceSessionId, {
        title: title.trim() || undefined,
      }, connectionId);
      handleClose(false);
      const url = `/sessions/${encodeURIComponent(session.id)}?instanceId=${encodeURIComponent(instanceId)}${connectionId ? `&connectionId=${encodeURIComponent(connectionId)}` : ""}`;
      router.push(url);
    } catch {
      // error is already set by useForkSession
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent
        className="sm:max-w-sm top-[10%] translate-y-0"
        onOpenAutoFocus={(e) => {
          // Prevent Radix from focusing the first focusable element (the close
          // button) and instead focus the title input directly.
          e.preventDefault();
          inputRef.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitFork className="h-4 w-4" />
            New Context Window
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {sourceSessionTitle && (
            <p className="text-sm text-muted-foreground">
              Creates a fresh session in the same workspace as{" "}
              <span className="font-medium text-foreground">
                {sourceSessionTitle}
              </span>
              .
            </p>
          )}

          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="fork-session-title">
              Title{" "}
              <span className="text-muted-foreground font-normal">(optional)</span>
            </label>
            <Input
              ref={inputRef}
              id="fork-session-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What are you working on?"
              disabled={isForking}
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
              disabled={isForking}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              className="weave-gradient-bg hover:opacity-90 border-0"
              disabled={isForking}
            >
              {isForking ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                  Forking…
                </>
              ) : (
                "New Context Window"
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
