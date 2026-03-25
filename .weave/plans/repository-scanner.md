# Repository Scanner — Local Git Repository Browser

## TL;DR
> **Summary**: Add a "Repositories" feature that scans workspace roots for local git repositories and surfaces them in a new sidebar panel, settings tab, and detail page — enabling navigation and info viewing for all local projects.
> **Estimated Effort**: Medium

## Context

### Original Request
Build a Repository Scanner feature with five surface areas: (1) a Settings tab to manage workspace root directories, (2) backend API routes to scan roots for git repos, (3) a new sidebar icon rail button + panel listing discovered repositories grouped by root, (4) a repository detail page showing git info, and (5) a refresh mechanism.

### Key Findings

**Existing workspace_roots backend (fully built, no UI):**
- DB table `workspace_roots` with CRUD in `src/lib/server/db-repository.ts` — `listWorkspaceRoots()`, `insertWorkspaceRoot()`, `deleteWorkspaceRoot()`, `getWorkspaceRootByPath()`
- API routes at `GET/POST /api/workspace-roots` and `DELETE /api/workspace-roots/[id]` — handles env roots (read-only) vs user roots (deletable), validates paths, resolves symlinks, deduplicates
- `getEnvRoots()` in `process-manager.ts` reads `ORCHESTRATOR_WORKSPACE_ROOTS` env var (falls back to `$HOME`)
- `WorkspaceRootItem`, `WorkspaceRootsResponse`, `AddWorkspaceRootRequest`, `AddWorkspaceRootResponse` types already exist in `api-types.ts`

**Sidebar architecture:**
- `SidebarView = "welcome" | "fleet" | "github"` in `sidebar-context.tsx` — needs `"repositories"` added
- `PANEL_VIEWS = new Set(["fleet", "github"])` — needs `"repositories"` added
- `sidebar-icon-rail.tsx`: `VIEW_DEFAULT_ROUTE` map, `viewForPathname()` function, `IconRailButton` component for view togglers
- `sidebar-panel.tsx`: switches on `activeView` to render `<FleetPanel />` or `<GitHubPanel />` — needs `<RepositoriesPanel />`
- `sidebar.tsx`: orchestrates rail + contextual panel, no changes needed (uses `panelOpen` which derives from `PANEL_VIEWS`)

**GitHub panel as reference pattern:**
- `github-panel.tsx`: nav element with header row (icon + label as Link + action button), then a list of items with active highlighting via `usePathname()`
- Each item is a `Link` with `ContextMenu` wrapper
- Active state: `pathname === repoPath` → apply `bg-sidebar-accent text-sidebar-accent-foreground font-medium`
- Uses `useBookmarkedRepos()` for data, `useIntegrationsContext()` for connection check

**Hook patterns:**
- `use-github-repos.ts`: `useSyncExternalStore` with module-level cache, `listeners` Set, `emitChange()`, `setState()` — heavyweight shared cache pattern
- `use-bookmarked-repos.ts`: simpler `useState` + `useEffect` fetch-on-mount + callbacks pattern — better fit for our use case
- `apiFetch()` from `api-client.ts` for all frontend API calls

**Settings page:**
- `src/app/settings/page.tsx`: `Tabs` component with `TabsList variant="line"`, `TabsTrigger`, `TabsContent`
- Current tabs: Skills, Agents, Providers, Keybindings, Appearance, Integrations, About
- `integrations-tab.tsx` is the reference for a settings tab: card-based layout with `Card`, `CardContent`, `Badge`, `Button` from UI components

**Existing tests:**
- `sidebar-context.test.ts`: tests `viewHasPanel()` and toggle behavior — needs updating for `"repositories"`
- `sidebar-icon-rail.test.ts`: tests `viewForPathname()` and `nextViewForSwitch()` — needs updating for repositories routes

**Page patterns:**
- GitHub detail page `[owner]/[repo]/page.tsx`: uses `use(params)` to unwrap Next.js 16 async params, `Header` component, card layout
- GitHub index page `page.tsx`: `Header` + centered empty state or grid of cards
- Catch-all route pattern: `[...path]` folder with `page.tsx` — params yields `{ path: string[] }`

## Objectives

### Core Objective
Enable users to discover, browse, and inspect all git repositories under their configured workspace roots, surfaced through a first-class sidebar panel and detail pages.

### Deliverables
- [ ] Settings "Repositories" tab for managing workspace root directories
- [ ] `GET /api/repositories` — scan all workspace roots for git repos (server-cached)
- [ ] `POST /api/repositories/refresh` — force re-scan
- [ ] `GET /api/repositories/info?path=<encoded>` — git info for one repo
- [ ] `useRepositories()` hook — client-side data access
- [ ] `useRepositoryInfo(path)` hook — client-side single repo info
- [ ] Icon rail button with `FolderGit2` icon
- [ ] Repositories sidebar panel with collapsible root groups
- [ ] `/repositories` index page (placeholder)
- [ ] `/repositories/[...path]` detail page (git info cards)

### Definition of Done
- [ ] `npx tsc --noEmit` passes
- [ ] `npm run build` succeeds
- [ ] `npx vitest run` passes (including updated sidebar tests)
- [ ] Clicking Repositories icon shows panel with repos grouped by root
- [ ] Clicking a repo navigates to `/repositories/<encoded-path>` showing git info
- [ ] Settings > Repositories tab lists roots with add/delete functionality
- [ ] Refresh button in panel re-scans and updates the list

### Guardrails (Must NOT)
- Must NOT modify existing workspace_roots API routes — they are complete
- Must NOT break existing Fleet or GitHub panels
- Must NOT use `child_process.execSync("git ...")` for scanning — use `fs.existsSync` to check for `.git` directory
- Must NOT expose arbitrary filesystem access — scanning is confined to workspace roots
- For the info route, `child_process.execSync("git ...")` IS acceptable (reading git metadata for a validated path)
- Must NOT store scan results in the database — in-memory server cache only

## TODOs

### Slice 1: Types & API Infrastructure

- [x] 1. **Add repository types to api-types.ts**
  **What**: Add the following types to the shared types file:
  ```ts
  // ─── Repository Scanner Types ─────────────────────────────────────────────
  interface ScannedRepository {
    name: string;        // directory name, e.g. "my-project"
    path: string;        // absolute path, e.g. "/home/user/repos/my-project"
    parentRoot: string;  // the workspace root it was found under
  }

  interface RepositoryScanResponse {
    repositories: ScannedRepository[];
    scannedAt: number;   // timestamp of last scan
  }

  interface RepositoryInfo {
    name: string;
    path: string;
    branch: string | null;       // current HEAD branch name
    lastCommit: {
      hash: string;
      message: string;
      author: string;
      date: string;              // ISO timestamp
    } | null;
    remotes: Array<{ name: string; url: string }>;
  }

  interface RepositoryInfoResponse {
    repository: RepositoryInfo;
  }
  ```
  **Files**: `src/lib/api-types.ts`
  **Acceptance**: Types are exported and importable. `npx tsc --noEmit` passes.

- [x] 2. **Create repository scanning utility**
  **What**: Create a server-side utility module that implements the scanning logic. This keeps the route handler thin.
  - `scanWorkspaceRoots()`: For each workspace root from `getAllowedRoots()` (excluding the `.weave/workspaces` root), list immediate child directories using `fs.readdirSync` with `withFileTypes: true`. For each child that is a directory, check if `path.join(child, '.git')` exists via `fs.existsSync`. Return `ScannedRepository[]`.
  - Module-level cache: `let cachedResult: { repositories: ScannedRepository[]; scannedAt: number } | null = null`
  - `getCachedOrScan()`: returns cached result if available, otherwise scans and caches
  - `invalidateCache()`: sets cache to null
  - `getRepositoryInfo(repoPath: string)`: validates path is under an allowed root, then uses `child_process.execSync` to run: `git rev-parse --abbrev-ref HEAD`, `git log -1 --format='%H|%s|%an|%aI'`, `git remote -v`. Parse and return `RepositoryInfo`. Wrap in try/catch for repos with no commits.
  **Files**: `src/lib/server/repository-scanner.ts` (new)
  **Acceptance**: Module exports `getCachedOrScan()`, `invalidateCache()`, `getRepositoryInfo()`. TypeScript compiles.

- [x] 3. **Create GET /api/repositories route**
  **What**: Create the scan endpoint. Calls `getCachedOrScan()` from the scanner utility. Returns `RepositoryScanResponse` as JSON. Wraps in try/catch with proper error response.
  **Files**: `src/app/api/repositories/route.ts` (new)
  **Acceptance**: `GET /api/repositories` returns JSON with `{ repositories: [...], scannedAt: ... }`. Subsequent calls return cached result.

- [x] 4. **Create POST /api/repositories/refresh route**
  **What**: Force re-scan endpoint. Calls `invalidateCache()` then `getCachedOrScan()`. Returns the fresh `RepositoryScanResponse`.
  **Files**: `src/app/api/repositories/refresh/route.ts` (new)
  **Acceptance**: `POST /api/repositories/refresh` invalidates cache and returns fresh scan results.

- [x] 5. **Create GET /api/repositories/info route**
  **What**: Single-repo info endpoint. Reads `path` from query params (`request.nextUrl.searchParams.get("path")`). Validates path is non-empty and absolute. Calls `getRepositoryInfo(path)`. Returns `RepositoryInfoResponse`. Returns 400 for invalid paths, 404 if not a git repo.
  **Files**: `src/app/api/repositories/info/route.ts` (new)
  **Acceptance**: `GET /api/repositories/info?path=/home/user/my-project` returns git info JSON.

### Slice 2: Settings Tab (Workspace Roots UI)

- [x] 6. **Create RepositoriesTab settings component**
  **What**: Create the settings tab component following the `integrations-tab.tsx` pattern:
  - Description text: "Configure parent directories to scan for git repositories."
  - Fetch workspace roots on mount via `apiFetch("/api/workspace-roots")` → `WorkspaceRootsResponse`
  - Display each root as a `Card` with:
    - Path text
    - `Badge` showing source ("env" = "System" badge in muted style, "user" = "Custom" badge)
    - `Badge` showing exists status (green if exists, red "Missing" if not)
    - Delete `Button` (only for `source === "user"` roots) — calls `DELETE /api/workspace-roots/[id]` then refreshes list
  - "Add Directory" section at bottom: text `Input` for path + `Button` "Add". On submit, `POST /api/workspace-roots` with `{ path }`. Show error messages from API (already exists, not a directory, etc.) using inline error text below input. On success, refresh list and call `POST /api/repositories/refresh` to invalidate scan cache.
  - Loading state while fetching (use a simple `isLoading` boolean)
  **Files**: `src/components/settings/repositories-tab.tsx` (new)
  **Acceptance**: Component renders workspace roots with source badges. Can add/delete user roots. Error messages display correctly.

- [x] 7. **Add Repositories tab to settings page**
  **What**: Import `RepositoriesTab` and add it to the `Tabs` component between "Integrations" and "About":
  - Add `<TabsTrigger value="repositories">Repositories</TabsTrigger>` after the integrations trigger
  - Add `<TabsContent value="repositories" className="mt-4"><RepositoriesTab /></TabsContent>` after the integrations content
  **Files**: `src/app/settings/page.tsx`
  **Acceptance**: Settings page shows "Repositories" tab between "Integrations" and "About". Clicking it renders the repositories tab content.

### Slice 3: Client Hooks

- [x] 8. **Create useRepositories hook**
  **What**: Create a client hook following the `use-bookmarked-repos.ts` pattern (useState + useEffect fetch-on-mount):
  - State: `repositories: ScannedRepository[]`, `isLoading: boolean`, `error: string | null`, `scannedAt: number | null`
  - On mount: fetch `GET /api/repositories` via `apiFetch`, parse response, update state
  - `refresh()` callback: fetch `POST /api/repositories/refresh` via `apiFetch`, parse response, update state
  - Expose: `{ repositories, isLoading, error, scannedAt, refresh }`
  - Group helper (pure function, exported): `groupByRoot(repos: ScannedRepository[]): Map<string, ScannedRepository[]>` — groups repositories by `parentRoot`, sorted alphabetically within each group
  **Files**: `src/hooks/use-repositories.ts` (new)
  **Acceptance**: Hook fetches repositories on mount. `refresh()` triggers re-scan. `groupByRoot` utility works correctly.

- [x] 9. **Create useRepositoryInfo hook**
  **What**: Create a client hook for fetching single-repo info:
  - Takes `path: string | null` parameter (null = don't fetch)
  - State: `info: RepositoryInfo | null`, `isLoading: boolean`, `error: string | null`
  - On mount / when path changes: if path is non-null, fetch `GET /api/repositories/info?path=${encodeURIComponent(path)}` via `apiFetch`
  - Expose: `{ info, isLoading, error }`
  **Files**: `src/hooks/use-repository-info.ts` (new)
  **Acceptance**: Hook fetches repo info when path is provided. Returns null info when path is null.

### Slice 4: Sidebar Integration (Icon Rail + Panel)

- [x] 10. **Add "repositories" to SidebarView type and PANEL_VIEWS**
  **What**: Update the sidebar context:
  - Change `SidebarView` union: `"welcome" | "fleet" | "github" | "repositories"`
  - Add `"repositories"` to `PANEL_VIEWS` set: `new Set<SidebarView>(["fleet", "github", "repositories"])`
  - Update `migrateSidebarStorage()` validation — the existing code checks `PANEL_VIEWS.has(value as SidebarView) || value === "welcome"` which will automatically work since we added to `PANEL_VIEWS`
  **Files**: `src/contexts/sidebar-context.tsx`
  **Acceptance**: `viewHasPanel("repositories")` returns `true`. TypeScript accepts `"repositories"` as a `SidebarView`.

- [x] 11. **Update sidebar-icon-rail for repositories**
  **What**: Update three things in the icon rail:
  - (a) Import `FolderGit2` from `lucide-react`
  - (b) Add `repositories: "/repositories"` to `VIEW_DEFAULT_ROUTE`
  - (c) Update `viewForPathname()`: add `if (pathname === "/repositories" || pathname.startsWith("/repositories/")) return "repositories";` — insert BEFORE the `isFleetRoute` check
  - (d) Add `repositories: VIEW_DEFAULT_ROUTE.repositories` to `lastPathByView.current` initial value
  - (e) Add the icon rail button in the top section, between GitHub and the spacer:
    ```tsx
    <IconRailButton icon={FolderGit2} label="Repositories" view="repositories" onSwitch={handleSwitch} />
    ```
  **Files**: `src/components/layout/sidebar-icon-rail.tsx`
  **Acceptance**: Icon rail shows FolderGit2 icon between GitHub and the spacer. Clicking it activates repositories view. Navigating to `/repositories/*` keeps it active.

- [x] 12. **Create RepositoriesPanel component**
  **What**: Create the sidebar panel following `github-panel.tsx` pattern:
  - Header row: `FolderGit2` icon + "Repositories" label (as `Link` to `/repositories`) + refresh `Button` (with `RefreshCw` icon from lucide-react, calls `refresh()` from `useRepositories`)
  - Show loading spinner (`Loader2` icon with `animate-spin`) while `isLoading`
  - Group repos by root using `groupByRoot()`. For each root:
    - Collapsible section header showing the root path (use a button that toggles a local `expandedRoots` state — `useState<Set<string>>` initialized with all roots expanded)
    - `ChevronRight` icon that rotates when expanded (use `cn("transition-transform", expanded && "rotate-90")`)
    - Under each root, list repos as `Link` items to `/repositories/${encodeURIComponent(repo.path)}`
    - Active highlighting: `pathname === \`/repositories/${encodeURIComponent(repo.path)}\``
  - Empty state: "No repositories found. Add workspace roots in Settings > Repositories."
  - Error state: show error message with retry button
  **Files**: `src/components/layout/repositories-panel.tsx` (new)
  **Acceptance**: Panel shows repos grouped by root. Sections are collapsible. Clicking a repo navigates to its detail page. Refresh button works. Active repo highlighted.

- [x] 13. **Add RepositoriesPanel to sidebar-panel.tsx**
  **What**: Import `RepositoriesPanel` and add a rendering branch:
  - Add import: `import { RepositoriesPanel } from "@/components/layout/repositories-panel";`
  - Add rendering: `{activeView === "repositories" && <RepositoriesPanel />}` after the GitHub panel line
  - Update the `aria-label` to handle the new view: change from ternary to a lookup or add `"repositories"` case
  **Files**: `src/components/layout/sidebar-panel.tsx`
  **Acceptance**: Selecting repositories view shows the RepositoriesPanel in the sidebar.

### Slice 5: Repository Pages

- [x] 14. **Create /repositories index page**
  **What**: Create a simple index page following the `/github/page.tsx` pattern:
  - `Header` with title "Repositories" and subtitle "Browse local git repositories"
  - Centered content: `FolderGit2` icon + "Select a repository from the sidebar to view details." message
  - If no repositories exist (use `useRepositories()`), show a different message: "No repositories found. Configure workspace roots in Settings > Repositories." with a `Link` to `/settings` (hint to select the Repositories tab)
  **Files**: `src/app/repositories/page.tsx` (new)
  **Acceptance**: `/repositories` renders a placeholder page. Shows appropriate message based on whether repos exist.

- [x] 15. **Create /repositories/[...path] detail page**
  **What**: Create the catch-all detail page following the GitHub `[owner]/[repo]/page.tsx` pattern:
  - Use `use(params)` to get `{ path: string[] }` from Next.js 16 async params
  - Reconstruct the full path: `const repoPath = "/" + path.join("/")` (on Windows, need to handle differently — use `decodeURIComponent` on the joined path segments)
  - Actually, since we `encodeURIComponent` the full path in the panel Link, the catch-all will split on `/`. Better approach: encode the full path as a single URL-safe segment in the panel. Use `encodeURIComponent(repo.path)` which produces a single segment like `%2Fhome%2Fuser%2Fmy-project`. Then the route is `src/app/repositories/[path]/page.tsx` (single dynamic segment, NOT catch-all). Params: `{ path: string }` → `decodeURIComponent(path)` to get the original path.
  - **Correction**: Use `[path]` single dynamic segment (not `[...path]`) since we're encoding the entire path as one URL component. This is simpler and avoids path-splitting issues across platforms.
  - Use `useRepositoryInfo(repoPath)` to fetch git info
  - `Header` with title = repo name (last segment of path) and subtitle = full path
  - Loading state: skeleton or spinner
  - Error state: message with path shown
  - Success state: card-based layout with:
    - **Branch card**: Shows current branch name with `GitBranch` icon
    - **Last commit card**: Hash (truncated to 7 chars), message, author, date (formatted)
    - **Remotes card**: List of remote name + URL pairs
  - Use `Card`, `CardContent`, `CardHeader`, `CardTitle` from UI components
  **Files**: `src/app/repositories/[path]/page.tsx` (new)
  **Acceptance**: Navigating to `/repositories/<encoded-path>` shows git info cards. Loading/error states handled.

### Slice 6: Tests & Verification

- [x] 16. **Update sidebar context tests**
  **What**: Update the existing test to cover `"repositories"`:
  - Add `expect(viewHasPanel("repositories")).toBe(true)` to the "tracks panel visibility by view" test
  - Add a test for toggle behavior with repositories view (similar to the existing github toggle test)
  **Files**: `src/contexts/__tests__/sidebar-context.test.ts`
  **Acceptance**: `npx vitest run src/contexts/__tests__/sidebar-context.test.ts` passes.

- [x] 17. **Update sidebar icon rail tests**
  **What**: Update the existing tests to cover repositories routes:
  - Add `expect(viewForPathname("/repositories")).toBe("repositories")` and `expect(viewForPathname("/repositories/some-encoded-path")).toBe("repositories")` to the viewForPathname tests
  - Add `expect(nextViewForSwitch("repositories", "repositories")).toBe("welcome")` to nextViewForSwitch tests
  - Add `expect(nextViewForSwitch("fleet", "repositories")).toBe("repositories")` test
  **Files**: `src/components/layout/__tests__/sidebar-icon-rail.test.ts`
  **Acceptance**: `npx vitest run src/components/layout/__tests__/sidebar-icon-rail.test.ts` passes.

- [x] 18. **Create repository scanner utility tests**
  **What**: Unit tests for the server scanning utility:
  - Test `groupByRoot()` (the pure function exported from `use-repositories.ts`) with mock data
  - Test the path encoding/decoding roundtrip (encode a path, decode it, verify equality)
  **Files**: `src/hooks/__tests__/use-repositories.test.ts` (new)
  **Acceptance**: `npx vitest run src/hooks/__tests__/use-repositories.test.ts` passes.

- [x] 19. **Final verification**
  **What**: Run all checks to ensure no regressions:
  - `npx tsc --noEmit`
  - `npm run build`
  - `npx vitest run`
  **Files**: None (verification only)
  **Acceptance**: All three commands pass with zero errors.

## File Summary

| File | Action | Slice |
|------|--------|-------|
| `src/lib/api-types.ts` | Modify — add repository types | 1 |
| `src/lib/server/repository-scanner.ts` | **Create** — scanning logic + cache | 1 |
| `src/app/api/repositories/route.ts` | **Create** — GET scan endpoint | 1 |
| `src/app/api/repositories/refresh/route.ts` | **Create** — POST refresh endpoint | 1 |
| `src/app/api/repositories/info/route.ts` | **Create** — GET repo info endpoint | 1 |
| `src/components/settings/repositories-tab.tsx` | **Create** — settings tab component | 2 |
| `src/app/settings/page.tsx` | Modify — add Repositories tab | 2 |
| `src/hooks/use-repositories.ts` | **Create** — client hook + groupByRoot | 3 |
| `src/hooks/use-repository-info.ts` | **Create** — client hook for repo info | 3 |
| `src/contexts/sidebar-context.tsx` | Modify — add "repositories" to type + PANEL_VIEWS | 4 |
| `src/components/layout/sidebar-icon-rail.tsx` | Modify — add icon, route map, pathname mapping | 4 |
| `src/components/layout/repositories-panel.tsx` | **Create** — sidebar panel component | 4 |
| `src/components/layout/sidebar-panel.tsx` | Modify — add RepositoriesPanel rendering | 4 |
| `src/app/repositories/page.tsx` | **Create** — index page | 5 |
| `src/app/repositories/[path]/page.tsx` | **Create** — detail page | 5 |
| `src/contexts/__tests__/sidebar-context.test.ts` | Modify — add repositories tests | 6 |
| `src/components/layout/__tests__/sidebar-icon-rail.test.ts` | Modify — add repositories tests | 6 |
| `src/hooks/__tests__/use-repositories.test.ts` | **Create** — groupByRoot tests | 6 |

## Key Design Decisions

### Path encoding strategy
The repository detail page uses a **single dynamic segment** (`[path]`) rather than catch-all (`[...path]`). The full filesystem path is `encodeURIComponent`-encoded into one URL segment (e.g. `/repositories/%2Fhome%2Fuser%2Fmy-project`). This avoids platform-specific path-separator issues and simplifies decoding.

### Server-side scan cache
The scan result is cached in a **module-level variable** in `repository-scanner.ts`. This is reset when:
- `POST /api/repositories/refresh` is called (explicit refresh)
- The settings tab adds/deletes a workspace root (calls refresh after mutating)

No TTL-based expiry — the cache lives until server restart or explicit refresh. This is appropriate because filesystem changes (new repos being cloned) are infrequent and the refresh button provides manual control.

### Scanning scope
Only **immediate children** of workspace roots are checked for `.git` directories. No recursive scanning — this keeps it fast and predictable. The `.weave/workspaces` root (where worktree/clone isolation directories live) should be excluded from scanning to avoid showing ephemeral workspaces.

### Windows compatibility
- `child_process.execSync` for git commands uses `{ encoding: "utf8", cwd: repoPath }` — works cross-platform
- Path handling uses `path.join()` and `path.resolve()` — handles separators correctly
- `fs.readdirSync` with `withFileTypes: true` — cross-platform directory listing

## Verification
- [ ] `npx tsc --noEmit` passes
- [ ] `npm run build` succeeds
- [ ] `npx vitest run` passes
- [ ] Settings > Repositories tab shows workspace roots with add/delete
- [ ] Icon rail shows FolderGit2 button between GitHub and spacer
- [ ] Repositories panel shows repos grouped by root with collapsible sections
- [ ] Clicking a repo navigates to detail page with git info
- [ ] Refresh button re-scans and updates the panel
- [ ] Fleet and GitHub panels still work correctly
- [ ] Panel toggle (⌘B) works correctly with repositories view
