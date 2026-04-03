"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { ChevronDown, Loader2, RefreshCw } from "lucide-react";
import { useGoogleChatSpaces } from "../hooks/use-google-chat-spaces";
import type { GoogleChatSpace } from "../types";

const SPACE_TYPE_LABELS: Record<string, string> = {
  SPACE: "Space",
  GROUP_CHAT: "Group",
  DIRECT_MESSAGE: "DM",
};

interface SpaceSelectorProps {
  selected: GoogleChatSpace | null;
  onSelect: (space: GoogleChatSpace) => void;
}

export function SpaceSelector({ selected, onSelect }: SpaceSelectorProps) {
  const [open, setOpen] = useState(false);
  const { spaces, isLoading, error, refresh } = useGoogleChatSpaces();

  return (
    <div className="flex items-center gap-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="gap-1.5 max-w-xs">
            <span className="truncate">
              {selected ? selected.displayName || selected.name : "Select a space…"}
            </span>
            <ChevronDown className="h-3.5 w-3.5 shrink-0" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-80 p-0" align="start">
          <Command>
            <CommandInput placeholder="Search spaces…" />
            <CommandList className="thin-scrollbar">
              {error && (
                <div className="py-3 px-4 text-xs text-destructive">{error}</div>
              )}
              {!error && spaces.length === 0 && !isLoading && (
                <CommandEmpty>No spaces found.</CommandEmpty>
              )}
              <CommandGroup>
                {spaces.map((space) => (
                  <CommandItem
                    key={space.name}
                    value={space.displayName || space.name}
                    onSelect={() => {
                      onSelect(space);
                      setOpen(false);
                    }}
                  >
                    <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm truncate">
                          {space.displayName || space.name}
                        </span>
                        <Badge
                          variant="secondary"
                          className="text-[10px] px-1 py-0 shrink-0"
                        >
                          {SPACE_TYPE_LABELS[space.spaceType] ?? space.spaceType}
                        </Badge>
                      </div>
                      {space.spaceDetails?.description && (
                        <div className="text-[10px] text-muted-foreground truncate">
                          {space.spaceDetails.description}
                        </div>
                      )}
                    </div>
                  </CommandItem>
                ))}
                {isLoading && spaces.length === 0 && (
                  <div className="flex justify-center py-3">
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                  </div>
                )}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      <Button
        variant="ghost"
        size="icon-sm"
        onClick={refresh}
        disabled={isLoading}
        aria-label="Refresh spaces"
      >
        <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`} />
      </Button>
    </div>
  );
}
