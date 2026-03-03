"use client";

import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
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
  const inputRef = useRef<HTMLInputElement>(null);

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

  // Sync cursor position from the input element
  const updateCursor = () => {
    setCursorPos(inputRef.current?.selectionStart ?? 0);
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
        onSubmit={async (e) => {
          e.preventDefault();
          // Don't submit if autocomplete is open — Enter selects an item instead
          if (autocomplete.isOpen) return;
          if (!canSend) return;
          const text = value.trim();
          setValue("");
          setIsSending(true);
          try {
            await onSend?.(text, selectedAgent ?? undefined);
          } finally {
            setIsSending(false);
            inputRef.current?.focus();
          }
        }}
        className="flex items-center gap-2"
      >
        {agents.length > 0 && (
          <AgentSelector
            agents={agents}
            selectedAgent={selectedAgent}
            onSelect={onAgentChange ?? (() => {})}
            disabled={isDisabled}
          />
        )}
        <Input
          ref={inputRef}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setCursorPos(e.target.selectionStart ?? 0);
          }}
          onClick={updateCursor}
          onSelect={updateCursor}
          onKeyDown={autocomplete.onKeyDown}
          onBlur={() => {
            // Delay closing to allow click-to-select on popup items
            setTimeout(() => {
              autocomplete.onClose();
            }, 150);
          }}
          placeholder="Send a message to this session..."
          className="text-sm"
          disabled={isDisabled}
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
          type="submit"
          size="icon"
          variant="default"
          disabled={!canSend}
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
