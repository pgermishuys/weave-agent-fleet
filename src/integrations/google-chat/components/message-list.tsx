"use client";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, RefreshCw } from "lucide-react";
import { useGoogleChatMessages } from "../hooks/use-google-chat-messages";
import { MessageRow } from "./message-row";

interface MessageListProps {
  spaceId: string;
}

export function MessageList({ spaceId }: MessageListProps) {
  const { messages, isLoading, error, hasMore, loadMore, refetch } =
    useGoogleChatMessages(spaceId);

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex items-center justify-end">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={refetch}
          disabled={isLoading}
          aria-label="Refresh messages"
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`}
          />
        </Button>
      </div>

      {error && (
        <div className="px-3 py-2 text-xs text-destructive rounded-md border border-destructive/20 bg-destructive/10">
          {error}
        </div>
      )}

      {!error && messages.length === 0 && !isLoading && (
        <div className="flex flex-col items-center justify-center py-12 gap-2">
          <p className="text-sm text-muted-foreground">No messages found.</p>
        </div>
      )}

      <div className="space-y-1">
        {messages.map((message) => (
          <MessageRow key={message.name} message={message} spaceId={spaceId} />
        ))}
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-4">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      )}

      {!isLoading && hasMore && (
        <div className="flex justify-center pt-2">
          <Button variant="outline" size="sm" onClick={loadMore}>
            Load more
            <Badge variant="secondary" className="ml-1 text-[10px]">
              +50
            </Badge>
          </Button>
        </div>
      )}
    </div>
  );
}
