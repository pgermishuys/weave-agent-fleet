# Fix: Remote Session connectionId Threading

## TL;DR
> **Summary**: When spawning a remote session, `connectionId` is correctly used to create the session but is then dropped from the `router.push` URL, so every subsequent API call on the session detail page — including SSE, metadata fetch, prompt sends, abort, terminate, resume, delete, fork, agents, models, diffs — goes to localhost instead of the remote Fleet server. This plan threads `connectionId` as an optional parameter through every affected hook, component, and utility, and also fixes SSE auth for `EventSource` (which cannot send headers) by teaching the proxy to accept a `?token=` query param.
> **Estimated Effort**: Medium

---

## Context

### Original Request
Thread `connectionId` through the Weave Agent Fleet session detail page and all its hooks so that remote sessions — those whose `connectionId` is not `"local"` — make every API call (including SSE) against the correct remote Fleet server with the correct auth token.

### Key Findings

1. **`apiFetch(path, init, connectionId?)`** already handles URL rewriting and `Authorization` header injection when `connectionId` is provided (`src/lib/api-client.ts`). The infrastructure is ready; the problem is that `connectionId` is never passed in.

2. **`sseUrl(path, connectionId?)`** also exists and already builds the correct remote URL — it just needs to be called with `connectionId`.

3. **`EventSource` cannot send custom headers.** The token must be appended as `?token=<value>` on the SSE URL. `connectionRegistry.getTokenForConnection(connectionId)` already exposes the token; `src/proxy.ts` only checks the `Authorization: Bearer` header today and must be extended to also accept `?token=`.

4. **`new-session-dialog.tsx`** already resolves `connectionId = isMultiServer ? selectedConnectionId : undefined` at line 171 and passes it to `createSession()`. It simply omits it from `router.push`.

5. **`fork-session-dialog.tsx`** has no `connectionId` prop at all — neither in its interface, `useForkSession` call, nor `router.push`.

6. **`page.tsx`** (`src/app/sessions/[id]/page.tsx`) never reads `connectionId` from `searchParams`. Every hook call and `apiFetch` call on the page is therefore missing it.

7. All 11 hooks + 1 utility function have signatures that do not accept `connectionId` and pass nothing to `apiFetch`.

8. The existing test for `useForkSession` verifies the exact call signature of `apiFetch` — it must be updated to accept the optional third argument.

9. The existing test for `fetchSessionStatus` verifies the exact call to `apiFetch` with only one argument — it must be updated to cover the two-argument (with `connectionId`) path.

---

## Objectives

### Core Objective
Ensure every API call made from the session detail page routes to the correct Fleet server when the session was created on a remote connection.

### Deliverables
- [ ] `src/proxy.ts` — accept `?token=` query param as an alternative to `Authorization: Bearer` header
- [ ] `src/lib/api-types.ts` — `SessionListItem` has `connectionId?: string` field
- [ ] `src/lib/session-status-utils.ts` — `fetchSessionStatus` accepts optional `connectionId`
- [ ] `src/hooks/use-sessions.ts` — fetches from all registered connections, stamps `connectionId` on each item
- [ ] `src/hooks/use-message-pagination.ts` — `loadInitialMessages` and `loadOlderMessages` accept optional `connectionId`
- [ ] `src/hooks/use-session-events.ts` — all `apiFetch`/`sseUrl` calls pass `connectionId`; SSE URL includes `?token=` when needed; hook signature accepts `connectionId` as 5th param
- [ ] `src/hooks/use-send-prompt.ts` — `sendPrompt` accepts optional `connectionId`
- [ ] `src/hooks/use-diffs.ts` — `useDiffs` accepts optional `connectionId`
- [ ] `src/hooks/use-agents.ts` — `useAgents` accepts optional `connectionId`
- [ ] `src/hooks/use-models.ts` — `useModels` accepts optional `connectionId`
- [ ] `src/hooks/use-terminate-session.ts` — `terminateSession` accepts optional `connectionId`
- [ ] `src/hooks/use-abort-session.ts` — `abortSession` accepts optional `connectionId`
- [ ] `src/hooks/use-resume-session.ts` — `resumeSession` accepts optional `connectionId`
- [ ] `src/hooks/use-delete-session.ts` — `deleteSession` accepts optional `connectionId`
- [ ] `src/hooks/use-fork-session.ts` — `forkSession` accepts optional `connectionId`
- [ ] `src/components/session/fork-session-dialog.tsx` — accepts `connectionId` prop, passes through
- [ ] `src/app/sessions/[id]/page.tsx` — reads `connectionId` from `searchParams`, wires it to every hook and call site
- [ ] `src/components/session/new-session-dialog.tsx` — include `connectionId` in `router.push`
- [ ] `src/components/fleet/live-session-card.tsx` — Link href includes `connectionId` when present
- [ ] `src/components/layout/sidebar-session-item.tsx` — Link href, `handleResume` push, and `ForkSessionDialog` all include/receive `connectionId`
- [ ] `src/components/session/activity-stream-v1.tsx` — child session `TaskDelegationItem` URL includes `connectionId`
- [ ] `src/app/page.tsx` — `handleResume` push includes `connectionId`
- [ ] Existing tests updated to cover `connectionId` forwarding

### Definition of Done
- [ ] `npm test` (or `npx vitest run`) passes with no regressions
- [ ] Navigating to a remote session via the UI results in all network requests going to the remote Fleet server URL (verifiable in DevTools Network tab)
- [ ] SSE connects successfully to a remote server (no 401 from the proxy)

### Guardrails (Must NOT)
- Do NOT change behaviour for local sessions (`connectionId` is `undefined` or `"local"`) — all existing callers without `connectionId` must work identically
- Do NOT change the `apiFetch` / `sseUrl` / `connectionRegistry` internals — the infrastructure is correct
- Do NOT add `connectionId` to URL query params for ancestor session links if the ancestor session lives on a different server — simply forward the same `connectionId` as those ancestors are fetched from the same Fleet instance

---

## TODOs

### Group 1 — Proxy: SSE token support

- [x] 1. Extend `src/proxy.ts` to accept `?token=` query param
  **What**: After the existing `authHeader?.startsWith("Bearer ")` check fails (returns a 401), add a fallback that reads `request.nextUrl.searchParams.get("token")`. If a token query param is present, use it in place of the bearer header for the `bcrypt.compare` call. This enables `EventSource` connections (which cannot set headers) to authenticate.
  **Files**: `src/proxy.ts`
  **Implementation detail**:
  - After `const authHeader = request.headers.get("authorization");`, also read `const tokenParam = request.nextUrl.searchParams.get("token");`
  - Change the current early-return 401 to only fire when BOTH `authHeader` is missing/malformed AND `tokenParam` is null/empty
  - Extract `token` from whichever source is present: `const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : (tokenParam ?? "");`
  - The existing `bcrypt.compare(token, storedHash)` call remains unchanged
  **Acceptance**: A request to `/api/sessions/x/events?instanceId=y&token=<valid>` returns 200; a request with an invalid token still returns 401

---

### Group 2 — Leaf utilities and hooks (no outbound dependencies on other changed files)

- [x] 2. Update `src/lib/session-status-utils.ts` — add `connectionId?` param
  **What**: Add `connectionId?: string` as the third parameter to `fetchSessionStatus`. Pass it as the third argument to `apiFetch(url, undefined, connectionId)`.
  **Files**: `src/lib/session-status-utils.ts`
  **Implementation detail**:
  ```
  export async function fetchSessionStatus(
    sessionId: string,
    instanceId: string,
    connectionId?: string
  ): Promise<"idle" | "busy"> {
    ...
    const response = await apiFetch(url, undefined, connectionId);
    ...
  }
  ```
  **Acceptance**: Calling `fetchSessionStatus("s", "i", "remote-id")` passes `"remote-id"` as the third argument to `apiFetch`

- [x] 3. Update `src/hooks/use-message-pagination.ts` — add `connectionId?` to both load functions
  **What**: Add `connectionId?: string` as the third parameter to both `loadInitialMessages` and `loadOlderMessages`. Update the `UseMessagePaginationReturn` interface signatures to match. Pass `connectionId` as the third argument to both `apiFetch` calls inside those functions.
  **Files**: `src/hooks/use-message-pagination.ts`
  **Implementation detail**:
  - `UseMessagePaginationReturn.loadInitialMessages` signature: `(sessionId: string, instanceId: string, connectionId?: string) => Promise<AccumulatedMessage[]>`
  - `UseMessagePaginationReturn.loadOlderMessages` signature: `(sessionId: string, instanceId: string, connectionId?: string) => Promise<AccumulatedMessage[]>`
  - `loadInitialMessages` inner `useCallback`: add `connectionId?: string` param, pass to `apiFetch(url, undefined, connectionId)`
  - `loadOlderMessages` inner `useCallback`: add `connectionId?: string` param, pass to `apiFetch(url, undefined, connectionId)`
  - Note: `connectionId` does NOT go into the `useCallback` dependency array (it's a call-time argument, not closed-over state)
  **Acceptance**: TypeScript compiles; calling either function with a third string arg passes it to `apiFetch`

- [x] 4. Update `src/hooks/use-send-prompt.ts` — add `connectionId?` param
  **What**: Add `connectionId?: string` as the sixth parameter to `sendPrompt` (after `model?`). Update the `UseSendPromptResult` interface. Pass `connectionId` as the third argument to both `apiFetch` calls (the `/command` call and the `/prompt` call).
  **Files**: `src/hooks/use-send-prompt.ts`
  **Implementation detail**:
  - Interface: `sendPrompt: (sessionId: string, instanceId: string, text: string, agent?: string, model?: { providerID: string; modelID: string }, connectionId?: string) => Promise<void>`
  - Implementation: `async (sessionId, instanceId, text, agent, model, connectionId) => { ... apiFetch(url, init, connectionId) ... }`
  **Acceptance**: Both `apiFetch` calls inside `sendPrompt` receive `connectionId`

- [x] 5. Update `src/hooks/use-diffs.ts` — add `connectionId?` param
  **What**: Add `connectionId?: string` as the third parameter to `useDiffs`. Pass it to `apiFetch(url, undefined, connectionId)` inside `fetchDiffs`.
  **Files**: `src/hooks/use-diffs.ts`
  **Implementation detail**:
  - `export function useDiffs(sessionId: string, instanceId: string, connectionId?: string): UseDiffsResult`
  - `fetchDiffs` callback: close over `connectionId` from hook params; pass as third arg to `apiFetch`
  - Add `connectionId` to `fetchDiffs`'s `useCallback` dependency array
  **Acceptance**: TypeScript compiles; `apiFetch` inside `fetchDiffs` receives the value

- [x] 6. Update `src/hooks/use-agents.ts` — add `connectionId?` param
  **What**: Add `connectionId?: string` as the second parameter to `useAgents`. Pass it to `apiFetch(url, { signal }, connectionId)` inside `fetchAgents`.
  **Files**: `src/hooks/use-agents.ts`
  **Implementation detail**:
  - `export function useAgents(instanceId: string, connectionId?: string): UseAgentsResult`
  - `fetchAgents` inside `useEffect`: `apiFetch(..., { signal: controller.signal }, connectionId)`
  - Add `connectionId` to the `useEffect` dependency array
  **Acceptance**: TypeScript compiles; re-fetches when `connectionId` changes

- [x] 7. Update `src/hooks/use-models.ts` — add `connectionId?` param
  **What**: Mirror the `useAgents` change exactly.
  **Files**: `src/hooks/use-models.ts`
  **Implementation detail**:
  - `export function useModels(instanceId: string, connectionId?: string): UseModelsResult`
  - `fetchModels` inside `useEffect`: `apiFetch(..., { signal: controller.signal }, connectionId)`
  - Add `connectionId` to the `useEffect` dependency array
  **Acceptance**: TypeScript compiles

- [x] 8. Update `src/hooks/use-terminate-session.ts` — add `connectionId?` param
  **What**: Add `connectionId?: string` as the fourth parameter to `terminateSession`. Update `UseTerminateSessionResult` interface. Pass to `apiFetch`.
  **Files**: `src/hooks/use-terminate-session.ts`
  **Implementation detail**:
  - Interface: `terminateSession: (sessionId: string, instanceId: string, opts?: TerminateSessionOptions, connectionId?: string) => Promise<void>`
  - Implementation: `apiFetch(url, { method: "DELETE" }, connectionId)`
  **Acceptance**: TypeScript compiles

- [x] 9. Update `src/hooks/use-abort-session.ts` — add `connectionId?` param
  **What**: Add `connectionId?: string` as the third parameter to `abortSession`. Update `UseAbortSessionResult` interface. Pass to `apiFetch`.
  **Files**: `src/hooks/use-abort-session.ts`
  **Implementation detail**:
  - Interface: `abortSession: (sessionId: string, instanceId: string, connectionId?: string) => Promise<void>`
  - Implementation: `apiFetch(url, { method: "POST" }, connectionId)`
  - Add `connectionId` to the `useCallback` dependency array
  **Acceptance**: TypeScript compiles

- [x] 10. Update `src/hooks/use-resume-session.ts` — add `connectionId?` param
  **What**: Add `connectionId?: string` as the second parameter to `resumeSession`. Update `UseResumeSessionResult` interface. Pass to `apiFetch`.
  **Files**: `src/hooks/use-resume-session.ts`
  **Implementation detail**:
  - Interface: `resumeSession: (sessionId: string, connectionId?: string) => Promise<ResumeSessionResponse>`
  - Implementation: `apiFetch(url, { method: "POST" }, connectionId)`
  - Add `connectionId` to the `useCallback` dependency array
  **Acceptance**: TypeScript compiles

- [x] 11. Update `src/hooks/use-delete-session.ts` — add `connectionId?` param
  **What**: Add `connectionId?: string` as the third parameter to `deleteSession`. Update `UseDeleteSessionResult` interface. Pass to `apiFetch`.
  **Files**: `src/hooks/use-delete-session.ts`
  **Implementation detail**:
  - Interface: `deleteSession: (sessionId: string, instanceId: string, connectionId?: string) => Promise<void>`
  - Implementation: `apiFetch(url, { method: "DELETE" }, connectionId)`
  **Acceptance**: TypeScript compiles

- [x] 12. Update `src/hooks/use-fork-session.ts` — add `connectionId?` param
  **What**: Add `connectionId?: string` as the third parameter to `forkSession`. Update `UseForkSessionResult` interface. Pass to `apiFetch`.
  **Files**: `src/hooks/use-fork-session.ts`
  **Implementation detail**:
  - Interface: `forkSession: (sessionId: string, opts?: ForkSessionRequest, connectionId?: string) => Promise<ForkSessionResponse>`
  - Implementation: `apiFetch(url, { method: "POST", headers: {...}, body: ... }, connectionId)`
  - Add `connectionId` to the `useCallback` dependency array (it's a parameter, so it closes over nothing; the `useCallback` dep array currently is `[]` — it can remain `[]` since `connectionId` is a call-time argument passed in, not closed over from hook scope. **Clarification**: because `forkSession` is a `useCallback` that takes `connectionId` as a parameter at call time, no change to the dep array is needed)
  **Acceptance**: TypeScript compiles; `apiFetch` third argument is forwarded

---

### Group 3 — `use-session-events.ts`: the most complex change

- [x] 13. Update `src/hooks/use-session-events.ts` — thread `connectionId` through all calls
  **What**: Add `connectionId?: string` as the fifth parameter to `useSessionEvents` (after `suppressAutoScrollRef`). Wire it through every internal API call and the `EventSource` URL.
  **Files**: `src/hooks/use-session-events.ts`
  **Implementation detail — parameter**:
  ```ts
  export function useSessionEvents(
    sessionId: string,
    instanceId: string,
    onAgentSwitch?: (agent: string) => void,
    suppressAutoScrollRef?: React.MutableRefObject<boolean>,
    connectionId?: string,
  ): UseSessionEventsResult
  ```

  **Implementation detail — store `connectionId` in a ref** (so the `connect` callback's closure sees the current value without needing it in its dep array):
  ```ts
  const connectionIdRef = useRef(connectionId);
  useEffect(() => { connectionIdRef.current = connectionId; }, [connectionId]);
  ```

  **Implementation detail — `loadAllMessages`**:
  - `apiFetch(url, undefined, connectionIdRef.current)` (both the main fetch and any fallback)

  **Implementation detail — `loadMessagesSince`**:
  - `apiFetch(url, undefined, connectionIdRef.current)`

  **Implementation detail — `loadInitialMessages`**:
  - `paginationLoadInitial(sessionId, instanceId, connectionIdRef.current)`

  **Implementation detail — `loadSessionStatus`**:
  - `fetchSessionStatus(sessionId, instanceId, connectionIdRef.current)`

  **Implementation detail — `loadOlderMessages`** (the exported function on the return object):
  - `paginationLoadOlder(sessionId, instanceId, connectionIdRef.current)`

  **Implementation detail — SSE `EventSource` in `connect`**:
  - Build the base SSE path: `const ssePath = \`/api/sessions/${encodeURIComponent(sessionId)}/events?instanceId=${encodeURIComponent(instanceId)}\``
  - Call `sseUrl(ssePath, connectionIdRef.current)` to resolve the remote base URL
  - If `connectionIdRef.current` is set (non-local), read the token: `const sseToken = connectionRegistry.getTokenForConnection(connectionIdRef.current);`
  - Append `?token=` if present: `const fullSseUrl = sseToken ? \`${resolvedUrl}&token=${encodeURIComponent(sseToken)}\` : resolvedUrl;`
  - Pass `fullSseUrl` to `new EventSource(fullSseUrl)`
  - Import `connectionRegistry` from `@/lib/fleet-connection-registry` at the top of the file

  **Acceptance**:
  - TypeScript compiles with no errors
  - `loadAllMessages`, `loadMessagesSince`, `loadInitialMessages`, `loadSessionStatus`, `loadOlderMessages` all pass `connectionId` to their respective `apiFetch` / hook calls
  - The `EventSource` URL includes `?token=<value>` when `connectionId` is a remote connection that has a token

---

### Group 4 — Components

- [x] 14. Update `src/components/session/fork-session-dialog.tsx` — accept and thread `connectionId`
  **What**: Add `connectionId?: string` to `ForkSessionDialogProps`. Pass it to `forkSession(sourceSessionId, opts, connectionId)`. Include it in `router.push` if present.
  **Files**: `src/components/session/fork-session-dialog.tsx`
  **Implementation detail**:
  - Add to interface: `connectionId?: string;`
  - Destructure in component: `{ sourceSessionId, sourceSessionTitle, open, onOpenChange, connectionId }`
  - In `handleSubmit`, change the `forkSession` call:
    ```ts
    const { instanceId, session } = await forkSession(
      sourceSessionId,
      { title: title.trim() || undefined },
      connectionId
    );
    ```
  - In `router.push`, append `connectionId` if present:
    ```ts
    const url = `/sessions/${encodeURIComponent(session.id)}?instanceId=${encodeURIComponent(instanceId)}${connectionId ? `&connectionId=${encodeURIComponent(connectionId)}` : ""}`;
    router.push(url);
    ```
  **Acceptance**: TypeScript compiles; `connectionId` prop flows end-to-end

- [x] 15. Update `src/components/session/new-session-dialog.tsx` — include `connectionId` in `router.push`
  **What**: At line 184–186, the `router.push` call omits `connectionId`. Add it.
  **Files**: `src/components/session/new-session-dialog.tsx`
  **Implementation detail**:
  - The local variable `connectionId` is already in scope at line 171 as `const connectionId = isMultiServer ? selectedConnectionId : undefined;`
  - Change `router.push(...)` to:
    ```ts
    router.push(
      `/sessions/${encodeURIComponent(session.id)}?instanceId=${encodeURIComponent(instanceId)}${connectionId ? `&connectionId=${encodeURIComponent(connectionId)}` : ""}`
    );
    ```
  **Acceptance**: After creating a remote session, the URL includes `?instanceId=...&connectionId=...`

---

### Group 5 — Session detail page: the integration point

- [x] 16. Update `src/app/sessions/[id]/page.tsx` — read `connectionId` and wire everything
  **What**: Read `connectionId` from `searchParams`, pass it to every hook and call site on the page.
  **Files**: `src/app/sessions/[id]/page.tsx`

  **Step 16a — read from searchParams** (after line 57):
  ```ts
  const connectionId = searchParams.get("connectionId") ?? undefined;
  ```

  **Step 16b — `useSessionEvents` call** (line 81–86): add `connectionId` as fifth argument:
  ```ts
  useSessionEvents(sessionId, instanceId, setSelectedAgent, suppressAutoScrollRef, connectionId)
  ```

  **Step 16c — `useAgents` call** (line 68): add `connectionId`:
  ```ts
  const { agents } = useAgents(instanceId, connectionId);
  ```

  **Step 16d — `useModels` call** (line 70): add `connectionId`:
  ```ts
  const { providers } = useModels(instanceId, connectionId);
  ```

  **Step 16e — `useDiffs` call** (line 92): add `connectionId`:
  ```ts
  const { diffs, ... } = useDiffs(sessionId, instanceId, connectionId);
  ```

  **Step 16f — `fetchMetadata` callback** (line 163): add `connectionId` as third arg to `apiFetch`:
  ```ts
  apiFetch(url, undefined, connectionId)
  ```
  Also add `connectionId` to the `useCallback` dependency array at line 187.

  **Step 16g — `handleSend`** (line 266): pass `connectionId` as sixth arg to `sendPrompt`:
  ```ts
  await sendPrompt(sessionId, instanceId, text, agent, model ?? undefined, connectionId);
  ```
  Also add `connectionId` to `handleSend`'s `useCallback` dep array.

  **Step 16h — `handleStop`** (line 277): pass `connectionId` as fourth arg:
  ```ts
  await terminateSession(sessionId, instanceId, undefined, connectionId);
  ```
  Also add `connectionId` to `handleStop`'s `useCallback` dep array.

  **Step 16i — `abortSession` call in the keybinding effect** (line 134):
  ```ts
  abortSession(sessionId, instanceId, connectionId)
  ```
  Also add `connectionId` to that `useEffect`'s dep array (line 142).

  **Step 16j — `handleAbort`** (line 292): pass `connectionId`:
  ```ts
  await abortSession(sessionId, instanceId, connectionId);
  ```
  Also add `connectionId` to `handleAbort`'s `useCallback` dep array.

  **Step 16k — `handleResume`** (line 310–313): pass `connectionId` to both `resumeSession` and `router.replace`:
  ```ts
  const result = await resumeSession(sessionId, connectionId);
  router.replace(
    `/sessions/${encodeURIComponent(result.session.id)}?instanceId=${encodeURIComponent(result.instanceId)}${connectionId ? `&connectionId=${encodeURIComponent(connectionId)}` : ""}`
  );
  ```
  Also add `connectionId` to `handleResume`'s `useCallback` dep array.

  **Step 16l — `handlePermanentDelete`** (line 321): pass `connectionId`:
  ```ts
  await permanentDelete(sessionId, instanceId, connectionId);
  ```
  Also add `connectionId` to `handlePermanentDelete`'s `useCallback` dep array.

  **Step 16m — `ForkSessionDialog`** (line 727–732): add `connectionId` prop:
  ```tsx
  <ForkSessionDialog
    sourceSessionId={sessionId}
    sourceSessionTitle={metadata.title}
    open={showForkDialog}
    onOpenChange={setShowForkDialog}
    connectionId={connectionId}
  />
  ```

  **Step 16n — ancestor session `Link` hrefs** (lines 463–479): append `connectionId` when present to every ancestor link and the back-arrow link, so navigating to an ancestor session preserves the remote context:
  ```ts
  // Back-arrow href:
  `/sessions/${encodeURIComponent(parent.opencodeSessionId)}?instanceId=${encodeURIComponent(parent.instanceId)}${connectionId ? `&connectionId=${encodeURIComponent(connectionId)}` : ""}`

  // Each ancestor Link href:
  `/sessions/${encodeURIComponent(ancestor.opencodeSessionId)}?instanceId=${encodeURIComponent(ancestor.instanceId)}${connectionId ? `&connectionId=${encodeURIComponent(connectionId)}` : ""}`
  ```

  **Acceptance**: TypeScript compiles; every hook and `apiFetch` call on the page receives `connectionId`

---

### Group 6 — Tests

- [x] 17. Update `src/hooks/__tests__/use-fork-session.test.ts` — cover `connectionId` forwarding
  **What**: The existing test at line 210–213 asserts `apiFetch` is called with exactly two arguments. This will now fail because `forkSession` accepts an optional third arg. Update the assertions to use `expect.objectContaining` for the init arg (already done), and add a new test verifying that when a `connectionId` is passed as the third argument to `forkSession`, it is forwarded as the third argument to `apiFetch`.
  **Files**: `src/hooks/__tests__/use-fork-session.test.ts`
  **Implementation detail**:
  - The existing "calls apiFetch with the correct URL and method" test at line 202 should remain valid as-is — adding an optional third param to `forkSession` doesn't break the existing call pattern; the test just verifies two args. However, a new test should be added:
    ```ts
    it("forwards connectionId as third argument to apiFetch", async () => {
      mockApiFetch.mockResolvedValue(makeOkResponse(makeForkResponse()));
      const { result } = renderHook(() => useForkSession());
      await act(async () => {
        await result.current.forkSession("db-sess-1", undefined, "remote-server");
      });
      expect(mockApiFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Object),
        "remote-server"
      );
    });
    ```
  **Acceptance**: `npx vitest run src/hooks/__tests__/use-fork-session.test.ts` passes

- [x] 18. Update `src/lib/__tests__/session-status-utils.test.ts` — cover `connectionId` forwarding
  **What**: Add one new test verifying that when `connectionId` is passed to `fetchSessionStatus`, it is forwarded as the third argument to `apiFetch`.
  **Files**: `src/lib/__tests__/session-status-utils.test.ts`
  **Implementation detail**:
  ```ts
  it("ForwardsConnectionIdToApiFetch", async () => {
    mockApiFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ status: "busy" }),
    });

    await fetchSessionStatus("sess-1", "inst-abc", "remote-conn");

    expect(mockApiFetch).toHaveBeenCalledWith(
      "/api/sessions/sess-1/status?instanceId=inst-abc",
      undefined,
      "remote-conn"
    );
  });
  ```
  **Acceptance**: `npx vitest run src/lib/__tests__/session-status-utils.test.ts` passes

---

### Group 7 — `connectionId` field on `SessionListItem` and all navigation surfaces

These tasks address the root cause of Issue 1: `connectionId` is a **client-side concept** (it lives in `FleetConnectionRegistry` in localStorage) and can never come from the server. The field must be formally added to the type and then stamped onto items after each per-connection fetch.

- [x] 19. Add `connectionId?: string` to `SessionListItem` in `src/lib/api-types.ts`
  **What**: Add the optional field to the interface so that the type cast in `page.tsx` (lines 129 and 150) and all downstream consumers are formally typed rather than relying on an unsafe cast.
  **Files**: `src/lib/api-types.ts`
  **Implementation detail**:
  - Inside `SessionListItem`, after the `branch` field (line 103), add:
    ```ts
    /**
     * Client-side connection identifier — set after fetching, not from the server.
     * Undefined means "local". Matches a key in FleetConnectionRegistry.
     */
    connectionId?: string;
    ```
  - This is an optional field; the server never populates it, so existing code that doesn't set it continues to work.
  **Acceptance**: TypeScript compiles; the `as SessionListItem & { connectionId?: string }` casts in `page.tsx` can be simplified to just `SessionListItem`

- [x] 20. Extend `src/hooks/use-sessions.ts` to fetch from all registered connections and stamp `connectionId`
  **What**: `useSessions` currently fetches only from localhost with no `connectionId`. To support remote sessions, it must loop over all registered Fleet connections (from `connectionRegistry`), fetch `/api/sessions` via `apiFetch(path, undefined, conn.id)` for each, stamp `connectionId` on each returned item, and merge all results into one flat array.
  **Files**: `src/hooks/use-sessions.ts`
  **Implementation detail**:
  - Import `connectionRegistry` from `@/lib/fleet-connection-registry`
  - Replace the single `apiFetch("/api/sessions")` call with a `Promise.allSettled` over all connections:
    ```ts
    const connections = connectionRegistry.getConnections();
    const results = await Promise.allSettled(
      connections.map(async (conn) => {
        const response = await apiFetch("/api/sessions", undefined, conn.isLocal ? undefined : conn.id);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const items = (await response.json()) as SessionListItem[];
        // Stamp connectionId on every item — undefined for local (matches existing behaviour)
        return items.map((item): SessionListItem => ({
          ...item,
          connectionId: conn.isLocal ? undefined : conn.id,
        }));
      })
    );
    // Flatten fulfilled results, silently drop failed connections
    const merged: SessionListItem[] = [];
    for (const result of results) {
      if (result.status === "fulfilled") merged.push(...result.value);
    }
    ```
  - Continue using `sessionsChanged` to compare against `prev` before calling `setSessions`
  - The `pollIntervalMs` contract is unchanged; the interval calls `fetchSessions` as before
  - **Error handling**: if ALL connections fail, set the `error` state as before; if only some fail, prefer partial success (no error state)
  **Acceptance**:
  - TypeScript compiles
  - Sessions from remote connections carry `connectionId === conn.id`
  - Sessions from local carry `connectionId === undefined`
  - A failed remote connection does not prevent local sessions from loading

- [x] 21. Update `src/components/fleet/live-session-card.tsx` — include `connectionId` in Link href
  **What**: Line 75 builds the navigation URL without `connectionId`. Since `SessionListItem` now formally has `connectionId?: string`, this is a straightforward addition.
  **Files**: `src/components/fleet/live-session-card.tsx`
  **Implementation detail**:
  - At line 43, `connectionId` is already destructured from `item` implicitly — add it explicitly:
    ```ts
    const { instanceId, session, isolationStrategy, activityStatus, lifecycleStatus, connectionId } = item;
    ```
  - Change line 75:
    ```tsx
    <Link href={`/sessions/${encodeURIComponent(session.id)}?instanceId=${encodeURIComponent(instanceId)}${connectionId ? `&connectionId=${encodeURIComponent(connectionId)}` : ""}`}>
    ```
  **Acceptance**: Clicking a remote session card navigates to a URL with `&connectionId=<id>`

- [x] 22. Update `src/components/layout/sidebar-session-item.tsx` — thread `connectionId` through all navigation surfaces
  **What**: Three places in this file navigate to a session URL without `connectionId`:
  1. The `<Link>` href at line 149
  2. `handleResume`'s `router.push` at line 124–126
  3. `ForkSessionDialog` at lines 262–267 (no `connectionId` prop passed)
  **Files**: `src/components/layout/sidebar-session-item.tsx`
  **Implementation detail**:
  - At line 37, destructure `connectionId` from `item`:
    ```ts
    const { instanceId, session, activityStatus, lifecycleStatus, connectionId } = item;
    ```
  - **Link href** (line 149): append `connectionId` if present:
    ```tsx
    href={`/sessions/${encodeURIComponent(session.id)}?instanceId=${encodeURIComponent(instanceId)}${connectionId ? `&connectionId=${encodeURIComponent(connectionId)}` : ""}`}
    ```
  - **`handleResume`** (line 124–126): pass `connectionId` to both `resumeSession` and `router.push`:
    ```ts
    const result = await resumeSession(session.id, connectionId);
    router.push(
      `/sessions/${encodeURIComponent(result.session.id)}?instanceId=${encodeURIComponent(result.instanceId)}${connectionId ? `&connectionId=${encodeURIComponent(connectionId)}` : ""}`
    );
    ```
    Also add `connectionId` to the `useCallback` dep array (line 131)
  - **`ForkSessionDialog`** (lines 262–267): add the prop:
    ```tsx
    <ForkSessionDialog
      sourceSessionId={item.dbId ?? item.session.id}
      sourceSessionTitle={title}
      open={showForkDialog}
      onOpenChange={setShowForkDialog}
      connectionId={connectionId}
    />
    ```
  **Acceptance**: TypeScript compiles; all three navigation paths include `connectionId` when present

- [x] 23. Update `src/components/session/activity-stream-v1.tsx` — include `connectionId` in child session URL
  **What**: `TaskDelegationItem` (line 84) builds a child session URL at line 106–108. It reads `parentInstanceId` from `useSearchParams` but does not read `connectionId`. Since the child session runs on the same Fleet server as the parent, it should inherit the parent's `connectionId`.
  **Files**: `src/components/session/activity-stream-v1.tsx`
  **Implementation detail**:
  - In `TaskDelegationItem`, after line 93 where `parentInstanceId` is read, also read `connectionId`:
    ```ts
    const connectionId = searchParams.get("connectionId");
    ```
  - Change the `childUrl` expression at line 106–108 to append `connectionId` if present:
    ```ts
    const childUrl = childOpencodeSessionId && parentInstanceId
      ? `/sessions/${encodeURIComponent(childOpencodeSessionId)}?instanceId=${encodeURIComponent(parentInstanceId)}${currentSessionId ? `&parentSessionId=${encodeURIComponent(currentSessionId)}` : ""}${connectionId ? `&connectionId=${encodeURIComponent(connectionId)}` : ""}`
      : null;
    ```
  **Acceptance**: TypeScript compiles; navigating to a child session from a remote parent's activity stream preserves `connectionId` in the URL

- [x] 24. Update `src/app/page.tsx` — include `connectionId` in `handleResume` router.push
  **What**: `handleResume` at line 81–91 calls `resumeSession(sessionId)` and then pushes to `/sessions/...?instanceId=...` without `connectionId`. The `sessionId` argument is a plain string — `connectionId` must be fetched from the item or passed alongside `sessionId`. The simplest fix is to change the `onResume` callback signature on `LiveSessionCard` to receive `connectionId` alongside `sessionId`, then thread it through.
  **Files**: `src/app/page.tsx`, `src/components/fleet/live-session-card.tsx`
  **Implementation detail**:
  - **`live-session-card.tsx`** — change `onResume` prop type from `(sessionId: string) => void` to `(sessionId: string, connectionId?: string) => void`; call it as `onResume(session.id, connectionId)` wherever it is invoked in the card
  - **`page.tsx`** — update `handleResume` signature to `(sessionId: string, connectionId?: string)` and include `connectionId` in both the `resumeSession` call and `router.push`:
    ```ts
    const handleResume = useCallback(async (sessionId: string, connectionId?: string) => {
      try {
        const result = await resumeSession(sessionId, connectionId);
        router.push(
          `/sessions/${encodeURIComponent(result.session.id)}?instanceId=${encodeURIComponent(result.instanceId)}${connectionId ? `&connectionId=${encodeURIComponent(connectionId)}` : ""}`
        );
      } catch {
        refetch();
      }
    }, [resumeSession, router, refetch]);
    ```
  **Acceptance**: TypeScript compiles; resuming a remote session from the fleet home page navigates to a URL with `&connectionId=<id>`

---

## Implementation Order

The dependency chain is bottom-up:
1. `proxy.ts` (standalone — no JS dependencies)
2. `api-types.ts` — add `connectionId?` field to `SessionListItem` (must come before all consumers)
3. `session-status-utils.ts` (depends only on `apiFetch`)
4. `use-message-pagination.ts` (depends only on `apiFetch`)
5. `use-sessions.ts` — multi-connection fetch + stamp `connectionId` (depends on `api-types.ts` change)
6. `use-send-prompt.ts`, `use-diffs.ts`, `use-agents.ts`, `use-models.ts`, `use-terminate-session.ts`, `use-abort-session.ts`, `use-resume-session.ts`, `use-delete-session.ts`, `use-fork-session.ts` (all depend only on `apiFetch` — can be done in parallel)
7. `use-session-events.ts` (depends on `session-status-utils.ts` and `use-message-pagination.ts`)
8. `fork-session-dialog.tsx` (depends on `use-fork-session.ts`)
9. `new-session-dialog.tsx` (standalone URL fix)
10. `live-session-card.tsx` — `connectionId` in Link href + updated `onResume` signature (depends on `api-types.ts`)
11. `sidebar-session-item.tsx` — thread `connectionId` through Link, resume push, ForkSessionDialog (depends on `api-types.ts` + `fork-session-dialog.tsx`)
12. `activity-stream-v1.tsx` — `connectionId` in child session URL (standalone URL fix)
13. `page.tsx` — fleet home page `handleResume` (depends on `live-session-card.tsx` onResume signature)
14. Session detail `page.tsx` (`src/app/sessions/[id]/page.tsx`) — depends on everything above
15. Tests (depends on implementation being final)

---

## Verification

- [x] `npx vitest run` — all tests pass, no regressions
- [x] TypeScript: `npx tsc --noEmit` exits 0
- [ ] Manual smoke test: create a new session on a remote Fleet connection and verify:
  - URL includes `?instanceId=...&connectionId=...`
  - Session detail page loads metadata from the remote server (not 404/localhost)
  - SSE connects and events arrive (no 401 in network tab)
  - Sending a prompt reaches the remote server
  - Abort, stop, fork all route correctly
- [ ] Existing local sessions unaffected (no `connectionId` in URL → all calls go to localhost as before)
