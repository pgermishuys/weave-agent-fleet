/**
 * Extracts a human-readable label for a tool call based on its name and input.
 *
 * Used by the activity stream to show context-aware one-line summaries
 * instead of raw truncated output.
 */

/** Shorten a file path to `parentDir/filename` when it exceeds `maxLen` chars. */
function shortenPath(filePath: string, maxLen = 50): string {
  if (filePath.length <= maxLen) return filePath;
  const segments = filePath.split("/");
  if (segments.length <= 2) return filePath;
  // Keep last two segments: parentDir/filename
  return "…/" + segments.slice(-2).join("/");
}

/** Truncate a string to `maxLen` chars, appending "…" if trimmed. */
function truncate(value: string, maxLen: number): string {
  if (value.length <= maxLen) return value;
  return value.slice(0, maxLen) + "…";
}

export function getToolLabel(
  toolName: string,
  input: Record<string, unknown> | null,
): string {
  switch (toolName) {
    case "bash": {
      if (typeof input?.description === "string" && input.description) {
        return input.description;
      }
      if (typeof input?.command === "string" && input.command) {
        return truncate(input.command, 60);
      }
      return "bash";
    }

    case "read": {
      if (typeof input?.filePath === "string" && input.filePath) {
        return shortenPath(input.filePath);
      }
      return "read";
    }

    case "edit": {
      if (typeof input?.filePath === "string" && input.filePath) {
        return shortenPath(input.filePath);
      }
      return "edit";
    }

    case "write": {
      if (typeof input?.filePath === "string" && input.filePath) {
        return shortenPath(input.filePath);
      }
      return "write";
    }

    case "glob": {
      if (typeof input?.pattern === "string" && input.pattern) {
        return input.pattern;
      }
      return "glob";
    }

    case "grep": {
      if (typeof input?.pattern === "string" && input.pattern) {
        return input.pattern;
      }
      return "grep";
    }

    case "webfetch": {
      if (typeof input?.url === "string" && input.url) {
        return input.url;
      }
      return "webfetch";
    }

    case "skill": {
      if (typeof input?.name === "string" && input.name) {
        return input.name;
      }
      return "skill";
    }

    default:
      return toolName;
  }
}
