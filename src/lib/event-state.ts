/**
 * Pure state update helpers for accumulating SSE events into renderable messages.
 * Extracted from useSessionEvents for testability — no React dependencies.
 */

import type {
  AccumulatedMessage,
  AccumulatedTextPart,
  AccumulatedToolPart,
} from "@/lib/api-types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function ensureMessage(
  prev: AccumulatedMessage[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  info: Record<string, any>
): AccumulatedMessage[] {
  const messageId: string = info.id;
  const existing = prev.find((m) => m.messageId === messageId);
  if (existing) return prev;

  const role: "user" | "assistant" =
    info.role === "user" ? "user" : "assistant";
  const newMsg: AccumulatedMessage = {
    messageId,
    sessionId: info.sessionID ?? "",
    role,
    parts: [],
    createdAt: info.time?.created,
    // v2: both UserMessage and AssistantMessage have agent: string
    agent: info.agent,
    modelID: info.modelID,
    parentID: info.parentID,
  };
  return [...prev, newMsg];
}

/**
 * Merges completion data into an existing message.
 * Isolated from ensureMessage() for easy revert if needed.
 * Only updates fields that were previously unset (null-safe merge).
 */
export function mergeMessageUpdate(
  prev: AccumulatedMessage[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  info: { id: string; time?: { completed?: number }; [key: string]: unknown }
): AccumulatedMessage[] {
  const index = prev.findIndex((m) => m.messageId === info.id);
  if (index === -1) return prev; // message not found, no-op
  const existing = prev[index];
  const completedAt = info.time?.completed;
  if (!completedAt || existing.completedAt) return prev; // nothing new to merge
  const updated = [...prev];
  updated[index] = { ...existing, completedAt };
  return updated;
}

export function applyPartUpdate(
  prev: AccumulatedMessage[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  part: Record<string, any>
): AccumulatedMessage[] {
  const messageId: string = part.messageID;
  const sessionId: string = part.sessionID;

  // Ensure the message exists
  let msgs = prev;
  if (!msgs.find((m) => m.messageId === messageId)) {
    const newMsg: AccumulatedMessage = {
      messageId,
      sessionId,
      role: "assistant",
      parts: [],
    };
    msgs = [...prev, newMsg];
  }

  return msgs.map((msg) => {
    if (msg.messageId !== messageId) return msg;

    if (part.type === "text") {
      const existingPart = msg.parts.find(
        (p): p is AccumulatedTextPart =>
          p.type === "text" && p.partId === part.id
      );
      if (existingPart) {
        return {
          ...msg,
          parts: msg.parts.map((p) =>
            p.partId === part.id ? { ...p, text: part.text ?? "" } : p
          ),
        };
      }
      const newPart: AccumulatedTextPart = {
        partId: part.id,
        type: "text",
        text: part.text ?? "",
      };
      return { ...msg, parts: [...msg.parts, newPart] };
    }

    if (part.type === "tool") {
      const newPart: AccumulatedToolPart = {
        partId: part.id,
        type: "tool",
        tool: part.tool ?? "",
        callId: part.callID ?? "",
        state: part.state,
      };
      const existing = msg.parts.find((p) => p.partId === part.id);
      if (existing) {
        return {
          ...msg,
          parts: msg.parts.map((p) => (p.partId === part.id ? newPart : p)),
        };
      }
      return { ...msg, parts: [...msg.parts, newPart] };
    }

    if (part.type === "step-finish") {
      return {
        ...msg,
        cost: (msg.cost ?? 0) + (part.cost ?? 0),
        tokens: {
          input: (msg.tokens?.input ?? 0) + (part.tokens?.input ?? 0),
          output: (msg.tokens?.output ?? 0) + (part.tokens?.output ?? 0),
          reasoning:
            (msg.tokens?.reasoning ?? 0) + (part.tokens?.reasoning ?? 0),
        },
      };
    }

    return msg;
  });
}

export function applyTextDelta(
  prev: AccumulatedMessage[],
  messageId: string,
  partId: string,
  sessionId: string,
  delta: string
): AccumulatedMessage[] {
  // Ensure message exists
  let msgs = prev;
  if (!msgs.find((m) => m.messageId === messageId)) {
    const newMsg: AccumulatedMessage = {
      messageId,
      sessionId,
      role: "assistant",
      parts: [],
    };
    msgs = [...prev, newMsg];
  }

  return msgs.map((msg) => {
    if (msg.messageId !== messageId) return msg;

    const existingPart = msg.parts.find(
      (p): p is AccumulatedTextPart => p.type === "text" && p.partId === partId
    );
    if (existingPart) {
      return {
        ...msg,
        parts: msg.parts.map((p) =>
          p.partId === partId && p.type === "text"
            ? { ...p, text: p.text + delta }
            : p
        ),
      };
    }
    const newPart: AccumulatedTextPart = { partId, type: "text", text: delta };
    return { ...msg, parts: [...msg.parts, newPart] };
  });
}

/**
 * Determines if an SSE event is relevant to a specific session.
 * Used by the SSE proxy to filter events before forwarding to the client.
 */
export function isRelevantToSession(
  type: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  properties: Record<string, any>,
  sessionId: string
): boolean {
  // System events: always forward
  if (type === "server.connected" || type === "server.heartbeat") return true;

  // message.part.updated / message.part.removed — check part.sessionID
  if (type === "message.part.updated" || type === "message.part.removed") {
    return (
      properties?.part?.sessionID === sessionId ||
      properties?.sessionID === sessionId
    );
  }

  // message.updated / message.removed — check info.sessionID
  if (type === "message.updated" || type === "message.removed") {
    return properties?.info?.sessionID === sessionId;
  }

  // session.* events — check properties.sessionID or properties.info.id
  if (type.startsWith("session.")) {
    return (
      properties?.sessionID === sessionId ||
      properties?.info?.id === sessionId
    );
  }

  // permission events
  if (type.startsWith("permission.")) {
    return properties?.sessionID === sessionId;
  }

  // message.part.delta (undocumented event for streaming text)
  if (type === "message.part.delta") {
    return properties?.sessionID === sessionId;
  }

  // Unknown events — skip to avoid noise
  return false;
}
