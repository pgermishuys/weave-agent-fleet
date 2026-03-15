"use client";

import { useEffect } from "react";
import { Search, Group, ArrowUpDown, Check } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type GroupBy = "directory" | "session-status" | "connection-status" | "source" | "none";
export type SortBy = "recent" | "name" | "status";

const GROUP_BY_LABELS: Record<GroupBy, string> = {
  directory: "Directory",
  "session-status": "Session Status",
  "connection-status": "Connection Status",
  source: "Source",
  none: "None",
};

const SORT_BY_LABELS: Record<SortBy, string> = {
  recent: "Recent",
  name: "Name",
  status: "Status",
};

const PREFS_KEY = "weave:fleet:prefs";

interface FleetPrefs {
  groupBy: GroupBy;
  sortBy: SortBy;
}

const DEFAULT_PREFS: FleetPrefs = { groupBy: "directory", sortBy: "recent" };

/** Always returns defaults — safe for SSR and initial client render. */
function loadPrefs(): FleetPrefs {
  return DEFAULT_PREFS;
}

/** Reads saved prefs from localStorage (client-only, call inside useEffect). */
function loadSavedPrefs(): FleetPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<FleetPrefs>;
      return {
        groupBy: parsed.groupBy ?? "directory",
        sortBy: parsed.sortBy ?? "recent",
      };
    }
  } catch {
    // ignore
  }
  return DEFAULT_PREFS;
}

function savePrefs(prefs: FleetPrefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // ignore
  }
}

interface FleetToolbarProps {
  groupBy: GroupBy;
  sortBy: SortBy;
  search: string;
  onGroupByChange: (groupBy: GroupBy) => void;
  onSortByChange: (sortBy: SortBy) => void;
  onSearchChange: (search: string) => void;
}

export function FleetToolbar({
  groupBy,
  sortBy,
  search,
  onGroupByChange,
  onSortByChange,
  onSearchChange,
}: FleetToolbarProps) {
  // Persist preferences when they change
  useEffect(() => {
    savePrefs({ groupBy, sortBy });
  }, [groupBy, sortBy]);

  return (
    <div className="space-y-2">
      {/* Search + Group + Sort row */}
      <div className="flex items-center gap-3">
        {/* Search */}
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search sessions…"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            className="h-8 pl-8 text-xs"
          />
        </div>

        {/* Group By */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
              <Group className="h-3.5 w-3.5" />
              Group: {GROUP_BY_LABELS[groupBy]}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {(Object.keys(GROUP_BY_LABELS) as GroupBy[]).map((key) => (
              <DropdownMenuItem
                key={key}
                onClick={() => onGroupByChange(key)}
                className="text-xs gap-2"
              >
                {groupBy === key && <Check className="h-3.5 w-3.5" />}
                {groupBy !== key && <span className="w-3.5" />}
                {GROUP_BY_LABELS[key]}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Sort By */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
              <ArrowUpDown className="h-3.5 w-3.5" />
              Sort: {SORT_BY_LABELS[sortBy]}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {(Object.keys(SORT_BY_LABELS) as SortBy[]).map((key) => (
              <DropdownMenuItem
                key={key}
                onClick={() => onSortByChange(key)}
                className="text-xs gap-2"
              >
                {sortBy === key && <Check className="h-3.5 w-3.5" />}
                {sortBy !== key && <span className="w-3.5" />}
                {SORT_BY_LABELS[key]}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

export { loadPrefs, loadSavedPrefs };
