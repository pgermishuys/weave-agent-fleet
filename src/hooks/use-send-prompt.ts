"use client";

import { useState, useCallback } from "react";
import { parseSlashCommand } from "@/lib/slash-command-utils";
import { apiFetch } from "@/lib/api-client";

export interface UseSendPromptResult {
  sendPrompt: (
    sessionId: string,
    instanceId: string,
    text: string,
    agent?: string
  ) => Promise<void>;
  isSending: boolean;
  error?: string;
}

/** Fleet-native commands handled client-side (not forwarded to the SDK). */
const FLEET_COMMANDS = new Set(["new"]);

export function useSendPrompt(
  onFleetCommand?: (command: string, args: string) => Promise<void>
): UseSendPromptResult {
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const sendPrompt = useCallback(
    async (sessionId: string, instanceId: string, text: string, agent?: string): Promise<void> => {
      setIsSending(true);
      setError(undefined);
      try {
        const parsed = parseSlashCommand(text);

        if (parsed && FLEET_COMMANDS.has(parsed.command)) {
          // Fleet-native command — handle client-side, never send to SDK
          if (onFleetCommand) {
            await onFleetCommand(parsed.command, parsed.args);
          }
          return;
        }

        if (parsed) {
          // Slash command — route to the command endpoint which fires the SDK
          // command() without awaiting it (fire-and-forget, matching the
          // OpenCode TUI pattern).  The SSE event stream delivers session
          // status changes and streamed messages back to the frontend.
          const response = await apiFetch(
            `/api/sessions/${encodeURIComponent(sessionId)}/command`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                instanceId,
                command: parsed.command,
                ...(parsed.args ? { args: parsed.args } : {}),
              }),
            }
          );

          if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            const message = (data as { error?: string }).error ?? `HTTP ${response.status}`;
            setError(message);
            throw new Error(message);
          }
        } else {
          // Regular prompt — route to promptAsync endpoint.
          const response = await apiFetch(
            `/api/sessions/${encodeURIComponent(sessionId)}/prompt`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ instanceId, text, agent }),
            }
          );

          if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            const message = (data as { error?: string }).error ?? `HTTP ${response.status}`;
            setError(message);
            throw new Error(message);
          }
        }
      } finally {
        setIsSending(false);
      }
    },
    [onFleetCommand]
  );

  return { sendPrompt, isSending, error };
}
