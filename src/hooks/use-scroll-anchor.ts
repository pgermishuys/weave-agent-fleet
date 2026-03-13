"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** Threshold in pixels from the bottom to consider the user "at the bottom". */
const AT_BOTTOM_THRESHOLD = 50;

/** Threshold in pixels from the top to consider the user "near the top". */
const NEAR_TOP_THRESHOLD = 200;

export interface UseScrollAnchorOptions {
  /**
   * Total number of messages — used to detect new arrivals and
   * increment the unseen counter when scrolled away from bottom.
   */
  messageCount: number;
  /**
   * Optional external ref for suppressing auto-scroll. When provided,
   * the hook uses this ref instead of creating its own internal one.
   * This allows the caller to set the flag synchronously before a
   * state update that changes messageCount (e.g. cache hydration in
   * useSessionEvents), ensuring the suppress flag is already true
   * when the messageCount effect runs on the same render cycle.
   */
  externalSuppressAutoScroll?: React.MutableRefObject<boolean>;
}

export interface UseScrollAnchorReturn {
  /** Callback-ref to attach to a container whose child has `[data-slot="scroll-area-viewport"]`. */
  scrollRef: (node: HTMLElement | null) => void;
  /** Whether the viewport is currently scrolled to (or near) the bottom. */
  isAtBottom: boolean;
  /** Whether the viewport is scrolled near the top (within NEAR_TOP_THRESHOLD). */
  isNearTop: boolean;
  /** Number of messages that arrived while the user was scrolled up. */
  newMessageCount: number;
  /** Programmatically scroll to the bottom and reset the counter. */
  scrollToBottom: () => void;
  /**
   * Preserve scroll position across a callback that prepends content.
   * Captures scrollHeight before, executes the callback, then adjusts
   * scrollTop by the delta so the visible content doesn't jump.
   */
  preserveScrollPosition: (callback: () => void | Promise<void>) => Promise<void>;
  /**
   * Returns the current scroll position of the viewport, or null if the
   * viewport is not yet mounted.
   */
  getScrollPosition: () => { scrollTop: number; scrollHeight: number } | null;
  /**
   * Restores a previously captured scroll position.
   * Uses the ratio approach to account for content height changes (e.g. from gap-fill).
   * Sets isProgrammaticScrollRef to prevent scroll handler from disengaging auto-scroll.
   */
  restoreScrollPosition: (saved: { scrollTop: number; scrollHeight: number }) => void;
  /**
   * When set to `true`, the messageCount change effect skips auto-scrolling.
   * Set this before hydrating cached messages to prevent an unwanted
   * scroll-to-bottom, then clear it after calling restoreScrollPosition.
   */
  suppressAutoScroll: React.MutableRefObject<boolean>;
}

/**
 * Smart auto-scroll hook for chat-style feeds.
 *
 * - Auto-scrolls on new content **only** when the viewport is already at the bottom.
 * - Pauses auto-scroll when the user scrolls up.
 * - Tracks the number of unseen messages while scrolled away.
 * - Exposes `scrollToBottom()` for a "jump to bottom" action.
 */
export function useScrollAnchor({
  messageCount,
  externalSuppressAutoScroll,
}: UseScrollAnchorOptions): UseScrollAnchorReturn {
  const viewportRef = useRef<HTMLElement | null>(null);
  const isAtBottomRef = useRef(true);
  const rafIdRef = useRef<number | null>(null);
  const prevMessageCountRef = useRef(messageCount);
  const mutationObserverRef = useRef<MutationObserver | null>(null);
  const mutationRafRef = useRef<number | null>(null);
  /**
   * Guard flag: set `true` while a programmatic scroll is in progress
   * (auto-scroll or preserveScrollPosition). While set, the scroll
   * handler will NOT disengage auto-scroll — only user-initiated
   * scrolls should do that.
   */
  const isProgrammaticScrollRef = useRef(false);
  /**
   * When true, the messageCount effect skips auto-scroll entirely.
   * Set before hydrating cached messages; cleared after restoreScrollPosition.
   * Uses the external ref if provided, otherwise creates an internal one.
   */
  const internalSuppressAutoScroll = useRef(false);
  const suppressAutoScroll = externalSuppressAutoScroll ?? internalSuppressAutoScroll;

  const [isAtBottom, setIsAtBottom] = useState(true);
  const [isNearTop, setIsNearTop] = useState(false);
  const [newMessageCount, setNewMessageCount] = useState(0);

  // —— Detect whether the viewport is scrolled to the bottom ——————
  const checkIsAtBottom = useCallback((el: HTMLElement): boolean => {
    const { scrollTop, scrollHeight, clientHeight } = el;
    return scrollHeight - scrollTop - clientHeight <= AT_BOTTOM_THRESHOLD;
  }, []);

  // —— Scroll handler (debounced via rAF) —————————————————————————
  const handleScroll = useCallback(() => {
    if (rafIdRef.current !== null) return; // already scheduled

    rafIdRef.current = requestAnimationFrame(() => {
      rafIdRef.current = null;
      const el = viewportRef.current;
      if (!el) return;

      const atBottom = checkIsAtBottom(el);

      // During programmatic scrolls (auto-scroll, preserve-position)
      // intermediate scroll events can read stale positions. Only
      // allow re-engagement (atBottom → true) but never disengage.
      if (isProgrammaticScrollRef.current) {
        if (atBottom) {
          isAtBottomRef.current = true;
          setIsAtBottom(true);
          setNewMessageCount(0);
        }
        // Skip near-top and disengage logic during programmatic scrolls.
        return;
      }

      isAtBottomRef.current = atBottom;
      setIsAtBottom(atBottom);

      const nearTop = el.scrollTop <= NEAR_TOP_THRESHOLD;
      setIsNearTop(nearTop);

      // If the user scrolled back to the bottom, clear the unseen count.
      if (atBottom) {
        setNewMessageCount(0);
      }
    });
  }, [checkIsAtBottom]);

  // —— Callback-ref that discovers the viewport element ———————————
  const scrollRef = useCallback(
    (node: HTMLElement | null) => {
      // Clean up previous listener & observer
      const prev = viewportRef.current;
      if (prev) {
        prev.removeEventListener("scroll", handleScroll);
      }
      if (mutationObserverRef.current) {
        mutationObserverRef.current.disconnect();
        mutationObserverRef.current = null;
      }

      if (node) {
        const viewport = node.querySelector<HTMLElement>(
          '[data-slot="scroll-area-viewport"]',
        );
        viewportRef.current = viewport ?? null;
        viewport?.addEventListener("scroll", handleScroll, { passive: true });

        // Observe DOM mutations (streaming text deltas, tool call updates)
        // to auto-scroll when content grows without changing messageCount.
        if (viewport) {
          const observer = new MutationObserver(() => {
            if (!isAtBottomRef.current || isProgrammaticScrollRef.current) return;
            if (mutationRafRef.current !== null) return;

            mutationRafRef.current = requestAnimationFrame(() => {
              mutationRafRef.current = null;
              const el = viewportRef.current;
              if (!el || !isAtBottomRef.current) return;
              isProgrammaticScrollRef.current = true;
              el.scrollTop = el.scrollHeight;
              isProgrammaticScrollRef.current = false;
            });
          });
          observer.observe(viewport, {
            childList: true,
            subtree: true,
            characterData: true,
          });
          mutationObserverRef.current = observer;
        }
      } else {
        viewportRef.current = null;
      }
    },
    [handleScroll],
  );

  // —— Programmatic scroll-to-bottom ——————————————————————————————
  const scrollToBottom = useCallback(() => {
    const el = viewportRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    isAtBottomRef.current = true;
    setIsAtBottom(true);
    setNewMessageCount(0);
  }, []);

  // —— Auto-scroll / unseen counter on message count changes ——————
  useEffect(() => {
    const delta = messageCount - prevMessageCountRef.current;
    prevMessageCountRef.current = messageCount;

    if (delta <= 0) return; // no new messages

    // When suppressAutoScroll is set, skip all auto-scroll logic.
    // This is used during cache hydration to prevent an unwanted scroll-to-bottom.
    if (suppressAutoScroll.current) return;

    if (isAtBottomRef.current) {
      // User is at the bottom → auto-scroll to keep them there.
      const el = viewportRef.current;
      if (el) {
        // Guard against false disengagement during smooth scroll.
        isProgrammaticScrollRef.current = true;
        // Use requestAnimationFrame so the DOM has a chance to lay out the
        // new content before we scroll.
        requestAnimationFrame(() => {
          el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
          // Clear the guard after the smooth scroll has had time to settle.
          // 300ms covers the typical smooth-scroll duration.
          setTimeout(() => {
            isProgrammaticScrollRef.current = false;
          }, 300);
        });
      }
    } else {
      // User is scrolled up → increment the unseen badge counter.
      setNewMessageCount((prev) => prev + delta);
    }
  }, [messageCount, suppressAutoScroll]);

  // —— Cleanup on unmount ——————————————————————————————————————————
  useEffect(() => {
    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
      }
      if (mutationRafRef.current !== null) {
        cancelAnimationFrame(mutationRafRef.current);
      }
      if (mutationObserverRef.current) {
        mutationObserverRef.current.disconnect();
      }
    };
  }, []);

  // —— Preserve scroll position across content prepend ─────────────
  const preserveScrollPosition = useCallback(
    async (callback: () => void | Promise<void>) => {
      const el = viewportRef.current;
      if (!el) {
        await callback();
        return;
      }

      const prevScrollHeight = el.scrollHeight;
      const prevScrollTop = el.scrollTop;

      isProgrammaticScrollRef.current = true;
      await callback();

      // Wait for the DOM to lay out the new content before adjusting
      requestAnimationFrame(() => {
        const delta = el.scrollHeight - prevScrollHeight;
        if (delta > 0) {
          el.scrollTop = prevScrollTop + delta;
        }
        isProgrammaticScrollRef.current = false;
      });
    },
    [],
  );

  // —— Get / restore scroll position for cache save/restore ─────────

  const getScrollPosition = useCallback(
    (): { scrollTop: number; scrollHeight: number } | null => {
      const el = viewportRef.current;
      if (!el) return null;
      return { scrollTop: el.scrollTop, scrollHeight: el.scrollHeight };
    },
    [],
  );

  const restoreScrollPosition = useCallback(
    (saved: { scrollTop: number; scrollHeight: number }): void => {
      const el = viewportRef.current;
      if (!el) return;

      isProgrammaticScrollRef.current = true;

      // Adjust for any content added by gap-fill since the snapshot was taken.
      const currentScrollHeight = el.scrollHeight;
      const newScrollTop = saved.scrollTop + (currentScrollHeight - saved.scrollHeight);
      el.scrollTop = newScrollTop;

      // Update isAtBottom based on the restored position.
      const atBottom = checkIsAtBottom(el);
      isAtBottomRef.current = atBottom;
      setIsAtBottom(atBottom);
      if (atBottom) setNewMessageCount(0);

      // Clear the programmatic guard after the browser has processed the scroll.
      setTimeout(() => {
        isProgrammaticScrollRef.current = false;
      }, 300);
    },
    [checkIsAtBottom],
  );

  return { scrollRef, isAtBottom, isNearTop, newMessageCount, scrollToBottom, preserveScrollPosition, getScrollPosition, restoreScrollPosition, suppressAutoScroll };
}
