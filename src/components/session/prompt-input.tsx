"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Send, Loader2, AlertCircle } from "lucide-react";
import { useAutocomplete } from "@/hooks/use-autocomplete";
import { AutocompletePopup } from "@/components/session/autocomplete-popup";
import { AgentSelector } from "@/components/session/agent-selector";
import type { AutocompleteAgent } from "@/lib/api-types";

interface PromptInputProps {
  onSend?: (text: string, agent?: string) => Promise<void>;
  disabled?: boolean;
  sendError?: string;
  instanceId?: string;
  agents?: AutocompleteAgent[];
  selectedAgent?: string | null;
  onAgentChange?: (agent: string | null) => void;
  onFocusRequest?: (focus: () => void) => void;
}

export function PromptInput({
  onSend,
  disabled,
  sendError,
  instanceId = "",
  agents = [],
  selectedAgent = null,
  onAgentChange,
  onFocusRequest,
}: PromptInputProps) {
  const [value, setValue] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [cursorPos, setCursorPos] = useState(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const historyRef = useRef<string[]>([]);
  const historyIndexRef = useRef<number>(-1);

  const isDisabled = disabled || isSending;

  // Re-focus whenever the input becomes enabled (e.g. agent finishes responding)
  useEffect(() => {
    if (!isDisabled) {
      inputRef.current?.focus();
    }
  }, [isDisabled]);

  // Expose a focus callback via onFocusRequest
  useEffect(() => {
    onFocusRequest?.(() => inputRef.current?.focus());
  }, [onFocusRequest]);

  const autocomplete = useAutocomplete({
    value,
    setValue,
    instanceId,
    inputRef,
    cursorPosition: cursorPos,
  });

  const canSend = !!value.trim() && !isDisabled && !autocomplete.isOpen;

  // Sync cursor position from the textarea element
  const updateCursor = () => {
    setCursorPos(inputRef.current?.selectionStart ?? 0);
  };

  // ─── Auto-resize textarea ────────────────────────────────────────────────
  const maxHeight = 150;

  useLayoutEffect(() => {
    const textarea = inputRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    const newHeight = Math.min(textarea.scrollHeight, maxHeight);
    textarea.style.height = newHeight + "px";
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [value]);

  // ─── Send logic ──────────────────────────────────────────────────────────
  const handleSend = async () => {
    if (autocomplete.isOpen) return;
    if (!canSend) return;
    const text = value.trim();

    // Push to history
    historyRef.current.push(text);
    historyIndexRef.current = -1;

    setValue("");
    setIsSending(true);
    try {
      await onSend?.(text, selectedAgent ?? undefined);
    } finally {
      setIsSending(false);
      inputRef.current?.focus();
    }
  };

  // ─── Keyboard handling ───────────────────────────────────────────────────
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter without Shift: send (unless autocomplete is open)
    if (e.key === "Enter" && !e.shiftKey) {
      if (!autocomplete.isOpen) {
        e.preventDefault();
        void handleSend();
        return;
      }
    }

    // ArrowUp: recall previous history entry when value is empty
    if (e.key === "ArrowUp" && !autocomplete.isOpen && value === "") {
      const history = historyRef.current;
      if (history.length === 0) return;
      e.preventDefault();
      const newIndex =
        historyIndexRef.current === -1
          ? history.length - 1
          : Math.max(0, historyIndexRef.current - 1);
      historyIndexRef.current = newIndex;
      setValue(history[newIndex]);
      return;
    }

    // ArrowDown: walk forward through history when browsing
    if (e.key === "ArrowDown" && !autocomplete.isOpen && historyIndexRef.current !== -1) {
      e.preventDefault();
      const history = historyRef.current;
      const newIndex = historyIndexRef.current + 1;
      if (newIndex >= history.length) {
        historyIndexRef.current = -1;
        setValue("");
      } else {
        historyIndexRef.current = newIndex;
        setValue(history[newIndex]);
      }
      return;
    }

    // Delegate all other keys to autocomplete
    autocomplete.onKeyDown(e);
  };

  return (
    <div className="relative border-t p-3 space-y-2">
      {/* Autocomplete popup — floats above the input */}
      <AutocompletePopup
        open={autocomplete.isOpen}
        items={autocomplete.items}
        isLoading={autocomplete.isLoading}
        selectedValue={autocomplete.selectedValue}
        error={autocomplete.error}
        onSelect={autocomplete.onSelect}
      />

      {sendError && (
        <div className="flex items-center gap-2 rounded-md bg-red-500/10 border border-red-500/20 px-3 py-1.5 text-xs text-red-400">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          <span>{sendError}</span>
        </div>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
        }}
        className="flex items-end gap-2"
      >
        {agents.length > 0 && (
          <AgentSelector
            agents={agents}
            selectedAgent={selectedAgent}
            onSelect={onAgentChange ?? (() => {})}
            disabled={isDisabled}
          />
        )}
        <Textarea
          ref={inputRef}
          rows={1}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setCursorPos(e.target.selectionStart ?? 0);
            historyIndexRef.current = -1;
          }}
          onClick={updateCursor}
          onSelect={updateCursor}
          onKeyDown={handleKeyDown}
          onBlur={() => {
            // Delay closing to allow click-to-select on popup items
            setTimeout(() => {
              autocomplete.onClose();
            }, 150);
          }}
          placeholder="Send a message to this session..."
          className="text-sm"
          disabled={isDisabled}
          style={{ overflowY: "hidden" }}
          // Accessibility attributes for combobox pattern
          role="combobox"
          aria-expanded={autocomplete.isOpen}
          aria-haspopup="listbox"
          aria-autocomplete="list"
          aria-controls="autocomplete-listbox"
          aria-activedescendant={
            autocomplete.isOpen && autocomplete.selectedValue
              ? `autocomplete-item-${autocomplete.selectedValue}`
              : undefined
          }
          autoComplete="off"
        />
        <Button
          type="button"
          size="icon"
          variant="default"
          disabled={!canSend}
          onClick={() => void handleSend()}
        >
          {isSending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
        </Button>
      </form>
    </div>
  );
}
