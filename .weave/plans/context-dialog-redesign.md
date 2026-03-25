# Context Dialog Redesign

## TL;DR
> **Summary**: Redesign the "Create Session From Context" dialog (`create-session-button.tsx`) to mirror the "New Session" dialog's source mode toggle, repository selector, and branch name field — while keeping the GitHub context badge, the `clone` isolation strategy, and the `contextSource` pass-through.
> **Estimated Effort**: Medium

## Context
### Original Request
Make the context dialog behave more like the New Session dialog: add Repository/Directory source mode toggle, repository selection dropdown, branch name field (repo+worktree), and auto-match the scanned local repo from the GitHub metadata — while keeping the GitHub Issue/PR badge at top and the `clone` isolation strategy in directory mode.

### Key Findings
1. **Metadata has `owner` and `repo`** — `contextSource.metadata.owner` and `contextSource.metadata.repo` are set in both `issue-row.tsx` and `pr-row.tsx` (and in `manifest.ts` for URL-resolved contexts). These are the GitHub repo name (e.g. `"weave"`) and owner (e.g. `"damianh"`).
2. **`ScannedRepository` has `name` and `path`** — The `name` field is the directory name (e.g. `"weave"`). There are no remote URLs on the scanned list. Auto-matching must compare `contextSource.metadata.repo` to `ScannedRepository.name` (case-insensitive). This is a heuristic — a repo named `"weave"` locally will match GitHub's `"weave"` — but it's the best we can do without enriching the scan API.
3. **`useRepositories()` hook** is already used in `new-session-dialog.tsx` and can be added to the context dialog identically.
4. **`useCreateSession()` hook** already supports `isolationStrategy: "existing" | "worktree" | "clone"` and `branch`, `context` fields — no backend changes needed.
5. **The context dialog is ~200 lines, the new session dialog is ~551 lines.** The redesigned context dialog will be ~400–450 lines (it's the new session dialog plus the context badge, auto-matching, and clone strategy — minus the DialogTrigger/controlled-open complexity).
6. **No shared extracted components exist** for source mode toggle, repo selector, or strategy picker — they're inline in `new-session-dialog.tsx`. Extracting them into shared components is tempting but would touch a working dialog; the plan avoids this to limit blast radius. A follow-up extraction can be done later.
7. **The `directory` prop** is never passed by either `issue-row.tsx` or `pr-row.tsx` today, but the interface supports it.

## Objectives
### Core Objective
Unify the "Create Session From Context" dialog UX with the "New Session" dialog, so users get the same repository-aware session creation workflow when starting from a GitHub issue or PR.

### Deliverables
- [ ] Redesigned `create-session-button.tsx` with source mode toggle, repository selector, isolation strategy, branch name, and title fields
- [ ] Auto-match scanned local repo from GitHub metadata on dialog open
- [ ] `clone` isolation strategy available in directory mode only
- [ ] Existing behavior preserved: context badge, contextSource pass-through, title pre-fill

### Definition of Done
- [ ] `npm run build` passes (no type errors)
- [ ] Manual test: open the context dialog from a GitHub issue row → repo mode is auto-selected if a matching scanned repo exists, repo dropdown shows it pre-selected
- [ ] Manual test: switch to directory mode → isolation strategy shows existing/clone, directory picker appears
- [ ] Manual test: switch to repo mode → isolation strategy shows worktree/existing, branch field appears when worktree selected
- [ ] Manual test: create session in each mode (repo+existing, repo+worktree, directory+existing, directory+clone) → session creates successfully with `contextSource` attached

### Guardrails (Must NOT)
- Do NOT modify `new-session-dialog.tsx` — this is a one-directional port, not a refactor
- Do NOT modify `use-create-session.ts` or `use-repositories.ts` — the hooks already support all needed functionality
- Do NOT modify `issue-row.tsx` or `pr-row.tsx` — the `CreateSessionButton` interface stays the same
- Do NOT extract shared sub-components in this PR — scope creep risk; do it as a follow-up

## UX Flow: Dialog Layout by Mode

### On Open
1. GitHub context badge + URL displayed at top (unchanged).
2. Source mode toggle: **Repository** / **Directory** (like new session dialog).
3. Default source mode selection:
   - If `contextSource.metadata.repo` matches a `ScannedRepository.name` (case-insensitive) → **Repository** mode, that repo pre-selected.
   - Else if scanned repos exist but none match → **Repository** mode, no repo pre-selected.
   - Else if no scanned repos → **Directory** mode (Repository button disabled, like new session dialog).
   - If `directory` prop is provided → override to **Directory** mode with that directory pre-filled.

### Repository Mode
- **Repository dropdown** — type-ahead searchable, identical to new session dialog. Pre-selected repo highlighted.
- **Isolation Strategy** — Worktree (default) / Directory (existing). Same 2 options as new session dialog.
- **Title** — pre-filled from `contextSource.title`.
- **Branch** — shown when worktree selected. Auto-generated from title (using `generateBranchName()`).

### Directory Mode
- **Directory picker** — DirectoryPicker component (existing).
- **Isolation Strategy** — Directory (existing) / Clone. The `clone` strategy is GitHub-specific and stays available here. `existing` is default.
- **Title** — pre-filled from `contextSource.title`.
- No branch field.

### On Submit
- `createSession(effectiveDirectory, { title, isolationStrategy, branch, context: contextSource })`
- Navigates to the new session page (unchanged).

## TODOs

- [ ] 1. **Add imports and hook wiring**
  **What**: Import `useRepositories`, `ScannedRepository`, add `useMemo`/`useEffect`/`useRef`/`useCallback` as needed. Call `useRepositories()` in the component. Add `refreshRepos` on dialog open (matching new session dialog pattern).
  **Files**: `src/integrations/github/components/create-session-button.tsx`
  **Acceptance**: Hook is called, `repositories` array is available, repos refresh on dialog open.

- [ ] 2. **Add source mode state and auto-matching logic**
  **What**: Add `sourceMode` state (`"repository" | "directory"`). Add a `useMemo` or `useEffect` that runs on dialog open to:
  - Extract `owner` and `repo` from `contextSource.metadata` (cast as `{ owner?: string; repo?: string }`).
  - Find the first `ScannedRepository` where `repo.name` matches `contextSource.metadata.repo` (case-insensitive).
  - If found, set source mode to `"repository"` and pre-select that repo.
  - If repos exist but no match, set mode to `"repository"` with no selection.
  - If no repos at all, set mode to `"directory"`.
  - If `defaultDir` prop is provided, override to `"directory"`.
  Add the one-shot initialisation pattern from new session dialog (using `sourceModeInitialized` ref to avoid re-firing).
  **Files**: `src/integrations/github/components/create-session-button.tsx`
  **Acceptance**: Dialog auto-selects the correct mode and repo based on metadata.

- [ ] 3. **Add repository selector UI (type-ahead dropdown)**
  **What**: Port the repository selector from `new-session-dialog.tsx` lines 82–428. This includes:
  - `selectedRepo`, `repoSearch`, `repoDropdownOpen`, `repoHighlightIdx` state
  - `repoInputRef`, `repoListRef` refs
  - `filteredRepos` useMemo
  - `selectRepo`, `handleRepoBlur`, `handleRepoKeyDown` callbacks
  - The `<Input>` + dropdown `<div>` JSX block
  Adapt: when auto-match finds a repo, pre-fill `repoSearch` with `repo.name` and `selectedRepo` with the repo object.
  **Files**: `src/integrations/github/components/create-session-button.tsx`
  **Acceptance**: Repository dropdown renders in repo mode, supports typing/filtering/keyboard navigation, pre-selects auto-matched repo.

- [ ] 4. **Add source mode toggle UI**
  **What**: Port the source mode radio button group from `new-session-dialog.tsx` lines 322–366. Include the `handleSourceModeKeyDown` callback for roving tabindex. Disable "Repository" button when `!hasRepos`.
  **Files**: `src/integrations/github/components/create-session-button.tsx`
  **Acceptance**: Toggle renders, switches between repo and directory mode, disables repo when no scanned repos.

- [ ] 5. **Restructure isolation strategy per mode**
  **What**: Replace the current 3-button strategy group with mode-dependent strategies:
  - **Repository mode**: `worktree` (default) / `existing` — port from new session dialog (lines 431–469). Include `repoStrategy` state, `REPO_STRATEGY_ORDER`, descriptions, keyboard handler.
  - **Directory mode**: `existing` (default) / `clone` — keep the existing clone option. Define `DIR_STRATEGY_ORDER: ["existing", "clone"]` with labels/icons. Use `dirStrategy` state.
  Remove the old flat `isolationStrategy` state; replace with `repoStrategy` and `dirStrategy`.
  **Files**: `src/integrations/github/components/create-session-button.tsx`
  **Acceptance**: Repo mode shows worktree/existing strategies. Directory mode shows existing/clone strategies.

- [ ] 6. **Add branch name field**
  **What**: Port the branch name field from `new-session-dialog.tsx` lines 169–172, 196–217, 504–524. Add `branch`, `branchManuallyEdited` state. Port `generateBranchName()`. Wire `handleTitleChange` to auto-generate branch from title when in repo+worktree mode and not manually edited. Show the branch input only when `sourceMode === "repository" && repoStrategy === "worktree"`.
  **Files**: `src/integrations/github/components/create-session-button.tsx`
  **Acceptance**: Branch field appears in repo+worktree mode, auto-generates from title, allows manual override.

- [ ] 7. **Update title field to use handleTitleChange**
  **What**: The current title uses `titleOverride` with a fallback to `contextSource.title`. Keep this pre-fill pattern but wire through `handleTitleChange` so branch auto-generation works. The effective title is `titleOverride ?? contextSource.title`. When user types, call `handleTitleChange` which sets `titleOverride` AND updates branch if applicable.
  **Files**: `src/integrations/github/components/create-session-button.tsx`
  **Acceptance**: Title pre-fills from context, typing updates branch in repo+worktree mode.

- [ ] 8. **Conditionally show directory picker vs repo selector**
  **What**: In repo mode, show repository selector (from TODO 3) instead of directory picker. In directory mode, show DirectoryPicker (existing). The `effectiveDirectory` is `selectedRepo?.path ?? ""` in repo mode, `directory.trim()` in directory mode.
  **Files**: `src/integrations/github/components/create-session-button.tsx`
  **Acceptance**: Directory picker only shows in directory mode. Repo selector only shows in repo mode.

- [ ] 9. **Update handleSubmit and effective values**
  **What**: Compute `effectiveDirectory`, `effectiveIsolation`, and `effectiveBranch`:
  - `effectiveDirectory`: repo mode → `selectedRepo?.path ?? ""`, directory mode → `directory.trim()`.
  - `effectiveIsolation`: repo mode → `repoStrategy`, directory mode → `dirStrategy`.
  - `effectiveBranch`: repo mode + worktree → `branch.trim() || undefined`, else `undefined`.
  Update submit to: `createSession(effectiveDirectory, { title, isolationStrategy: effectiveIsolation, branch: effectiveBranch, context: contextSource })`.
  Update the submit button disabled condition: `!effectiveDirectory || isLoading`.
  **Files**: `src/integrations/github/components/create-session-button.tsx`
  **Acceptance**: Sessions create correctly in all mode/strategy combinations with contextSource attached.

- [ ] 10. **Update handleOpenChange to reset all new state**
  **What**: When dialog closes, reset: `sourceMode` (to initial), `selectedRepo`, `repoSearch`, `repoDropdownOpen`, `repoStrategy`, `dirStrategy`, `branch`, `branchManuallyEdited`, `titleOverride`. Reset the `sourceModeInitialized` ref so it re-fires on next open.
  **Files**: `src/integrations/github/components/create-session-button.tsx`
  **Acceptance**: Opening the dialog a second time starts clean with correct auto-match.

## Field Order in Dialog (Top to Bottom)

1. **GitHub Context Badge** — Badge + URL (unchanged)
2. **Source Mode Toggle** — Repository / Directory
3. **Repository Selector** (repo mode only) — type-ahead dropdown
4. **Isolation Strategy** — mode-dependent buttons
5. **Directory Picker** (directory mode only)
6. **Title** — pre-filled from context
7. **Branch** (repo+worktree only) — auto-generated from title
8. **Error display** (if any)
9. **Create Session button**

## Auto-Matching Algorithm

```
const ghOwner = contextSource.metadata.owner as string | undefined;
const ghRepo = contextSource.metadata.repo as string | undefined;

// Find first scanned repo whose directory name matches the GitHub repo name
const matchedRepo = ghRepo
  ? repositories.find(r => r.name.toLowerCase() === ghRepo.toLowerCase())
  : null;
```

This is a simple name match. It won't handle cases where the local directory name differs from the GitHub repo name (e.g. local dir `my-fork` for GitHub repo `original`). This is acceptable for v1 — it handles the common case where people clone repos with the default directory name.

## Potential Pitfalls

1. **Multiple repos with the same name** — If two workspace roots contain a repo named `"weave"`, `Array.find()` returns the first. This is fine — the user can always type to filter and select the correct one.
2. **Race condition: repos still loading when dialog opens** — Use the same pattern as new session dialog: defer source mode initialization until `!reposLoading` using a one-shot ref. Show the toggle but disable it while loading.
3. **Title pre-fill + branch generation** — The title starts as `contextSource.title` (e.g. `"Issue #42: Fix the thing"`). On open, we should auto-generate the initial branch from this title so it's ready when the user sees the form. Set `branch` to `generateBranchName(contextSource.title)` during initialization.
4. **Dialog width** — More fields may need slightly more vertical space. The `sm:max-w-md` class should be sufficient since we're following the same layout as new session dialog which also uses `sm:max-w-md`.

## Verification
- [ ] `npm run build` passes with no type errors
- [ ] `npm run lint` passes
- [ ] No regressions: new session dialog (`new-session-dialog.tsx`) is untouched
- [ ] No regressions: `issue-row.tsx` and `pr-row.tsx` still render CreateSessionButton identically
- [ ] Context dialog creates sessions with `contextSource` attached in all mode combinations
