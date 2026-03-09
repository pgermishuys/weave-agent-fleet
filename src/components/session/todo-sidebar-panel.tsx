"use client";

import { CheckCircle2, Circle, ClipboardList, Loader2, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import type { TodoItem } from "@/lib/todo-utils";

interface TodoSidebarPanelProps {
  todos: TodoItem[];
}

function StatusIcon({ status }: { status: TodoItem["status"] }) {
  switch (status) {
    case "completed":
      return <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-green-500 mt-0.5" />;
    case "in_progress":
      return <Loader2 className="h-3.5 w-3.5 shrink-0 text-blue-600 dark:text-blue-400 animate-spin mt-0.5" />;
    case "cancelled":
      return <XCircle className="h-3.5 w-3.5 shrink-0 text-red-600/60 dark:text-red-400/60 mt-0.5" />;
    default:
      return <Circle className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50 mt-0.5" />;
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

export function TodoSidebarPanel({ todos }: TodoSidebarPanelProps) {
  const completedCount = todos.filter((t) => t.status === "completed").length;
  const percent = todos.length > 0 ? Math.round((completedCount / todos.length) * 100) : 0;

  return (
    <section>
      {/* Header */}
      <div className="flex items-center gap-1.5 mb-2">
        <ClipboardList className="h-3.5 w-3.5 text-muted-foreground" />
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Todos
        </p>
      </div>

      {/* Progress summary */}
      <p className="text-[10px] text-muted-foreground mb-1.5">
        {completedCount} of {todos.length} completed
      </p>
      <Progress value={percent} className="h-1.5 mb-3" />

      {/* Todo items */}
      <div className="space-y-1.5">
        {todos.map((todo, i) => (
          <div key={i} className="flex items-start gap-2 text-xs">
            <StatusIcon status={todo.status} />
            <span
              className={
                todo.status === "completed" || todo.status === "cancelled"
                  ? "flex-1 min-w-0 line-through text-muted-foreground break-words"
                  : "flex-1 min-w-0 text-foreground/90 break-words"
              }
            >
              {todo.content}
            </span>
            <PriorityBadge priority={todo.priority} />
          </div>
        ))}
      </div>
    </section>
  );
}
