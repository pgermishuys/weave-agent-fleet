"use client";

import { useEffect, useRef, useState, useCallback } from "react";

export interface TextSelectionState {
  /** The selected text string. */
  text: string;
  /** The bounding DOMRect of the selection range (for positioning the toolbar). */
  rect: DOMRect;
}

/**
 * Listens for text selections within a container ref.
 *
 * Returns the current `TextSelectionState` (selected text + bounding rect) when
 * the user has selected at least `minLength` characters inside the element
 * identified by `containerRef`.  Returns `null` when:
 *   - the selection is empty / collapsed
 *   - the selected text is shorter than `minLength`
 *   - the selection anchor is outside `containerRef`
 *
 * Selection updates are debounced by `debounceMs` (default 150 ms) to avoid
 * excessive re-renders during drag-select.  Clearing the selection (collapsed
 * or outside container) is applied immediately with no debounce for responsive
 * toolbar dismissal.
 */
export function useTextSelection(
  containerRef: React.RefObject<HTMLElement | null>,
  minLength = 10,
  debounceMs = 150
): TextSelectionState | null {
  const [selectionState, setSelectionState] = useState<TextSelectionState | null>(null);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearDebounce = useCallback(() => {
    if (debounceTimer.current !== null) {
      clearTimeout(debounceTimer.current);
      debounceTimer.current = null;
    }
  }, []);

  useEffect(() => {
    const handleSelectionChange = () => {
      const selection = window.getSelection();

      // Immediately clear if there is no active selection or it is collapsed.
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
        clearDebounce();
        setSelectionState(null);
        return;
      }

      // Immediately clear if the anchor node is outside the container.
      const container = containerRef.current;
      if (!container || !container.contains(selection.anchorNode)) {
        clearDebounce();
        setSelectionState(null);
        return;
      }

      // Debounce the update for active drag-selects.
      clearDebounce();
      debounceTimer.current = setTimeout(() => {
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
          setSelectionState(null);
          return;
        }
        if (!container.contains(sel.anchorNode)) {
          setSelectionState(null);
          return;
        }

        const text = sel.toString();
        if (text.length < minLength) {
          setSelectionState(null);
          return;
        }

        const range = sel.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        setSelectionState({ text, rect });
      }, debounceMs);
    };

    document.addEventListener("selectionchange", handleSelectionChange);
    return () => {
      document.removeEventListener("selectionchange", handleSelectionChange);
      clearDebounce();
    };
  }, [containerRef, minLength, debounceMs, clearDebounce]);

  return selectionState;
}
