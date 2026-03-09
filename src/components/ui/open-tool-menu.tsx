"use client";

import { ExternalLink, Loader2 } from "lucide-react";
import type { OpenTool } from "@/hooks/use-open-directory";
import {
  useAvailableTools,
  getToolsByCategory,
  type AvailableTool,
} from "@/hooks/use-available-tools";
import { getToolIcon } from "@/lib/tool-icons";

import {
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

import {
  ContextMenuSub,
  ContextMenuSubTrigger,
  ContextMenuSubContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from "@/components/ui/context-menu";

// ── Shared data preparation ─────────────────────────────────────────────────

interface ToolGroup {
  category: AvailableTool["category"];
  tools: AvailableTool[];
}

function groupTools(tools: AvailableTool[]): ToolGroup[] {
  const order: AvailableTool["category"][] = ["editor", "terminal", "explorer"];
  const groups: ToolGroup[] = [];
  for (const category of order) {
    const items = getToolsByCategory(tools, category);
    if (items.length > 0) {
      groups.push({ category, tools: items });
    }
  }
  return groups;
}

// ── Dropdown Menu variant (for SessionGroup overflow menu) ──────────────────

interface OpenToolDropdownSubmenuProps {
  directory: string;
  onOpen: (directory: string, tool: OpenTool) => void;
}

export function OpenToolDropdownSubmenu({
  directory,
  onOpen,
}: OpenToolDropdownSubmenuProps) {
  const { tools, isLoading } = useAvailableTools();
  const groups = groupTools(tools);

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger className="gap-2 text-xs">
        <ExternalLink className="size-3.5" />
        Open in...
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        {isLoading && tools.length === 0 && (
          <DropdownMenuItem disabled className="gap-2 text-xs">
            <Loader2 className="size-3.5 animate-spin" />
            Detecting tools…
          </DropdownMenuItem>
        )}
        {!isLoading && tools.length === 0 && (
          <DropdownMenuItem disabled className="gap-2 text-xs text-muted-foreground">
            No tools detected
          </DropdownMenuItem>
        )}
        {groups.map((group, gi) => (
          <div key={group.category}>
            {gi > 0 && <DropdownMenuSeparator />}
            {group.tools.map((tool) => {
              const Icon = getToolIcon(tool.iconName);
              return (
                <DropdownMenuItem
                  key={tool.id}
                  onClick={() => onOpen(directory, tool.id)}
                  className="gap-2 text-xs"
                >
                  <Icon className="size-3.5" />
                  <span className="flex-1">{tool.label}</span>
                </DropdownMenuItem>
              );
            })}
          </div>
        ))}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

// ── Context Menu variant (for right-click menus) ────────────────────────────

interface OpenToolContextSubmenuProps {
  directory: string;
  onOpen: (directory: string, tool: OpenTool) => void;
}

export function OpenToolContextSubmenu({
  directory,
  onOpen,
}: OpenToolContextSubmenuProps) {
  const { tools, isLoading } = useAvailableTools();
  const groups = groupTools(tools);

  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger className="gap-2 text-xs">
        <ExternalLink className="h-3.5 w-3.5" />
        Open in...
      </ContextMenuSubTrigger>
      <ContextMenuSubContent>
        {isLoading && tools.length === 0 && (
          <ContextMenuItem disabled className="gap-2 text-xs">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Detecting tools…
          </ContextMenuItem>
        )}
        {!isLoading && tools.length === 0 && (
          <ContextMenuItem disabled className="gap-2 text-xs text-muted-foreground">
            No tools detected
          </ContextMenuItem>
        )}
        {groups.map((group, gi) => (
          <div key={group.category}>
            {gi > 0 && <ContextMenuSeparator />}
            {group.tools.map((tool) => {
              const Icon = getToolIcon(tool.iconName);
              return (
                <ContextMenuItem
                  key={tool.id}
                  onClick={() => onOpen(directory, tool.id)}
                  className="gap-2 text-xs"
                >
                  <Icon className="h-3.5 w-3.5" />
                  <span className="flex-1">{tool.label}</span>
                </ContextMenuItem>
              );
            })}
          </div>
        ))}
      </ContextMenuSubContent>
    </ContextMenuSub>
  );
}
