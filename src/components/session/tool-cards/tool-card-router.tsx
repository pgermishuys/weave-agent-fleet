"use client";

import type { AccumulatedPart, PendingQuestion } from "@/lib/api-types";
import { CollapsibleToolCall } from "../collapsible-tool-call";
import { ReadToolCard } from "./read-tool-card";
import { WriteToolCard } from "./write-tool-card";
import { EditToolCard } from "./edit-tool-card";
import { BashToolCard } from "./bash-tool-card";
import { GrepToolCard } from "./grep-tool-card";
import { GlobToolCard } from "./glob-tool-card";
import { WebFetchToolCard } from "./webfetch-tool-card";
import { SkillToolCard } from "./skill-tool-card";
import { QuestionToolCard } from "./question-tool-card";

interface ToolCardRouterProps {
  part: AccumulatedPart & { type: "tool" };
  /** The OpenCode session ID — required by question tool card for API calls. */
  sessionId?: string;
  /** Pending questions from useSessionEvents — required by question tool card. */
  pendingQuestions?: PendingQuestion[];
}

/**
 * Routes tool calls to specialized card renderers based on `part.tool`.
 *
 * TodoWrite and Task routing remain in `ToolCallItem` (activity-stream-v1.tsx)
 * because they have special running-state / delegation logic.
 *
 * Unknown tools fall back to the generic `CollapsibleToolCall`.
 */
export function ToolCardRouter({ part, sessionId, pendingQuestions }: ToolCardRouterProps) {
  switch (part.tool) {
    case "read":
      return <ReadToolCard part={part} />;
    case "write":
      return <WriteToolCard part={part} />;
    case "edit":
      return <EditToolCard part={part} />;
    case "bash":
      return <BashToolCard part={part} />;
    case "grep":
      return <GrepToolCard part={part} />;
    case "glob":
      return <GlobToolCard part={part} />;
    case "webfetch":
      return <WebFetchToolCard part={part} />;
    case "skill":
      return <SkillToolCard part={part} />;
    case "question":
      if (sessionId) {
        return (
          <QuestionToolCard
            part={part}
            sessionId={sessionId}
            pendingQuestions={pendingQuestions ?? []}
          />
        );
      }
      return <CollapsibleToolCall part={part} />;
    default:
      return <CollapsibleToolCall part={part} />;
  }
}
