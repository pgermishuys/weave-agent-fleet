# Session Loss Recovery — Lazy Instance Respawn

## TL;DR
> **Summary**: After a fleet restart, sessions with dead `instance_id` references return 404 on all detail/interaction routes. Fix by introducing a `getOrRecoverClient()` function that lazily spawns a new instance for the session's directory when `getClientForInstance()` would fail, then updates the session's `instance_id`.
> **Estimated Effort**: Medium

## Context
### Original Request
After fleet restart, all opencode processes die but sessions in SQLite still hold stale `instance_id` references. Recovery (`recoverInstances()`) marks everything as `stopped` but leaves the in-memory `instances` Map empty. When a user clicks any session, `getClientForInstance(stale-uuid)` fails with `undefined`, returning 404. Sessions are permanently broken until manual restart.

### Key Findings
1. **`spawnInstance(directory)` already handles deduplication** — the `directoryToInstanceId` Map and `inflightSpawns` Map prevent duplicate concurrent spawns for the same directory. This is the core building block.
2. **`updateSessionForResume()` already exists** — it atomically updates `instance_id`, sets status to `active`, and clears `stopped_at`. This is exactly the DB operation needed.
3. **The `/api/sessions/[id]/resume` route already implements the full recovery flow** — it looks up the DB session, finds the workspace directory, calls `spawnInstance()`, verifies the SDK session, and calls `updateSessionForResume()`. This is the pattern to generalize.
4. **13 call sites use `getClientForInstance()`** across session routes (GET detail, messages, diffs, status, events, prompt, command, abort) and instance routes (models, agents, commands, find/files). Plus internal uses in `instance-event-hub.ts` and `callback-service.ts`.
5. **6 call sites use `getInstance()` directly** in session routes (status, events, files, files/[...path]×4) — these need the `ManagedInstance` object (for `directory`), not just the client.
6. **Concurrent request handling is already solved** — `spawnInstance()` coalesces concurrent spawns via `inflightSpawns` Map. Multiple requests for the same dead session will all await the same spawn promise.
7. **The resume route already validates**: directory is in allowed roots, directory exists on disk, SDK session exists in the new instance. The lazy recovery should apply the same guards.

## Objectives
### Core Objective
Make session detail/interaction routes transparently recover from stale `instance_id` references by lazily spawning (or reusing) a live instance for the session's directory.

### Deliverables
- [ ] New `ensureInstanceForSession()` function in `opencode-client.ts` that encapsulates lazy recovery logic
- [ ] New `updateSessionInstanceId()` DB function (lighter than `updateSessionForResume` — just updates FK without changing status to active)
- [ ] All session routes that use `getClientForInstance()` or `getInstance()` updated to use the recovery path
- [ ] Unit tests for the new recovery function
- [ ] Unit tests for the new DB function

### Definition of Done
- [ ] After fleet restart, clicking a previously-active session in the sidebar loads its detail page without 404
- [ ] Multiple sessions pointing to the same directory reuse a single respawned instance
- [ ] Concurrent requests for the same dead session don't spawn duplicate instances
- [ ] Terminal sessions (completed, error) are NOT auto-recovered (they show historical data from DB)
- [ ] All existing tests pass: `npx vitest run`

### Guardrails (Must NOT)
- Must NOT eagerly spawn instances on startup (the whole point is lazy recovery)
- Must NOT change the `recoverInstances()` behavior — it correctly marks everything stopped
- Must NOT break the existing `/api/sessions/[id]/resume` route — that's user-initiated resume with different semantics
- Must NOT auto-recover sessions whose directory no longer exists or is outside allowed roots
- Must NOT change the sidebar listing (`GET /api/sessions`) — it already works with DB-only data

## TODOs

- [x] 1. Add `updateSessionInstanceId()` to DB repository
  **What**: Add a lightweight function that only updates the `instance_id` column on a session row without changing status or other fields. Unlike `updateSessionForResume()` which sets status to `active` (appropriate for user-initiated resume), lazy recovery should preserve the current status — the session may be `stopped`, `disconnected`, etc. and should stay that way until the user explicitly resumes or the system detects live activity.
  **Files**: `src/lib/server/db-repository.ts`
  **Acceptance**: Function exists, updates only `instance_id` column, unit test passes.

- [x] 2. Create `ensureInstanceForSession()` in `opencode-client.ts`
  **What**: Add an async function that:
  1. Tries `getInstance(instanceId)` — if found and running, returns `{ instance, client }`.
  2. If not found or dead, looks up the session in DB via `getSession(sessionId)` to get `directory` (from the session's `directory` column or workspace lookup).
  3. Calls `spawnInstance(directory)` which handles directory dedup and concurrent spawn coalescing.
  4. Calls `updateSessionInstanceId(dbSession.id, newInstance.id)` to fix the stale FK.
  5. Returns `{ instance, client: newInstance.client }`.
  
  Signature: `async function ensureInstanceForSession(instanceId: string, sessionId: string): Promise<{ instance: ManagedInstance; client: OpencodeClient }>`.
  
  Edge cases to handle:
  - **Directory doesn't exist**: throw (route handler returns 404/400)
  - **Directory outside allowed roots**: throw (security)
  - **DB session not found**: throw (route handler returns 404)
  - **Concurrent requests**: `spawnInstance()` already coalesces — safe to call from multiple handlers simultaneously
  - **Instance routes (models, agents, commands, find/files)**: These don't have a `sessionId` — they need a separate helper or fallback. See TODO 4.
  
  **Files**: `src/lib/server/opencode-client.ts`
  **Acceptance**: Function handles happy path (spawn + update) and error cases (missing session, bad directory). All existing `getClientForInstance` tests still pass.

- [x] 3. Update session detail/interaction routes to use `ensureInstanceForSession()`
  **What**: Replace the `getClientForInstance(instanceId)` try/catch blocks in all session routes with calls to `ensureInstanceForSession(instanceId, sessionId)`. The routes already have both `instanceId` and `sessionId` available.
  
  Routes to update (all under `src/app/api/sessions/[id]/`):
  - `route.ts` — GET handler (session detail). Uses `getClientForInstance`. Replace with `ensureInstanceForSession`.
  - `messages/route.ts` — GET handler. Uses `getClientForInstance`. Replace.
  - `diffs/route.ts` — GET handler. Uses `getClientForInstance`. Replace.
  - `status/route.ts` — GET handler. Uses both `getInstance` and `getClientForInstance`. Replace both with `ensureInstanceForSession`.
  - `events/route.ts` — GET handler (SSE). Uses `getInstance` directly. Replace with `ensureInstanceForSession` and use `instance` for the `addListener` call.
  - `prompt/route.ts` — POST handler. Uses `getClientForInstance`. Replace.
  - `command/route.ts` — POST handler. Uses `getClientForInstance`. Replace.
  - `abort/route.ts` — POST handler. Uses `getClientForInstance`. Replace.
  - `files/route.ts` — GET handler. Uses `getInstance` for `instance.directory`. Replace with `ensureInstanceForSession`.
  - `files/[...path]/route.ts` — GET, POST, DELETE, PATCH handlers. All use `getInstance` for `instance.directory`. Replace all four with `ensureInstanceForSession`.
  
  **Important**: The `DELETE` handler in `route.ts` (terminate session) should NOT use recovery — if the instance is dead and the user is terminating, just let it proceed without spawning. Keep existing `getClientForInstance` in the DELETE handler's abort step (which is already wrapped in try/catch and is best-effort).
  
  **Files**: `src/app/api/sessions/[id]/route.ts`, `src/app/api/sessions/[id]/messages/route.ts`, `src/app/api/sessions/[id]/diffs/route.ts`, `src/app/api/sessions/[id]/status/route.ts`, `src/app/api/sessions/[id]/events/route.ts`, `src/app/api/sessions/[id]/prompt/route.ts`, `src/app/api/sessions/[id]/command/route.ts`, `src/app/api/sessions/[id]/abort/route.ts`, `src/app/api/sessions/[id]/files/route.ts`, `src/app/api/sessions/[id]/files/[...path]/route.ts`
  **Acceptance**: After fleet restart, all session detail routes return data instead of 404.

- [x] 4. Update instance-scoped routes with DB-based directory fallback
  **What**: The instance routes (`/api/instances/[id]/models`, `agents`, `commands`, `find/files`) receive only an `instanceId` — they have no `sessionId`. These routes cannot use `ensureInstanceForSession()` directly. However, these routes are always called in the context of a session (the frontend knows which session it's viewing). Two options:
  
  **Option A (Recommended)**: Add an `ensureInstanceById()` function that:
  1. Tries `getInstance(instanceId)` — returns if found and running.
  2. If not found, queries DB for the instance record (`getInstance` from db-repository) to get the `directory`.
  3. Calls `spawnInstance(directory)` to get/reuse a live instance.
  4. Returns the new instance (caller must handle the fact that instanceId changed).
  
  Apply this to all 4 instance routes. The frontend will need to handle the fact that the returned data came from a new instance (which is fine — models/agents/commands are instance-level, not session-level).
  
  **Option B (Simpler)**: Have the frontend pass `sessionId` as a query parameter on these routes too, so `ensureInstanceForSession()` can be used. This requires a frontend change.
  
  **Decision**: Go with Option A — purely server-side fix, no frontend changes needed.
  
  **Files**: `src/lib/server/opencode-client.ts` (add `ensureInstanceById()`), `src/app/api/instances/[id]/models/route.ts`, `src/app/api/instances/[id]/agents/route.ts`, `src/app/api/instances/[id]/commands/route.ts`, `src/app/api/instances/[id]/find/files/route.ts`
  **Acceptance**: Instance routes recover gracefully when the instance is dead.

- [x] 5. Add a `getInstanceById()` DB query to db-repository
  **What**: Verify `getInstance(id)` in `db-repository.ts` already exists (it does — line 150). This is needed by `ensureInstanceById()` to look up the directory for a dead instance. No new code needed, but verify it's exported and returns the `directory` field.
  **Files**: `src/lib/server/db-repository.ts`
  **Acceptance**: `getInstance(id)` returns a `DbInstance` with `directory` field — already done, just verify.

- [x] 6. Handle internal consumers: `instance-event-hub.ts` and `callback-service.ts`
  **What**: These internal modules also use `getClientForInstance()` but in different contexts:
  
  - **`instance-event-hub.ts`**: Called from `processEventStream()` to reconnect to an instance's event stream. If the instance is dead, the event hub should NOT auto-spawn — it should let the hub's reconnection loop time out and the health check system handle death detection. **No change needed.**
  
  - **`callback-service.ts`**: Called from `deliverCallbacks()` to get the child session's client for diff fetching. If the child's instance is dead, the diff fetch already falls back to `"(diff unavailable)"`. The target instance (conductor) check also guards correctly. **No change needed.**
  
  **Decision**: No changes to internal consumers. They have their own error handling that is appropriate for their contexts.
  **Acceptance**: Verify no regressions in existing `instance-event-hub.test.ts` and callback tests.

- [x] 7. Write unit tests for `ensureInstanceForSession()`
  **What**: Test the following scenarios:
  1. **Instance exists and running** → returns immediately without DB lookup
  2. **Instance missing, session found in DB** → spawns new instance, updates session FK, returns client
  3. **Instance missing, session not in DB** → throws error
  4. **Instance missing, directory doesn't exist** → throws error
  5. **Multiple concurrent calls for same session** → coalesced into single spawn (via `spawnInstance` dedup)
  6. **Multiple sessions with same directory, different dead instanceIds** → single spawn, both sessions get updated
  
  Follow existing test patterns: mock `process-manager` and `db-repository` modules.
  
  **Files**: `src/lib/server/__tests__/opencode-client.test.ts` (new file)
  **Acceptance**: All 6 scenarios pass.

- [x] 8. Write unit tests for `updateSessionInstanceId()`
  **What**: Test that the function:
  1. Updates only `instance_id` column
  2. Does not change `status`, `stopped_at`, `activity_status`, or `lifecycle_status`
  3. Handles non-existent session ID gracefully (no throw)
  
  Add to existing `db-repository.test.ts` alongside the `updateSessionForResume` tests.
  
  **Files**: `src/lib/server/__tests__/db-repository.test.ts`
  **Acceptance**: Tests pass.

- [x] 9. Update existing route tests for recovery behavior
  **What**: Update tests in `src/app/api/sessions/[id]/__tests__/route.test.ts`, `messages/__tests__/route.test.ts`, `status/__tests__/route.test.ts`, and `command/__tests__/route.test.ts` to mock the new `ensureInstanceForSession` function and verify that routes call it instead of `getClientForInstance` directly.
  
  Add a test case to each route test verifying that when the instance is dead, the route successfully recovers by calling `ensureInstanceForSession` (which internally spawns + updates).
  
  **Files**: `src/app/api/sessions/[id]/__tests__/route.test.ts`, `src/app/api/sessions/[id]/messages/__tests__/route.test.ts`, `src/app/api/sessions/[id]/status/__tests__/route.test.ts`, `src/app/api/sessions/[id]/command/__tests__/route.test.ts`, `src/app/api/sessions/[id]/diffs/__tests__/route.test.ts`
  **Acceptance**: All existing tests pass with updated mocks, new recovery test cases pass.

- [ ] 10. Verify full test suite and release build
  **Acceptance**: `npx vitest run` passes. Release build (`npm run build`) succeeds.

## Implementation Order

```
1. updateSessionInstanceId (DB)           — independent, no dependencies
5. Verify getInstanceById (DB)            — verification only
↓
2. ensureInstanceForSession (core logic)  — depends on 1
4. ensureInstanceById (variant)           — depends on 2's pattern
↓
3. Update session routes                  — depends on 2
4b. Update instance routes                — depends on 4
6. Verify internal consumers              — independent analysis
↓
7-9. Tests                                — depends on 2-4
↓
10. Full verification                     — depends on all above
```

## Design Details

### `ensureInstanceForSession()` — Detailed Pseudocode

```typescript
export async function ensureInstanceForSession(
  instanceId: string,
  sessionId: string
): Promise<{ instance: ManagedInstance; client: OpencodeClient }> {
  // Fast path: instance is alive in memory
  const existing = getInstance(instanceId);
  if (existing && existing.status === "running") {
    return { instance: existing, client: existing.client };
  }

  // Slow path: need to recover
  log.info("opencode-client", "Instance not available — attempting lazy recovery", {
    instanceId, sessionId,
  });

  // Look up session in DB to find directory
  const dbSession = getSession(sessionId) ?? getSessionByOpencodeId(sessionId);
  if (!dbSession) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  const directory = dbSession.directory;

  // Spawn or reuse instance for this directory
  // spawnInstance handles: directory dedup, concurrent coalescing, port allocation
  const newInstance = await spawnInstance(directory);

  // Update the session's instance_id FK to point to the new instance
  if (newInstance.id !== instanceId) {
    try {
      updateSessionInstanceId(dbSession.id, newInstance.id);
    } catch (err) {
      log.warn("opencode-client", "Failed to update session instance_id in DB", {
        sessionId: dbSession.id, newInstanceId: newInstance.id, err,
      });
      // Non-fatal — the session will still work, just the DB FK is stale
    }
  }

  return { instance: newInstance, client: newInstance.client };
}
```

### Route Migration Pattern

Before (current):
```typescript
let client;
try {
  client = getClientForInstance(instanceId);
} catch (err) {
  return NextResponse.json({ error: "Instance not found or unavailable" }, { status: 404 });
}
```

After (with recovery):
```typescript
let client;
let instance;
try {
  ({ client, instance } = await ensureInstanceForSession(instanceId, sessionId));
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  log.warn("route", "Failed to ensure instance for session", { sessionId, instanceId, err: msg });
  return NextResponse.json({ error: "Instance not found or unavailable" }, { status: 404 });
}
```

### Why NOT use the existing `/resume` route internally

The `/resume` route has user-facing semantics: it checks resumable statuses, validates workspace, verifies the SDK session exists, and sets status to `active`. Lazy recovery is different:
- It should work for any non-terminal session status
- It doesn't need to verify the SDK session (the route handler will do that)
- It should NOT change the session status (that's the job of the SSE watcher or the user)
- It just needs to ensure a live instance exists and the FK is correct

## Verification
- [ ] All tests pass: `npx vitest run`
- [ ] Release build succeeds: `npm run build`
- [ ] No regressions in session creation flow
- [ ] No regressions in session listing (sidebar)
- [ ] No regressions in session termination/deletion
- [ ] Manual test: restart fleet → click a previously-active session → loads without 404
