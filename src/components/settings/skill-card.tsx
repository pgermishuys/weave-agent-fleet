"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Trash2, FolderOpen, Loader2 } from "lucide-react";

const KNOWN_AGENTS = ["loom", "tapestry", "shuttle", "weft", "warp", "thread", "spindle", "pattern"];

interface SkillCardProps {
  name: string;
  description: string;
  path: string;
  assignedAgents: string[];
  allAgents: string[];
  onToggleAgent: (skillName: string, agentName: string, assigned: boolean) => void;
  onRemove: (skillName: string) => void;
  isRemoving?: boolean;
}

export function SkillCard({
  name,
  description,
  path,
  assignedAgents,
  allAgents,
  onToggleAgent,
  onRemove,
  isRemoving,
}: SkillCardProps) {
  // Combine known agents with dynamic ones from config
  const agentList = Array.from(
    new Set([...KNOWN_AGENTS, ...allAgents])
  ).sort();

  return (
    <Card className="transition-colors hover:bg-accent/30">
      <CardContent className="p-4 space-y-3">
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <h4 className="text-sm font-semibold font-mono truncate">
              {name}
            </h4>
            <p className="text-xs text-muted-foreground mt-0.5">
              {description}
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive shrink-0"
            onClick={() => onRemove(name)}
            disabled={isRemoving}
            title="Remove skill"
          >
            {isRemoving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>

        {/* Path */}
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground font-mono">
          <FolderOpen className="h-3 w-3 shrink-0" />
          <span className="truncate">{path}</span>
        </div>

        {/* Agent toggles */}
        <div className="flex flex-wrap gap-1.5">
          {agentList.map((agent) => {
            const isAssigned = assignedAgents.includes(agent);
            return (
              <button
                key={agent}
                onClick={() => onToggleAgent(name, agent, !isAssigned)}
                className="cursor-pointer"
              >
                <Badge
                  variant={isAssigned ? "default" : "outline"}
                  className={`text-[10px] transition-colors ${
                    isAssigned
                      ? "bg-blue-500/20 text-blue-600 dark:text-blue-400 border-blue-500/30 hover:bg-blue-500/30"
                      : "text-muted-foreground hover:text-foreground hover:border-foreground/30"
                  }`}
                >
                  {agent}
                </Badge>
              </button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
