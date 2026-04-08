"use client";

import { useCallback } from "react";
import { createPortal } from "react-dom";
import { GitBranch } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { TextSelectionState } from "@/hooks/use-text-selection";

interface SelectionToolbarProps {
  /** The current text selection state. When null the toolbar is hidden. */
  selection: TextSelectionState | null;
  /** Called when the user clicks "Spawn Session". */
  onSpawnClick: (selectedText: string) => void;
}

// Fixed dimensions for position calculation — the button content is static so
// these are predictable.  Avoids needing a ref measurement during render.
const TOOLBAR_WIDTH = 160;
const TOOLBAR_HEIGHT = 34;
const GAP = 8;

/**
 * A small floating toolbar that appears near a text selection in the activity
 * stream and provides a "Spawn Session" button.
 *
 * Rendered via a React portal to `document.body` so it is never clipped by
 * `overflow: hidden` ancestors in the scroll area.
 *
 * Positioning:
 *   - 8 px below the selection bounding rect, centred horizontally
 *   - Clamped to viewport bounds so it never overflows off-screen
 *   - Flips above the selection when there is insufficient space below
 */
export function SelectionToolbar({ selection, onSpawnClick }: SelectionToolbarProps) {
  const handleClick = useCallback(() => {
    if (!selection) return;
    onSpawnClick(selection.text);
    // Collapse the browser selection so the toolbar disappears
    window.getSelection()?.removeAllRanges();
  }, [selection, onSpawnClick]);

  // SSR guard — portals need document.body
  if (typeof document === "undefined") return null;
  if (!selection) return null;

  const { rect } = selection;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  let top = rect.bottom + GAP;
  let left = rect.left + rect.width / 2 - TOOLBAR_WIDTH / 2;

  // Flip above if there is not enough space below
  if (top + TOOLBAR_HEIGHT > viewportHeight - GAP) {
    top = rect.top - TOOLBAR_HEIGHT - GAP;
  }

  // Clamp horizontally
  left = Math.max(GAP, Math.min(left, viewportWidth - TOOLBAR_WIDTH - GAP));

  return createPortal(
    <div
      className="fixed z-50 animate-in fade-in-0 zoom-in-95 duration-100"
      style={{ top, left }}
    >
      <Button
        size="sm"
        variant="default"
        className="weave-gradient-bg border-0 shadow-md hover:opacity-90 gap-1.5"
        onClick={handleClick}
        onMouseDown={(e) => {
          // Prevent the click from collapsing the selection before we can read it
          e.preventDefault();
        }}
      >
        <GitBranch className="h-3.5 w-3.5" />
        Spawn Session
      </Button>
    </div>,
    document.body
  );
}
