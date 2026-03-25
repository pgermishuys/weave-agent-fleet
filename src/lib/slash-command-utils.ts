/**
 * Slash command parsing utilities.
 * Used to detect and parse /command-style input before routing to the SDK command API.
 */

import { extractText } from "./markdown-utils";

export interface ParsedSlashCommand {
  /** The command name without the leading slash, e.g. "metrics" */
  command: string;
  /** Everything after the command name (trimmed), e.g. "arg1 arg2" */
  args: string;
}

/**
 * Parses a slash command string into its command name and arguments.
 * Returns null if the text does not start with a slash or has no command name.
 */
export function parseSlashCommand(text: string): ParsedSlashCommand | null {
  const trimmed = text.trimStart();
  if (!trimmed.startsWith("/")) return null;

  // Strip the leading slash and split on whitespace
  const withoutSlash = trimmed.slice(1);
  const spaceIndex = withoutSlash.search(/\s/);

  let command: string;
  let args: string;

  if (spaceIndex === -1) {
    command = withoutSlash;
    args = "";
  } else {
    command = withoutSlash.slice(0, spaceIndex);
    args = withoutSlash.slice(spaceIndex + 1).trim();
  }

  // A bare "/" with nothing after it is not a valid command
  if (!command) return null;

  return { command, args };
}

/**
 * Returns true if the given text represents a slash command (starts with /).
 */
export function isSlashCommand(text: string): boolean {
  return text.trimStart().startsWith("/");
}

/**
 * Extracts the slash command text from a React node (e.g. the children of an
 * inline `<code>` element).  Returns the trimmed slash command string (e.g.
 * `"/start-work"` or `"/compact arg1 arg2"`) if the node's text content is
 * exactly a valid slash command, or `null` otherwise.
 *
 * Uses `extractText` from markdown-utils to recursively flatten React node trees
 * to a plain string before parsing.
 */
export function extractSlashCommandText(children: unknown): string | null {
  const text = extractText(children).trim();
  if (!text) return null;
  const parsed = parseSlashCommand(text);
  if (!parsed) return null;
  // Rebuild the full command string (slash + command + optional args)
  const full = parsed.args ? `/${parsed.command} ${parsed.args}` : `/${parsed.command}`;
  // Only return if the original text matches the reconstructed command exactly
  // (guards against prose like "run /start-work now" slipping through)
  if (text !== full) return null;
  return full;
}
