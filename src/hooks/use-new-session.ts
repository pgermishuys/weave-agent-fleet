"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { useCreateSession } from "@/hooks/use-create-session";

export interface UseNewSessionResult {
  startNewSession: () => Promise<void>;
  isCreating: boolean;
  error?: string;
}

/**
 * Encapsulates "create a new session in the same workspace directory and navigate to it".
 * Used by both the `/new` slash command handler and the "New Session" header button.
 */
export function useNewSession(currentDirectory: string | null | undefined): UseNewSessionResult {
  const { createSession, isLoading, error: createError } = useCreateSession();
  const router = useRouter();
  const [directoryError, setDirectoryError] = useState<string | undefined>();

  const startNewSession = useCallback(async () => {
    setDirectoryError(undefined);

    if (!currentDirectory) {
      setDirectoryError("No workspace directory available");
      return;
    }

    const result = await createSession(currentDirectory, {
      isolationStrategy: "existing",
    });

    router.push(
      `/sessions/${encodeURIComponent(result.session.id)}?instanceId=${encodeURIComponent(result.instanceId)}`
    );
  }, [currentDirectory, createSession, router]);

  return {
    startNewSession,
    isCreating: isLoading,
    error: directoryError ?? createError,
  };
}
