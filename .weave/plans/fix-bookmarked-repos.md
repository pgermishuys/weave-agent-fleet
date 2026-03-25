# Fix Bookmarked Repos: Cross-Instance Sync & Error Handling

## TL;DR
> **Summary**: Fix two bugs in `useBookmarkedRepos` — instances don't share state (sidebar doesn't update when dialog adds a repo), and `syncToServer` silently swallows errors with no UI feedback.
> **Estimated Effort**: Short

## Context
### Original Request
Fix two bugs: (1) `GitHubPanel` and `AddRepoDialog` each call `useBookmarkedRepos()` but get independent `useState` copies — adding a repo in the dialog never updates the sidebar. (2) `syncToServer` is fire-and-forget (`void`) with no error propagation to the UI.

### Key Findings
- **The EventTarget broadcast pattern already exists** in `src/hooks/use-repositories.ts` (lines 27-41). It uses a module-level `EventTarget` singleton (`reposBus`), a `broadcastReposUpdate()` helper, and a `useEffect` listener in the hook. This is the proven pattern to replicate.
- **`useBookmarkedRepos`** (105 lines) has:
  - `useState<BookmarkedRepo[]>([])` — local per-instance, root cause of Bug 1.
  - `syncToServer` — catches errors but only `console.error`s, no broadcast to other instances, no error state for consumers.
  - `addRepo` / `removeRepo` call `setRepos` (local only) then `void syncToServer(next)` — fire-and-forget.
  - Migration logic from localStorage (lines 49-74) — must be preserved.
- **No existing tests** for the `useBookmarkedRepos` hook (only `bookmarks.test.ts` for the API route, which is fine and unaffected).
- **Consumers** (`github-panel.tsx` and `add-repo-dialog.tsx`) don't need structural changes — they already destructure the hook return. They just need access to the new `error` field for optional error display.
- The hook uses raw `fetch()` instead of the codebase's `apiFetch()` wrapper — should be aligned for consistency.

## Objectives
### Core Objective
Make all mounted instances of `useBookmarkedRepos` share a single logical state via the EventTarget broadcast pattern, and surface sync errors to consumers.

### Deliverables
- [ ] Cross-instance state sync via EventTarget broadcast in `useBookmarkedRepos`
- [ ] Proper error handling in `syncToServer` with error state exposed to consumers
- [ ] Consumer components updated to optionally display sync errors
- [ ] New unit tests for `useBookmarkedRepos` hook
- [ ] Consistent use of `apiFetch` instead of raw `fetch`

### Definition of Done
- [ ] Adding a repo in `AddRepoDialog` immediately appears in `GitHubPanel` without manual refresh
- [ ] Removing a repo in `GitHubPanel` context menu is reflected in `AddRepoDialog`'s `hasRepo` filter
- [ ] A failed `syncToServer` surfaces an `error` string in all hook instances
- [ ] All existing tests pass: `npx vitest run`
- [ ] New hook tests pass

### Guardrails (Must NOT)
- Do NOT change the API route (`bookmarks/route.ts`) or server store (`integration-store.ts`)
- Do NOT remove the localStorage migration logic
- Do NOT make `addRepo` / `removeRepo` async (would complicate consumer code)
- Do NOT introduce external state management libraries (no zustand, jotai, etc.)

## TODOs

- [ ] 1. **Add EventTarget broadcast bus to `useBookmarkedRepos`**
  **What**: Add a module-level `EventTarget` singleton and broadcast helpers, mirroring the pattern in `use-repositories.ts` (lines 27-41). Define two event types: `"bookmarks-updated"` (carries `BookmarkedRepo[]`) and `"bookmarks-error"` (carries `string`).
  **Files**: `src/integrations/github/hooks/use-bookmarked-repos.ts`
  **Details**:
  - Add at module scope (before the hook function):
    ```
    const bookmarksBus = new EventTarget();
    function broadcastBookmarksUpdate(repos: BookmarkedRepo[]) { ... }
    function broadcastBookmarksError(message: string) { ... }
    ```
  - Use `CustomEvent` with `detail` payload, same as `use-repositories.ts`.
  **Acceptance**: Module-level bus and helpers exist; no behavioral change yet.

- [ ] 2. **Add `error` state and listener effects to the hook**
  **What**: Add `useState<string | null>(null)` for error tracking. Add a `useEffect` that listens to both `"bookmarks-updated"` and `"bookmarks-error"` events on `bookmarksBus`, updating local state when another instance broadcasts. Add an `applyData` callback (like `use-repositories.ts` line 58) to DRY up state application.
  **Files**: `src/integrations/github/hooks/use-bookmarked-repos.ts`
  **Details**:
  - Add `const [error, setError] = useState<string | null>(null);`
  - Add `applyData` callback: `useCallback((repos: BookmarkedRepo[]) => { setRepos(sortByName(repos)); setError(null); }, [])`.
  - Add `useEffect` listener (like `use-repositories.ts` lines 91-98):
    - On `"bookmarks-updated"`: call `applyData(detail)`.
    - On `"bookmarks-error"`: call `setError(detail)`.
    - Return cleanup that removes both listeners.
  - Update `UseBookmarkedReposResult` interface to include `error: string | null`.
  **Acceptance**: Hook returns `error` field; listener effect mounts/cleans up.

- [ ] 3. **Refactor `syncToServer` to broadcast results and errors**
  **What**: Make `syncToServer` broadcast success/failure to all instances after the fetch completes. On success, broadcast the repos. On failure, broadcast the error message. Also switch from raw `fetch()` to `apiFetch()` for consistency.
  **Files**: `src/integrations/github/hooks/use-bookmarked-repos.ts`
  **Details**:
  - Change `syncToServer` signature: still returns `Promise<void>`, still handles its own errors internally.
  - On success (response ok): `broadcastBookmarksUpdate(repos)`.
  - On success but non-ok response: parse error, `broadcastBookmarksError(message)`.
  - On catch: `broadcastBookmarksError("Failed to sync bookmarks")`.
  - Replace `fetch(BOOKMARKS_API, ...)` with `apiFetch(BOOKMARKS_API, ...)`.
  - Add import for `apiFetch` from `@/lib/api-client`.
  **Acceptance**: Sync success broadcasts repos to all instances; sync failure broadcasts error to all instances.

- [ ] 4. **Update `addRepo` and `removeRepo` to use broadcast-aware flow**
  **What**: Refactor `addRepo` and `removeRepo` so they: (1) optimistically update local state, (2) broadcast the update immediately so other instances update, (3) fire `syncToServer` which will broadcast again on completion (or broadcast error on failure). Clear error on new operations.
  **Files**: `src/integrations/github/hooks/use-bookmarked-repos.ts`
  **Details**:
  - In `addRepo`: after computing `next`, call `broadcastBookmarksUpdate(next)` (this updates all OTHER instances immediately). The local instance already gets updated via `setRepos`. Keep `void syncToServer(next)`.
  - In `removeRepo`: same pattern — `broadcastBookmarksUpdate(next)` then `void syncToServer(next)`.
  - Clear `setError(null)` at the start of each operation (optimistic).
  - Note: The broadcast listener in the same instance will also fire, but calling `setRepos` with the same sorted array is a no-op (React bails out on same reference if we're careful, but even if it re-renders it's harmless and correct).
  **Acceptance**: Calling `addRepo` in one component instance causes another instance's `repos` to update immediately.

- [ ] 5. **Update `loadAndMigrate` to use `apiFetch` and broadcast**
  **What**: The initial load in `useEffect` should also use `apiFetch` and broadcast after load so if multiple instances mount at different times, a late-mounter gets the data from an early-mounter's broadcast.
  **Files**: `src/integrations/github/hooks/use-bookmarked-repos.ts`
  **Details**:
  - Replace `fetch(BOOKMARKS_API)` with `apiFetch(BOOKMARKS_API)`.
  - After setting `finalRepos`, call `broadcastBookmarksUpdate(sortByName(finalRepos))`.
  - On fetch error, call `broadcastBookmarksError(message)` and `setError(message)`.
  **Acceptance**: Initial load broadcasts to all instances; errors are surfaced.

- [ ] 6. **Add optional error display to `GitHubPanel`**
  **What**: Destructure `error` from the hook and display a subtle inline error message when sync fails.
  **Files**: `src/components/layout/github-panel.tsx`
  **Details**:
  - Change line 25: `const { repos, removeRepo, error } = useBookmarkedRepos();`
  - Add a conditional error banner below the repo list (or above it), e.g.:
    ```tsx
    {error && (
      <p className="px-3 py-1.5 text-xs text-destructive">{error}</p>
    )}
    ```
  - Place it after the `!isGitHubConnected` message block, before the repo list `<div>`.
  **Acceptance**: When `syncToServer` fails, a red error message appears in the sidebar panel.

- [ ] 7. **Create unit tests for `useBookmarkedRepos`**
  **What**: Create a new test file covering: (a) `sortByName` pure function, (b) initial fetch populates repos, (c) `addRepo` updates state and calls sync, (d) `removeRepo` updates state and calls sync, (e) cross-instance broadcast (add in one hook instance, verify the other sees it), (f) error state on sync failure.
  **Files**: `src/integrations/github/hooks/__tests__/use-bookmarked-repos.test.ts` (new file)
  **Details**:
  - Mock `@/lib/api-client` (`apiFetch`), `@/hooks/use-persisted-state` (`removePersistedKey`).
  - Use `@testing-library/react` `renderHook` + `act` for hook testing (same pattern as other hook tests in the codebase).
  - Test cases:
    1. `sortByName` sorts alphabetically by `fullName`
    2. Initial fetch — success populates `repos`, error sets `error`
    3. `addRepo` adds to state, prevents duplicates, calls sync
    4. `removeRepo` removes from state, calls sync
    5. `hasRepo` returns correct boolean
    6. Cross-instance sync: render two hook instances, `addRepo` on one, verify `repos` on both
    7. Error broadcast: mock sync failure, verify `error` propagates to all instances
    8. Migration from localStorage: mock localStorage with legacy data, verify merge and cleanup
  **Acceptance**: All tests pass with `npx vitest run src/integrations/github/hooks/__tests__/use-bookmarked-repos.test.ts`.

## Verification
- [ ] All existing tests pass: `npx vitest run`
- [ ] New hook tests pass: `npx vitest run src/integrations/github/hooks/__tests__/use-bookmarked-repos.test.ts`
- [ ] No regressions in `bookmarks.test.ts` (API route tests unchanged)
- [ ] Manual verification: open app, add repo via dialog, confirm sidebar updates instantly
- [ ] Manual verification: remove repo via sidebar context menu, confirm dialog's `hasRepo` filter updates
- [ ] Manual verification: disconnect network/stop server, add repo, confirm error appears in sidebar
