"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, RefreshCw, Search } from "lucide-react";
import { useGoogleChatSpaces } from "../hooks/use-google-chat-spaces";
import { SpaceRow } from "./space-row";
import type { GoogleChatSpaceType } from "../types";

type SpaceFilter = "ALL" | GoogleChatSpaceType;

const FILTER_LABELS: Record<SpaceFilter, string> = {
  ALL: "All",
  SPACE: "Spaces",
  GROUP_CHAT: "Groups",
  DIRECT_MESSAGE: "DMs",
};

const FILTERS: SpaceFilter[] = ["ALL", "SPACE", "GROUP_CHAT", "DIRECT_MESSAGE"];

export function SpaceList() {
  const { spaces, isLoading, error, refresh } = useGoogleChatSpaces();
  const [typeFilter, setTypeFilter] = useState<SpaceFilter>("ALL");
  const [nameFilter, setNameFilter] = useState("");

  const filtered = spaces.filter((s) => {
    const matchesType = typeFilter === "ALL" || s.spaceType === typeFilter;
    const matchesName =
      !nameFilter.trim() ||
      s.displayName.toLowerCase().includes(nameFilter.trim().toLowerCase());
    return matchesType && matchesName;
  });

  return (
    <div className="space-y-3">
      {/* Filter bar */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1 min-w-0">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            className="pl-8 h-8 text-sm"
            placeholder="Filter spaces…"
            value={nameFilter}
            onChange={(e) => setNameFilter(e.target.value)}
          />
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={refresh}
          disabled={isLoading}
          aria-label="Refresh spaces"
          className="shrink-0"
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`}
          />
        </Button>
      </div>

      {/* Type filter tabs */}
      <div className="flex gap-1 flex-wrap">
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setTypeFilter(f)}
            className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
              typeFilter === f
                ? "border-primary bg-primary/10 text-primary"
                : "border-input text-muted-foreground hover:border-muted-foreground hover:text-foreground"
            }`}
          >
            {FILTER_LABELS[f]}
          </button>
        ))}
      </div>

      {error && (
        <div className="px-3 py-2 text-xs text-destructive rounded-md border border-destructive/20 bg-destructive/10">
          {error}
        </div>
      )}

      {!error && filtered.length === 0 && !isLoading && (
        <div className="flex flex-col items-center justify-center py-12 gap-2">
          <p className="text-sm text-muted-foreground">
            {spaces.length === 0
              ? "No spaces found."
              : "No spaces match the current filters."}
          </p>
        </div>
      )}

      <div className="space-y-1">
        {filtered.map((space) => (
          <SpaceRow key={space.name} space={space} />
        ))}
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-4">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      )}
    </div>
  );
}
