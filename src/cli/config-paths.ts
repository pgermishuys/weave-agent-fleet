/**
 * Shared path resolution for Weave configuration files and skill directories.
 * Used by both CLI commands and server-side config managers.
 */

import { homedir } from "os";
import { join } from "path";

/**
 * Returns the user-level OpenCode config directory.
 * On all platforms: ~/.config/opencode/
 */
export function getUserConfigDir(): string {
  return join(homedir(), ".config", "opencode");
}

/**
 * Returns the path to the user-level weave-opencode.jsonc config file.
 */
export function getUserWeaveConfigPath(): string {
  return join(getUserConfigDir(), "weave-opencode.jsonc");
}

/**
 * Returns the path to the skills directory.
 * ~/.config/opencode/skills/
 */
export function getSkillsDir(): string {
  return join(getUserConfigDir(), "skills");
}

/**
 * Returns the project-level config directory path.
 * <projectDir>/.opencode/
 */
export function getProjectConfigDir(projectDir: string): string {
  return join(projectDir, ".opencode");
}

/**
 * Returns the path to the project-level weave-opencode.jsonc config file.
 * <projectDir>/.opencode/weave-opencode.jsonc
 */
export function getProjectWeaveConfigPath(projectDir: string): string {
  return join(getProjectConfigDir(projectDir), "weave-opencode.jsonc");
}

/**
 * Returns the OpenCode data directory (XDG data home).
 * Respects $XDG_DATA_HOME; falls back to ~/.local/share/opencode on all platforms.
 *
 * IMPORTANT: OpenCode uses the `xdg-basedir` npm package which resolves to
 * ~/.local/share on ALL platforms (including Windows) when $XDG_DATA_HOME is not set.
 * We must match that behavior exactly — do NOT use %LOCALAPPDATA% on Windows.
 */
export function getDataDir(): string {
  const xdgDataHome = process.env.XDG_DATA_HOME;
  if (xdgDataHome) {
    return join(xdgDataHome, "opencode");
  }
  return join(homedir(), ".local", "share", "opencode");
}

/**
 * Returns the path to OpenCode's auth.json file.
 */
export function getAuthJsonPath(): string {
  return join(getDataDir(), "auth.json");
}

/**
 * Returns the path to the Fleet API token hash file.
 * Stored at ~/.weave/api-token.hash — same directory as fleet.db.
 */
export function getTokenHashPath(): string {
  return join(homedir(), ".weave", "api-token.hash");
}
