import { lazy } from "react";
import { MessageSquare } from "lucide-react";
import type { IntegrationManifest, ContextSource } from "@/integrations/types";

// Module-level flag updated by IntegrationsContext on each poll.
// Allows isConfigured() to remain synchronous.
let _isGoogleChatConfigured = false;

export function setGoogleChatConfigured(value: boolean): void {
  _isGoogleChatConfigured = value;
}

// ─── URL patterns ──────────────────────────────────────────────────────────────

/**
 * Extracts spaceId (and optional messageId) from a Google Chat URL.
 *
 * Supported patterns:
 *   https://chat.google.com/room/{spaceId}
 *   https://chat.google.com/room/{spaceId}/{messageId}
 *   https://mail.google.com/mail/u/{n}/#chat/space/{spaceId}
 */
function parseGoogleChatUrl(
  url: string
): { spaceId: string; messageId?: string } | null {
  try {
    const parsed = new URL(url);

    // chat.google.com/room/{spaceId}[/{messageId}]
    if (parsed.hostname === "chat.google.com") {
      const match = parsed.pathname.match(
        /^\/room\/([a-zA-Z0-9_-]+)(?:\/([a-zA-Z0-9_-]+))?/
      );
      if (match) {
        return { spaceId: match[1], messageId: match[2] };
      }
    }

    // mail.google.com/mail/u/{n}/#chat/space/{spaceId}
    if (parsed.hostname === "mail.google.com") {
      const hash = parsed.hash; // e.g. #chat/space/AAAA_BBBB
      const match = hash.match(/^#chat\/space\/([a-zA-Z0-9_-]+)/);
      if (match) {
        return { spaceId: match[1] };
      }
    }

    return null;
  } catch {
    return null;
  }
}

// ─── Context resolution ────────────────────────────────────────────────────────

/**
 * Resolve a Google Chat URL into a ContextSource for use as agent session context.
 */
async function resolveContext(url: string): Promise<ContextSource | null> {
  const parsed = parseGoogleChatUrl(url);
  if (!parsed) return null;

  const { spaceId, messageId } = parsed;

  // Validate IDs (same rule as API routes)
  const idPattern = /^[a-zA-Z0-9_-]+$/;
  if (!idPattern.test(spaceId)) return null;
  if (messageId !== undefined && !idPattern.test(messageId)) return null;

  try {
    if (messageId) {
      // Resolve a specific message
      const msgRes = await fetch(
        `/api/integrations/google-chat/spaces/${spaceId}/messages/${messageId}`
      );
      if (!msgRes.ok) return null;

      const message = (await msgRes.json()) as {
        name: string;
        text: string;
        sender: { displayName: string; name: string };
        createTime: string;
        thread: { name: string };
        replyCount?: number;
      };

      return {
        type: "google-chat-message",
        url,
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

    // Resolve a space
    const spaceRes = await fetch(
      `/api/integrations/google-chat/spaces/${spaceId}`
    );
    if (!spaceRes.ok) return null;

    const space = (await spaceRes.json()) as {
      name: string;
      displayName: string;
      spaceType: string;
      spaceDetails?: { description: string };
    };

    // Fetch recent messages for context body
    const msgsRes = await fetch(
      `/api/integrations/google-chat/spaces/${spaceId}/messages?pageSize=20&orderBy=createTime+desc`
    );
    let messagesBody = "";
    if (msgsRes.ok) {
      const msgsData = (await msgsRes.json()) as {
        messages?: Array<{
          sender: { displayName: string };
          text: string;
          createTime: string;
        }>;
      };
      if (msgsData.messages) {
        messagesBody = msgsData.messages
          .map(
            (m) =>
              `[${new Date(m.createTime).toLocaleString()}] ${m.sender.displayName}: ${m.text}`
          )
          .join("\n");
      }
    }

    return {
      type: "google-chat-space",
      url,
      title: space.displayName || `Space: ${spaceId}`,
      body: [space.spaceDetails?.description, messagesBody]
        .filter(Boolean)
        .join("\n\n"),
      metadata: {
        spaceName: space.name,
        spaceType: space.spaceType,
        description: space.spaceDetails?.description ?? "",
      },
    };
  } catch {
    return null;
  }
}

export const googleChatManifest: IntegrationManifest = {
  id: "google-chat",
  name: "Google Chat",
  icon: MessageSquare,
  browserComponent: lazy(() =>
    import("./browser").then((m) => ({ default: m.GoogleChatBrowser }))
  ),
  settingsComponent: lazy(() =>
    import("./settings").then((m) => ({ default: m.GoogleChatSettings }))
  ),
  isConfigured: () => _isGoogleChatConfigured,
  resolveContext,
};

