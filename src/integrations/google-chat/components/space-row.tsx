"use client";

import { useState } from "react";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import { ChevronRight, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { CreateSessionButton } from "@/integrations/github/components/create-session-button";
import type { GoogleChatSpace } from "../types";
import type { ContextSource } from "@/integrations/types";

interface SpaceRowProps {
  space: GoogleChatSpace;
}

const SPACE_TYPE_LABELS: Record<string, string> = {
  SPACE: "Space",
  GROUP_CHAT: "Group",
  DIRECT_MESSAGE: "DM",
};

function spaceContextSource(space: GoogleChatSpace): ContextSource {
  const spaceId = space.name.split("/").pop() ?? space.name;
  return {
    type: "google-chat-space",
    url: `https://chat.google.com/room/${spaceId}`,
    title: space.displayName || `Space: ${spaceId}`,
    body: space.spaceDetails?.description ?? "",
    metadata: {
      spaceName: space.name,
      spaceType: space.spaceType,
      description: space.spaceDetails?.description ?? "",
    },
  };
}

export function SpaceRow({ space }: SpaceRowProps) {
  const [isOpen, setIsOpen] = useState(false);

  const contextSource = spaceContextSource(space);
  const typeLabel = SPACE_TYPE_LABELS[space.spaceType] ?? space.spaceType;
  const memberCount =
    space.membershipCount?.joinedDirectHumanUserCount ?? null;

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div className="flex items-center gap-3 px-3 py-2.5 rounded-md hover:bg-muted/50 transition-colors group">
        <CollapsibleTrigger className="flex items-center gap-3 flex-1 min-w-0 text-left">
          <ChevronRight
            className={cn(
              "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
              isOpen && "rotate-90"
            )}
          />
          <span className="text-sm truncate">
            {space.displayName || space.name}
          </span>
          <Badge
            variant="outline"
            className="text-[10px] px-1.5 py-0 shrink-0"
          >
            {typeLabel}
          </Badge>
        </CollapsibleTrigger>

        <div className="flex items-center gap-2 shrink-0">
          {memberCount !== null && memberCount > 0 && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Users className="h-3 w-3" />
              {memberCount}
            </span>
          )}
          <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
            <CreateSessionButton contextSource={contextSource} />
          </div>
        </div>
      </div>

      <CollapsibleContent>
        <div className="ml-9 mr-3 mb-3 p-4 rounded-md border bg-muted/30 space-y-3">
          {space.spaceDetails?.description ? (
            <p className="text-sm text-muted-foreground">
              {space.spaceDetails.description}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground italic">
              No description provided.
            </p>
          )}

          <div className="border-t pt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
            <span>Type: {typeLabel}</span>
            {memberCount !== null && <span>Members: {memberCount}</span>}
            {space.lastActiveTime && (
              <span>
                Last active:{" "}
                {new Date(space.lastActiveTime).toLocaleDateString()}
              </span>
            )}
          </div>

          <div className="border-t pt-3">
            <CreateSessionButton contextSource={contextSource} />
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
