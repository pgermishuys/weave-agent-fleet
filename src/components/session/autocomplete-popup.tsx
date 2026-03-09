"use client";

import * as React from "react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { Terminal, FileText, Folder, Bot, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export type AutocompleteItemGroup = "command" | "file" | "agent";

export interface AutocompleteItem {
  id: string;
  label: string;
  description?: string;
  group: AutocompleteItemGroup;
  /** The string value inserted into the input on selection */
  value: string;
  /**
   * Optional group-specific metadata:
   * - agents: CSS color string for the colored dot
   * - files:  "dir" if the path is a directory
   */
  meta?: string;
}

interface AutocompletePopupProps {
  open: boolean;
  onSelect: (value: string) => void;
  items: AutocompleteItem[];
  isLoading: boolean;
  /** The value of the currently highlighted item (drives cmdk selection) */
  selectedValue: string | null;
  /** Network / data error to display inline */
  error?: string;
}

const GROUP_LABELS: Record<AutocompleteItemGroup, string> = {
  command: "Commands",
  file: "Files",
  agent: "Agents",
};

const GROUP_ORDER: AutocompleteItemGroup[] = ["command", "agent", "file"];

function ItemIcon({ item }: { item: AutocompleteItem }) {
  if (item.group === "command") {
    return <Terminal className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />;
  }
  if (item.group === "agent") {
    return (
      <span className="relative inline-flex shrink-0 items-center justify-center">
        <Bot className="h-3.5 w-3.5 text-muted-foreground" />
        {item.meta && (
          <span
            className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full"
            style={{ backgroundColor: item.meta }}
          />
        )}
      </span>
    );
  }
  // file group — distinguish directories by meta
  if (item.meta === "dir") {
    return <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />;
  }
  return <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />;
}

/**
 * Floating autocomplete popup that renders above the prompt input.
 * Positioned absolutely — the parent container must be `position: relative`.
 *
 * Uses cmdk for keyboard-navigable list semantics.
 * Selection highlighting is driven externally via `selectedValue`.
 */
export function AutocompletePopup({
  open,
  onSelect,
  items,
  isLoading,
  selectedValue,
  error,
}: AutocompletePopupProps) {
  if (!open) return null;

  // Group items by type, preserving GROUP_ORDER
  const grouped = GROUP_ORDER.reduce<Record<AutocompleteItemGroup, AutocompleteItem[]>>(
    (acc, g) => {
      acc[g] = items.filter((item) => item.group === g);
      return acc;
    },
    { command: [], file: [], agent: [] }
  );

  const visibleGroups = GROUP_ORDER.filter((g) => grouped[g].length > 0);
  const hasItems = visibleGroups.length > 0;

  return (
    <div
      role="presentation"
      className={cn(
        "absolute bottom-full left-0 right-0 mb-1 z-50",
        "rounded-md border bg-popover shadow-md overflow-hidden"
      )}
      // Prevent mousedown from blurring the input (allows click-to-select)
      onMouseDown={(e) => e.preventDefault()}
    >
      <Command
        shouldFilter={false}
        value={selectedValue ?? ""}
        className="rounded-none border-0"
      >
        <CommandList id="autocomplete-listbox" className="max-h-[300px]">
          {/* Loading state */}
          {isLoading && (
            <div className="flex items-center justify-center gap-2 py-4 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              <span>Searching…</span>
            </div>
          )}

          {/* Error state */}
          {error && !isLoading && (
            <div role="alert" className="px-3 py-2 text-xs text-red-600 dark:text-red-400">
              {error}
            </div>
          )}

          {/* Empty state — only when not loading and no error */}
          {!isLoading && !error && !hasItems && (
            <CommandEmpty className="py-4 text-xs">No results</CommandEmpty>
          )}

          {/* Grouped items */}
          {!isLoading &&
            visibleGroups.map((group, groupIndex) => (
              <React.Fragment key={group}>
                {groupIndex > 0 && <CommandSeparator />}
                <CommandGroup heading={GROUP_LABELS[group]}>
                  {grouped[group].map((item) => (
                    <CommandItem
                      key={item.id}
                      id={`autocomplete-item-${item.value}`}
                      value={item.value}
                      onSelect={() => onSelect(item.value)}
                      className="gap-2 text-sm"
                    >
                      <ItemIcon item={item} />
                      <span className="truncate font-medium">{item.label}</span>
                      {item.description && (
                        <span className="ml-auto truncate text-xs text-muted-foreground">
                          {item.description}
                        </span>
                      )}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </React.Fragment>
            ))}
        </CommandList>
      </Command>
    </div>
  );
}
