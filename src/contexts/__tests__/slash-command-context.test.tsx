/**
 * Tests for SlashCommandContext provider and consumer hook.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { SlashCommandProvider, useSlashCommandContext } from "@/contexts/slash-command-context";
import React from "react";

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockSendPrompt = vi.fn().mockResolvedValue(undefined);
vi.mock("@/hooks/use-send-prompt", () => ({
  useSendPrompt: () => ({
    sendPrompt: mockSendPrompt,
    isSending: false,
    error: undefined,
  }),
}));

const mockCommands = [
  { name: "start-work", description: "Start working" },
  { name: "compact", description: "Compact messages" },
];
vi.mock("@/hooks/use-commands", () => ({
  useCommands: () => ({
    commands: mockCommands,
    isLoading: false,
    error: undefined,
  }),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeWrapper(
  sessionId = "sess-1",
  instanceId = "inst-1",
  disabled = false
) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <SlashCommandProvider
        sessionId={sessionId}
        instanceId={instanceId}
        disabled={disabled}
      >
        {children}
      </SlashCommandProvider>
    );
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("useSlashCommandContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("ReturnsNullWhenOutsideProvider", () => {
    const { result } = renderHook(() => useSlashCommandContext());
    expect(result.current).toBeNull();
  });

  it("ReturnsContextValueInsideProvider", () => {
    const { result } = renderHook(() => useSlashCommandContext(), {
      wrapper: makeWrapper(),
    });
    expect(result.current).not.toBeNull();
  });

  it("KnownCommandsSetContainsCommandsFromHook", () => {
    const { result } = renderHook(() => useSlashCommandContext(), {
      wrapper: makeWrapper(),
    });
    expect(result.current?.knownCommands.has("start-work")).toBe(true);
    expect(result.current?.knownCommands.has("compact")).toBe(true);
    expect(result.current?.knownCommands.has("unknown")).toBe(false);
  });

  it("DisabledFalseByDefault", () => {
    const { result } = renderHook(() => useSlashCommandContext(), {
      wrapper: makeWrapper("s", "i", false),
    });
    expect(result.current?.disabled).toBe(false);
  });

  it("DisabledTrueWhenProviderDisabledPropIsTrue", () => {
    const { result } = renderHook(() => useSlashCommandContext(), {
      wrapper: makeWrapper("s", "i", true),
    });
    expect(result.current?.disabled).toBe(true);
  });

  it("ExecuteCommandCallsSendPromptWithCorrectArgs", async () => {
    const { result } = renderHook(() => useSlashCommandContext(), {
      wrapper: makeWrapper("session-abc", "instance-xyz"),
    });
    await act(async () => {
      await result.current?.executeCommand("/start-work");
    });
    expect(mockSendPrompt).toHaveBeenCalledWith(
      "session-abc",
      "instance-xyz",
      "/start-work"
    );
  });
});
