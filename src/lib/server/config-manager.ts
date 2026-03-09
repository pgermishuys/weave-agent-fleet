/**
 * Server-side config manager.
 * Reads/writes weave-opencode.jsonc (user-level and project-level)
 * and lists installed skills. Reuses CLI modules for parsing logic.
 */

import { mkdirSync, writeFileSync } from "fs";
import { dirname } from "path";
import {
  getUserWeaveConfigPath,
  getProjectWeaveConfigPath,
  getSkillsDir,
} from "@/cli/config-paths";
import {
  listInstalledSkills as listSkills,
  readWeaveConfig,
  type WeaveConfig,
  type WeaveToolsConfig,
  type InstalledSkill,
} from "@/cli/skill-catalog";
import {
  installSkill as doInstallSkill,
  removeSkill as doRemoveSkill,
} from "@/cli/skill-installer";

/**
 * Get the user-level Weave config.
 */
export function getUserConfig(): WeaveConfig | null {
  return readWeaveConfig(getUserWeaveConfigPath());
}

/**
 * Get the project-level Weave config for a specific directory.
 */
export function getProjectConfig(directory: string): WeaveConfig | null {
  return readWeaveConfig(getProjectWeaveConfigPath(directory));
}

/**
 * Deep merge two WeaveConfig objects.
 * Project-level config overrides user-level.
 */
function deepMerge(base: WeaveConfig, override: WeaveConfig): WeaveConfig {
  const merged: WeaveConfig = { ...base };

  if (override.agents) {
    if (!merged.agents) {
      merged.agents = {};
    }
    for (const [agent, agentConfig] of Object.entries(override.agents)) {
      if (merged.agents[agent]) {
        // Merge skills arrays (project skills override)
        merged.agents[agent] = {
          ...merged.agents[agent],
          ...agentConfig,
        };
      } else {
        merged.agents[agent] = { ...agentConfig };
      }
    }
  }

  // Merge tools section — project overrides beat user overrides per key
  if (override.tools || base.tools) {
    const baseTools = base.tools ?? {};
    const overrideTools = override.tools ?? {};
    merged.tools = {
      overrides: { ...baseTools.overrides, ...overrideTools.overrides },
      custom: { ...baseTools.custom, ...overrideTools.custom },
    };
  }

  return merged;
}

/**
 * Get the merged config (user + project).
 */
export function getMergedConfig(directory: string): WeaveConfig {
  const userConfig = getUserConfig() ?? {};
  const projectConfig = getProjectConfig(directory) ?? {};
  return deepMerge(userConfig, projectConfig);
}

/**
 * Update the user-level config.
 */
export function updateUserConfig(config: WeaveConfig): void {
  const configPath = getUserWeaveConfigPath();
  const dir = dirname(configPath);
  mkdirSync(dir, { recursive: true });
  writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
}

/**
 * Update the project-level config.
 */
export function updateProjectConfig(
  directory: string,
  config: WeaveConfig
): void {
  const configPath = getProjectWeaveConfigPath(directory);
  const dir = dirname(configPath);
  mkdirSync(dir, { recursive: true });
  writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
}

/**
 * List all installed skills.
 */
export function listInstalledSkills(): InstalledSkill[] {
  return listSkills();
}

/**
 * Install a skill from a URL or content.
 */
export async function installSkillFromSource(options: {
  url?: string;
  content?: string;
  agents?: string[];
}): Promise<{
  name: string;
  description: string;
  path: string;
}> {
  if (options.url) {
    const result = await doInstallSkill(options.url, {
      force: true,
      agents: options.agents,
    });
    return { name: result.name, description: result.description, path: result.path };
  }

  if (options.content) {
    // Write content to a temp file and install from there
    const { tmpdir } = await import("os");
    const { join } = await import("path");
    const { randomUUID } = await import("crypto");
    const tempPath = join(tmpdir(), `skill-install-${randomUUID()}.md`);
    writeFileSync(tempPath, options.content, "utf-8");

    try {
      const result = await doInstallSkill(tempPath, {
        force: true,
        agents: options.agents,
      });
      return { name: result.name, description: result.description, path: result.path };
    } finally {
      const { rmSync } = await import("fs");
      rmSync(tempPath, { force: true });
    }
  }

  throw new Error("Either 'url' or 'content' must be provided.");
}

/**
 * Remove an installed skill.
 */
export function removeInstalledSkill(name: string): void {
  doRemoveSkill(name);
}

/**
 * Get config file paths for display.
 */
export function getConfigPaths(): {
  userConfig: string;
  skillsDir: string;
} {
  return {
    userConfig: getUserWeaveConfigPath(),
    skillsDir: getSkillsDir(),
  };
}

/**
 * Get the merged tools config (user + project, or user-only when no directory).
 */
export function getMergedToolsConfig(directory?: string): WeaveToolsConfig {
  const config = directory ? getMergedConfig(directory) : (getUserConfig() ?? {});
  return config.tools ?? {};
}
