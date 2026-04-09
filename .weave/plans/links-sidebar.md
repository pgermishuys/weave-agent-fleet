# Links Sidebar — Persist, Issue Tracking, Polling Hardening

> **PR**: https://github.com/pgermishuys/weave-agent-fleet/pull/188

## TL;DR
> **Summary**: Harden the session sidebar's GitHub link tracking with localStorage persistence, issue URL detection/display, and rate-limit-aware polling backoff across three phased vertical slices.
> **Estimated Effort**: Large

## Context

### Original Request
Improve the session sidebar's GitHub link tracking across three dimensions: (1) persist detected links to localStorage so they survive page refresh, (2) add GitHub issue URL detection and sidebar display alongside PRs, and (3) harden the polling pipeline with longer intervals and rate-limit backoff.

### Key Findings

**Current PR pipeline** (6 files):
- `src/lib/pr-utils.ts` — regex extraction from messages: scans bash tool outputs + text parts, deduplicates by URL
- `src/app/sessions/[id]/page.tsx` (lines 432-457) — merges message-extracted PRs with in-memory cache, persists back via `sessionCache.patchPrReferences()`
- `src/lib/session-cache.ts` — LRU in-memory cache (10 entries, 30-min TTL); `prReferences` field on `CacheEntry`; `_pendingPrs` side-map for entries not yet in cache. **Not persisted to disk/localStorage.**
- `src/hooks/use-pr-status.ts` — polls at 15s intervals; skips hidden tabs & terminal states (merged/closed); `usePrStatus(prs) → { statuses, isLoading, error }`
- `src/components/session/pr-sidebar-panel.tsx` — renders PR list with status icons (merged, closed, checks running/failed/passed, draft badge)
- `src/app/api/integrations/github/repos/[owner]/[repo]/pulls/[number]/status/route.ts` — server route making 2 GitHub API calls (PR details + check suites). Rate-limit headers read but **not enforced**.

**Message pagination impact**: Initial load fetches last 50 messages. PRs from message 1–450 are invisible on fresh load. The in-memory cache survives tab-switching but **not** page refresh.

**Existing issue infrastructure**: An issue detail route already exists at `src/app/api/integrations/github/repos/[owner]/[repo]/issues/[number]/route.ts` (returns `GitHubIssue`). `GitHubIssue` type in `types.ts` has `{ number, title, state, labels, html_url }`. No issue **status** endpoint exists. The `manifest.ts` `resolveContext` function parses both issue and PR URLs but only for context-loading — not sidebar detection.

**Rate limiting**: `github-fetch.ts` returns `rateLimitRemaining` and `rateLimitReset` from response headers but **nothing consumes** these values for throttling. At 15s polling with N PRs, each tick makes 2N GitHub API requests.

**Test patterns**: Tests live in `__tests__/` sibling directories. Vitest. Comprehensive test files exist for `pr-utils` (350 lines), `session-cache` (201 lines), and `pr-status` route (294 lines). Test helpers use `makeMessage()`, `makeToolPart()`, `makeTextPart()` patterns.

**Sidebar duplication**: The session page renders the PR sidebar panel in **two places** — the desktop aside (line 1040-1045) and the mobile Sheet (line 1204-1210). Both must be updated to include issue tracking.

## Objectives

### Core Objective
Make the sidebar's GitHub link tracking persistent, comprehensive (PRs + issues), and respectful of API rate limits.

### Deliverables
- [ ] localStorage persistence for detected links (PRs + issues) keyed by session ID
- [ ] Issue URL detection from messages (regex extraction mirroring PR pipeline)
- [ ] Issue status API route returning title, state, labels
- [ ] Issue status polling hook (or generalized link status hook)
- [ ] Unified "GitHub Links" sidebar panel showing both PRs and issues
- [ ] Polling interval increased from 15s to 30s with rate-limit-aware backoff
- [ ] Centralized rate-limit state shared across PR and issue polling
- [ ] Tests for all new/modified modules

### Definition of Done
- [ ] `npm run test` passes with all new and existing tests green
- [ ] `npm run build` succeeds without errors
- [ ] Detected PRs and issues survive a full page refresh (F5) on the session detail page
- [ ] Issue URLs in bash output / assistant text appear in the sidebar with correct open/closed status
- [ ] When `X-RateLimit-Remaining` drops below threshold, polling interval increases automatically

### Guardrails (Must NOT)
- Must NOT break existing PR detection — all existing `pr-utils.test.ts` tests must continue passing
- Must NOT remove or rename `PrReference` type — extend, don't replace (backward compat with session cache)
- Must NOT change the `session-cache.ts` LRU/TTL logic — localStorage is an additional layer, not a replacement
- Must NOT make localStorage a hard dependency — gracefully degrade if storage is unavailable (private browsing, quota exceeded)
- Must NOT auto-clean localStorage entries for **active** sessions — only expire stale ones

## TODOs

### Phase 1: Polling Improvements

- [x] 1. Increase default poll interval from 15s to 30s
  **What**: Change the `PR_POLL_INTERVAL_MS` constant from `15_000` to `30_000` in `use-pr-status.ts`. This is a one-line change that immediately halves the GitHub API request rate.
  **Files**: `src/hooks/use-pr-status.ts`
  **Acceptance**: Constant updated; manual verification that polling interval is 30s

- [x] 2. Add centralized rate-limit tracker module
  **What**: Create a new module `src/lib/github-rate-limit.ts` that exposes a singleton rate-limit state. This module tracks `remaining` and `resetAt` (Unix epoch seconds) from the most recent GitHub API response. It provides:
  - `updateRateLimit(remaining: number, resetAt: number): void` — called after each GitHub API response
  - `getRateLimitState(): { remaining: number | null, resetAt: number | null }` — returns current known state
  - `getRecommendedInterval(baseMs: number): number` — returns the polling interval adjusted for rate-limit pressure:
    - `remaining >= 100` → `baseMs` (no change)
    - `100 > remaining >= 50` → `baseMs * 2`
    - `50 > remaining >= 10` → `baseMs * 4`
    - `remaining < 10` → `Infinity` (stop polling; resume after reset)
  - `shouldPoll(): boolean` — returns false if remaining < 10 AND reset time hasn't passed yet
  This module is a pure TypeScript module (no React dependencies) so it can be imported from both hooks and API routes.
  **Files**: `src/lib/github-rate-limit.ts`
  **Acceptance**: Unit tests verify each threshold bracket returns the correct multiplier; `shouldPoll()` returns false when exhausted, true after reset

- [x] 3. Wire rate-limit updates into the PR status API route
  **What**: In the PR status API route, after calling `githubFetch`, surface the rate-limit info in the JSON response as optional fields `rateLimitRemaining` and `rateLimitReset`. This allows the client-side hook to read them without parsing headers.
  Add two optional fields to `PrStatusResponse` type in `types.ts`:
  ```
  rateLimitRemaining?: number;
  rateLimitReset?: number;
  ```
  In the route handler, read the rate-limit values from the `githubFetch` result (which already returns them) and include them in the response JSON.
  **Files**: `src/integrations/github/types.ts`, `src/app/api/integrations/github/repos/[owner]/[repo]/pulls/[number]/status/route.ts`
  **Acceptance**: PR status API response includes `rateLimitRemaining` and `rateLimitReset` fields when available; existing tests still pass; add new test case verifying these fields appear in response

- [x] 4. Integrate rate-limit backoff into `use-pr-status.ts`
  **What**: Modify `usePrStatus` to consume rate-limit info from poll responses and use the centralized tracker:
  - After each successful fetch, call `updateRateLimit()` with the values from the response body
  - Replace the static `setInterval(fetchStatuses, PR_POLL_INTERVAL_MS)` with a dynamic interval: after each fetch completes, call `setTimeout` with `getRecommendedInterval(BASE_POLL_INTERVAL_MS)` instead of `setInterval`
  - Before each fetch, check `shouldPoll()` — if false, skip and schedule next check at reset time
  - The interval self-adjusts: when rate limit recovers (after reset timestamp passes), interval drops back to baseline
  Implementation detail: switch from `setInterval` to a recursive `setTimeout` pattern so the interval can change dynamically. Store the timeout ref to clear on unmount.
  **Files**: `src/hooks/use-pr-status.ts`, `src/lib/github-rate-limit.ts` (import)
  **Acceptance**: When rate limit remaining drops below 100, polling interval increases; when remaining < 10, polling pauses; after reset timestamp passes, polling resumes at base interval

- [x] 5. Add unit tests for rate-limit tracker
  **What**: Create `src/lib/__tests__/github-rate-limit.test.ts` with tests for:
  - Initial state returns null for remaining/resetAt
  - `updateRateLimit` stores values correctly
  - `getRecommendedInterval` returns correct multipliers at each threshold bracket
  - `shouldPoll` returns false when remaining < 10 and reset time is in the future
  - `shouldPoll` returns true when remaining < 10 but reset time has passed
  - `shouldPoll` returns true when remaining >= 10
  **Files**: `src/lib/__tests__/github-rate-limit.test.ts`
  **Acceptance**: All tests pass

### Phase 2: Link Persistence (localStorage)

- [x] 6. Create `src/lib/link-storage.ts` — localStorage persistence layer
  **What**: Create a new module for persisting detected GitHub links (both PRs and issues) to localStorage. Design:
  - Key format: `weave:session-links:{sessionId}`
  - Stored structure: `{ version: 1, updatedAt: number, prs: PrReference[], issues: IssueReference[] }`
  - Functions:
    - `loadSessionLinks(sessionId: string): StoredSessionLinks | null` — reads from localStorage, returns null if not found or parse error
    - `saveSessionLinks(sessionId: string, links: StoredSessionLinks): void` — writes to localStorage, wrapped in try/catch (graceful degradation for private browsing / quota exceeded)
    - `removeSessionLinks(sessionId: string): void` — removes a specific session's links
    - `cleanupStaleLinks(maxAgeMs: number): void` — iterates localStorage keys matching the prefix, removes entries older than `maxAgeMs` (default: 7 days). Called lazily (not on every load).
  - The `StoredSessionLinks` type: `{ version: 1, updatedAt: number, prs: PrReference[], issues: IssueReference[] }`
  - Import `PrReference` from `pr-utils.ts`. Import `IssueReference` from the new `issue-utils.ts` (created in Phase 3). For Phase 2, `issues` will be an empty array — the type is forward-declared here so Phase 3 doesn't need to change the storage format.
  - NOTE: Because `IssueReference` doesn't exist yet in Phase 2, create it in this module as a forward declaration: `export interface IssueReference { owner: string; repo: string; number: number; url: string; }`. Phase 3 will re-export this from `issue-utils.ts`.
  **Files**: `src/lib/link-storage.ts`
  **Acceptance**: localStorage read/write roundtrips correctly; graceful no-op on storage errors; stale cleanup removes entries older than threshold

- [x] 7. Integrate localStorage persistence into the session detail page
  **What**: Modify the PR detection block in `page.tsx` (lines 432-457) to:
  1. On mount / session ID change: load persisted links from `loadSessionLinks(sessionId)` as the base set
  2. Merge: persisted links → in-memory cache → message-extracted (additive only — never remove a persisted link because its message isn't loaded)
  3. After merge, save back via `saveSessionLinks(sessionId, { version: 1, updatedAt: Date.now(), prs: mergedPrs, issues: mergedIssues })` whenever the merged set changes
  4. Call `cleanupStaleLinks(7 * 24 * 60 * 60 * 1000)` once on page mount (via `useEffect` with empty deps) to avoid localStorage bloat
  The merge function should be extracted into a helper (e.g., `mergeLinks` in `link-storage.ts`) for testability.
  Continue calling `sessionCache.patchPrReferences()` so the in-memory cache stays in sync for tab-switching.
  **Files**: `src/app/sessions/[id]/page.tsx`, `src/lib/link-storage.ts`
  **Acceptance**: After detecting PRs in a session, refreshing the page shows the same PRs in the sidebar even though messages haven't been paginated back that far

- [x] 8. Add unit tests for link-storage
  **What**: Create `src/lib/__tests__/link-storage.test.ts`:
  - `loadSessionLinks` returns null for nonexistent key
  - `loadSessionLinks` returns null for invalid JSON
  - `saveSessionLinks` / `loadSessionLinks` roundtrip
  - `removeSessionLinks` deletes the entry
  - `cleanupStaleLinks` removes entries older than threshold but keeps recent ones
  - Graceful no-op when `localStorage.setItem` throws (mock `localStorage` to throw QuotaExceededError)
  - Merge helper correctly unions PRs and issues by URL, preserving order (persisted first)
  **Files**: `src/lib/__tests__/link-storage.test.ts`
  **Acceptance**: All tests pass

### Phase 3: Issue Detection & Sidebar

- [x] 9. Create `src/lib/issue-utils.ts` — issue URL extraction
  **What**: Create a new module mirroring `pr-utils.ts` for issue URLs. Functions:
  - `parseIssueUrlsFromOutput(output: unknown): IssueReference[]` — regex `/https:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/issues\/(\d+)/g`, same pattern as `parsePrUrlsFromOutput`
  - `extractIssueReferences(messages: AccumulatedMessage[]): IssueReference[]` — scans messages like `extractPrReferences`, scanning bash tool outputs and text parts
  - Re-export `IssueReference` type (same shape as in `link-storage.ts` — `{owner, repo, number, url}`). Update `link-storage.ts` to import from here instead of forward-declaring.
  Implementation should follow the exact same patterns as `pr-utils.ts`: global regex with `lastIndex` reset, `Set<string>` for dedup, same message part scanning logic.
  **Files**: `src/lib/issue-utils.ts`, `src/lib/link-storage.ts` (update import of `IssueReference`)
  **Acceptance**: Extracts issue URLs from bash output and text parts; deduplicates; ignores PR URLs; ignores non-GitHub URLs

- [x] 10. Add unit tests for issue-utils
  **What**: Create `src/lib/__tests__/issue-utils.test.ts` mirroring `pr-utils.test.ts` structure:
  - `parseIssueUrlsFromOutput`: null/undefined/empty → []; non-GitHub URL → []; PR URL → []; single issue URL → correct ref; multiple issues → all extracted; duplicates → deduped
  - `extractIssueReferences`: empty messages → []; no issue URLs → []; bash part with issue URL → extracted; text part with issue URL → extracted; non-bash tool part → ignored; cross-message dedup; first-appearance order preserved
  **Files**: `src/lib/__tests__/issue-utils.test.ts`
  **Acceptance**: All tests pass; mirrors coverage of `pr-utils.test.ts`

- [x] 11. Add `IssueStatusResponse` type and issue status API route
  **What**:
  1. Add `IssueStatusResponse` type to `src/integrations/github/types.ts`:
     ```ts
     export interface IssueStatusResponse {
       number: number;
       title: string;
       state: "open" | "closed";
       labels: Array<{ name: string; color: string }>;
       url: string;
       rateLimitRemaining?: number;
       rateLimitReset?: number;
     }
     ```
  2. Create API route at `src/app/api/integrations/github/repos/[owner]/[repo]/issues/[number]/status/route.ts`:
     - GET handler: auth check → `githubFetch<GitHubIssue>(...)` to get the issue → map to `IssueStatusResponse`
     - Only 1 GitHub API call needed (no check suites for issues), so this is cheaper than the PR status route
     - Include rate-limit headers in response (same pattern as PR status route from TODO 3)
  **Files**: `src/integrations/github/types.ts`, `src/app/api/integrations/github/repos/[owner]/[repo]/issues/[number]/status/route.ts`
  **Acceptance**: `GET /api/integrations/github/repos/acme/repo/issues/42/status` returns `IssueStatusResponse` JSON; 401 when no token; forwards GitHub errors

- [x] 12. Add unit tests for issue status API route
  **What**: Create `src/app/api/integrations/github/__tests__/issue-status.test.ts` following the pattern of `pr-status.test.ts`:
  - Returns 401 when no token
  - Returns correct `IssueStatusResponse` for open issue
  - Returns correct state for closed issue
  - Includes labels in response
  - Forwards GitHub 404
  - Includes rate-limit fields when available
  **Files**: `src/app/api/integrations/github/__tests__/issue-status.test.ts`
  **Acceptance**: All tests pass

- [x] 13. Create `src/hooks/use-issue-status.ts` — issue status polling hook
  **What**: Create a polling hook for issue statuses following the same pattern as `use-pr-status.ts` but adapted for issues:
  - `useIssueStatus(issues: IssueReference[]): UseIssueStatusResult`
  - Returns `{ statuses: Map<string, IssueStatusResponse>, isLoading, error }`
  - Terminal state for issues: `state === "closed"` (no merged concept)
  - Uses the same dynamic `setTimeout` pattern with `getRecommendedInterval()` from `github-rate-limit.ts` (Phase 1)
  - Shares the centralized rate-limit tracker — calls `updateRateLimit()` after each fetch
  - Same visibility change handling (skip when tab hidden, fetch on focus)
  - Base interval: `30_000` (same as updated PR polling)
  **Files**: `src/hooks/use-issue-status.ts`
  **Acceptance**: Polls issue status at 30s intervals; stops polling closed issues; respects rate-limit backoff; skips when tab hidden

- [x] 14. Create unified `GitHubLinksSidebarPanel` component
  **What**: Create `src/components/session/github-links-sidebar-panel.tsx` that replaces `PrSidebarPanel` in the sidebar rendering. This component:
  - Props: `{ prs: PrReference[], prStatuses: Map<string, PrStatusResponse>, issues: IssueReference[], issueStatuses: Map<string, IssueStatusResponse> }`
  - Header: "GitHub" with a GitHub icon and total count (prs.length + issues.length)
  - Renders PRs first (reuse existing `PrStatusIcon` and status label logic — extract from `pr-sidebar-panel.tsx` or import)
  - Then renders issues with new `IssueStatusIcon`: open → green circle-dot icon, closed → purple circle-check icon
  - Each item is a clickable link with the same hover/external-link styling as current PR items
  - Issues show title (from status) or `#N` fallback, with optional label badges (first 2-3 labels, truncated)
  - If only PRs exist, show "Pull Requests" sub-header; if only issues, show "Issues"; if both, show sub-headers for each section
  - Keep `PrSidebarPanel` as-is (don't delete) for backward compatibility but stop using it in `page.tsx`
  **Files**: `src/components/session/github-links-sidebar-panel.tsx`
  **Acceptance**: Component renders PRs and issues correctly; shows appropriate icons and status labels; links open in new tab

- [x] 15. Wire issue detection and unified panel into session detail page
  **What**: Modify `src/app/sessions/[id]/page.tsx` to:
  1. Import `extractIssueReferences` from `issue-utils.ts`
  2. Import `useIssueStatus` from `use-issue-status.ts`
  3. Import `GitHubLinksSidebarPanel` from `github-links-sidebar-panel.tsx`
  4. Add issue detection parallel to PR detection:
     ```ts
     const messagesIssues = useMemo(() => extractIssueReferences(messages), [messages]);
     ```
  5. Merge issues with localStorage-persisted issues (same pattern as PR merge in TODO 7)
  6. Call `useIssueStatus(detectedIssues)` to get issue statuses
  7. Persist combined links (PRs + issues) to localStorage via `saveSessionLinks()`
  8. Replace `<PrSidebarPanel>` in **both** sidebar locations (desktop aside ~line 1040 and mobile Sheet ~line 1204) with `<GitHubLinksSidebarPanel>`, passing both PR and issue data
  9. Show the panel when `detectedPrs.length > 0 || detectedIssues.length > 0`
  **Files**: `src/app/sessions/[id]/page.tsx`
  **Acceptance**: Issue URLs in session messages appear in sidebar; PRs still work as before; both desktop and mobile sidebars show unified panel

- [x] 16. Update `link-storage.ts` to import `IssueReference` from `issue-utils.ts`
  **What**: Now that `issue-utils.ts` exists, update `link-storage.ts` to import `IssueReference` from there instead of having its own forward declaration. This keeps the type definition in a single canonical location. Also re-export it from `link-storage.ts` so existing consumers don't break.
  **Files**: `src/lib/link-storage.ts`, `src/lib/issue-utils.ts`
  **Acceptance**: No duplicate type definitions; imports resolve correctly; all tests pass

- [x] 17. Update existing `pr-utils.test.ts` to explicitly assert issue URLs are NOT matched
  **What**: The existing test already has one assertion (`returns [] for a GitHub issue URL (not a PR URL)`) but add a complementary assertion in `extractPrReferences` level: a message containing both a PR URL and an issue URL should only return the PR. This guards against accidental regression if someone tries to generalize the regex.
  **Files**: `src/lib/__tests__/pr-utils.test.ts`
  **Acceptance**: New test case passes; existing tests unaffected

## Verification

- [x] `npm run test` — all tests pass (existing + new)
- [x] `npm run build` — clean build, no TypeScript errors
- [ ] Manual: open a session where agent has created a PR → PR appears in sidebar → refresh page → PR still appears (localStorage persistence)
- [ ] Manual: open a session where agent references an issue URL → issue appears in sidebar with correct open/closed state
- [ ] Manual: observe network tab — polling interval is 30s, not 15s; when rate-limit remaining is low (simulate by checking response headers), interval increases
- [x] Grep verification: no remaining references to `PR_POLL_INTERVAL_MS = 15_000` (old value)
- [x] Grep verification: `PrSidebarPanel` is no longer rendered in `page.tsx` (replaced by `GitHubLinksSidebarPanel`), but the component file still exists for potential external use
