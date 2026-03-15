"use client";

import { SessionEvent } from "@/lib/types";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import {
  MessageSquare,
  ArrowRight,
  ArrowLeft,
  Wrench,
  CheckSquare,
  RefreshCw,
  Coins,
  Bot,
  User,
} from "lucide-react";
import { MarkdownRenderer } from "./markdown-renderer";

interface ActivityStreamProps {
  events: SessionEvent[];
}

function getAgentColor(agent: string): string {
  switch (agent) {
    case "loom": return "text-[#4A90D9]";
    case "tapestry": return "text-[#D94A4A]";
    case "shuttle": return "text-[#E67E22]";
    case "pattern": return "text-[#9B59B6]";
    case "thread": return "text-[#27AE60]";
    case "spindle": return "text-[#F39C12]";
    case "weft": return "text-[#1ABC9C]";
    case "warp": return "text-[#E74C3C]";
    default: return "text-muted-foreground";
  }
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "UTC",
  });
}

function EventIcon({ type, data }: { type: string; data: Record<string, unknown> }) {
  switch (type) {
    case "message":
      return data.role === "user" ? (
        <User className="h-3.5 w-3.5 text-foreground" />
      ) : (
        <Bot className="h-3.5 w-3.5 text-muted-foreground" />
      );
    case "delegation_start":
      return <ArrowRight className="h-3.5 w-3.5 text-cyan-500" />;
    case "delegation_end":
      return <ArrowLeft className="h-3.5 w-3.5 text-cyan-500" />;
    case "tool_call":
      return <Wrench className="h-3.5 w-3.5 text-amber-500" />;
    case "plan_progress":
      return <CheckSquare className="h-3.5 w-3.5 text-green-500" />;
    case "agent_switch":
      return <RefreshCw className="h-3.5 w-3.5 text-violet-500" />;
    case "cost_update":
      return <Coins className="h-3.5 w-3.5 text-amber-500" />;
    default:
      return <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" />;
  }
}

function EventContent({ event }: { event: SessionEvent }) {
  const { type, data, agent } = event;
  const agentColor = agent ? getAgentColor(agent) : "text-muted-foreground";

  switch (type) {
    case "message":
      return (
        <div>
          <span className={`font-medium ${data.role === "user" ? "text-foreground" : agentColor}`}>
            {data.role === "user" ? "You" : agent}
          </span>
          <div className="mt-0.5">
            <MarkdownRenderer content={data.text as string} className="text-xs" />
          </div>
        </div>
      );

    case "delegation_start":
      return (
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className={agentColor}>{agent}</span>
          <ArrowRight className="h-3 w-3 text-muted-foreground" />
          <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
            {data.targetAgent as string}
          </Badge>
          <span className="text-muted-foreground">{String(data.reason)}</span>
        </div>
      );

    case "delegation_end":
      return (
        <div>
          <div className="flex items-center gap-1.5">
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
              {agent}
            </Badge>
            <span className="text-muted-foreground">returned</span>
            {data.tokensUsed != null && (
              <span className="text-[10px] text-muted-foreground">
                ({(Number(data.tokensUsed) / 1000).toFixed(1)}k tokens, {(Number(data.duration) / 1000).toFixed(1)}s)
              </span>
            )}
          </div>
          <p className="text-muted-foreground mt-0.5 text-xs">
            {String(data.result)}
          </p>
        </div>
      );

    case "tool_call":
      return (
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className={agentColor}>{agent}</span>
          <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-mono">
            {data.tool as string}
          </Badge>
          {data.args != null && typeof data.args === "object" && (
            <span className="text-[10px] text-muted-foreground font-mono">
              {Object.entries(data.args as Record<string, unknown>)
                .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
                .join(" ")
                .slice(0, 60)}
            </span>
          )}
          {data.status === "completed" && (
            <span className="text-[10px] text-green-500">
              {String(data.result)}
              {data.duration != null && ` (${Number(data.duration)}ms)`}
            </span>
          )}
        </div>
      );

    case "plan_progress":
      return (
        <div className="flex items-center gap-1.5">
          <span className={agentColor}>{agent}</span>
          <span className="text-muted-foreground">completed</span>
          <span className="font-medium">{String(data.task)}</span>
          <span className="text-[10px] text-muted-foreground">
            ({(data.index as number) + 1}/{data.total as number})
          </span>
        </div>
      );

    case "agent_switch":
      return (
        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground">Agent switched</span>
          <Badge variant="outline" className="text-[10px] px-1.5 py-0">
            {data.from as string}
          </Badge>
          <ArrowRight className="h-3 w-3 text-muted-foreground" />
          <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
            {data.to as string}
          </Badge>
          <span className="text-[10px] text-muted-foreground">
            ({data.reason as string})
          </span>
        </div>
      );

    case "cost_update":
      return (
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <span>Session cost updated:</span>
          <span className="font-medium text-amber-500">
            ${(data.sessionCost as number).toFixed(2)}
          </span>
          <span>({((data.sessionTokens as number) / 1000).toFixed(1)}k tokens)</span>
        </div>
      );

    default:
      return (
        <span className="text-muted-foreground">
          {JSON.stringify(data)}
        </span>
      );
  }
}

export function ActivityStream({ events }: ActivityStreamProps) {
  return (
    <ScrollArea className="h-full">
      <div className="space-y-0">
        {events.map((event) => (
          <div
            key={event.id}
            className="flex gap-3 px-4 py-2.5 hover:bg-accent/30 border-b border-border/50"
          >
            <div className="flex flex-col items-center pt-0.5">
              <EventIcon type={event.type} data={event.data} />
            </div>
            <div className="flex-1 min-w-0 text-sm">
              <EventContent event={event} />
            </div>
            <time className="text-[10px] text-muted-foreground whitespace-nowrap pt-0.5">
              {formatTime(event.timestamp)}
            </time>
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}
