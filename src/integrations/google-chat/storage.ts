"use client";

import { removePersistedKey } from "@/hooks/use-persisted-state";

export const GOOGLE_CHAT_LAST_SPACE_KEY = "weave:google-chat:lastSpace";

/**
 * Clears all Google Chat client-side state from localStorage.
 * Called on disconnect to ensure no stale data remains.
 */
export function clearGoogleChatClientState(): void {
  removePersistedKey(GOOGLE_CHAT_LAST_SPACE_KEY);

  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key !== null && key.startsWith("weave:google-chat:")) {
        keysToRemove.push(key);
      }
    }

    for (const key of keysToRemove) {
      removePersistedKey(key);
    }
  } catch {
    // localStorage unavailable (e.g. SSR or private browsing)
  }
}
