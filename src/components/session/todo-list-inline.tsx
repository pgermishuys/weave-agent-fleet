"use client";

import { CheckCircle2, Circle, Loader2, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { TodoItem } from "@/lib/todo-utils";

interface TodoListInlineProps {
  items: TodoItem[];
  isRunning: boolean;
}

function StatusIcon({ status }: { status: TodoItem["status"] }) {
  switch (status) {
    case "completed":
      return <CheckCircle2 className="h-3 w-3 shrink-0 text-green-500" />;
    case "in_progress":
      return <Loader2 className="h-3 w-3 shrink-0 text-blue-600 dark:text-blue-400 animate-spin" />;
    case "cancelled":
      return <XCircle className="h-3 w-3 shrink-0 text-red-600/60 dark:text-red-400/60" />;
    default:
      return <Circle className="h-3 w-3 shrink-0 text-muted-foreground/50" />;
  }
}

function PriorityBadge({ priority }: { priority: TodoItem["priority"] }) {
  const className =
    priority === "high"
      ? "text-red-600 dark:text-red-400 border-red-400/30"
      : priority === "medium"
      ? "text-amber-600 dark:text-amber-400 border-amber-400/30"
      : "text-muted-foreground border-border";

  return (
    <Badge
      variant="outline"
      className={`text-[10px] px-1 py-0 leading-tight shrink-0 ${className}`}
    >
      {priority}
    </Badge>
  );
}

export function TodoListInline({ items, isRunning }: TodoListInlineProps) {
  return (
    <div className="ml-5 mt-1 space-y-0.5">
      {isRunning && items.length === 0 && (
        <span className="text-xs text-muted-foreground italic">Updating…</span>
      )}
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-1.5 text-xs">
          <StatusIcon status={item.status} />
          <span
            className={
              item.status === "completed" || item.status === "cancelled"
                ? "line-through text-muted-foreground flex-1 min-w-0 truncate"
                : "flex-1 min-w-0 truncate text-foreground/80"
            }
          >
            {item.content}
          </span>
          <PriorityBadge priority={item.priority} />
        </div>
      ))}
    </div>
  );
}
