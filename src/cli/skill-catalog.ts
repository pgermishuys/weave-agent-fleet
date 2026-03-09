/**
 * Skill catalog reader.
 * Reads installed skills from ~/.config/opencode/skills/ and parses their YAML frontmatter.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { getSkillsDir, getUserWeaveConfigPath } from "./config-paths";

export interface InstalledSkill {
  name: string;
  description: string;
  path: string;
  assignedAgents: string[];
}

export interface WeaveAgentConfig {
  skills?: string[];
  model?: string;
}

export interface WeaveToolOverride {
  /** Override the command binary. */
  command?: string;
  /** Override args pattern — use ${dir} placeholder for the directory. */
  args?: string;
  /** Hide this tool from the menu. */
  hidden?: boolean;
}

export interface WeaveCustomTool {
  label: string;
  category: "editor" | "terminal" | "explorer";
  /** Lucide icon name, defaults to "wrench". */
  iconName?: string;
  command: string;
  /** Args pattern — use ${dir} for directory, defaults to "${dir}". */
  args?: string;
  /** Restrict to platforms. Omit = all. */
  platforms?: ("win32" | "darwin" | "linux")[];
}

export interface WeaveToolsConfig {
  /** Override builtin tool settings (keyed by builtin tool ID). */
  overrides?: Record<string, WeaveToolOverride>;
  /** Add custom tool definitions (keyed by custom tool ID). */
  custom?: Record<string, WeaveCustomTool>;
}

export interface WeaveConfig {
  agents?: Record<string, WeaveAgentConfig>;
  tools?: WeaveToolsConfig;
}

/**
 * Parse YAML frontmatter from a SKILL.md file.
 * Handles the simple key: value format between --- fences.
 * Returns null if no valid frontmatter is found.
 */
export function parseFrontmatter(
  content: string
): { name: string; description: string } | null {
  const lines = content.split("\n");

  // Must start with ---
  if (lines[0]?.trim() !== "---") {
    return null;
  }

  let name = "";
  let description = "";
  let foundEnd = false;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === "---") {
      foundEnd = true;
      break;
    }

    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;

    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();

    if (key === "name") {
      name = value;
    } else if (key === "description") {
      description = value;
    }
  }

  if (!foundEnd || !name) {
    return null;
  }

  return { name, description };
}

/**
 * Parse a JSONC string (JSON with comments).
 * Strips single-line (//) and multi-line comments before parsing.
 */
export function parseJsonc(content: string): unknown {
  // Strip single-line comments (// ...) but not inside strings
  // Strip multi-line comments (/* ... */)
  let cleaned = "";
  let inString = false;
  let inSingleLineComment = false;
  let inMultiLineComment = false;
  let i = 0;

  while (i < content.length) {
    if (inSingleLineComment) {
      if (content[i] === "\n") {
        inSingleLineComment = false;
        cleaned += "\n";
      }
      i++;
      continue;
    }

    if (inMultiLineComment) {
      if (content[i] === "*" && content[i + 1] === "/") {
        inMultiLineComment = false;
        i += 2;
        continue;
      }
      if (content[i] === "\n") {
        cleaned += "\n";
      }
      i++;
      continue;
    }

    if (inString) {
      if (content[i] === "\\" && i + 1 < content.length) {
        cleaned += content[i] + content[i + 1];
        i += 2;
        continue;
      }
      if (content[i] === '"') {
        inString = false;
      }
      cleaned += content[i];
      i++;
      continue;
    }

    // Not in string or comment
    if (content[i] === '"') {
      inString = true;
      cleaned += content[i];
      i++;
      continue;
    }

    if (content[i] === "/" && content[i + 1] === "/") {
      inSingleLineComment = true;
      i += 2;
      continue;
    }

    if (content[i] === "/" && content[i + 1] === "*") {
      inMultiLineComment = true;
      i += 2;
      continue;
    }

    cleaned += content[i];
    i++;
  }

  // Handle trailing commas (common in JSONC)
  cleaned = cleaned.replace(/,\s*([\]}])/g, "$1");

  return JSON.parse(cleaned);
}

/**
 * Read the weave-opencode.jsonc config file.
 * Returns null if the file doesn't exist.
 */
export function readWeaveConfig(configPath: string): WeaveConfig | null {
  if (!existsSync(configPath)) {
    return null;
  }

  try {
    const content = readFileSync(configPath, "utf-8");
    return parseJsonc(content) as WeaveConfig;
  } catch {
    return null;
  }
}

/**
 * Get agent assignments for a given skill name from a WeaveConfig.
 */
function getAgentAssignments(
  config: WeaveConfig | null,
  skillName: string
): string[] {
  if (!config?.agents) return [];

  const agents: string[] = [];
  for (const [agentName, agentConfig] of Object.entries(config.agents)) {
    if (agentConfig.skills?.includes(skillName)) {
      agents.push(agentName);
    }
  }
  return agents;
}

/**
 * List all installed skills from the skills directory.
 * Reads YAML frontmatter from each SKILL.md and merges agent assignments
 * from the user-level weave-opencode.jsonc.
 */
export function listInstalledSkills(
  skillsDir?: string,
  configPath?: string
): InstalledSkill[] {
  const dir = skillsDir ?? getSkillsDir();
  const cfgPath = configPath ?? getUserWeaveConfigPath();

  if (!existsSync(dir)) {
    return [];
  }

  const config = readWeaveConfig(cfgPath);
  const skills: InstalledSkill[] = [];

  const entries = readdirSync(dir);
  for (const entry of entries) {
    const skillDir = join(dir, entry);
    if (!statSync(skillDir).isDirectory()) continue;

    const skillFile = join(skillDir, "SKILL.md");
    if (!existsSync(skillFile)) continue;

    const content = readFileSync(skillFile, "utf-8");
    const frontmatter = parseFrontmatter(content);
    if (!frontmatter) continue;

    skills.push({
      name: frontmatter.name,
      description: frontmatter.description,
      path: skillDir,
      assignedAgents: getAgentAssignments(config, frontmatter.name),
    });
  }

  return skills.sort((a, b) => a.name.localeCompare(b.name));
}
