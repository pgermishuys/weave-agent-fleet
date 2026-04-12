/**
 * TypeScript interfaces for the Google Chat API entities.
 * @see https://developers.google.com/workspace/chat/api/reference/rest
 */

// ─── Enums / Union Types ───────────────────────────────────────────────────────

export type GoogleChatSpaceType = "SPACE" | "GROUP_CHAT" | "DIRECT_MESSAGE";

export type GoogleChatSpaceThreadingState =
  | "THREADED_MESSAGES"
  | "GROUPED_MESSAGES"
  | "UNTHREADED_MESSAGES";

export type GoogleChatMemberRole =
  | "ROLE_UNSPECIFIED"
  | "ROLE_MEMBER"
  | "ROLE_MANAGER";

export type GoogleChatMemberType = "TYPE_UNSPECIFIED" | "HUMAN" | "BOT";

// ─── Core Entities ─────────────────────────────────────────────────────────────

/** A user or bot that sends a message. */
export interface GoogleChatSender {
  /** Resource name: `users/{user}` */
  name: string;
  displayName: string;
  type: GoogleChatMemberType;
  avatarUrl?: string;
}

/** A message thread in a space. */
export interface GoogleChatThread {
  /** Resource name: `spaces/{space}/threads/{thread}` */
  name: string;
}

/** An annotation embedded in a message (mentions, slash commands, rich links). */
export interface GoogleChatAnnotation {
  type: string;
  startIndex?: number;
  length?: number;
  userMention?: {
    user: GoogleChatSender;
    type: "MENTION" | "ADD";
  };
}

/** A summary of emoji reactions on a message. */
export interface GoogleChatEmojiReactionSummary {
  emoji: {
    unicode?: string;
    customEmoji?: { uid: string; resourceName: string };
  };
  reactionCount: number;
}

/** A file attachment on a message. */
export interface GoogleChatAttachment {
  /** Resource name: `spaces/{space}/messages/{message}/attachments/{attachment}` */
  name: string;
  contentName: string;
  contentType: string;
  downloadUri?: string;
  thumbnailUri?: string;
}

/**
 * A Chat space (group conversation, DM, or named space).
 * @see https://developers.google.com/workspace/chat/api/reference/rest/v1/spaces
 */
export interface GoogleChatSpace {
  /** Resource name: `spaces/{space}` */
  name: string;
  displayName: string;
  spaceType: GoogleChatSpaceType;
  spaceThreadingState?: GoogleChatSpaceThreadingState;
  spaceDetails?: {
    description: string;
    guidelines: string;
  };
  membershipCount?: {
    joinedDirectHumanUserCount: number;
    joinedGroupCount: number;
  };
  createTime?: string;
  lastActiveTime?: string;
  singleUserBotDm?: boolean;
  adminInstalled?: boolean;
}

/**
 * A Chat message.
 * @see https://developers.google.com/workspace/chat/api/reference/rest/v1/spaces.messages
 */
export interface GoogleChatMessage {
  /** Resource name: `spaces/{space}/messages/{message}` */
  name: string;
  /** Plain-text body of the message. */
  text: string;
  /** Text with markup (bold, italic, code, @mentions). */
  formattedText?: string;
  sender: GoogleChatSender;
  createTime: string;
  lastUpdateTime?: string;
  deleteTime?: string;
  thread: GoogleChatThread;
  /** True if this message is a reply within a thread. */
  threadReply?: boolean;
  annotations?: GoogleChatAnnotation[];
  emojiReactionSummaries?: GoogleChatEmojiReactionSummary[];
  attachment?: GoogleChatAttachment[];
  /** Number of replies in this message's thread (if this is a root message). */
  replyCount?: number;
}

/**
 * A membership record: a user or bot in a space.
 * @see https://developers.google.com/workspace/chat/api/reference/rest/v1/spaces.members
 */
export interface GoogleChatMember {
  /** Resource name: `spaces/{space}/members/{member}` */
  name: string;
  member: GoogleChatSender;
  role: GoogleChatMemberRole;
  createTime: string;
}

// ─── API Response Shapes ───────────────────────────────────────────────────────

export interface GoogleChatListSpacesResponse {
  spaces: GoogleChatSpace[];
  nextPageToken?: string;
}

export interface GoogleChatListMessagesResponse {
  messages: GoogleChatMessage[];
  nextPageToken?: string;
}

export interface GoogleChatListMembersResponse {
  memberships: GoogleChatMember[];
  nextPageToken?: string;
}
