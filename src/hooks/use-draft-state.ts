"use client";

import { useCallback, useEffect, useRef } from "react";
import { usePersistedState, removePersistedKey } from "./use-persisted-state";
import { buildDraftKey, pruneDrafts } from "@/lib/draft-utils";
import type { DraftValue } from "@/lib/draft-utils";

const DEBOUNCE_MS = 300;
const EMPTY_DRAFT: DraftValue = { text: "", updatedAt: 0 };

/**
 * Manages per-session prompt draft persistence in localStorage.
 *
 * - `text`       – the currently persisted draft (reactive to session key changes)
 * - `setText`    – debounced write (300 ms); flushes immediately on unmount / session switch
 * - `clearDraft` – immediate delete from localStorage, cancels any pending write
 */
export function useDraftState(sessionId: string) {
  const key = buildDraftKey(sessionId);
  const [draft, setDraft] = usePersistedState<DraftValue>(key, EMPTY_DRAFT);

  // Pending write ref for debounce
  const pendingRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Flush pending write immediately
  const flush = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (pendingRef.current !== null) {
      const text = pendingRef.current;
      pendingRef.current = null;
      if (text === "") {
        removePersistedKey(key);
      } else {
        setDraft({ text, updatedAt: Date.now() });
        // Prune old drafts asynchronously so we don't block the write path
        if (typeof requestIdleCallback === "function") {
          requestIdleCallback(() => pruneDrafts(20));
        } else {
          setTimeout(() => pruneDrafts(20), 0);
        }
      }
    }
  }, [key, setDraft]);

  // Flush on unmount or key change (session switch)
  useEffect(() => {
    return () => flush();
  }, [flush]);

  // Debounced setText
  const setText = useCallback(
    (text: string) => {
      pendingRef.current = text;
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
      }
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        flush();
      }, DEBOUNCE_MS);
    },
    [flush],
  );

  // Explicit clear — immediate, no debounce
  const clearDraft = useCallback(() => {
    pendingRef.current = null;
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    removePersistedKey(key);
  }, [key]);

  return {
    text: draft.text,
    setText,
    clearDraft,
  };
}
