# Slash Command Click-to-Run

## TL;DR
> **Summary**: Add a clickable play button next to slash commands (like `/start-work`) that appear in inline code within assistant messages, allowing single-click execution via the existing command API.
> **Estimated Effort**: Medium

## Context
### Original Request
When the assistant mentions a slash command in inline code (e.g., `` `/start-work` ``), render a small play icon button next to it that executes the command in the current session when clicked.

### Key Findings
1. **Rendering pipeline**: Messages flow through `ActivityStreamV1` → `MessageItem` → `MarkdownRenderer` → `ReactMarkdown`. The `MarkdownRenderer` is a pure presentational component with no access to session context (`sessionId`, `instanceId`).

2. **Module-level components constraint**: `MARKDOWN_COMPONENTS` is defined at module level in `markdown-renderer.tsx` (line 96) for referential stability — react-markdown rebuilds its pipeline if the `components` prop identity changes. This means we cannot use closures or hooks directly inside the component overrides.

3. **Existing command execution**: `useSendPrompt()` hook already handles slash command routing — it calls `parseSlashCommand()`, then POSTs to `/api/sessions/{id}/command`. The session page creates `handleSend(text, agent?, model?)` which wraps `sendPrompt(sessionId, instanceId, text)`.

4. **Command validation**: `useCommands(instanceId)` fetches available commands from the API. `AutocompleteCommand` has `{ name: string; description?: string }`.

5. **Existing context pattern**: The codebase uses React contexts extensively (6 contexts in `src/contexts/`). `CommandRegistryContext` is a good pattern to follow — it's created with `createContext`, has a provider component, and a `useXxx()` consumer hook that throws if used outside the provider.

6. **MarkdownRenderer consumers**: Used in 4 places — `activity-stream-v1.tsx` (session messages), `activity-stream.tsx` (legacy), `pr-row.tsx` (GitHub PRs), `issue-row.tsx` (GitHub issues), `webfetch-tool-card.tsx`. Only the session activity stream should have click-to-run; the others should gracefully show slash commands without play buttons (no context = no button).

7. **`extractText` utility** in `markdown-utils.ts` recursively extracts plain text from React node trees — perfect for extracting the slash command text from inline code children.

## Objectives
### Core Objective
Enable one-click execution of slash commands mentioned in assistant messages.

### Deliverables
- [ ] React context (`SlashCommandContext`) to provide command execution and available commands list
- [ ] `SlashCommandCode` wrapper component that detects slash commands and renders a play button
- [ ] Integration into `markdown-renderer.tsx` inline code override
- [ ] Context provider wired into the session detail page
- [ ] Utility function to extract and validate slash command text from React children
- [ ] Unit tests for the new utility functions
- [ ] Unit tests for context and component behavior

### Definition of Done
- [ ] Inline code containing valid slash commands shows a play icon button
- [ ] Clicking the button executes the command via the existing API
- [ ] Non-slash-command inline code renders unchanged
- [ ] Play button only appears for known commands (validated against `useCommands`)
- [ ] Button shows loading state during execution and brief success/error feedback
- [ ] Double-click is prevented (button disabled while executing)
- [ ] `MarkdownRenderer` in non-session contexts (GitHub PRs/issues, webfetch) works without errors (no context = no button)
- [ ] All existing tests continue to pass
- [ ] `npm run build` succeeds

### Guardrails (Must NOT)
- Must NOT break the module-level `MARKDOWN_COMPONENTS` referential stability
- Must NOT add `sessionId`/`instanceId` as props to `MarkdownRenderer` (it's used in 4+ places — context is cleaner)
- Must NOT show play buttons outside session context (GitHub PR/issue views, webfetch tool card)
- Must NOT execute commands when session is stopped or disconnected

## TODOs

- [x] 1. **Add `extractInlineText` utility to `slash-command-utils.ts`**
  **What**: Add a function that takes React `children` (the content of an inline `<code>` element) and extracts the plain text string. Then checks if it's a valid slash command text (starts with `/`, has a command name, no extra content beyond command + optional args). Reuse `extractText` from `markdown-utils.ts` for the recursive text extraction.
  **Files**: `src/lib/slash-command-utils.ts`
  **Details**:
  ```
  export function extractSlashCommandText(children: React.ReactNode): string | null
  ```
  - Call `extractText(children)` to get raw text
  - Call `parseSlashCommand(text)` — if it returns non-null AND the full text trims to just the slash command (no surrounding prose), return the trimmed text
  - Return `null` if not a slash command
  **Acceptance**: Unit tests pass for various inputs (plain text `/start-work`, nested React nodes, non-commands, bare `/`, commands with args)

- [x] 2. **Add unit tests for `extractSlashCommandText`**
  **What**: Add test cases to the existing `src/lib/__tests__/slash-command-utils.test.ts` file.
  **Files**: `src/lib/__tests__/slash-command-utils.test.ts`
  **Details**: Test cases:
  - Returns `/start-work` for string child `"/start-work"`
  - Returns `/compact arg1 arg2` for string child `"/compact arg1 arg2"`
  - Returns `null` for non-slash text like `"some code"`
  - Returns `null` for empty string
  - Returns `null` for bare `"/"`
  - Returns the text for an array of React nodes that concatenate to a slash command
  **Acceptance**: `npx vitest run src/lib/__tests__/slash-command-utils.test.ts` passes

- [x] 3. **Create `SlashCommandContext`**
  **What**: Create a new React context that provides: (a) an `executeCommand` function, (b) a set of known command names for validation, and (c) a `disabled` flag for when the session can't accept commands. The context value should be `null` by default so consumers can detect when they're outside a provider (graceful degradation for non-session uses of `MarkdownRenderer`).
  **Files**: `src/contexts/slash-command-context.tsx` (new file)
  **Details**:
  ```typescript
  interface SlashCommandContextValue {
    /** Execute a slash command string like "/start-work" */
    executeCommand: (commandText: string) => Promise<void>;
    /** Set of known command names (without leading slash) for validation */
    knownCommands: Set<string>;
    /** True when commands cannot be executed (session stopped, disconnected, etc.) */
    disabled: boolean;
  }
  ```
  - `createContext<SlashCommandContextValue | null>(null)` — null default enables graceful degradation
  - `SlashCommandProvider` component that accepts `sessionId`, `instanceId`, `disabled` props
  - Internally uses `useSendPrompt()` to get `sendPrompt` and `isSending`
  - Internally uses `useCommands(instanceId)` to get available command names
  - Builds a `Set<string>` of known command names (memoized)
  - `executeCommand` wraps `sendPrompt(sessionId, instanceId, commandText)`
  - `useSlashCommandContext()` hook: returns the context value or `null` (does NOT throw when missing — this is intentional for graceful degradation)
  **Acceptance**: Context can be imported and used. Returns `null` when no provider is present.

- [x] 4. **Create `SlashCommandCode` component**
  **What**: An inline component rendered by the `code` override in `MARKDOWN_COMPONENTS`. It detects whether its children represent a slash command, and if a `SlashCommandContext` is available, renders the play button.
  **Files**: `src/components/session/slash-command-code.tsx` (new file)
  **Details**:
  - Consumes `useSlashCommandContext()` — if `null`, renders plain styled `<code>` (same as current behavior)
  - Calls `extractSlashCommandText(children)` to detect slash commands
  - If not a slash command, renders plain styled `<code>`
  - If a slash command but command name not in `knownCommands`, renders plain styled `<code>` (no play button)
  - If valid slash command with known command name:
    - Render `<code>` with the text + a small play button (`Play` icon from lucide-react, ~12px)
    - Wrap in an inline `<span>` with `inline-flex items-center gap-0.5` for alignment
    - Play button styling: `opacity-0 group-hover:opacity-70 hover:opacity-100 transition-opacity` — appears on hover of the code element, uses `group` class on the wrapping span
    - On click: call `executeCommand(commandText)`, track local `isExecuting` state
    - While executing: show a `Loader2` spinner icon instead of play, disable the button
    - On success: briefly flash a `Check` icon (500ms), then revert to play
    - On error: briefly flash a red `X` icon (1s), then revert to play
    - If `disabled` is true on context: don't render the play button (or render it grayed out with `cursor-not-allowed`)
    - Prevent double-click: button is disabled while `isExecuting` is true
  - The `<code>` element retains all existing styling: `bg-muted/50 text-primary/90 px-1 py-0.5 rounded text-xs font-mono`
  **Acceptance**: Component renders correctly in both provider and no-provider scenarios. Play button appears on hover for valid commands only.

- [x] 5. **Integrate `SlashCommandCode` into `markdown-renderer.tsx`**
  **What**: Update the inline `code` override in `MARKDOWN_COMPONENTS` to delegate to `SlashCommandCode` instead of rendering a plain `<code>` element directly.
  **Files**: `src/components/session/markdown-renderer.tsx`
  **Details**:
  - Import `SlashCommandCode` from `./slash-command-code`
  - In the `code` override (line 175-192), change the inline code branch (line 187-191) from:
    ```tsx
    return (
      <code className="bg-muted/50 text-primary/90 px-1 py-0.5 rounded text-xs font-mono">
        {children}
      </code>
    );
    ```
    to:
    ```tsx
    return <SlashCommandCode {...props}>{children}</SlashCommandCode>;
    ```
  - `SlashCommandCode` handles all the logic internally (slash command detection, context consumption, fallback rendering)
  - Block code path (lines 179-185) remains unchanged
  - `MARKDOWN_COMPONENTS` stays at module level — no closure, no hooks, no referential instability
  **Acceptance**: Inline code renders identically to before when no `SlashCommandContext` is present. Build succeeds. No react-markdown re-renders caused by component identity changes.

- [x] 6. **Wire `SlashCommandProvider` into the session detail page**
  **What**: Wrap the activity stream portion of the session page with `SlashCommandProvider` so that `MarkdownRenderer` instances within it have access to command execution.
  **Files**: `src/app/sessions/[id]/page.tsx`
  **Details**:
  - Import `SlashCommandProvider` from `@/contexts/slash-command-context`
  - Wrap the `<ActivityStreamV1>` component (line 666-684) with `<SlashCommandProvider>`:
    ```tsx
    <SlashCommandProvider
      sessionId={sessionId}
      instanceId={instanceId}
      disabled={isStopped || isResumable || status === "error"}
    >
      <ActivityStreamV1 ... />
    </SlashCommandProvider>
    ```
  - The `disabled` prop mirrors the same condition used for the `PromptInput` disabled state (line 690): `isStopped || isResumable || status === "error"`
  - This means: no play buttons when the session is stopped, disconnected/resumable, or errored
  - The GitHub PR/issue and webfetch uses of `MarkdownRenderer` are NOT wrapped — they get `null` from `useSlashCommandContext()` and render plain code, which is the desired behavior
  **Acceptance**: Play buttons appear next to valid slash commands in session messages. No play buttons in GitHub integration views.

- [x] 7. **Add unit tests for `SlashCommandCode` component**
  **What**: Test the component's rendering behavior across different scenarios.
  **Files**: `src/components/session/__tests__/slash-command-code.test.tsx` (new file)
  **Details**: Test cases:
  - Renders plain `<code>` when no context provider is present
  - Renders plain `<code>` when children are not a slash command
  - Renders plain `<code>` when slash command is not in `knownCommands`
  - Renders `<code>` with play button when valid known slash command and context present
  - Play button is hidden when `disabled` is true on context
  - Clicking play button calls `executeCommand` with the correct text
  - Play button shows loading state while executing
  - Play button is disabled during execution (no double-click)
  **Acceptance**: `npx vitest run src/components/session/__tests__/slash-command-code.test.tsx` passes

- [x] 8. **Add unit tests for `SlashCommandContext`**
  **What**: Test the context provider and consumer hook behavior.
  **Files**: `src/contexts/__tests__/slash-command-context.test.ts` (new file)
  **Details**: Test cases:
  - `useSlashCommandContext()` returns `null` when outside provider
  - Provider passes through `executeCommand`, `knownCommands`, and `disabled`
  - `knownCommands` set updates when commands are fetched
  **Acceptance**: `npx vitest run src/contexts/__tests__/slash-command-context.test.ts` passes

## Verification
- [ ] All existing tests pass: `npx vitest run` *(skipped by user)*
- [ ] New tests pass: `npx vitest run src/lib/__tests__/slash-command-utils.test.ts src/components/session/__tests__/slash-command-code.test.tsx src/contexts/__tests__/slash-command-context.test.ts` *(individual test files verified during implementation)*
- [ ] Build succeeds: `npm run build` *(pre-existing env issue: `generate is not a function` — fails on clean main branch too, not caused by our changes)*
- [ ] No regressions in non-session MarkdownRenderer usage (GitHub PRs/issues render without errors)
- [ ] Manual verification: slash commands in assistant messages show play button on hover, clicking executes the command

## Architecture Diagram

```
Session Page (page.tsx)
  └─ SlashCommandProvider  ← NEW (provides executeCommand + knownCommands)
       │    props: sessionId, instanceId, disabled
       │    uses:  useSendPrompt(), useCommands()
       │
       └─ ActivityStreamV1
            └─ MessageItem
                 └─ MarkdownRenderer
                      └─ ReactMarkdown
                           └─ code override (MARKDOWN_COMPONENTS)
                                └─ SlashCommandCode  ← NEW
                                     │  uses: useSlashCommandContext()
                                     │  - null → plain <code>
                                     │  - present → detect slash cmd → show play button
                                     └─ extractSlashCommandText()  ← NEW utility
```

## Edge Cases
| Scenario | Behavior |
|---|---|
| Multiple slash commands in one message | Each renders its own independent play button with independent state |
| `/command arg1 arg2` | Play button executes the full command text including args |
| Command fails (API error) | Brief red X icon flash (1s), then reverts to play icon |
| Double-click | Button disabled while `isExecuting` is true |
| Session stopped/disconnected | Play button not rendered (`disabled=true` from context) |
| Unknown command (not in `knownCommands`) | No play button — renders as plain inline code |
| Commands still loading (`useCommands` in flight) | No play button until commands load (conservative — avoids showing buttons for invalid commands) |
| MarkdownRenderer in GitHub PR/issue view | No context provider → `useSlashCommandContext()` returns `null` → plain code rendering |
| Bare `/` in inline code | Not a valid command → no play button |
| `/` in a code block (fenced) | Block code path unchanged — no play button (handled by `pre` override) |
