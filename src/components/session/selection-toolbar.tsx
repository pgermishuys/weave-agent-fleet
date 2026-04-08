"use client";

import { useEffect, useRef, useState } from "react";
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
  const toolbarRef = useRef<HTMLDivElement>(null);
  // Track whether we've rendered at least once so we can measure the toolbar.
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!selection || !mounted) return null;

  const { rect, text } = selection;

  // Calculate position — we read from the rendered toolbar width/height if
  // available, otherwise fall back to sensible estimates.
  const toolbarWidth = toolbarRef.current?.offsetWidth ?? 160;
  const toolbarHeight = toolbarRef.current?.offsetHeight ?? 34;
  const gap = 8;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  let top = rect.bottom + gap;
  let left = rect.left + rect.width / 2 - toolbarWidth / 2;

  // Flip above if there is not enough space below
  if (top + toolbarHeight > viewportHeight - gap) {
    top = rect.top - toolbarHeight - gap;
  }

  // Clamp horizontally
  left = Math.max(gap, Math.min(left, viewportWidth - toolbarWidth - gap));

  const handleClick = () => {
    onSpawnClick(text);
    // Collapse the browser selection so the toolbar disappears
    window.getSelection()?.removeAllRanges();
  };

  return createPortal(
    <div
      ref={toolbarRef}
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
