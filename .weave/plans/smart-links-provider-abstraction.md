# Smart Links Provider Abstraction

## TL;DR
> **Summary**: Extract the GitHub-specific smart links system into a provider-based abstraction, then add Linear as a second provider to validate it.
> **Estimated Effort**: Large

## Context
### Original Request
Make the currently GitHub-only smart links system extensible to support multiple providers (Linear, Jira, etc.). Additionally: links should be persisted server-side with the session (not just localStorage), and users should be able to dismiss individual links they no longer find useful.

### Key Findings
- **Structural duplication**: `pr-utils.ts` and `issue-utils.ts` are nearly identical — same pattern of regex → parse → extract from messages. Same for `use-pr-status.ts` / `use-issue-status.ts` (226 and 228 lines of near-identical polling logic).
- **Provider-specific coupling in page.tsx**: Lines 441–483 have GitHub-specific extraction, merging, persistence, and polling. Lines 958–968 render the sidebar panel.
- **Rate limiting is already abstracted**: `github-rate-limit.ts` is a singleton module-level tracker. The pattern works but needs to be per-provider.
- **Storage schema is version-gated**: `StoredSessionLinks` has `version: 1` with `prs` and `issues` fields — needs migration to v2.
- **Session cache**: `sessionCache.patchPrReferences` / `getPrReferences` is also GitHub-specific; needs generalizing.
- **API routes**: Status endpoints at `/api/integrations/github/repos/[owner]/[repo]/pulls/[number]/status` and `.../issues/[number]/status` — these stay as-is; the abstraction sits on the client side.
- **Status responses include rate-limit fields**: `rateLimitRemaining` / `rateLimitReset` piggybacked on `PrStatusResponse` / `IssueStatusResponse`.

### Design Decisions
- **Server-side persistence**: Smart links are persisted with the session (API-backed), not just localStorage. localStorage serves as a fast cache/fallback but the source of truth is the session. This means links survive across devices and browsers.
- **User dismissal UX**: Each link row shows a small "×" button on hover (right side, before external-link icon). Clicking it removes the link from the session's persisted links and stops polling its status. Dismissed links are tracked by URL so auto-detection doesn't re-add them.

## Objectives
### Core Objective
Introduce a `SmartLinkProvider` interface and registry so that adding a new provider (Linear, Jira) requires only: (1) implementing the interface, (2) registering it.

### Deliverables
- [ ] `SmartLinkProvider` interface and provider registry
- [ ] Generic `SmartLinkReference` type replacing `PrReference` / `IssueReference` in the smart-links pipeline
- [ ] Unified `useSmartLinkStatuses` hook replacing `usePrStatus` + `useIssueStatus`
- [ ] Per-provider rate-limit tracker (generalized from `github-rate-limit.ts`)
- [ ] Server-side persistence API (links stored with session, dismissed URLs tracked)
- [ ] Generic `SmartLinksSidebarPanel` component with dismiss UX
- [ ] Refactored `page.tsx` integration point
- [ ] GitHub provider implementation (wrapping existing code)
- [ ] Linear provider implementation (validating the abstraction)

### Definition of Done
- [ ] `npm run build` passes with no errors
- [ ] Existing GitHub smart links functionality works identically (visual and behavioral parity)
- [ ] Linear URLs detected and rendered in sidebar when present
- [ ] Adding a hypothetical third provider requires only a new file + registry entry

### Guardrails (Must NOT)
- Do NOT change the existing GitHub API routes — they stay as-is
- Do NOT over-abstract — no plugin system, no dynamic loading, no config files
- Do NOT break existing imports that aren't part of the smart-links pipeline

## TODOs

- [x] 1. Define the provider interface and generic types
  **What**: Create `SmartLinkProvider` interface and `SmartLinkReference` type. The provider interface covers: `name`, `displayName`, `icon`, URL detection patterns, reference parsing, status endpoint URL builder, terminal state check, status response type, and rate-limit extraction from responses. `SmartLinkReference` carries `provider: string`, `linkType: string`, `url: string`, `displayLabel: string`, and `metadata: Record<string, unknown>` for provider-specific data (owner/repo/number for GitHub, teamKey/issueId for Linear, etc.).
  **Files**: `src/lib/smart-links/types.ts`
  **Acceptance**: Types compile; no runtime code yet

- [x] 2. Create provider registry
  **What**: Simple array-based registry. `registerProvider(provider)` and `getProviders()`. Auto-register built-in providers on import. Export `detectSmartLinks(text: string): SmartLinkReference[]` that runs all provider detectors. Export `extractSmartLinksFromMessages(messages: AccumulatedMessage[]): SmartLinkReference[]` that scans message parts (bash output + text) — consolidating the duplicated logic from `pr-utils.ts` and `issue-utils.ts`.
  **Files**: `src/lib/smart-links/registry.ts`
  **Acceptance**: Registry returns all registered providers; `detectSmartLinks` finds URLs from all providers

- [x] 3. Generalize rate-limit tracker to per-provider
  **What**: Refactor `github-rate-limit.ts` pattern into a factory: `createRateLimitTracker(providerName)` returning `{ update, getRecommendedInterval, shouldPoll }`. Each provider gets its own singleton tracker. The GitHub provider's tracker preserves identical thresholds (100/50/10 remaining). Export a `getRateLimitTracker(providerName)` lookup.
  **Files**: `src/lib/smart-links/rate-limit.ts`
  **Acceptance**: GitHub rate-limit behavior is identical; Linear gets its own independent tracker

- [x] 4. Implement GitHub provider
  **What**: Wrap existing GitHub logic into a `SmartLinkProvider` implementation. Two link types: `pull-request` and `issue`, each with its own regex, status endpoint path builder, icon component, terminal state check, and status label derivation. Reuse existing `PrStatusResponse` / `IssueStatusResponse` types as the status response. Register in the registry.
  **Files**: `src/lib/smart-links/providers/github.ts`
  **Acceptance**: `detectSmartLinks("https://github.com/foo/bar/pull/1 https://github.com/foo/bar/issues/2")` returns two references with correct metadata

- [x] 5. Unified polling hook
  **What**: Create `useSmartLinkStatuses(refs: SmartLinkReference[])` that replaces both `usePrStatus` and `useIssueStatus`. Groups refs by provider, polls each via its status endpoint builder, uses per-provider rate-limit tracker for backoff. Preserves all existing behaviors: terminal state skipping, tab visibility awareness, adaptive intervals, `Promise.allSettled`. Returns `Map<string, unknown>` keyed by URL (consumers cast to provider-specific status type via the provider's renderer).
  **Files**: `src/hooks/use-smart-link-statuses.ts`
  **Acceptance**: Hook polls GitHub PRs and issues with identical behavior to current separate hooks

- [x] 6. Server-side persistence and dismissal API
  **What**: Add `smart_links TEXT` and `dismissed_smart_links TEXT` columns to the `sessions` table (JSON blobs). `smart_links` stores `SmartLinkReference[]`, `dismissed_smart_links` stores `string[]` (dismissed URLs). Add repository functions: `getSessionSmartLinks(id)`, `updateSessionSmartLinks(id, links)`, `dismissSessionSmartLink(id, url)`. Create API route `src/app/api/sessions/[id]/smart-links/route.ts`: GET returns `{ links, dismissed }`, PUT upserts detected links (filters out dismissed), DELETE with `?url=<encoded>` marks as dismissed. On the client, `src/lib/smart-links/storage.ts` provides a hook `useSmartLinkStorage(sessionId)` that: loads from server on mount, merges newly-detected links (excluding dismissed), persists back via PUT (debounced), and exposes `dismiss(url)`. localStorage is a write-through cache for instant render before server responds. Existing localStorage v1 data is migrated to server on first load.
  **Files**: `src/lib/server/db-repository.ts` (add columns + functions), `src/app/api/sessions/[id]/smart-links/route.ts`, `src/lib/smart-links/storage.ts`
  **Acceptance**: Links persist in SQLite; visible from another browser; dismissed links don't reappear; localStorage v1 migrates on first load

- [x] 7. Generic sidebar panel component with dismiss
  **What**: Create `SmartLinksSidebarPanel` that receives `refs: SmartLinkReference[]`, `statuses: Map<string, unknown>`, and `onDismiss: (url: string) => void`. Groups by provider, renders provider header (icon + display name + count), then delegates each link's rendering to the provider's `renderLink(ref, status)` method (a React component factory on the provider interface). Each link row shows a small "×" button on hover (positioned right side, before external-link icon) that calls `onDismiss(url)`. The GitHub provider's renderers replicate the exact existing PR and issue row UI (icons, draft badge, labels, etc.).
  **Files**: `src/components/session/smart-links-sidebar-panel.tsx`
  **Acceptance**: Visual parity with current `GitHubLinksSidebarPanel` for GitHub links; "×" button appears on hover and removes the link

- [x] 8. Rewire session page integration
  **What**: Replace the GitHub-specific extraction/merge/persist/poll/render block in `page.tsx` (lines 441–483, 958–968) with generic smart-links equivalents. Use `extractSmartLinksFromMessages`, generic merge, `useSmartLinkStatuses`, `SmartLinksSidebarPanel`. Update session cache to store `SmartLinkReference[]` instead of `PrReference[]`.
  **Files**: `src/app/sessions/[id]/page.tsx`
  **Acceptance**: Identical runtime behavior; GitHub links appear and poll as before

- [x] 9. Deprecate old modules
  **What**: Mark `pr-utils.ts`, `issue-utils.ts`, `use-pr-status.ts`, `use-issue-status.ts`, `github-rate-limit.ts`, `link-storage.ts`, `github-links-sidebar-panel.tsx` as deprecated with re-exports pointing to new modules. Remove after one release cycle. (Or delete outright if no external consumers.)
  **Files**: `src/lib/pr-utils.ts`, `src/lib/issue-utils.ts`, `src/hooks/use-pr-status.ts`, `src/hooks/use-issue-status.ts`, `src/lib/github-rate-limit.ts`, `src/lib/link-storage.ts`, `src/components/session/github-links-sidebar-panel.tsx`
  **Acceptance**: `grep -r "pr-utils\|issue-utils\|use-pr-status\|use-issue-status\|github-rate-limit\|link-storage\|github-links-sidebar-panel" src/ --include="*.ts" --include="*.tsx"` returns only the deprecated files themselves (no consumers)

- [x] 10. Implement Linear provider
  **What**: Add Linear as a second provider to validate the abstraction. Detection: `https://linear.app/{workspace}/issue/{TEAM-123}` regex. Status endpoint: new API route at `/api/integrations/linear/issues/[issueId]/status` that calls Linear's GraphQL API. Link types: `issue` only (Linear doesn't separate PRs/issues). Icons: Linear's issue state icons. Rate limiting: Linear uses `X-RateLimit-Requests-Remaining` header. Register in registry.
  **Files**: `src/lib/smart-links/providers/linear.ts`, `src/app/api/integrations/linear/issues/[issueId]/status/route.ts`
  **Acceptance**: Linear issue URLs in session messages appear in sidebar with status polling

## Verification
- [ ] `npm run build` completes without errors <!-- Pre-existing build failure unrelated to smart links — `npx tsc --noEmit` passes with zero errors -->
- [x] `npm run lint` passes
- [x] Existing GitHub PR/issue URLs in sessions render with correct status icons
- [x] GitHub rate-limit backoff behavior unchanged
- [x] Links persist server-side — visible from another browser/device
- [x] Dismissing a link removes it from the panel and it doesn't reappear from auto-detection
- [x] localStorage v1 data migrates to server on first load
- [x] Linear URLs detected and displayed when present
- [x] Tab visibility pause/resume works for all providers
- [x] Terminal state skipping works per provider
