"use client";

import { useState, useCallback } from "react";
import { Play, Loader2, Check, X } from "lucide-react";
import { useSlashCommandContext } from "@/contexts/slash-command-context";
import { extractSlashCommandText } from "@/lib/slash-command-utils";
import type { ClassAttributes, HTMLAttributes } from "react";
import type { ExtraProps } from "react-markdown";

// ─── Types ────────────────────────────────────────────────────────────────────

type InlineCodeProps = ClassAttributes<HTMLElement> &
  HTMLAttributes<HTMLElement> &
  ExtraProps;

type ButtonState = "idle" | "executing" | "success" | "error";

// ─── SlashCommandCode ─────────────────────────────────────────────────────────

/**
 * Inline code renderer that detects slash commands and, when a SlashCommandContext
 * is available, renders a hover-revealed play button to execute the command.
 *
 * Falls back to plain styled `<code>` when:
 * - No SlashCommandContext provider is present (non-session views)
 * - The content is not a valid slash command
 * - The command name is not in the known commands set
 * - The context is disabled (session stopped/errored)
 */
export function SlashCommandCode({ children, className, ...props }: InlineCodeProps) {
  const ctx = useSlashCommandContext();
  const [buttonState, setButtonState] = useState<ButtonState>("idle");

  const commandText = extractSlashCommandText(children);

  // Determine if we should show a play button:
  // - context must be present (session view)
  // - content must be a valid slash command
  // - command must be in the known commands set
  // - context must not be disabled
  const parsed = commandText?.slice(1).split(/\s/)[0]; // command name without slash
  const isKnownCommand =
    ctx !== null &&
    !ctx.disabled &&
    commandText !== null &&
    parsed !== undefined &&
    ctx.knownCommands.size > 0 && // wait for commands to load
    ctx.knownCommands.has(parsed);

  const handleExecute = useCallback(async () => {
    if (!ctx || !commandText || buttonState !== "idle") return;
    setButtonState("executing");
    try {
      await ctx.executeCommand(commandText);
      setButtonState("success");
      setTimeout(() => setButtonState("idle"), 500);
    } catch {
      setButtonState("error");
      setTimeout(() => setButtonState("idle"), 1000);
    }
  }, [ctx, commandText, buttonState]);

  const codeElement = (
    <code
      className="bg-muted/50 text-primary/90 px-1 py-0.5 rounded text-xs font-mono"
      {...props}
    >
      {children}
    </code>
  );

  if (!isKnownCommand) {
    return codeElement;
  }

  return (
    <span className="group inline-flex items-center gap-0.5">
      {codeElement}
      <button
        type="button"
        onClick={() => void handleExecute()}
        disabled={buttonState !== "idle"}
        aria-label={`Run ${commandText}`}
        title={`Run ${commandText}`}
        className="inline-flex items-center justify-center opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity disabled:cursor-not-allowed"
      >
        {buttonState === "executing" && (
          <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
        )}
        {buttonState === "success" && (
          <Check className="h-3 w-3 text-green-600 dark:text-green-400" />
        )}
        {buttonState === "error" && (
          <X className="h-3 w-3 text-red-600 dark:text-red-400" />
        )}
        {buttonState === "idle" && (
          <Play className="h-3 w-3 text-muted-foreground" />
        )}
      </button>
    </span>
  );
}
