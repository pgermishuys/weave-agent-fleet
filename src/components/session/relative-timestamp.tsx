"use client";

import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { formatTimestamp, formatRelativeTime } from "@/lib/format-utils";
import { useRelativeTime } from "@/hooks/use-relative-time";

interface RelativeTimestampProps {
  timestamp: number;
}

export function RelativeTimestamp({ timestamp }: RelativeTimestampProps) {
  const now = useRelativeTime();

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="text-[10px] text-muted-foreground ml-auto cursor-default">
          {formatRelativeTime(timestamp, now)}
        </span>
      </TooltipTrigger>
      <TooltipContent>
        {formatTimestamp(timestamp, now)}
      </TooltipContent>
    </Tooltip>
  );
}
