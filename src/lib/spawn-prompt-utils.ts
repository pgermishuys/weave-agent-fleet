/**
 * Utilities for formatting a "spawn session from selection" prompt and
 * deriving a git branch name from free-form text.
 */

export interface FormatSpawnPromptOptions {
  /** The text the user selected in the conversation. */
  selectedText: string;
  /** Human-readable title of the source session. */
  sessionTitle: string;
  /** OpenCode session ID (or Fleet DB id) of the source session. */
  sourceSessionId: string;
  /**
   * Optional extra instructions / conversation summary to include.
   * Shown as the "Instructions" section. May be edited by the user before spawning.
   */
  conversationSummary?: string;
}

/**
 * Formats the selected text and session context into a structured markdown
 * prompt suitable for initialising a new independent session.
 *
 * The result is shown in an editable textarea in the spawn dialog so the user
 * can refine it before sending.
 */
export function formatSpawnPrompt(opts: FormatSpawnPromptOptions): string {
  const { selectedText, sessionTitle, sourceSessionId, conversationSummary } = opts;

  // Derive a short title from the first ~60 chars of the selected text
  const autoTitle = deriveTitle(selectedText);

  const lines: string[] = [
    `# Task: ${autoTitle}`,
    "",
    "## Context",
    `> This task was extracted from session "${sessionTitle}" (ID: ${sourceSessionId}).`,
    "> The text below was selected from the conversation as the basis for this task.",
    "",
    "## Selected Text",
    selectedText,
  ];

  if (conversationSummary && conversationSummary.trim()) {
    lines.push("", "## Instructions", conversationSummary.trim());
  }

  lines.push(
    "",
    "---",
    "Complete this task independently. The context above was extracted from another session for reference."
  );

  return lines.join("\n");
}

/**
 * Derives a short human-readable title from the first sentence or ~60 chars
 * of the provided text, stripping markdown syntax and extra whitespace.
 */
export function deriveTitle(text: string): string {
  // Strip common markdown: headers, bold/italic markers, code fences, links
  const stripped = text
    .replace(/^#{1,6}\s+/gm, "")        // ## Heading
    .replace(/\*{1,3}([^*]+)\*{1,3}/g, "$1") // **bold** / *italic*
    .replace(/`{1,3}[^`]*`{1,3}/g, "")  // `code` / ```block```
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // [link](url)
    .replace(/\n+/g, " ")               // newlines → spaces
    .replace(/\s+/g, " ")               // collapse whitespace
    .trim();

  // Take up to the first sentence boundary or 60 chars
  const firstSentence = stripped.match(/^[^.!?]{1,60}[.!?]?/)?.[0] ?? stripped;
  const title = firstSentence.trim().slice(0, 60);

  return title || "New Task";
}

/**
 * Derives a valid git branch name from free-form text.
 *
 * The result:
 *   - is lowercased
 *   - uses hyphens as word separators
 *   - strips characters that are invalid in git branch names
 *   - is prefixed with `weave/`
 *   - is at most 50 characters long (after the prefix)
 *
 * @example
 *   generateBranchName("Refactor auth module to use JWT")
 *   // => "weave/refactor-auth-module-to-use-jwt"
 */
export function generateBranchName(text: string): string {
  const slug = text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")   // strip invalid chars
    .replace(/\s+/g, "-")            // spaces → hyphens
    .replace(/-+/g, "-")             // collapse multiple hyphens
    .replace(/^-|-$/g, "")           // strip leading/trailing hyphens
    .slice(0, 50);

  return `weave/${slug || "session"}`;
}
