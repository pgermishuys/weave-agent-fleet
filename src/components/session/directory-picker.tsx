"use client";

import * as React from "react";
import { useState, useRef, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  FolderOpen,
  Folder,
  GitBranch,
  ChevronUp,
  ChevronRight,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useDirectoryBrowser } from "@/hooks/use-directory-browser";

interface DirectoryPickerProps {
  /** The currently selected/typed directory path */
  value: string;
  /** Callback when path changes */
  onChange: (path: string) => void;
  /** Placeholder text for the input */
  placeholder?: string;
  /** Whether the input is disabled */
  disabled?: boolean;
  /** HTML id for the text input (for label association) */
  id?: string;
}

export function DirectoryPicker({
  value,
  onChange,
  placeholder,
  disabled,
  id,
}: DirectoryPickerProps) {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const {
    currentPath,
    entries,
    isLoading,
    error,
    parentPath,
    roots,
    browse,
    goUp,
    search,
    setSearch,
  } = useDirectoryBrowser(popoverOpen);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const commandListRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [popoverWidth, setPopoverWidth] = useState<number | undefined>();

  // Measure container width when popover opens
  useEffect(() => {
    if (popoverOpen && containerRef.current) {
      setPopoverWidth(containerRef.current.offsetWidth);
    }
  }, [popoverOpen]);

  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    const el = commandListRef.current;
    if (!el) return;

    const scrollingDown = event.deltaY > 0;
    const canScrollDown = el.scrollTop + el.clientHeight < el.scrollHeight;
    const canScrollUp = el.scrollTop > 0;

    if ((scrollingDown && canScrollDown) || (!scrollingDown && canScrollUp)) {
      event.preventDefault();
      el.scrollTop += event.deltaY;
    }
  };

  // Focus search input when popover opens
  useEffect(() => {
    if (popoverOpen) {
      // Small delay to let the popover render
      const timer = setTimeout(() => {
        searchInputRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [popoverOpen]);

  // Build breadcrumb segments from current path
  const breadcrumbs = React.useMemo(() => {
    if (currentPath === null) return [];

    // Normalize separators: server may return "\" on Windows
    const sep = currentPath.includes("\\") ? "\\" : "/";

    // Find which root this path is under
    const root = roots.find(
      (r) => currentPath === r || currentPath.startsWith(r + sep)
    );

    if (!root) return [{ label: currentPath, path: currentPath }];

    const rootName = root.split(sep).filter(Boolean).pop() ?? root;
    const crumbs: { label: string; path: string }[] = [
      { label: rootName, path: root },
    ];

    // Add segments between root and current path
    if (currentPath !== root) {
      const relative = currentPath.slice(root.length + 1);
      const segments = relative.split(sep);
      let accumulated = root;
      for (const segment of segments) {
        accumulated = `${accumulated}${sep}${segment}`;
        crumbs.push({ label: segment, path: accumulated });
      }
    }

    return crumbs;
  }, [currentPath, roots]);

  const handleSelect = (path: string) => {
    onChange(path);
    setPopoverOpen(false);
  };

  const handleNavigate = (path: string) => {
    browse(path);
  };

  return (
    <div ref={containerRef} className="flex gap-1.5">
      <Input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className="flex-1"
      />
      <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="icon"
            disabled={disabled}
            className="shrink-0"
            aria-label="Browse directories"
          >
            <FolderOpen className="h-4 w-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          side="bottom"
          className="p-0"
          style={popoverWidth ? { width: popoverWidth } : { width: 320 }}
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          {/* Breadcrumb navigation */}
          {currentPath !== null && (
            <div className="flex items-center gap-1 px-3 py-2 border-b text-xs text-muted-foreground overflow-x-auto">
              <button
                type="button"
                onClick={() => browse(null)}
                className="shrink-0 hover:text-foreground transition-colors"
              >
                Roots
              </button>
              {breadcrumbs.map((crumb, i) => (
                <React.Fragment key={crumb.path}>
                  <ChevronRight className="h-3 w-3 shrink-0" />
                  <button
                    type="button"
                    onClick={() => browse(crumb.path)}
                    className={cn(
                      "truncate max-w-[80px] hover:text-foreground transition-colors",
                      i === breadcrumbs.length - 1 && "text-foreground font-medium"
                    )}
                    title={crumb.path}
                  >
                    {crumb.label}
                  </button>
                </React.Fragment>
              ))}
            </div>
          )}

          <Command shouldFilter={false} className="rounded-none border-0">
            <CommandInput
              ref={searchInputRef}
              placeholder="Search directories..."
              value={search}
              onValueChange={setSearch}
            />
            <CommandList ref={commandListRef} onWheel={handleWheel} className="max-h-[250px]">
              {/* Loading state */}
              {isLoading && (
                <div className="flex items-center justify-center gap-2 py-4 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>Loading...</span>
                </div>
              )}

              {/* Error state */}
              {error && !isLoading && (
                <div className="px-3 py-2 text-xs text-red-600 dark:text-red-400">{error}</div>
              )}

              {/* Empty state */}
              {!isLoading && !error && entries.length === 0 && (
                <CommandEmpty className="py-4 text-xs">
                  No subdirectories
                </CommandEmpty>
              )}

              {!isLoading && !error && entries.length > 0 && (
                <CommandGroup>
                  {/* Go up button */}
                  {parentPath !== null && !search && (
                    <CommandItem
                      onSelect={goUp}
                      className="gap-2 text-sm text-muted-foreground"
                    >
                      <ChevronUp className="h-3.5 w-3.5" />
                      <span className="truncate">.. (up)</span>
                    </CommandItem>
                  )}

                  {entries.map((entry) => (
                    <CommandItem
                      key={entry.path}
                      value={entry.path}
                      className="gap-2 text-sm group"
                      onSelect={() => handleNavigate(entry.path)}
                    >
                      <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="truncate flex-1">{entry.name}</span>
                      {entry.isGitRepo && (
                        <GitBranch className="h-3 w-3 shrink-0 text-muted-foreground" />
                      )}
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-5 px-1.5 text-[10px] opacity-0 group-hover:opacity-100 group-data-[selected=true]:opacity-100 transition-opacity shrink-0"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSelect(entry.path);
                        }}
                        onMouseDown={(e) => e.preventDefault()}
                      >
                        Select
                      </Button>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
            </CommandList>
          </Command>

          {/* Use current directory button */}
          {currentPath !== null && (
            <div className="border-t px-3 py-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full text-xs h-7"
                onClick={() => handleSelect(currentPath)}
              >
                Use this directory
              </Button>
            </div>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}
