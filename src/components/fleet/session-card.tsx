import Link from "next/link";
import { Session } from "@/lib/types";
import { formatTokens, formatCost, getStatusDot, formatRelativeTime } from "@/lib/format-utils";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Clock,
  FileCode,
  Hash,
  Coins,
  MessageSquare,
  ArrowRight,
} from "lucide-react";

interface SessionCardProps {
  session: Session;
}

function getStatusLabel(status: string): string {
  switch (status) {
    case "active": return "Active";
    case "idle": return "Idle";
    case "waiting_input": return "Needs Input";
    case "completed": return "Completed";
    case "error": return "Error";
    default: return status;
  }
}

function getSourceLabel(source: Session["source"]): string {
  switch (source.type) {
    case "manual": return "Manual";
    case "template": return "Template";
    case "batch": return "Batch";
    case "github": return `Issue #${source.issueNumber}`;
    case "pipeline": return "Pipeline";
    default: return source.type;
  }
}

function getAgentColor(agent: string): string {
  switch (agent) {
    case "loom": return "bg-[#4A90D9]/10 text-[#4A90D9]";
    case "tapestry": return "bg-[#D94A4A]/10 text-[#D94A4A]";
    case "shuttle": return "bg-[#E67E22]/10 text-[#E67E22]";
    case "pattern": return "bg-[#9B59B6]/10 text-[#9B59B6]";
    case "thread": return "bg-[#27AE60]/10 text-[#27AE60]";
    case "spindle": return "bg-[#F39C12]/10 text-[#F39C12]";
    case "weft": return "bg-[#1ABC9C]/10 text-[#1ABC9C]";
    case "warp": return "bg-[#E74C3C]/10 text-[#E74C3C]";
    default: return "bg-muted-foreground/10 text-muted-foreground";
  }
}

export function SessionCard({ session }: SessionCardProps) {
  const totalTokens =
    session.tokens.input + session.tokens.output + session.tokens.reasoning;
  const progressPercent = session.planProgress
    ? (session.planProgress.done / session.planProgress.total) * 100
    : 0;

  return (
    <Link href={`/sessions/${session.id}`}>
      <Card className="transition-all hover:border-foreground/20 hover:shadow-md cursor-pointer group">
        <CardHeader className="pb-2 pt-4 px-4">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-2">
              <span
                className={`h-2.5 w-2.5 rounded-full ${getStatusDot(session.status)} ${session.status === "active" ? "animate-pulse" : ""}`}
              />
              <h3 className="font-semibold text-sm">{session.name}</h3>
            </div>
            <ArrowRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
          <div className="flex items-center gap-1.5 mt-1">
            <Badge
              variant="secondary"
              className={`text-[10px] px-1.5 py-0 ${getAgentColor(session.currentAgent)}`}
            >
              {session.currentAgent}
            </Badge>
            <Badge variant="outline" className="text-[10px] px-1.5 py-0">
              {getSourceLabel(session.source)}
            </Badge>
            <span className="text-[10px] text-muted-foreground">
              {getStatusLabel(session.status)}
            </span>
          </div>
        </CardHeader>
        <CardContent className="px-4 pb-4 space-y-3">
          {/* Prompt preview */}
          <p className="text-xs text-muted-foreground line-clamp-2">
            {session.initialPrompt}
          </p>

          {/* Plan progress */}
          {session.planProgress && (
            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Progress</span>
                <span className="font-medium">
                  {session.planProgress.done}/{session.planProgress.total}
                </span>
              </div>
              <Progress value={progressPercent} className="h-1.5" />
            </div>
          )}

          {/* Stats row */}
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Hash className="h-3 w-3" />
              {formatTokens(totalTokens)}
            </span>
            <span className="flex items-center gap-1">
              <Coins className="h-3 w-3" />
              {formatCost(session.cost)}
            </span>
            {session.modifiedFiles.length > 0 && (
              <span className="flex items-center gap-1">
                <FileCode className="h-3 w-3" />
                {session.modifiedFiles.length}
              </span>
            )}
            <span className="ml-auto flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {formatRelativeTime(session.createdAt)}
            </span>
          </div>

          {/* Tags */}
          {session.tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {session.tags.map((tag) => (
                <Badge
                  key={tag}
                  variant="outline"
                  className="text-[10px] px-1 py-0 text-muted-foreground"
                >
                  {tag}
                </Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}
