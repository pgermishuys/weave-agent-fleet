"use client";

import { useState, useCallback } from "react";
import { apiFetch } from "@/lib/api-client";

/**
 * Tool identifier string.
 *
 * Previously a strict union (`"vscode" | "cursor" | "terminal" | "explorer"`),
 * now widened to `string` because tool IDs are dynamic — they come from the
 * server-side registry and user config. Validation happens server-side.
 */
export type OpenTool = string;

export interface UseOpenDirectoryResult {
  openDirectory: (directory: string, tool: OpenTool) => Promise<void>;
  isOpening: boolean;
  error?: string;
}

export function useOpenDirectory(): UseOpenDirectoryResult {
  const [isOpening, setIsOpening] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const openDirectory = useCallback(
    async (directory: string, tool: OpenTool): Promise<void> => {
      setIsOpening(true);
      setError(undefined);

      try {
        const response = await apiFetch("/api/open-directory", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ directory, tool }),
        });

        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(
            (body as { error?: string }).error ?? `HTTP ${response.status}`
          );
        }
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to open directory";
        setError(message);
        console.error("[useOpenDirectory]", message);
      } finally {
        setIsOpening(false);
      }
    },
    []
  );

  return { openDirectory, isOpening, error };
}
