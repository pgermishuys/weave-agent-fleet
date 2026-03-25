# PR Tracking Sidebar Panel

## TL;DR
> **Summary**: Detect PR URLs from `gh pr create` bash tool output in session messages, display them in a new "Pull Requests" sidebar section below TODOs, and poll GitHub for live status (open/merged/closed + CI checks).
> **Estimated Effort**: Medium

## Context
### Original Request
When an AI agent creates a PR during a session (via `gh pr create` in the `bash` tool), automatically detect the PR URL from tool output, display it in the right sidebar, show composite status icons matching GitHub's visual language, and poll for live status every 15 seconds.

### Key Findings

**Message/Part Model**:
- `AccumulatedMessage` has `parts: AccumulatedPart[]` where each part can be `AccumulatedTextPart`, `AccumulatedToolPart`, or `AccumulatedFilePart`.
- `AccumulatedToolPart` has `tool: string` (e.g. `"bash"`), `callId`, and `state` (typed as `Part extends { type: "tool"; state: infer S } ? S : unknown`).
- In practice, `state` is cast to `any` — it has shape `{ status: "running" | "completed" | "pending", output?: string, input?: unknown, metadata?: unknown }`.
- Tool output for `bash` calls is in `state.output` as a plain string — this is where `gh pr create` prints the PR URL (e.g. `https://github.com/owner/repo/pull/123`).

**TODO System (pattern to mirror)**:
- `src/lib/todo-utils.ts` — pure extraction functions: `isTodoWriteTool()`, `parseTodoOutput()`, `extractLatestTodos()`. Scans `AccumulatedMessage[]` backwards looking at tool parts.
- `src/components/session/todo-sidebar-panel.tsx` — `"use client"` component that receives `TodoItem[]` props and renders a sidebar section with icons from `lucide-react`, uses `Badge`, `Progress` from Shadcn UI.
- In `page.tsx` line 373: `const latestTodos = useMemo(() => extractLatestTodos(messages), [messages]);`
- In sidebar (lines 855-861): conditionally rendered with `{latestTodos && latestTodos.length > 0 && (<><Separator /><TodoSidebarPanel todos={latestTodos} /></>)}`.

**Existing Polling Patterns**:
- `use-sessions.ts`: `useState` + `useCallback` + `useEffect` with `setInterval(fetchFn, pollIntervalMs)`, `isMounted` ref for cleanup, `apiFetch()` for requests.
- `use-fleet-summary.ts`: Same pattern — shallow equality check in `setSummary(prev => ...)` to avoid unnecessary re-renders.
- Both clean up with `clearInterval` + `isMounted.current = false` in effect cleanup.

**GitHub API Infrastructure**:
- `src/app/api/integrations/github/_lib/github-fetch.ts` — `getGitHubToken()` + `githubFetch<T>(path, token, options?)`. Handles auth, rate limits, error mapping.
- `src/app/api/integrations/github/repos/[owner]/[repo]/pulls/[number]/route.ts` — existing GET route that fetches a single PR. Returns `GitHubPullRequest`.
- `GitHubPullRequest` type (in `src/integrations/github/types.ts`): has `state: "open" | "closed" | "merged"`, `merged_at`, `head.sha`, `head.ref`.
- **No existing check suites endpoint** — need to create one or extend the PR status route.

**GitHub REST API for Check Suites**:
- `GET /repos/{owner}/{repo}/commits/{ref}/check-suites` returns `{ total_count, check_suites: [{ id, status, conclusion, ... }] }`.
- `status`: `"queued" | "in_progress" | "completed"`.
- `conclusion` (when completed): `"success" | "failure" | "neutral" | "cancelled" | "skipped" | "timed_out" | "action_required"`.
- Alternative: `GET /repos/{owner}/{repo}/commits/{ref}/status` (combined status API) returns `{ state: "pending" | "success" | "failure" | "error" }` — simpler but only covers legacy status checks.
- Best approach: use **check-suites API** for modern CI (GitHub Actions) + fall back to combined status.

**Lucide Icons Available**:
- The project uses `lucide-react`. Relevant icons: `GitPullRequest`, `GitPullRequestClosed`, `GitMerge`, `Clock`, `Timer`, `CircleX`, `CircleCheck`, `ExternalLink`, `CircleDot`.
- For the composite status icons: `GitPullRequestDraft` (if draft PRs), `GitMerge` (purple merged), `GitPullRequestClosed` (closed not merged).

**Test Patterns**:
- Pure utility tests in `src/lib/__tests__/*.test.ts` — Vitest with `describe`/`it`/`expect`, helper factories like `makeMessage()`, `makeToolPart()`.
- API route tests in `src/app/api/integrations/github/__tests__/*.test.ts` — mock `getIntegrationConfig` and `global.fetch`, test status codes and response shapes.

## Objectives
### Core Objective
Surface PR creation and live status in the session sidebar so users can track CI progress without leaving the app.

### Deliverables
- [x] PR URL extraction utility (`pr-utils.ts`) that scans messages for GitHub PR URLs in bash tool output
- [x] API route to fetch PR status + check suite status in a single call
- [x] Polling hook (`use-pr-status.ts`) that fetches status for detected PRs every 15 seconds
- [x] Sidebar component (`pr-sidebar-panel.tsx`) with composite status icons matching GitHub's visual language
- [x] Integration into session detail page sidebar (below TODOs)
- [x] Unit tests for PR extraction utility
- [x] Unit tests for API route

### Definition of Done
- [ ] `npx vitest run` passes all new and existing tests
- [ ] `npx next build` succeeds without errors
- [ ] PR URLs from `gh pr create` bash output are detected and displayed in sidebar
- [ ] Status icons update every 15 seconds reflecting PR state + CI status
- [ ] Clicking a PR opens it in a new tab

### Guardrails (Must NOT)
- Must NOT poll when no PRs are detected (avoid wasted API calls)
- Must NOT re-render the entire sidebar on every poll (use shallow equality checks)
- Must NOT break existing TODO sidebar functionality
- Must NOT introduce new npm dependencies (use existing lucide-react icons)
- Must NOT poll when the tab is not visible (use `document.visibilityState` check)

## TODOs

- [x] 1. **Create PR URL extraction utility**
  **What**: Create `src/lib/pr-utils.ts` with pure functions to extract PR URLs from session messages, mirroring the `todo-utils.ts` pattern.
  **Files**: Create `src/lib/pr-utils.ts`
  **Details**:
  ```
  Types:
  - interface PrReference {
      owner: string;      // e.g. "damianh"
      repo: string;       // e.g. "weave-agent-fleet"
      number: number;     // e.g. 123
      url: string;        // full URL: "https://github.com/damianh/weave-agent-fleet/pull/123"
    }

  Functions:
  - isBashTool(toolName: string): boolean
    - Case-insensitive match for "bash" tool name.

  - parsePrUrlsFromOutput(output: unknown): PrReference[]
    - If output is not a string or is empty, return [].
    - Use regex: /https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/g
    - Extract owner, repo, number from each match.
    - Deduplicate by URL.

  - extractPrReferences(messages: AccumulatedMessage[]): PrReference[]
    - Scan ALL messages (not just latest — accumulate all PRs created in the session).
    - For each message, iterate parts. If part is type "tool" and isBashTool(part.tool):
      - Extract state.output (cast state to any, same pattern as todo-utils).
      - Call parsePrUrlsFromOutput(state.output).
    - Also scan text parts for PR URLs (agents sometimes mention the URL in their response text too).
    - Deduplicate by URL across all messages (use a Set).
    - Return array of unique PrReference objects, ordered by first appearance.
  ```
  **Acceptance**: Unit tests pass for all edge cases (no messages, no bash parts, bash parts without PR URLs, multiple PRs, duplicates, mixed parts).

- [x] 2. **Create PR extraction unit tests**
  **What**: Create comprehensive tests for pr-utils.ts following the exact pattern of `todo-utils.test.ts`.
  **Files**: Create `src/lib/__tests__/pr-utils.test.ts`
  **Details**:
  ```
  Test groups:
  - isBashTool: "bash", "Bash", "BASH" → true; "Bash_tool", "shell", "" → false
  - parsePrUrlsFromOutput:
    - null/undefined/number → []
    - empty string → []
    - string without URLs → []
    - string with one PR URL → [PrReference]
    - string with multiple PR URLs → [PrReference, PrReference]
    - duplicate URLs → deduplicated
    - URL with trailing text/newlines → correctly parsed
    - Non-GitHub URLs → []
    - GitHub URLs that aren't PR URLs (e.g. /issues/123) → []
  - extractPrReferences:
    - empty messages → []
    - messages with no bash parts → []
    - messages with bash parts but no PR URLs → []
    - single bash part with one PR URL → [PrReference]
    - multiple messages with PR URLs → all collected, deduped
    - PR URLs in text parts also detected
    - Mixed tool types (bash + todowrite) → only scans relevant parts
    - Non-completed bash parts still scanned (URL may appear in running output)

  Use same helper factories: makeMessage(), makeToolPart(), makeTextPart()
  ```
  **Acceptance**: All tests green, full coverage of pr-utils.ts.

- [x] 3. **Add GitHub Check Suites type and extend PR types**
  **What**: Add types for GitHub check suites API response and a combined PR status response type.
  **Files**: Modify `src/integrations/github/types.ts`
  **Details**:
  ```
  Add these types:

  export interface GitHubCheckSuite {
    id: number;
    status: "queued" | "in_progress" | "completed";
    conclusion: "success" | "failure" | "neutral" | "cancelled" | "skipped" | "timed_out" | "action_required" | null;
  }

  export interface GitHubCheckSuitesResponse {
    total_count: number;
    check_suites: GitHubCheckSuite[];
  }

  /** Combined PR + checks status for the sidebar polling endpoint. */
  export interface PrStatusResponse {
    number: number;
    title: string;
    state: "open" | "closed";
    merged: boolean;
    draft: boolean;
    checksStatus: "pending" | "running" | "success" | "failure" | "none";
    headRef: string;
    url: string;
  }
  ```
  **Acceptance**: Types compile without errors.

- [x] 4. **Create PR status API route**
  **What**: Create a new API route that fetches both PR details and check suite status in parallel, returning a combined `PrStatusResponse`.
  **Files**: Create `src/app/api/integrations/github/repos/[owner]/[repo]/pulls/[number]/status/route.ts`
  **Details**:
  ```
  GET /api/integrations/github/repos/[owner]/[repo]/pulls/[number]/status

  Implementation:
  1. getGitHubToken() — 401 if missing.
  2. Await params (Next.js 16 async params pattern — see existing routes).
  3. Fetch PR details and check suites in parallel:
     - githubFetch<GitHubPullRequest>(`/repos/${owner}/${repo}/pulls/${number}`, token)
     - githubFetch<GitHubCheckSuitesResponse>(`/repos/${owner}/${repo}/commits/${pr.head.sha}/check-suites`, token)
     Note: check suites need the head SHA from the PR — so fetch PR first, then check suites.
     Actually: fetch PR first, then use head.sha for check suites. Can't fully parallelize.
  4. Map check suites to a single composite status:
     - If total_count === 0 → "none"
     - If any suite has status "queued" or "in_progress" → "running"
     - If all completed and all conclusion === "success" or "neutral" or "skipped" → "success"
     - Otherwise → "failure"
  5. Return PrStatusResponse:
     - number, title from PR
     - state from PR ("open" | "closed")
     - merged: pr.merged_at !== null (GitHub REST API returns state "open"|"closed", merged is derived)
     - draft from PR
     - checksStatus from step 4
     - headRef from pr.head.ref
     - url from pr.html_url
  ```
  **Acceptance**: Route returns correct combined status. API route tests pass.

- [x] 5. **Create PR status API route tests**
  **What**: Unit tests for the status route following the pattern of `issues.test.ts`.
  **Files**: Create `src/app/api/integrations/github/__tests__/pr-status.test.ts`
  **Details**:
  ```
  Mock setup: same as issues.test.ts — mock getIntegrationConfig and global.fetch.

  Tests:
  - Returns 401 when no token configured
  - Returns combined PR status with checks passing (success)
  - Returns combined PR status with checks running (pending)
  - Returns combined PR status with checks failing (failure)
  - Returns "none" checksStatus when no check suites exist
  - Returns merged: true when merged_at is set
  - Forwards GitHub 404 error
  - Handles rate limit errors

  Note: global.fetch will be called twice (PR fetch, then check-suites fetch).
  Use mockFetch.mockResolvedValueOnce() for sequenced responses.
  ```
  **Acceptance**: All route tests pass.

- [x] 6. **Create PR status polling hook**
  **What**: Create `src/hooks/use-pr-status.ts` — a polling hook that fetches status for multiple PRs, following the `use-fleet-summary.ts` pattern.
  **Files**: Create `src/hooks/use-pr-status.ts`
  **Details**:
  ```
  import type { PrReference } from "@/lib/pr-utils";
  import type { PrStatusResponse } from "@/integrations/github/types";

  interface UsePrStatusResult {
    statuses: Map<string, PrStatusResponse>;  // keyed by PR URL
    isLoading: boolean;
    error?: string;
  }

  const PR_POLL_INTERVAL_MS = 15_000;

  function usePrStatus(prs: PrReference[]): UsePrStatusResult

  Implementation:
  1. useState for statuses Map, isLoading, error.
  2. useRef(true) for isMounted cleanup.
  3. useCallback for fetchStatuses:
     - If prs.length === 0, skip (avoid unnecessary API calls).
     - Check document.visibilityState === "visible" before fetching (skip if tab hidden).
     - For each PR, call apiFetch(`/api/integrations/github/repos/${pr.owner}/${pr.repo}/pulls/${pr.number}/status`).
     - Use Promise.allSettled() to handle partial failures.
     - Build new Map from results.
     - Shallow compare with prev map to avoid unnecessary re-renders:
       setStatuses(prev => {
         // Compare by JSON.stringify of sorted entries (simple but effective for small maps)
         // Or compare each entry's checksStatus + state + merged fields
         if (shallowMapEqual(prev, newMap)) return prev;
         return newMap;
       });
  4. useEffect with setInterval(fetchStatuses, PR_POLL_INTERVAL_MS).
     - Deps: [fetchStatuses] (which depends on prs via closure — need to stabilize with useRef or useMemo on prs).
     - IMPORTANT: Stabilize the prs input — the consumer (page.tsx) will compute PrReference[] via useMemo, but if messages change every SSE event, the prs array reference changes. Use a ref to hold the latest prs and compare by serialized content to avoid restarting the interval.
  5. Cleanup: clearInterval + isMounted.current = false.
  6. Add visibilitychange listener to pause/resume polling when tab visibility changes.
  7. Smart polling optimization: once a PR is merged or closed, stop polling that specific PR (terminal states don't change).
  ```
  **Acceptance**: Hook fetches status on mount, polls every 15s, cleans up on unmount, skips when no PRs, pauses when tab hidden.

- [x] 7. **Create PR sidebar panel component**
  **What**: Create `src/components/session/pr-sidebar-panel.tsx` — renders the "Pull Requests" section in the sidebar, following the exact structure of `todo-sidebar-panel.tsx`.
  **Files**: Create `src/components/session/pr-sidebar-panel.tsx`
  **Details**:
  ```
  "use client";

  Props:
  interface PrSidebarPanelProps {
    prs: PrReference[];
    statuses: Map<string, PrStatusResponse>;
  }

  Composite Status Icon component (internal):
  function PrStatusIcon({ pr, status }: { pr: PrReference; status?: PrStatusResponse })
  - Determine icon + color from combined state:
    - status undefined (loading) → <Loader2 className="animate-spin text-muted-foreground" />
    - status.merged → <GitMerge className="text-purple-500" /> (GitHub's purple merge icon)
    - status.state === "closed" && !status.merged → <GitPullRequestClosed className="text-muted-foreground" /> (grey closed)
    - status.state === "open" && status.checksStatus === "running" → <Clock className="text-amber-500" /> (amber timer)
    - status.state === "open" && status.checksStatus === "success" → <GitPullRequest className="text-green-500" /> (green open)
    - status.state === "open" && status.checksStatus === "failure" → <CircleX className="text-red-500" /> (red X)
    - status.state === "open" && status.checksStatus === "none" → <GitPullRequest className="text-green-500" /> (green, no checks)
    - status.state === "open" && status.checksStatus === "pending" → <Clock className="text-amber-500" /> (amber, same as running)
  - Icons sized at h-3.5 w-3.5 (matching todo icons).

  Layout (mirror todo-sidebar-panel.tsx):
  <section>
    {/* Header */}
    <div className="flex items-center gap-1.5 mb-2">
      <GitPullRequest className="h-3.5 w-3.5 text-muted-foreground" />
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
        Pull Requests
      </p>
    </div>

    {/* PR items */}
    <div className="space-y-1.5">
      {prs.map((pr) => {
        const status = statuses.get(pr.url);
        return (
          <a
            key={pr.url}
            href={pr.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-start gap-2 text-xs group hover:bg-accent/50 rounded-sm px-1 py-0.5 -mx-1 transition-colors"
          >
            <PrStatusIcon pr={pr} status={status} />
            <span className="flex-1 min-w-0 text-foreground/90 break-words group-hover:text-foreground">
              {status?.title ?? `#${pr.number}`}
            </span>
            <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground/50 opacity-0 group-hover:opacity-100 transition-opacity mt-0.5" />
          </a>
        );
      })}
    </div>
  </section>
  ```
  **Acceptance**: Component renders PR list with correct status icons, items are clickable `<a>` tags opening in new tabs.

- [x] 8. **Integrate into session detail page**
  **What**: Wire up PR extraction, polling hook, and sidebar panel in `page.tsx`.
  **Files**: Modify `src/app/sessions/[id]/page.tsx`
  **Details**:
  ```
  Imports to add (top of file):
  - import { extractPrReferences } from "@/lib/pr-utils";
  - import { PrSidebarPanel } from "@/components/session/pr-sidebar-panel";
  - import { usePrStatus } from "@/hooks/use-pr-status";

  State computation (near line 373, after latestTodos):
  - const detectedPrs = useMemo(() => extractPrReferences(messages), [messages]);
  - const { statuses: prStatuses } = usePrStatus(detectedPrs);

  Sidebar rendering (after TODO section, around line 861):
  - Insert after the TodoSidebarPanel conditional block:
    {detectedPrs.length > 0 && (
      <>
        <Separator />
        <PrSidebarPanel prs={detectedPrs} statuses={prStatuses} />
      </>
    )}

  No icon imports needed — GitPullRequest is already imported on line 19 (used elsewhere? — check).
  Actually line 19 doesn't import GitPullRequest. But the component imports its own icons.
  ```
  **Acceptance**: PRs appear in sidebar when `gh pr create` output contains PR URLs. Status updates every 15 seconds. Section hidden when no PRs detected.

- [x] 9. **Handle edge cases and polish**
  **What**: Address remaining edge cases and UX polish.
  **Files**: Modify files from previous tasks as needed
  **Details**:
  ```
  Edge cases to handle:
  1. GitHub not connected (no token): usePrStatus should gracefully handle 401 responses — show PRs with unknown status icon, no error toast.
  2. PR URL in text parts: extractPrReferences already handles this (task 1).
  3. Multiple PRs from same session: all shown, each polled independently.
  4. Very long PR titles: truncated with text-ellipsis in the sidebar.
  5. Draft PRs: could show a subtle "(draft)" badge or different icon — use status.draft from PrStatusResponse. Show as dim text or with a Badge variant="outline" next to the title.

  Polish:
  - Add data-testid="pr-sidebar-panel" to the section element (for potential command palette scrolling, similar to todo panel).
  - Add title/tooltip on hover showing full PR title + status text.
  - Consider adding a small count badge in the header: "Pull Requests (2)".
  ```
  **Acceptance**: All edge cases handled gracefully, no crashes or error states visible to users.

## Implementation Order

```
Task 1 (pr-utils.ts) ──→ Task 2 (pr-utils tests) ──→ Task 8 (page.tsx integration)
                                                              ↑
Task 3 (types) ──→ Task 4 (API route) ──→ Task 5 (route tests) ──→ Task 6 (polling hook) ──→─┘
                                                                                              ↓
                                                                           Task 7 (sidebar component) ──→ Task 9 (polish)
```

Tasks 1-2 and 3-5 can be done in parallel. Task 6 depends on 3. Task 7 depends on 1+3. Task 8 depends on 1+6+7. Task 9 is final polish.

## Verification
- [ ] `npx vitest run` — all new tests in `pr-utils.test.ts` and `pr-status.test.ts` pass (skipped by user)
- [ ] `npx vitest run` — all existing tests still pass (no regressions) (skipped by user)
- [x] `bunx tsc --noEmit` — no TypeScript errors
- [ ] Manual: open a session where `gh pr create` was used → PR appears in sidebar
- [ ] Manual: PR status icon updates as checks run → pass → merge
- [ ] Manual: clicking PR opens GitHub in new tab
- [ ] Manual: navigating away from session stops polling (no memory leaks)
- [ ] Manual: tab hidden → polling pauses; tab visible → polling resumes

## Pitfalls & Mitigations

| Risk | Mitigation |
|------|-----------|
| `messages` array changes on every SSE event, causing PR extraction to re-run | `useMemo(() => extractPrReferences(messages), [messages])` — React memoization handles this. The extraction is O(n) over parts but very fast for typical message counts. |
| Polling hook re-creates interval on every PR list change | Stabilize with `useRef` for the latest PR list; compare serialized values before restarting interval. |
| GitHub rate limiting (5000 req/hr authenticated) | 15s poll × N PRs. At 4 PRs = ~960 req/hr — well within limits. For safety, respect `X-RateLimit-Remaining` header and back off if < 100. |
| Check suites API requires `checks:read` OAuth scope | The existing GitHub token may not have this scope. Handle 403 gracefully — show "none" for checks status, PR state still visible. |
| PR URLs in paginated (older) messages not loaded | `extractPrReferences` operates on the currently loaded `messages` array. If older messages with PR URLs are loaded via `loadOlderMessages`, they'll be picked up on next useMemo run. Acceptable limitation. |
| `GitHubPullRequest.state` type says `"merged"` but GitHub API only returns `"open" \| "closed"` | The existing type in `types.ts` already has `"merged"` as a state value — this is a local convention. The API route should derive merged status from `merged_at !== null` rather than relying on state field. |
