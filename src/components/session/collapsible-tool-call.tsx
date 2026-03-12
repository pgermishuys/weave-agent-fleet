"use client";

import { useState } from "react";
import { SquareTerminal, X, Loader2, ChevronRight, ChevronDown, Copy, Check } from "lucide-react";
import { getToolLabel } from "@/lib/tool-labels";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import type { AccumulatedPart } from "@/lib/api-types";

interface CollapsibleToolCallProps {
  part: AccumulatedPart & { type: "tool" };
}

/** Try to pretty-print a string as JSON; returns null if not valid JSON. */
function tryFormatJson(value: string): string | null {
  try {
    const parsed: unknown = JSON.parse(value);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return null;
  }
}

/** Render a value as formatted JSON (in a <pre>) or plain text. */
function FormattedOutput({ value }: { value: string }) {
  const formatted = tryFormatJson(value);
  if (formatted !== null) {
    return (
      <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed">
        {formatted}
      </pre>
    );
  }
  return (
    <span className="whitespace-pre-wrap break-words text-xs leading-relaxed">
      {value}
    </span>
  );
}

export function CollapsibleToolCall({ part }: CollapsibleToolCallProps) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const state = part.state as any;
  const isRunning = state?.status === "running" || !state?.status;
  const isCompleted = state?.status === "completed";
  const isError = state?.status === "error";

  const output: string = state?.output ? String(state.output) : "";
  const error: string = state?.error ? String(state.error) : "";
  const input: string = state?.input ? JSON.stringify(state.input) : "";

  const label = getToolLabel(part.tool, state?.input ?? null);

  const hasExpandableContent = !isRunning && (output || error || input);

  async function handleCopy() {
    const text = output || error || "";
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard access denied — silently ignore
    }
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild disabled={!hasExpandableContent}>
        <button
          type="button"
          className="flex w-full items-center gap-2 py-0.5 text-xs text-muted-foreground text-left hover:bg-accent/30 rounded-sm px-1 -mx-1 transition-colors disabled:hover:bg-transparent disabled:cursor-default"
        >
          {/* Chevron — only when expandable */}
          {hasExpandableContent ? (
            open ? (
              <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground/60" />
            ) : (
              <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground/60" />
            )
          ) : (
            <span className="inline-block h-3 w-3 shrink-0" />
          )}

          <SquareTerminal className="h-3 w-3 shrink-0 text-muted-foreground" />
          <span className="flex-1 truncate">{label}</span>
          <span className="font-mono text-muted-foreground/50 shrink-0">{part.tool}</span>

          {isRunning && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground shrink-0" />}
          {isCompleted && <Check className="h-3 w-3 text-green-500 shrink-0" />}
          {isError && <X className="h-3 w-3 text-red-500 shrink-0" />}
        </button>
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className="mt-1 mb-1 ml-4 rounded-md border border-border/60 bg-muted/20 p-3 space-y-3 text-xs">
          {/* Input */}
          {input && (
            <div>
              <div className="text-muted-foreground/70 font-medium mb-1">Input</div>
              <div className="bg-muted/30 rounded px-2 py-1.5 overflow-x-auto">
                <FormattedOutput value={input} />
              </div>
            </div>
          )}

          {/* Output */}
          {(output || error) && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-muted-foreground/70 font-medium">
                  {isError ? "Error" : "Output"}
                </span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    void handleCopy();
                  }}
                  className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                  title="Copy to clipboard"
                >
                  {copied ? (
                    <>
                      <Check className="h-3 w-3" />
                      Copied
                    </>
                  ) : (
                    <>
                      <Copy className="h-3 w-3" />
                      Copy
                    </>
                  )}
                </button>
              </div>
              <div className={`bg-muted/30 rounded px-2 py-1.5 overflow-x-auto ${isError ? "text-red-600 dark:text-red-400" : ""}`}>
                <FormattedOutput value={isError ? error : output} />
              </div>
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
