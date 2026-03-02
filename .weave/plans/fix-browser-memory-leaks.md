# Fix Browser Memory Leaks

## TL;DR
> **Summary**: Fix confirmed memory leaks and excessive re-rendering in the Agent Fleet frontend caused by leaked SSE reconnect timeouts, unbounded state array copies on every text delta, unmemoized message components, and unthrottled auto-scroll.
> **Estimated Effort**: Medium

## Context
### Original Request
The browser tab running Agent Fleet becomes sluggish over time. Investigation identified five confirmed issues across four files, ranging from leaked `setTimeout` handles to O(n) array copies firing dozens of times per second during streaming.

### Key Findings
1. **`notifications-context.tsx` (line 195-197)** — `setTimeout` for SSE reconnection is never stored in a ref. On repeated SSE drops the closures accumulate, each holding references to `connectSSE`, `isMounted`, and `eventSourceRef`. The sister file `use-session-events.ts` (lines 168-170, 186-188) already implements the correct pattern with `reconnectTimerRef`.

2. **`use-session-events.ts` (line 113) + `event-state.ts`** — `setMessages(accumulated)` replaces state with the full conversation history on every load. The `applyTextDelta` function (called multiple times per second during streaming) runs `.map()` over the entire messages array and creates a new message + parts object even for non-matching messages. `ensureMessage` always spreads `[...prev, newMsg]`. These compound: a 500-message conversation streaming text = 500 object identity checks lost per delta.

3. **`activity-stream-v1.tsx` (lines 130-232, 288-295)** — `MessageItem` is a plain function component. The `allMessages` prop (the entire array) is passed to every instance solely to compute duration by looking up a parent message ID. This means even with `React.memo`, memoization would be defeated because `allMessages` changes on every state update.

4. **`activity-stream-v1.tsx` (lines 246-248)** — `useEffect` with `[messages]` dependency calls `scrollIntoView({ behavior: "smooth" })` on every text delta. During streaming this fires many times per second, queuing overlapping smooth-scroll animations causing layout thrashing.

5. **`notifications-context.tsx` (line 177)** — `setUnreadCount(prev => prev + 1)` with no upper bound. Low impact but trivially fixable.

## Objectives
### Core Objective
Eliminate the root causes of progressive browser slowdown during extended Agent Fleet usage, focusing on the four highest-impact issues.

### Deliverables
- [ ] SSE reconnect timeout properly tracked and cleaned up in notifications context
- [ ] `applyTextDelta` optimized to avoid unnecessary array/object creation
- [ ] `MessageItem` wrapped in `React.memo` with `allMessages` prop eliminated
- [ ] Auto-scroll debounced to prevent layout thrashing during streaming
- [ ] Unread count capped at a reasonable maximum

### Definition of Done
- [ ] `dotnet build` (backend) and `npm run build` (frontend) succeed with no new warnings
- [ ] Manual test: open a session, stream a long response (100+ messages), verify no perceptible lag
- [ ] Manual test: disconnect network briefly, reconnect — verify no timeout accumulation (check with `console.log` or React DevTools)
- [ ] React DevTools Profiler: during active streaming, only the actively-streaming `MessageItem` re-renders (not all siblings)

### Guardrails (Must NOT)
- Do NOT add message windowing/virtualization (e.g., react-window) — that is a separate, larger refactor
- Do NOT change the SSE event protocol or API shape
- Do NOT change the `AccumulatedMessage` type definition
- Do NOT introduce new dependencies

## TODOs

- [ ] 1. **Fix SSE reconnect timeout leak in notifications context**
  **What**: Add a `reconnectTimerRef` to `NotificationsProvider`, store the `setTimeout` return value in it, clear it before scheduling a new reconnect, and clear it in the cleanup function of the lifecycle `useEffect`. Follow the exact pattern from `use-session-events.ts` lines 48, 168-170, 186-188.
  **Files**: `src/contexts/notifications-context.tsx`
  **Changes**:
    - Add `const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);` alongside the existing refs (after line 56)
    - In `connectSSE` → `es.onerror` handler (line 195): before `setTimeout`, clear any existing timer: `if (reconnectTimerRef.current) { clearTimeout(reconnectTimerRef.current); reconnectTimerRef.current = null; }`. Store the return value: `reconnectTimerRef.current = setTimeout(...)`.
    - In the cleanup function of the lifecycle `useEffect` (lines 207-212): add `if (reconnectTimerRef.current) { clearTimeout(reconnectTimerRef.current); reconnectTimerRef.current = null; }` before or after `stopPolling()`.
    - Cap unread count: change `setUnreadCount((prev) => prev + 1)` (line 177) to `setUnreadCount((prev) => Math.min(prev + 1, 9999))`.
  **Acceptance**: After this change, each `es.onerror` invocation clears the previous timer before scheduling a new one, and unmount clears any pending timer. Unread count is bounded at 9999.

- [ ] 2. **Optimize `applyTextDelta` hot path in event-state.ts**
  **What**: The `applyTextDelta` function is called multiple times per second during streaming. Currently it: (a) runs `.find()` to check if message exists, then `.map()` over ALL messages; (b) creates new objects for every message in the `.map()` even when they don't match. Optimize to use index-based update to avoid touching non-target messages.
  **Files**: `src/lib/event-state.ts`
  **Changes**:
    - Rewrite `applyTextDelta` to use `findIndex` instead of `find` + `map`:
      1. `const msgIndex = prev.findIndex(m => m.messageId === messageId)`
      2. If not found, append new message (existing behavior) and return `[...prev, newMsg]`
      3. If found, get `const msg = prev[msgIndex]`
      4. Find the part: `const partIndex = msg.parts.findIndex(p => p.type === "text" && p.partId === partId)`
      5. If part found: create new parts array by shallow-copying and replacing only the target index. Create new message object. Create new top-level array by shallow-copying and replacing only the target message index: `const next = prev.slice(); next[msgIndex] = updatedMsg; return next;`
      6. If part not found: append new part to msg.parts, update the message at index, return `prev.slice()` with replacement at `msgIndex`.
    - This eliminates: O(n) `.map()` creating n-1 unnecessary identity comparisons, and ensures non-target messages keep their reference identity (critical for `React.memo` downstream).
    - Apply the same index-based optimization to `mergeMessageUpdate` which also uses `findIndex` but then does `[...prev]` spread — change to `prev.slice()` with index replacement (already close, just verify).
    - `ensureMessage` is fine — it only fires once per message and the early return on `existing` is correct.
  **Acceptance**: `applyTextDelta` creates a new array reference (for React state update) but only creates new objects for the single target message. All other message references remain identical (`===`). Existing behavior preserved — same output for same inputs.

- [ ] 3. **Memoize MessageItem and eliminate allMessages prop**
  **What**: `MessageItem` re-renders for every text delta because (a) it's not wrapped in `React.memo`, and (b) even if it were, the `allMessages` prop changes on every update. The `allMessages` prop is only used to look up a parent message's `createdAt` to compute duration (lines 147-152). Fix: precompute a `Map<string, number>` of `messageId → createdAt` in the parent `ActivityStreamV1`, pass only the relevant `parentCreatedAt` timestamp as an optional number prop.
  **Files**: `src/components/session/activity-stream-v1.tsx`
  **Changes**:
    - In `ActivityStreamV1`, before the JSX return, compute:
      ```
      const createdAtByMessageId = useMemo(() => {
        const map = new Map<string, number>();
        for (const msg of messages) {
          if (msg.createdAt != null) map.set(msg.messageId, msg.createdAt);
        }
        return map;
      }, [messages]);
      ```
    - Change `MessageItemProps`: remove `allMessages?: AccumulatedMessage[]`, add `parentCreatedAt?: number`.
    - In the `messages.map(...)` render: replace `allMessages={messages}` with `parentCreatedAt={message.parentID ? createdAtByMessageId.get(message.parentID) : undefined}`.
    - In `MessageItem`: replace the duration computation block (lines 146-152) with:
      ```
      let durationStr: string | null = null;
      if (!isUser && message.completedAt && parentCreatedAt) {
        durationStr = formatDuration(message.completedAt - parentCreatedAt);
      }
      ```
    - Wrap `MessageItem` with `React.memo`:
      ```
      const MessageItem = memo(function MessageItem({ message, agents, parentCreatedAt }: MessageItemProps) {
        ...
      });
      ```
    - Add `memo` to the React import at line 1.
    - Add `useMemo` to the React import at line 1 (already imported? — check: no, line 3 only imports `useEffect, useRef`).
  **Risks**:
    - `agents` array prop: if `agents` changes reference on every render, it defeats memoization. Check caller — `agents` comes from props of `ActivityStreamV1` which comes from the page component. It's likely stable (fetched once). If not stable, consider memoizing it in the parent or using a custom `areEqual` for `React.memo`. For now, assume stable — revisit if profiling shows issues.
    - `parentCreatedAt` is a primitive (`number | undefined`), so it won't defeat memoization.
    - `message` object: after Task 2's optimization, the message object reference only changes when that specific message is updated. This is correct — the memoized component will re-render only for its own updates.
  **Acceptance**: React DevTools Profiler shows that during text streaming, only the active message's `MessageItem` re-renders. Sibling `MessageItem` components show "Did not render" in the profiler.

- [ ] 4. **Debounce auto-scroll to prevent layout thrashing**
  **What**: The `useEffect` on `[messages]` fires `scrollIntoView({ behavior: "smooth" })` on every text delta — dozens of times per second during streaming. Each call queues a smooth-scroll animation, and overlapping animations cause layout thrashing. Fix: debounce using a ref-based approach, and only scroll when genuinely needed.
  **Files**: `src/components/session/activity-stream-v1.tsx`
  **Changes**:
    - Replace the current auto-scroll `useEffect` (lines 246-248) with a debounced version:
      ```
      const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
      const prevMessageCountRef = useRef(0);

      useEffect(() => {
        // Only auto-scroll when message count changes (new message) or this is the initial load,
        // not on every text delta to an existing message.
        const messageCount = messages.length;
        const isNewMessage = messageCount !== prevMessageCountRef.current;
        prevMessageCountRef.current = messageCount;

        if (scrollTimerRef.current) {
          clearTimeout(scrollTimerRef.current);
        }

        // Debounce: wait 150ms to coalesce rapid updates
        scrollTimerRef.current = setTimeout(() => {
          bottomRef.current?.scrollIntoView({
            behavior: isNewMessage ? "smooth" : "auto",
          });
          scrollTimerRef.current = null;
        }, 150);

        return () => {
          if (scrollTimerRef.current) {
            clearTimeout(scrollTimerRef.current);
            scrollTimerRef.current = null;
          }
        };
      }, [messages]);
      ```
    - Design rationale:
      - **Debounce at 150ms**: coalesces dozens of text deltas into a single scroll. 150ms is imperceptible to the user but eliminates layout thrashing.
      - **`isNewMessage` detection**: when a new message arrives (count changes), use `behavior: "smooth"` for visible feedback. For text deltas to existing messages, use `behavior: "auto"` (instant jump) to avoid queuing smooth animations during rapid streaming.
      - **Cleanup**: timer cleared on unmount and before scheduling a new one.
  **Acceptance**: During active streaming, `scrollIntoView` is called at most ~7 times/second (1000ms / 150ms) instead of dozens. No visible scroll jank. New messages still smoothly scroll into view.

- [ ] 5. **Verify and test all changes together**
  **What**: Integration verification to ensure all four fixes work together without regressions.
  **Files**: All modified files
  **Acceptance**:
    - [ ] `npm run build` succeeds with no new TypeScript errors or warnings
    - [ ] `npm run lint` passes (or has no new violations)
    - [ ] Manual smoke test: open Agent Fleet, start a session, send a prompt that generates a long response
    - [ ] Verify auto-scroll works smoothly during response streaming
    - [ ] Verify message duration displays correctly (parentCreatedAt lookup works)
    - [ ] Verify notification badge updates on new notifications
    - [ ] Simulate SSE disconnect (DevTools → Network → Offline toggle): verify reconnection works and no timeout accumulation
    - [ ] React DevTools Profiler check: during streaming, only the active `MessageItem` and the parent `ActivityStreamV1` re-render
    - [ ] Leave tab open for 30+ minutes with periodic SSE activity — verify no memory growth in DevTools Memory tab

## Verification
- [ ] `npm run build` completes successfully
- [ ] `npm run lint` passes
- [ ] No regressions in notification delivery or display
- [ ] No regressions in message rendering or ordering
- [ ] Auto-scroll behavior feels natural (not janky, not delayed)
- [ ] React DevTools Profiler confirms reduced re-renders during streaming
- [ ] Memory tab shows stable heap over extended usage
