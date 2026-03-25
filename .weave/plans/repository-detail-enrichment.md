# Repository Detail Page Enrichment

## TL;DR
> **Summary**: Enrich the repository detail page (`/repositories/[path]`) from 3 simple cards to a full-featured view with stats banner, tabbed layout (Summary + Statistics placeholder), branches, tags, recent commits, README preview, and clickable remote links.
> **Estimated Effort**: Medium

## Context

### Original Request
The repository detail page currently shows 3 basic cards (Branch, Last Commit, Remotes). The user wants it enriched to match a screenshot showing: a stats banner (uncommitted files, total commits, first/last commit dates, remote links with GitHub shortcuts), a Summary tab with branches, tags, recent commits, and README preview, and a Statistics tab (placeholder).

### Key Findings

**Existing server-side scanner** (`src/lib/server/repository-scanner.ts`):
- Uses `execSync` with `cwd: repoPath` for git commands
- `getRepositoryInfo()` runs 3 quick git commands: `rev-parse`, `git log -1`, `git remote -v`
- Returns `RepositoryInfo` type with `name`, `path`, `branch`, `lastCommit`, `remotes`
- `validateRepoPath()` ensures path is under an allowed workspace root

**Existing API route** (`src/app/api/repositories/info/route.ts`):
- `GET /api/repositories/info?path=...` — validates path, checks `.git` exists, returns `RepositoryInfo`
- Simple and lean — extending it would make it heavier

**Existing client hook** (`src/hooks/use-repository-info.ts`):
- `useRepositoryInfo(path)` — fetches from `GET /api/repositories/info`, manages loading/error state
- Returns `{ info, isLoading, error }`

**Existing detail page** (`src/app/repositories/[path]/page.tsx`):
- Client component using `use(params)` for Next.js 16 async params
- Uses `Header`, `Card`, `CardContent`, `CardHeader`, `CardTitle` from UI components
- Shows branch, last commit, remotes in a responsive grid

**Available UI components** (`src/components/ui/`):
- `Card`, `Badge`, `Button`, `Tabs`/`TabsList`/`TabsTrigger`/`TabsContent`, `Separator`, `Avatar`/`AvatarFallback`, `Tooltip`/`TooltipTrigger`/`TooltipContent`, `ScrollArea`
- `TooltipProvider` already wraps the app in `client-layout.tsx`

**Relative time utilities** (already exist):
- `formatRelativeTime(timestamp, now?)` in `src/lib/format-utils.ts` — handles `number | Date | string`, returns "just now", "5m ago", "2h ago", or falls back to formatted date for >24h
- `useRelativeTime()` hook in `src/hooks/use-relative-time.ts` — shared 30s ticker for live-updating relative times
- `RelativeTimestamp` component in `src/components/session/relative-timestamp.tsx` — combines tooltip + relative time (takes `number` timestamp only)

**API design decision**: Create a **new endpoint** `GET /api/repositories/detail?path=...` rather than extending the existing `info` endpoint. Rationale:
1. The existing `info` endpoint is fast (3 quick git commands) and used by the sidebar panel for lightweight data
2. The enriched data requires 6+ additional git commands (some potentially slow on large repos)
3. Keeps backward compatibility — nothing that depends on `info` changes
4. A single new endpoint is simpler than multiple small endpoints (branches, tags, commits, readme each separate) — this is an internal tool, not a public API

**Git commands needed** (all `execSync` with `cwd: repoPath`):
| Data | Command |
|------|---------|
| Branches | `git branch -a --sort=-committerdate --format=%(refname:short)%x1F%(objectname:short)%x1F%(subject)%x1F%(authorname)%x1F%(authoremail)%x1F%(committerdate:iso)` |
| Tags | `git tag --sort=-creatordate --format=%(refname:short)%x1F%(objectname:short)%x1F%(creatordate:iso)%x1F%(taggername)%x1F%(taggeremail)` |
| Recent commits (10) | `git log -10 --format=%H%x1F%h%x1F%s%x1F%an%x1F%ae%x1F%aI` |
| Total commit count | `git rev-list --count HEAD` |
| First commit date | `git log --reverse --format=%aI -1` |
| Uncommitted file count | `git status --porcelain` (count non-empty lines) |
| README | `fs.readFileSync` for `README.md` / `README.MD` / `readme.md` / `README` in repo root |

**GitHub URL detection**: Parse remote URLs matching `git@github.com:owner/repo.git` or `https://github.com/owner/repo.git` to extract `owner/repo` and build links to the repo, issues, and pull requests pages.

## Objectives

### Core Objective
Replace the 3-card detail page with a rich, tabbed view showing comprehensive git repository information — stats banner, branches, tags, recent commits, README preview — matching the target screenshot layout.

### Deliverables
- [ ] New `RepositoryDetail` type with all enriched fields
- [ ] New `GET /api/repositories/detail` endpoint with full git data
- [ ] New `useRepositoryDetail(path)` client hook
- [ ] GitHub URL parser utility for constructing repo/issues/PRs links
- [ ] Redesigned detail page with stats banner + tabbed layout
- [ ] Summary tab: branches, tags, recent commits, README sections
- [ ] Statistics tab: placeholder with "Coming soon" message

### Definition of Done
- [ ] `npx tsc --noEmit` passes
- [ ] `npm run build` succeeds
- [ ] `npx vitest run` passes (no regressions, new tests pass)
- [ ] Detail page displays stats banner with commit count, dates, uncommitted count, remote links
- [ ] Summary tab shows branches, tags, commits, README
- [ ] Relative times update live (30s interval)
- [ ] GitHub remotes show clickable Repository/Issues/Pull Requests links
- [ ] Non-GitHub remotes display URL without GitHub-specific links
- [ ] Partial git command failures don't break the page (graceful degradation)

### Guardrails (Must NOT)
- Must NOT modify the existing `GET /api/repositories/info` endpoint or `RepositoryInfo` type — they serve the sidebar/panel
- Must NOT modify any API routes outside the repository scanner feature
- Must NOT introduce new npm dependencies (use existing: lucide-react, Tailwind, shadcn/ui, Radix)
- Must NOT use async git execution — stick with `execSync` pattern used throughout the scanner
- Must NOT render README as markdown — show raw text in a `<pre>` block (keeps scope bounded; markdown rendering can be a follow-up)

## TODOs

### Slice 1: Types & API

- [x] 1. **Add enriched repository detail types to `api-types.ts`**
  **What**: Add new types below the existing `RepositoryInfoResponse` interface. These are additive — existing types untouched.
  ```ts
  export interface BranchInfo {
    name: string;           // e.g. "main", "remotes/origin/feature-x"
    shortHash: string;      // abbreviated commit hash
    message: string;        // latest commit subject
    author: string;         // author name
    authorEmail: string;    // author email (for gravatar)
    date: string;           // ISO timestamp of latest commit
    isCurrent: boolean;     // true if this is the HEAD branch
    isRemote: boolean;      // true if starts with "remotes/" or "origin/"
  }

  export interface TagInfo {
    name: string;           // e.g. "v1.0.0"
    shortHash: string;      // abbreviated object hash
    date: string;           // ISO timestamp (creator date)
    tagger: string;         // tagger name (empty string for lightweight tags)
    taggerEmail: string;    // tagger email (empty string for lightweight tags)
  }

  export interface CommitInfo {
    hash: string;           // full SHA
    shortHash: string;      // abbreviated SHA
    message: string;        // subject line
    author: string;         // author name
    authorEmail: string;    // author email
    date: string;           // ISO timestamp
  }

  export interface GitHubRemoteInfo {
    owner: string;
    repo: string;
    repoUrl: string;        // https://github.com/owner/repo
    issuesUrl: string;      // https://github.com/owner/repo/issues
    pullsUrl: string;       // https://github.com/owner/repo/pulls
  }

  export interface RemoteInfo {
    name: string;           // e.g. "origin"
    url: string;            // raw URL
    github: GitHubRemoteInfo | null; // parsed GitHub info, null if not GitHub
  }

  export interface RepositoryDetail {
    name: string;
    path: string;
    branch: string | null;          // current HEAD branch
    uncommittedCount: number;       // number of uncommitted files (from git status)
    totalCommitCount: number;       // total commits on HEAD
    firstCommitDate: string | null; // ISO timestamp of initial commit
    lastCommitDate: string | null;  // ISO timestamp of most recent commit
    branches: BranchInfo[];         // all branches sorted by committer date desc
    tags: TagInfo[];                // all tags sorted by creator date desc
    recentCommits: CommitInfo[];    // last 10 commits
    remotes: RemoteInfo[];          // remotes with parsed GitHub info
    readmeContent: string | null;   // raw README text, null if not found
    readmeFilename: string | null;  // actual filename found (e.g. "README.md")
  }

  export interface RepositoryDetailResponse {
    repository: RepositoryDetail;
  }
  ```
  **Files**: `src/lib/api-types.ts` (modify — append after `RepositoryInfoResponse`)
  **Acceptance**: Types compile. `npx tsc --noEmit` passes. Existing `RepositoryInfo` unchanged.

- [x] 2. **Add `getRepositoryDetail()` function to repository scanner**
  **What**: Add a new function to `src/lib/server/repository-scanner.ts` that gathers all enriched data. Keep `getRepositoryInfo()` unchanged. The new function:

  **Imports to add**: `readFileSync` from `fs`, `join` from `path` (already imported).

  **New imports in type imports**: Add `RepositoryDetail`, `BranchInfo`, `TagInfo`, `CommitInfo`, `RemoteInfo`, `GitHubRemoteInfo` to the import from `@/lib/api-types`.

  **Helper function — `parseGitHubUrl(url: string): GitHubRemoteInfo | null`**:
  - Match against patterns:
    - SSH: `/^git@github\.com:([^/]+)\/([^/.]+?)(?:\.git)?$/`
    - HTTPS: `/^https?:\/\/github\.com\/([^/]+)\/([^/.]+?)(?:\.git)?$/`
  - If match found, extract `owner` and `repo`, construct URLs:
    - `repoUrl`: `https://github.com/${owner}/${repo}`
    - `issuesUrl`: `https://github.com/${owner}/${repo}/issues`
    - `pullsUrl`: `https://github.com/${owner}/${repo}/pulls`
  - Return `null` if no match

  **Helper function — `findReadme(repoPath: string): { content: string; filename: string } | null`**:
  - Check for files in order: `README.md`, `README.MD`, `readme.md`, `Readme.md`, `README`, `README.txt`
  - Use `existsSync(join(repoPath, filename))` for each
  - If found, `readFileSync(join(repoPath, filename), "utf8")`
  - Truncate to 50,000 characters max (prevent massive READMEs from bloating response)
  - Return `null` if none found

  **Main function — `getRepositoryDetail(repoPath: string): RepositoryDetail`**:
  - Reuse existing pattern: each git command in its own try/catch so partial failures return defaults
  - `name`: same logic as existing (`repoPath.split(/[\\/]/).filter(Boolean).at(-1) ?? repoPath`)
  - `branch`: same as existing `getRepositoryInfo` logic
  - `uncommittedCount`: `git status --porcelain` → split by `\n`, filter empty lines, count length. Default `0` on error.
  - `totalCommitCount`: `git rev-list --count HEAD` → `parseInt(output.trim(), 10)`. Default `0` on error.
  - `firstCommitDate`: `git log --reverse --format=%aI -1` → `trim()`. Default `null` on error.
  - `lastCommitDate`: `git log -1 --format=%aI` → `trim()`. Default `null` on error.
  - `branches`: `git branch -a --sort=-committerdate --format=%(refname:short)%x1F%(objectname:short)%x1F%(subject)%x1F%(authorname)%x1F%(authoremail)%x1F%(committerdate:iso)` → split lines, parse each with `\x1F` delimiter. Set `isCurrent` by comparing with `branch`. Set `isRemote` if name starts with `origin/` or `remotes/`. Filter out `HEAD` entries (e.g., `origin/HEAD -> origin/main`). Default `[]` on error.
  - `tags`: `git tag --sort=-creatordate --format=%(refname:short)%x1F%(objectname:short)%x1F%(creatordate:iso)%x1F%(taggername)%x1F%(taggeremail)` → split lines, parse. Default `[]` on error.
  - `recentCommits`: `git log -10 --format=%H%x1F%h%x1F%s%x1F%an%x1F%ae%x1F%aI` → split lines, parse. Default `[]` on error.
  - `remotes`: Reuse the existing remote-parsing logic from `getRepositoryInfo`, but enhance each entry by calling `parseGitHubUrl(url)` to populate the `github` field.
  - `readmeContent`/`readmeFilename`: Call `findReadme(repoPath)`.
  - Return all fields as a `RepositoryDetail` object.

  **Files**: `src/lib/server/repository-scanner.ts` (modify — add functions after `getRepositoryInfo`)
  **Acceptance**: Function compiles. Each git command failure is isolated. `parseGitHubUrl` correctly handles SSH and HTTPS GitHub URLs.

- [x] 3. **Create `GET /api/repositories/detail` route**
  **What**: New API route at `src/app/api/repositories/detail/route.ts`. Follow the exact same pattern as the existing `info/route.ts`:
  - Read `path` from `request.nextUrl.searchParams.get("path")`
  - Return 400 if missing
  - Call `validateRepoPath(inputPath)` — return 400 on validation error
  - Check `.git` exists — return 404 if not
  - Call `getRepositoryDetail(resolvedPath)` — return 500 on error
  - Return `{ repository: detail }` as JSON
  
  **Files**: `src/app/api/repositories/detail/route.ts` (new)
  **Acceptance**: `GET /api/repositories/detail?path=/some/repo` returns enriched JSON. Reuses same validation as `info` route. Error responses match existing pattern.

- [x] 4. **Create `useRepositoryDetail(path)` client hook**
  **What**: New hook at `src/hooks/use-repository-detail.ts`. Follow the exact same pattern as `use-repository-info.ts`:
  - Takes `path: string | null`
  - State: `detail: RepositoryDetail | null`, `isLoading: boolean`, `error: string | null`
  - `useEffect` fetches `GET /api/repositories/detail?path=${encodeURIComponent(path)}` via `apiFetch`
  - Cleanup via `cancelled` flag pattern (same as `use-repository-info.ts`)
  - Returns `{ detail, isLoading, error }`

  **Files**: `src/hooks/use-repository-detail.ts` (new)
  **Acceptance**: Hook fetches detail when path is non-null. Returns null when path is null. Loading/error states work correctly.

### Slice 2: Detail Page UI — Header & Stats Banner

- [x] 5. **Redesign the detail page layout with stats banner**
  **What**: Rewrite `src/app/repositories/[path]/page.tsx` to use the new `useRepositoryDetail` hook and display a stats banner + tabbed layout. This task covers the overall page structure, header, and stats banner. The tab contents are handled in subsequent tasks.

  **Page structure** (top to bottom):
  1. `<Header>` — title = repo name, subtitle = filesystem path, actions = external folder link button
  2. Stats banner — horizontal card with key metrics
  3. `<Tabs>` — "Summary" and "Statistics" tabs

  **Header changes**:
  - Keep using `<Header>` component
  - Add an action button in the `actions` slot: a `Button` variant="ghost" size="icon" with `ExternalLink` icon from lucide-react. On click, do nothing (filesystem links can't be opened from browser; show the path as a copyable tooltip instead). Actually, better: use a `FolderOpen` icon and make the subtitle selectable with a `title` attribute showing the full path. The external link concept doesn't work in a web app — remove it, keep header simple.

  **Stats banner** (a `Card` spanning full width):
  - Horizontal flex layout with dividers between sections
  - Section 1: **Uncommitted** — `FileWarning` icon + `detail.uncommittedCount` count + "uncommitted files" label
  - Section 2: **Commits** — `GitCommit` icon + `detail.totalCommitCount` count + "total commits" label
  - Section 3: **First Commit** — `Calendar` icon + formatted date of `detail.firstCommitDate` (use `formatRelativeTime` for recent, or `toLocaleDateString` for old dates — actually just use `new Date(date).toLocaleDateString()` since first commit is always old)
  - Section 4: **Last Commit** — `Clock` icon + `formatRelativeTime(detail.lastCommitDate)` with `useRelativeTime()` for live updates
  - Section 5: **Remotes** — For each remote that has `github` info, show the remote name as a label plus three links: "GitHub" → `repoUrl`, "Issues" → `issuesUrl`, "PRs" → `pullsUrl` — each as a small `Button` variant="link" size="sm" with `ExternalLink` icon, opening in new tab (`target="_blank" rel="noopener noreferrer"`). For non-GitHub remotes, just show the URL.

  **Tabs skeleton**:
  - `<Tabs defaultValue="summary">` wrapping `<TabsList>` with two triggers: "Summary" and "Statistics"
  - `<TabsContent value="summary">` — placeholder `<div>` (filled in next tasks)
  - `<TabsContent value="statistics">` — placeholder "Coming soon" message

  **Loading state**: Same spinner as current page
  **Error state**: Same error display as current page

  **Imports needed**:
  - From `lucide-react`: `GitBranch`, `GitCommit`, `Globe`, `Loader2`, `ExternalLink`, `FileWarning`, `Clock`, `Calendar`, `Tag`, `BookOpen`
  - From `@/components/ui/card`: `Card`, `CardContent`, `CardHeader`, `CardTitle`
  - From `@/components/ui/tabs`: `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent`
  - From `@/components/ui/badge`: `Badge`
  - From `@/components/ui/button`: `Button`
  - From `@/components/ui/separator`: `Separator`
  - From `@/hooks/use-repository-detail`: `useRepositoryDetail`
  - From `@/hooks/use-relative-time`: `useRelativeTime`
  - From `@/lib/format-utils`: `formatRelativeTime`
  - From `@/components/layout/header`: `Header`

  **Switch from `useRepositoryInfo` to `useRepositoryDetail`**: The page will no longer import `use-repository-info`.

  **Files**: `src/app/repositories/[path]/page.tsx` (rewrite)
  **Acceptance**: Page renders header + stats banner + tab shells. Stats show correct data. GitHub remote links open in new tabs. Loading/error states work.

### Slice 3: Summary Tab Sections

- [x] 6. **Build the Branches section**
  **What**: Create a `BranchesSection` component (can be defined inline in the page file or as a separate component — recommend inline in the page file to keep things simple, or extract to `src/components/repositories/branches-section.tsx` if it gets large). 
  
  **Recommendation**: Extract all four summary sections into a single new file `src/components/repositories/repository-summary.tsx` that exports a `RepositorySummary` component accepting `detail: RepositoryDetail`. This keeps the page file clean.

  **Branches section layout**:
  - Section header: `GitBranch` icon + "Branches" text + `Badge` showing count (`detail.branches.length`)
  - Filter: Show local branches by default. Optionally show a small toggle/filter to include remote branches (simple: show all, with remote branches having a dimmer style). For simplicity in v1, show all branches but visually distinguish remote ones.
  - Each branch row (in a `Card` or simple list):
    - Branch name (font-mono, with `Badge variant="outline"` for the current branch saying "HEAD" or a `★` indicator)
    - Latest commit message (truncated with `truncate` class)
    - Author name
    - Relative time (use `formatRelativeTime(branchDate, now)` where `now` comes from `useRelativeTime()` — but since this is inside a child component, pass `now` as a prop from the page)
  - If no branches: "No branches found" in muted text
  - Layout: Vertical list, each branch as a row with flex layout

  **Files**: `src/components/repositories/repository-summary.tsx` (new)
  **Acceptance**: Branches render with name, commit message, author, relative time. Current branch is visually marked.

- [x] 7. **Build the Tags section**
  **What**: Add a tags section to `RepositorySummary`.

  **Tags section layout**:
  - Section header: `Tag` icon + "Tags" text + `Badge` showing count
  - Each tag row:
    - Tag name (font-mono)
    - Tagger name (or "lightweight tag" in muted if tagger is empty)
    - Relative time
  - If no tags: "No tags" in muted text
  - Layout: Similar vertical list to branches

  **Files**: `src/components/repositories/repository-summary.tsx` (modify — add tags section)
  **Acceptance**: Tags render with name, tagger, relative time. Empty state handled.

- [x] 8. **Build the Recent Commits section**
  **What**: Add a recent commits section to `RepositorySummary`.

  **Commits section layout**:
  - Section header: `GitCommit` icon + "Recent Commits" text
  - Each commit row:
    - Short hash in a `Badge variant="secondary"` or `<code>` element (font-mono, muted)
    - Commit message (truncated)
    - Author name
    - Relative time
  - Layout: Vertical list, visually similar to branches/tags

  **Files**: `src/components/repositories/repository-summary.tsx` (modify — add commits section)
  **Acceptance**: Recent commits display with hash, message, author, relative time.

- [x] 9. **Build the README section**
  **What**: Add a README preview section to `RepositorySummary`.

  **README section layout**:
  - Section header: `BookOpen` icon + "README" text + filename in muted text (e.g., "README.md")
  - Content: `<pre>` block with `whitespace-pre-wrap`, `text-sm`, `font-mono` classes, inside a `Card`. Max height with overflow-auto (e.g., `max-h-96 overflow-auto thin-scrollbar`).
  - If no README: "No README found" in muted text
  - Do NOT render as markdown — plain text only (markdown rendering is a future enhancement)

  **Files**: `src/components/repositories/repository-summary.tsx` (modify — add README section)
  **Acceptance**: README text displays in a scrollable pre block. Absent README shows empty state.

- [x] 10. **Wire `RepositorySummary` into the detail page**
  **What**: Import `RepositorySummary` in the detail page and render it inside `<TabsContent value="summary">`. Pass `detail` and `now` (from `useRelativeTime()`) as props.

  Also add the Statistics tab placeholder content inside `<TabsContent value="statistics">`:
  - Centered text: `BarChart3` icon + "Statistics" heading + "Coming soon — commit frequency, contributor breakdown, and more." in muted text

  **Files**: `src/app/repositories/[path]/page.tsx` (modify — fill in tab contents)
  **Acceptance**: Summary tab shows all four sections. Statistics tab shows placeholder. Switching tabs works.

### Slice 4: Tests

- [x] 11. **Unit tests for `parseGitHubUrl` helper**
  **What**: Create tests for the GitHub URL parser function. Export it from `repository-scanner.ts` for testability (it's a pure function, safe to export).

  Test cases:
  - SSH URL: `git@github.com:owner/repo.git` → extracts owner/repo, constructs correct URLs
  - SSH URL without `.git`: `git@github.com:owner/repo` → works
  - HTTPS URL: `https://github.com/owner/repo.git` → works
  - HTTPS URL without `.git`: `https://github.com/owner/repo` → works
  - HTTP URL: `http://github.com/owner/repo.git` → works
  - Non-GitHub SSH: `git@gitlab.com:owner/repo.git` → returns `null`
  - Non-GitHub HTTPS: `https://gitlab.com/owner/repo.git` → returns `null`
  - Malformed URL: `not-a-url` → returns `null`
  - Empty string: `""` → returns `null`

  **Files**: `src/lib/server/__tests__/repository-scanner.test.ts` (new)
  **Acceptance**: `npx vitest run src/lib/server/__tests__/repository-scanner.test.ts` passes.

- [x] 12. **Unit tests for `findReadme` helper**
  **What**: Test the README file finder. Since it uses `fs.existsSync` and `fs.readFileSync`, tests should use a temp directory (via `os.tmpdir()` + `fs.mkdtempSync`) or mock `fs` functions. Recommend using a real temp directory for simplicity.

  Test cases:
  - Directory with `README.md` → returns content and filename
  - Directory with `README.MD` (uppercase) → returns content and filename
  - Directory with no README file → returns `null`
  - Priority: if both `README.md` and `README` exist, `README.md` wins (first in search order)

  **Files**: `src/lib/server/__tests__/repository-scanner.test.ts` (modify — add tests)
  **Acceptance**: Tests pass.

- [ ] 13. **Final verification**
  **What**: Run all checks to confirm no regressions:
  - `npx tsc --noEmit`
  - `npm run build`
  - `npx vitest run`
  **Files**: None (verification only)
  **Acceptance**: All three commands pass with zero errors.

## File Summary

| File | Action | Slice |
|------|--------|-------|
| `src/lib/api-types.ts` | Modify — append enriched types after existing `RepositoryInfoResponse` | 1 |
| `src/lib/server/repository-scanner.ts` | Modify — add `parseGitHubUrl`, `findReadme`, `getRepositoryDetail` | 1 |
| `src/app/api/repositories/detail/route.ts` | **Create** — GET detail endpoint | 1 |
| `src/hooks/use-repository-detail.ts` | **Create** — client hook for enriched data | 1 |
| `src/app/repositories/[path]/page.tsx` | Rewrite — stats banner + tabs layout | 2 |
| `src/components/repositories/repository-summary.tsx` | **Create** — branches, tags, commits, README sections | 3 |
| `src/lib/server/__tests__/repository-scanner.test.ts` | **Create** — tests for parseGitHubUrl, findReadme | 4 |

## Key Design Decisions

### New endpoint vs. extending existing
A new `GET /api/repositories/detail` endpoint is created rather than extending `GET /api/repositories/info`. The `info` endpoint remains lean for sidebar usage. The `detail` endpoint runs 7+ git commands and reads the filesystem for README — it's heavier by nature and only called when a user opens the detail page.

### All git commands in isolated try/catch
Each git command in `getRepositoryDetail()` is wrapped in its own try/catch block with sensible defaults (`0` for counts, `null` for dates, `[]` for lists). This ensures:
- Repos with no commits don't crash the whole page
- Repos with no tags still show branches and commits
- Permission issues on one command don't block others

### Reuse of relative time infrastructure
The existing `formatRelativeTime()` utility, `useRelativeTime()` hook, and `RelativeTimestamp` component are reused. The Summary component receives `now` from `useRelativeTime()` to enable live-updating timestamps without each row needing its own hook subscription.

### README as plain text
README content is returned as raw text and displayed in a `<pre>` block. Markdown rendering (via `react-markdown` or similar) is explicitly out of scope to avoid adding dependencies and complexity. It can be a follow-up enhancement.

### GitHub URL parsing scope
Only GitHub URLs are parsed for special links (repo, issues, PRs). GitLab, Bitbucket, etc. are shown as plain URLs. The parser handles both SSH (`git@github.com:`) and HTTPS (`https://github.com/`) formats, with or without `.git` suffix.

### Component extraction strategy
Summary tab sections are extracted into `src/components/repositories/repository-summary.tsx` rather than inline in the page. This keeps the page file focused on layout/routing and the summary component focused on rendering data sections. The four sections (branches, tags, commits, README) are built incrementally as separate tasks but live in the same file.

## Verification
- [ ] `npx tsc --noEmit` passes
- [ ] `npm run build` succeeds
- [ ] `npx vitest run` passes
- [ ] Detail page shows stats banner with commit count, dates, uncommitted count
- [ ] GitHub remotes show clickable Repository / Issues / PRs links
- [ ] Summary tab shows branches with current branch highlighted
- [ ] Summary tab shows tags with tagger and relative time
- [ ] Summary tab shows recent commits with hash, message, author, time
- [ ] Summary tab shows README content in scrollable pre block
- [ ] Statistics tab shows "Coming soon" placeholder
- [ ] Relative timestamps update every 30 seconds
- [ ] Page handles repos with no commits gracefully
- [ ] Page handles repos with no tags gracefully
- [ ] Page handles repos with no README gracefully
- [ ] Existing `GET /api/repositories/info` endpoint unchanged and still works
