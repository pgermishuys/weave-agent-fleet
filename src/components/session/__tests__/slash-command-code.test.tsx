/**
 * Tests for SlashCommandCode component.
 * Uses @testing-library/react with jsdom environment.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SlashCommandCode } from "@/components/session/slash-command-code";
import { SlashCommandContext } from "@/contexts/slash-command-context";
import type { SlashCommandContextValue } from "@/contexts/slash-command-context";
import React from "react";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeCtx(overrides: Partial<SlashCommandContextValue> = {}): SlashCommandContextValue {
  return {
    executeCommand: vi.fn().mockResolvedValue(undefined),
    knownCommands: new Set(["start-work", "compact", "metrics"]),
    disabled: false,
    ...overrides,
  };
}

function renderWithCtx(
  children: React.ReactNode,
  ctx: SlashCommandContextValue | null = null
) {
  if (ctx === null) {
    return render(<SlashCommandCode>{children}</SlashCommandCode>);
  }
  return render(
    <SlashCommandContext.Provider value={ctx}>
      <SlashCommandCode>{children}</SlashCommandCode>
    </SlashCommandContext.Provider>
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("SlashCommandCode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("RendersPlainCodeWhenNoContextProvider", () => {
    renderWithCtx("/start-work", null);
    const code = screen.getByText("/start-work");
    expect(code.tagName).toBe("CODE");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("RendersPlainCodeWhenChildrenAreNotASlashCommand", () => {
    const ctx = makeCtx();
    renderWithCtx("some code", ctx);
    const code = screen.getByText("some code");
    expect(code.tagName).toBe("CODE");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("RendersPlainCodeWhenCommandNotInKnownCommands", () => {
    const ctx = makeCtx({ knownCommands: new Set(["other-cmd"]) });
    renderWithCtx("/start-work", ctx);
    // No play button
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("RendersPlayButtonForValidKnownSlashCommand", () => {
    const ctx = makeCtx();
    renderWithCtx("/start-work", ctx);
    const btn = screen.getByRole("button", { name: /run \/start-work/i });
    expect(btn).toBeTruthy();
  });

  it("PlayButtonIsHiddenWhenContextIsDisabled", () => {
    const ctx = makeCtx({ disabled: true });
    renderWithCtx("/start-work", ctx);
    // disabled=true → isKnownCommand is false → no play button
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("ClickingPlayButtonCallsExecuteCommand", async () => {
    const ctx = makeCtx();
    renderWithCtx("/start-work", ctx);
    const btn = screen.getByRole("button");
    fireEvent.click(btn);
    await waitFor(() => {
      expect(ctx.executeCommand).toHaveBeenCalledWith("/start-work");
    });
  });

  it("PlayButtonIsDisabledWhileExecuting", async () => {
    let resolveCmd: () => void;
    const executeCommand = vi.fn(
      () => new Promise<void>((res) => { resolveCmd = res; })
    );
    const ctx = makeCtx({ executeCommand });
    renderWithCtx("/start-work", ctx);
    const btn = screen.getByRole("button");
    fireEvent.click(btn);
    // While promise is pending, button should have disabled attribute
    expect(btn.hasAttribute("disabled")).toBe(true);
    resolveCmd!();
    await waitFor(() => expect(btn.hasAttribute("disabled")).toBe(false));
  });

  it("PreventDoubleClickWhileExecuting", async () => {
    let resolveCmd: () => void;
    const executeCommand = vi.fn(
      () => new Promise<void>((res) => { resolveCmd = res; })
    );
    const ctx = makeCtx({ executeCommand });
    renderWithCtx("/start-work", ctx);
    const btn = screen.getByRole("button");
    fireEvent.click(btn);
    fireEvent.click(btn);
    fireEvent.click(btn);
    resolveCmd!();
    await waitFor(() => expect(executeCommand).toHaveBeenCalledTimes(1));
  });

  it("RendersPlayButtonForCommandWithArgs", () => {
    const ctx = makeCtx({ knownCommands: new Set(["compact"]) });
    renderWithCtx("/compact arg1 arg2", ctx);
    const btn = screen.getByRole("button", { name: /run \/compact arg1 arg2/i });
    expect(btn).toBeTruthy();
  });
});
