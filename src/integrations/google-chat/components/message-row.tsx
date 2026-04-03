"use client";

import { CreateSessionButton } from "@/integrations/github/components/create-session-button";
import type { GoogleChatMessage } from "../types";
import type { ContextSource } from "@/integrations/types";

interface MessageRowProps {
  message: GoogleChatMessage;
  spaceId: string;
}

function formatAge(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function messageContextSource(
  message: GoogleChatMessage,
  spaceId: string
): ContextSource {
  const messageId = message.name.split("/").pop() ?? message.name;
  return {
    type: "google-chat-message",
    url: `https://chat.google.com/room/${spaceId}/${messageId}`,
    title: `Message from ${message.sender.displayName}`,
    body: message.text,
    metadata: {
      messageName: message.name,
      spaceName: `spaces/${spaceId}`,
      sender: message.sender.displayName,
      senderName: message.sender.name,
      createTime: message.createTime,
      threadName: message.thread.name,
      replyCount: message.replyCount ?? 0,
    },
  };
}

export function MessageRow({ message, spaceId }: MessageRowProps) {
  const contextSource = messageContextSource(message, spaceId);

  const reactions = message.emojiReactionSummaries ?? [];
  const hasAttachments =
    message.attachment && message.attachment.length > 0;
  const isThreadReply = message.threadReply ?? false;

  return (
    <div className="group flex items-start gap-3 px-3 py-2.5 rounded-md hover:bg-muted/50 transition-colors">
      {/* Thread indicator */}
      {isThreadReply && (
        <span className="mt-1 h-3.5 w-0.5 shrink-0 rounded-full bg-muted-foreground/30" />
      )}

      <div className="flex-1 min-w-0 space-y-1">
        {/* Header: sender + time */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-medium text-foreground">
            {message.sender.displayName}
          </span>
          <span className="text-xs text-muted-foreground">
            {formatAge(message.createTime)}
          </span>
          {isThreadReply && (
            <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
              reply
            </span>
          )}
          {message.replyCount !== undefined && message.replyCount > 0 && (
            <span className="text-xs text-muted-foreground">
              {message.replyCount} {message.replyCount === 1 ? "reply" : "replies"}
            </span>
          )}
        </div>

        {/* Message text */}
        <p className="text-sm text-foreground whitespace-pre-wrap break-words">
          {message.text || (
            <span className="italic text-muted-foreground">(no text)</span>
          )}
        </p>

        {/* Reactions */}
        {reactions.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {reactions.map((r, i) => (
              <span
                key={i}
                className="flex items-center gap-0.5 text-xs bg-muted rounded-full px-2 py-0.5"
              >
                {r.emoji.unicode ?? "•"}
                <span className="text-muted-foreground ml-0.5">
                  {r.reactionCount}
                </span>
              </span>
            ))}
          </div>
        )}

        {/* Attachment indicator */}
        {hasAttachments && (
          <p className="text-[10px] text-muted-foreground">
            {message.attachment!.length}{" "}
            {message.attachment!.length === 1 ? "attachment" : "attachments"}
          </p>
        )}
      </div>

      {/* Actions */}
      <div className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
        <CreateSessionButton contextSource={contextSource} />
      </div>
    </div>
  );
}
