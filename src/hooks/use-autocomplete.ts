"use client";

import { useState, useCallback, useMemo, type KeyboardEvent, type RefObject } from "react";
import { useCommands } from "@/hooks/use-commands";
import { useAgents } from "@/hooks/use-agents";
import { useFindFiles } from "@/hooks/use-find-files";
import type { AutocompleteItem } from "@/components/session/autocomplete-popup";

interface UseAutocompleteParams {
  value: string;
  setValue: (value: string) => void;
  instanceId: string;
  inputRef: RefObject<HTMLInputElement | null>;
  cursorPosition: number;
}

export interface UseAutocompleteResult {
  isOpen: boolean;
  items: AutocompleteItem[];
  isLoading: boolean;
  error?: string;
  selectedValue: string | null;
  onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void;
  onSelect: (value: string) => void;
  onClose: () => void;
}

interface Trigger {
  type: "slash" | "mention";
  startIndex: number;
}

/**
 * Detects `/` and `@` trigger characters in the input, fetches relevant
 * autocomplete data, and exposes keyboard handlers and selection logic.
 *
 * `/` at position 0 triggers slash-command autocomplete.
 * `@` anywhere (after whitespace or at start) triggers file + agent autocomplete.
 */
export function useAutocomplete({
  value,
  setValue,
  instanceId,
  inputRef,
  cursorPosition,
}: UseAutocompleteParams): UseAutocompleteResult {
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Tracks the input value at the time Escape was pressed.
  // While this matches the current value, the popup stays suppressed.
  // Cleared automatically when the user changes the input text (derived state pattern).
  const [suppressedValue, setSuppressedValue] = useState<string | null>(null);

  // Auto-clear suppression when the user types (value no longer matches snapshot).
  // This is a render-time state adjustment — safe in React 19 (triggers synchronous re-render).
  if (suppressedValue !== null && value !== suppressedValue) {
    setSuppressedValue(null);
  }

  const isSuppressed = suppressedValue !== null;

  // ─── Data sources ───────────────────────────────────────────────────────────
  const { commands, isLoading: commandsLoading, error: commandsError } = useCommands(instanceId);
  const { agents, isLoading: agentsLoading, error: agentsError } = useAgents(instanceId);

  // ─── Trigger detection (pure derivation — no state) ─────────────────────────
  const computedTrigger = useMemo((): Trigger | null => {
    if (!value) return null;

    // Slash trigger: only active when value starts with `/` and no space yet
    if (value.startsWith("/") && cursorPosition >= 1) {
      const afterSlash = value.slice(1, cursorPosition);
      if (!afterSlash.includes(" ")) {
        return { type: "slash", startIndex: 0 };
      }
      return null;
    }

    // Mention trigger: scan backwards from cursor to find `@`
    const textBeforeCursor = value.slice(0, cursorPosition);
    const atIndex = textBeforeCursor.lastIndexOf("@");
    if (atIndex === -1) return null;

    // Character immediately before `@` must be whitespace or start-of-string
    const charBefore = atIndex > 0 ? textBeforeCursor[atIndex - 1] : null;
    if (charBefore !== null && !/\s/.test(charBefore)) return null;

    // Text between `@` and cursor must not contain whitespace
    const textBetween = textBeforeCursor.slice(atIndex + 1);
    if (textBetween.includes(" ")) return null;

    return { type: "mention", startIndex: atIndex };
  }, [value, cursorPosition]);

  const filterText = useMemo(() => {
    if (!computedTrigger) return "";
    return value.slice(computedTrigger.startIndex + 1, cursorPosition);
  }, [computedTrigger, value, cursorPosition]);

  const { files, isLoading: filesLoading, error: filesError } = useFindFiles(
    instanceId,
    computedTrigger?.type === "mention" ? filterText : ""
  );

  // Popup is open when a trigger is detected AND not suppressed by Escape
  const isOpen = computedTrigger !== null && !isSuppressed;

  // ─── Filtered items ─────────────────────────────────────────────────────────
  const items = useMemo((): AutocompleteItem[] => {
    if (!computedTrigger || isSuppressed) return [];

    if (computedTrigger.type === "slash") {
      const filter = filterText.toLowerCase();
      return commands
        .filter((cmd) => cmd.name.toLowerCase().startsWith(filter))
        .map((cmd) => ({
          id: `command:${cmd.name}`,
          label: `/${cmd.name}`,
          description: cmd.description,
          group: "command" as const,
          value: `/${cmd.name} `,
        }));
    }

    // mention — agents (client-filtered) + files (server-searched)
    const filter = filterText.toLowerCase();
    const agentItems: AutocompleteItem[] = agents
      .filter(
        (a) =>
          filter === "" ||
          a.name.toLowerCase().includes(filter) ||
          a.description?.toLowerCase().includes(filter)
      )
      .map((agent) => ({
        id: `agent:${agent.name}`,
        label: `@${agent.name}`,
        description: agent.description ?? agent.mode,
        group: "agent" as const,
        value: `@${agent.name} `,
        meta: agent.color,
      }));

    const fileItems: AutocompleteItem[] = files.map((filePath) => {
      const isDir = filePath.endsWith("/");
      const segments = filePath.replace(/\/$/, "").split("/");
      const shortName = segments[segments.length - 1] + (isDir ? "/" : "");
      const displayPath =
        filePath.length > 40 ? `\u2026${filePath.slice(-39)}` : filePath;
      return {
        id: `file:${filePath}`,
        label: displayPath,
        description: shortName !== displayPath ? shortName : undefined,
        group: "file" as const,
        value: `@${filePath} `,
        meta: isDir ? "dir" : undefined,
      };
    });

    return [...agentItems, ...fileItems];
  }, [computedTrigger, isSuppressed, commands, agents, files, filterText]);

  // Clamp selectedIndex to valid range when items array shrinks
  const clampedIndex = items.length === 0 ? 0 : Math.min(selectedIndex, items.length - 1);
  const selectedValue = items[clampedIndex]?.value ?? null;

  // ─── Selection ──────────────────────────────────────────────────────────────
  const onSelect = useCallback(
    (itemValue: string) => {
      if (!computedTrigger) return;

      let newValue: string;
      let newCursor: number;

      if (computedTrigger.type === "slash") {
        newValue = itemValue;
        newCursor = itemValue.length;
      } else {
        const before = value.slice(0, computedTrigger.startIndex);
        const after = value.slice(cursorPosition);
        newValue = before + itemValue + after;
        newCursor = (before + itemValue).length;
      }

      setValue(newValue);
      setSelectedIndex(0);

      // Restore cursor position asynchronously (after React re-render)
      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.selectionStart = newCursor;
          inputRef.current.selectionEnd = newCursor;
        }
      }, 0);
    },
    [computedTrigger, value, cursorPosition, setValue, inputRef]
  );

  const onClose = useCallback(() => {
    setSuppressedValue(value);
    setSelectedIndex(0);
  }, [value]);

  // ─── Keyboard handling ──────────────────────────────────────────────────────
  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (!isOpen) return;

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((i) =>
            items.length === 0 ? 0 : (i + 1) % items.length
          );
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((i) =>
            items.length === 0 ? 0 : (i - 1 + items.length) % items.length
          );
          break;
        case "Enter":
        case "Tab": {
          const item = items[clampedIndex];
          if (item) {
            e.preventDefault();
            onSelect(item.value);
          }
          break;
        }
        case "Escape":
          e.preventDefault();
          e.stopPropagation();
          onClose();
          break;
        default:
          // Reset to top item when user types additional characters
          setSelectedIndex(0);
          break;
      }
    },
    [isOpen, items, clampedIndex, onSelect, onClose]
  );

  // ─── Loading / error ────────────────────────────────────────────────────────
  // Intentional priority: commandsError shadows other errors for slash;
  // agentsError shadows filesError for mention (show first error only).
  const isLoading =
    (computedTrigger?.type === "slash" && commandsLoading) ||
    (computedTrigger?.type === "mention" && (agentsLoading || filesLoading)) ||
    false;

  const error =
    (computedTrigger?.type === "slash" ? commandsError : undefined) ??
    (computedTrigger?.type === "mention" ? (agentsError ?? filesError) : undefined);

  return {
    isOpen,
    items,
    isLoading,
    error: error ?? undefined,
    selectedValue,
    onKeyDown,
    onSelect,
    onClose,
  };
}
