"use client";

import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import { useSendPrompt } from "@/hooks/use-send-prompt";
import { useCommands } from "@/hooks/use-commands";

// ─── Context Value ────────────────────────────────────────────────────────────

export interface SlashCommandContextValue {
  /** Execute a slash command string like "/start-work" or "/compact arg1 arg2" */
  executeCommand: (commandText: string) => Promise<void>;
  /** Set of known command names (without leading slash) for validation */
  knownCommands: Set<string>;
  /** True when commands cannot be executed (session stopped, disconnected, etc.) */
  disabled: boolean;
}

/**
 * Context that provides slash command execution capabilities to descendant components.
 * When null (outside a provider), consumers should render plain inline code without
 * a play button — this is the intended graceful-degradation path for non-session
 * contexts (GitHub PR/issue views, webfetch tool cards, etc.).
 */
const SlashCommandContext = createContext<SlashCommandContextValue | null>(null);
export { SlashCommandContext };

// ─── Provider ─────────────────────────────────────────────────────────────────

interface SlashCommandProviderProps {
  children: ReactNode;
  sessionId: string;
  instanceId: string;
  /** When true, play buttons are hidden/disabled (session stopped, error, etc.) */
  disabled?: boolean;
}

export function SlashCommandProvider({
  children,
  sessionId,
  instanceId,
  disabled = false,
}: SlashCommandProviderProps) {
  const { sendPrompt } = useSendPrompt();
  const { commands } = useCommands(instanceId);

  const knownCommands = useMemo(
    () => new Set(commands.map((c) => c.name)),
    [commands]
  );

  const executeCommand = useCallback(
    async (commandText: string): Promise<void> => {
      await sendPrompt(sessionId, instanceId, commandText);
    },
    [sendPrompt, sessionId, instanceId]
  );

  const value = useMemo(
    (): SlashCommandContextValue => ({
      executeCommand,
      knownCommands,
      disabled,
    }),
    [executeCommand, knownCommands, disabled]
  );

  return (
    <SlashCommandContext.Provider value={value}>
      {children}
    </SlashCommandContext.Provider>
  );
}

// ─── Consumer Hook ────────────────────────────────────────────────────────────

/**
 * Returns the SlashCommandContext value, or null when used outside a provider.
 * Does NOT throw — null is the intentional graceful-degradation value for
 * non-session contexts.
 */
export function useSlashCommandContext(): SlashCommandContextValue | null {
  return useContext(SlashCommandContext);
}
