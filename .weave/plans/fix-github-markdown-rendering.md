# Fix GitHub Integration Markdown Rendering

## TL;DR
> **Summary**: Replace bare `<ReactMarkdown>` in GitHub issue and PR views with the existing `<MarkdownRenderer>` component to get GFM support, syntax highlighting, and consistent styling.
> **Estimated Effort**: Quick

## Context
### Original Request
The GitHub integration's issue and PR expandable rows render markdown with a bare `<ReactMarkdown>` component — no plugins, no custom styled components. The codebase already has a fully configured `<MarkdownRenderer>` at `src/components/session/markdown-renderer.tsx` that includes `remarkGfm`, `rehype-highlight`, copy-to-clipboard code blocks, and themed component overrides.

### Key Findings
- **`MarkdownRenderer` props**: `content: string` (required), `className?: string` (optional). It wraps output in `<div className="prose-weave space-y-2 text-sm {className}">`.
- **Null safety**: Both `GitHubIssue.body` and `GitHubPullRequest.body` are typed `string | null`. Both files already guard with ternary checks (`body ? <Markdown> : <NoDescription>`), so `MarkdownRenderer` will only receive a truthy string — no change needed.
- **Styling overlap**: The current wrapper divs use `prose prose-sm dark:prose-invert max-w-none text-sm` (body) and `prose prose-xs dark:prose-invert max-w-none text-muted-foreground` (comments). `MarkdownRenderer` applies its own `prose-weave space-y-2 text-sm` internally. The old Tailwind `prose` classes should be **removed** from the wrapper divs to avoid conflicting typography resets. Any size/color adjustments can be passed via the `className` prop.
- **Import cleanup**: `react-markdown` is only directly imported in these two files and in `markdown-renderer.tsx` itself. Removing the direct imports from the two GitHub component files is clean — no other code in those files depends on `ReactMarkdown`.

## Objectives
### Core Objective
Unify markdown rendering in GitHub integration views with the existing `MarkdownRenderer` component.

### Deliverables
- [ ] `issue-row.tsx` uses `MarkdownRenderer` for issue body and comment body
- [ ] `pr-row.tsx` uses `MarkdownRenderer` for PR body and comment body
- [ ] No duplicate or conflicting prose/typography classes on wrapper divs

### Definition of Done
- [ ] `npx tsc --noEmit` passes with no errors
- [ ] App builds successfully (`npm run build`)
- [ ] Expanding a GitHub issue shows rendered markdown with GFM tables, syntax-highlighted code, and copy button
- [ ] Expanding a GitHub PR shows the same
- [ ] Issues/PRs with `null` body still show "No description provided."

### Guardrails (Must NOT)
- Do NOT modify `markdown-renderer.tsx` — it's the source of truth
- Do NOT change the null-guard ternary logic (the existing `body ? ... : ...` pattern is correct)
- Do NOT remove the `react-markdown` package from `package.json` — it's still used by `MarkdownRenderer` internally

## TODOs

- [ ] 1. Update `issue-row.tsx` imports
  **What**: Remove `import ReactMarkdown from "react-markdown"` and add `import { MarkdownRenderer } from "@/components/session/markdown-renderer"`
  **Files**: `src/integrations/github/components/issue-row.tsx`
  **Acceptance**: File imports `MarkdownRenderer`, does not import `ReactMarkdown`

- [ ] 2. Replace issue body markdown rendering in `issue-row.tsx`
  **What**: On line 115-117, replace the wrapper div + `<ReactMarkdown>` with `<MarkdownRenderer>`:
  - **Before**:
    ```tsx
    <div className="prose prose-sm dark:prose-invert max-w-none text-sm">
      <ReactMarkdown>{issue.body}</ReactMarkdown>
    </div>
    ```
  - **After**:
    ```tsx
    <MarkdownRenderer content={issue.body} />
    ```
  The `MarkdownRenderer` already applies `prose-weave space-y-2 text-sm` internally, so the outer `<div>` with prose classes is no longer needed.
  **Files**: `src/integrations/github/components/issue-row.tsx`
  **Acceptance**: Issue body renders with GFM and syntax highlighting; no double prose wrappers

- [ ] 3. Replace comment body markdown rendering in `issue-row.tsx`
  **What**: On line 143-145, replace the wrapper div + `<ReactMarkdown>` with `<MarkdownRenderer>`:
  - **Before**:
    ```tsx
    <div className="prose prose-xs dark:prose-invert max-w-none text-muted-foreground">
      <ReactMarkdown>{comment.body}</ReactMarkdown>
    </div>
    ```
  - **After**:
    ```tsx
    <MarkdownRenderer content={comment.body} className="text-muted-foreground" />
    ```
  Pass `text-muted-foreground` via `className` to preserve the muted comment styling.
  **Files**: `src/integrations/github/components/issue-row.tsx`
  **Acceptance**: Comment bodies render with GFM and syntax highlighting; text color is muted

- [ ] 4. Update `pr-row.tsx` imports
  **What**: Remove `import ReactMarkdown from "react-markdown"` and add `import { MarkdownRenderer } from "@/components/session/markdown-renderer"`
  **Files**: `src/integrations/github/components/pr-row.tsx`
  **Acceptance**: File imports `MarkdownRenderer`, does not import `ReactMarkdown`

- [ ] 5. Replace PR body markdown rendering in `pr-row.tsx`
  **What**: On line 132-134, replace the wrapper div + `<ReactMarkdown>` with `<MarkdownRenderer>`:
  - **Before**:
    ```tsx
    <div className="prose prose-sm dark:prose-invert max-w-none text-sm">
      <ReactMarkdown>{pr.body}</ReactMarkdown>
    </div>
    ```
  - **After**:
    ```tsx
    <MarkdownRenderer content={pr.body} />
    ```
  **Files**: `src/integrations/github/components/pr-row.tsx`
  **Acceptance**: PR body renders with GFM and syntax highlighting; no double prose wrappers

- [ ] 6. Replace comment body markdown rendering in `pr-row.tsx`
  **What**: On line 170-172, replace the wrapper div + `<ReactMarkdown>` with `<MarkdownRenderer>`:
  - **Before**:
    ```tsx
    <div className="prose prose-xs dark:prose-invert max-w-none text-muted-foreground">
      <ReactMarkdown>{comment.body}</ReactMarkdown>
    </div>
    ```
  - **After**:
    ```tsx
    <MarkdownRenderer content={comment.body} className="text-muted-foreground" />
    ```
  **Files**: `src/integrations/github/components/pr-row.tsx`
  **Acceptance**: Comment bodies render with GFM and syntax highlighting; text color is muted

## Verification
- [ ] `npx tsc --noEmit` — no type errors
- [ ] `npm run build` — successful production build
- [ ] No remaining direct `ReactMarkdown` imports in `issue-row.tsx` or `pr-row.tsx`
- [ ] Visual check: issue/PR bodies render GFM tables, task lists, and fenced code with syntax highlighting
- [ ] Visual check: null-body issues/PRs still show "No description provided." fallback
