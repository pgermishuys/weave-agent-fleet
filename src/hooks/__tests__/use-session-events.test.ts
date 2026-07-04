import { describe, expect, it, vi } from "vitest";
import type React from "react";
import type { AccumulatedMessage, PendingQuestion, SSEEvent } from "@/lib/api-types";
import { handleEvent } from "@/hooks/use-session-events";

function createStateHarness(sessionId: string) {
  let messages: AccumulatedMessage[] = [];
  let status: string | undefined;
  let sessionStatus: "idle" | "busy" = "idle";
  let error: string | undefined;
  let pendingQuestions: PendingQuestion[] = [];

  const setMessages = (update: React.SetStateAction<AccumulatedMessage[]>) => {
    messages = typeof update === "function"
      ? (update as (prev: AccumulatedMessage[]) => AccumulatedMessage[])(messages)
      : update;
  };
  const setStatus = (update: React.SetStateAction<string>) => {
    status = typeof update === "function"
      ? (update as (prev: string | undefined) => string)(status)
      : update;
  };
  const setSessionStatus = (update: React.SetStateAction<"idle" | "busy">) => {
    sessionStatus = typeof update === "function"
      ? (update as (prev: "idle" | "busy") => "idle" | "busy")(sessionStatus)
      : update;
  };
  const setError = (update: React.SetStateAction<string | undefined>) => {
    error = typeof update === "function"
      ? (update as (prev: string | undefined) => string | undefined)(error)
      : update;
  };
  const setPendingQuestions = (update: React.SetStateAction<PendingQuestion[]>) => {
    pendingQuestions = typeof update === "function"
      ? (update as (prev: PendingQuestion[]) => PendingQuestion[])(pendingQuestions)
      : update;
  };

  const onAgentSwitchRef: React.MutableRefObject<((agent: string) => void) | undefined> = {
    current: vi.fn(),
  };
  const lastMessageIdRef: React.MutableRefObject<string | null> = { current: null };

  const dispatch = (event: SSEEvent) => {
    handleEvent(
      event,
      sessionId,
      setMessages,
      setStatus as React.Dispatch<React.SetStateAction<"connecting" | "connected" | "recovering" | "disconnected" | "error" | "abandoned">>,
      setSessionStatus,
      setError,
      onAgentSwitchRef,
      lastMessageIdRef,
      setPendingQuestions,
    );
  };

  return {
    dispatch,
    getMessages: () => messages,
    getPendingQuestions: () => pendingQuestions,
  };
}

describe("handleEvent message.part.updated", () => {
  it("applies text part when only top-level sessionID is present", () => {
    const harness = createStateHarness("sess-1");

    harness.dispatch({
      type: "message.updated",
      properties: {
        info: {
          id: "msg-1",
          role: "assistant",
          sessionID: "sess-1",
        },
      },
    } as SSEEvent);

    harness.dispatch({
      type: "message.part.updated",
      properties: {
        sessionID: "sess-1",
        part: {
          id: "part-1",
          messageID: "msg-1",
          type: "text",
          text: "hello",
        },
      },
    } as SSEEvent);

    const messages = harness.getMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0]?.parts).toHaveLength(1);
    expect(messages[0]?.parts[0]).toMatchObject({ type: "text", text: "hello" });
  });

  it("ignores part updates missing messageID", () => {
    const harness = createStateHarness("sess-1");

    harness.dispatch({
      type: "message.part.updated",
      properties: {
        sessionID: "sess-1",
        part: {
          id: "part-1",
          type: "text",
          text: "hello",
        },
      },
    } as SSEEvent);

    expect(harness.getMessages()).toHaveLength(0);
  });

  it("ignores part updates for a different session", () => {
    const harness = createStateHarness("sess-1");

    harness.dispatch({
      type: "message.part.updated",
      properties: {
        sessionID: "sess-2",
        part: {
          id: "part-1",
          messageID: "msg-1",
          type: "text",
          text: "hello",
        },
      },
    } as SSEEvent);

    expect(harness.getMessages()).toHaveLength(0);
  });

  it("creates new message with concrete sessionID on fallback", () => {
    const harness = createStateHarness("sess-1");

    harness.dispatch({
      type: "message.part.updated",
      properties: {
        sessionID: "sess-1",
        part: {
          id: "part-1",
          messageID: "msg-1",
          type: "text",
          text: "hello",
        },
      },
    } as SSEEvent);

    const messages = harness.getMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0]?.sessionId).toBe("sess-1");
    expect(messages[0]?.parts[0]).toMatchObject({ type: "text", text: "hello" });
  });
});
