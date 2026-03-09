/**
 * Tool registry — data-driven lookup table for "Open In" tools.
 *
 * Replaces the hardcoded switch statement in open-directory/route.ts
 * with an extensible, platform-aware registry of editors, terminals,
 * and file explorers.
 */

// ── Types ───────────────────────────────────────────────────────────────────

export type ToolCategory = "editor" | "terminal" | "explorer";

export type PlatformId = "win32" | "darwin" | "linux";

export interface PlatformCommand {
  /** The binary or command to execute. */
  command: string;
  /** Build the args array for a given directory path. */
  args: (dir: string) => string[];
  /** Optional spawn options overrides. */
  options?: {
    shell?: boolean;
    /** When set to "directory", the spawn cwd is set to the target directory. */
    cwd?: "directory";
    windowsHide?: boolean;
  };
}

export interface ToolDefinition {
  id: string;
  label: string;
  /** Lucide icon name string — mapped to a component client-side. */
  iconName: string;
  category: ToolCategory;
  /** Per-platform spawn configuration. Absent key = tool not available on that platform. */
  platforms: Partial<Record<PlatformId, PlatformCommand>>;
  /** If true, the tool is always considered available (no detection needed). */
  alwaysAvailable?: boolean;
  /**
   * The binary names to probe during detection.
   * If omitted the detector derives it from the platform command.
   */
  detectBinaries?: Partial<Record<PlatformId, string[]>>;
  /** macOS .app bundle names to check in /Applications. */
  detectMacApps?: string[];
}

// ── Builtin tool definitions ────────────────────────────────────────────────

export const BUILTIN_TOOLS: readonly ToolDefinition[] = [
  // ── Editors ───────────────────────────────────────────────────────────────
  {
    id: "vscode",
    label: "VS Code",
    iconName: "code-2",
    category: "editor",
    platforms: {
      darwin: {
        command: "open",
        args: (dir) => ["-a", "Visual Studio Code", dir],
      },
      win32: {
        command: "code",
        args: (dir) => [dir],
        options: { shell: true, windowsHide: true },
      },
      linux: {
        command: "code",
        args: (dir) => [dir],
      },
    },
    detectBinaries: {
      win32: ["code"],
      linux: ["code"],
    },
    detectMacApps: ["Visual Studio Code"],
  },
  {
    id: "vscode-insiders",
    label: "VS Code Insiders",
    iconName: "code-2",
    category: "editor",
    platforms: {
      darwin: {
        command: "open",
        args: (dir) => ["-a", "Visual Studio Code - Insiders", dir],
      },
      win32: {
        command: "code-insiders",
        args: (dir) => [dir],
        options: { shell: true, windowsHide: true },
      },
      linux: {
        command: "code-insiders",
        args: (dir) => [dir],
      },
    },
    detectBinaries: {
      win32: ["code-insiders"],
      linux: ["code-insiders"],
    },
    detectMacApps: ["Visual Studio Code - Insiders"],
  },
  {
    id: "cursor",
    label: "Cursor",
    iconName: "mouse-pointer-2",
    category: "editor",
    platforms: {
      darwin: {
        command: "open",
        args: (dir) => ["-a", "Cursor", dir],
      },
      win32: {
        command: "cursor",
        args: (dir) => [dir],
        options: { shell: true, windowsHide: true },
      },
      linux: {
        command: "cursor",
        args: (dir) => [dir],
      },
    },
    detectBinaries: {
      win32: ["cursor"],
      linux: ["cursor"],
    },
    detectMacApps: ["Cursor"],
  },
  {
    id: "windsurf",
    label: "Windsurf",
    iconName: "wind",
    category: "editor",
    platforms: {
      darwin: {
        command: "open",
        args: (dir) => ["-a", "Windsurf", dir],
      },
      win32: {
        command: "windsurf",
        args: (dir) => [dir],
        options: { shell: true, windowsHide: true },
      },
      linux: {
        command: "windsurf",
        args: (dir) => [dir],
      },
    },
    detectBinaries: {
      win32: ["windsurf"],
      linux: ["windsurf"],
    },
    detectMacApps: ["Windsurf"],
  },
  {
    id: "zed",
    label: "Zed",
    iconName: "pen-tool",
    category: "editor",
    platforms: {
      darwin: {
        command: "open",
        args: (dir) => ["-a", "Zed", dir],
      },
      linux: {
        command: "zed",
        args: (dir) => [dir],
      },
    },
    detectBinaries: {
      linux: ["zed"],
    },
    detectMacApps: ["Zed"],
  },
  {
    id: "sublime",
    label: "Sublime Text",
    iconName: "braces",
    category: "editor",
    platforms: {
      darwin: {
        command: "open",
        args: (dir) => ["-a", "Sublime Text", dir],
      },
      win32: {
        command: "subl",
        args: (dir) => [dir],
        options: { shell: true, windowsHide: true },
      },
      linux: {
        command: "subl",
        args: (dir) => [dir],
      },
    },
    detectBinaries: {
      win32: ["subl"],
      linux: ["subl"],
    },
    detectMacApps: ["Sublime Text"],
  },
  {
    id: "neovim",
    label: "Neovim",
    iconName: "square-terminal",
    category: "editor",
    platforms: {
      darwin: {
        command: "nvim",
        args: (dir) => [dir],
      },
      win32: {
        command: "nvim",
        args: (dir) => [dir],
        options: { shell: true, windowsHide: true },
      },
      linux: {
        command: "nvim",
        args: (dir) => [dir],
      },
    },
    detectBinaries: {
      darwin: ["nvim"],
      win32: ["nvim"],
      linux: ["nvim"],
    },
  },
  {
    id: "intellij",
    label: "IntelliJ IDEA",
    iconName: "app-window",
    category: "editor",
    platforms: {
      darwin: {
        command: "open",
        args: (dir) => ["-a", "IntelliJ IDEA", dir],
      },
      win32: {
        command: "idea",
        args: (dir) => [dir],
        options: { shell: true, windowsHide: true },
      },
      linux: {
        command: "idea",
        args: (dir) => [dir],
      },
    },
    detectBinaries: {
      win32: ["idea", "idea64"],
      linux: ["idea"],
    },
    detectMacApps: ["IntelliJ IDEA", "IntelliJ IDEA CE"],
  },
  {
    id: "webstorm",
    label: "WebStorm",
    iconName: "app-window",
    category: "editor",
    platforms: {
      darwin: {
        command: "open",
        args: (dir) => ["-a", "WebStorm", dir],
      },
      win32: {
        command: "webstorm",
        args: (dir) => [dir],
        options: { shell: true, windowsHide: true },
      },
      linux: {
        command: "webstorm",
        args: (dir) => [dir],
      },
    },
    detectBinaries: {
      win32: ["webstorm", "webstorm64"],
      linux: ["webstorm"],
    },
    detectMacApps: ["WebStorm"],
  },
  {
    id: "rider",
    label: "Rider",
    iconName: "app-window",
    category: "editor",
    platforms: {
      darwin: {
        command: "open",
        args: (dir) => ["-a", "Rider", dir],
      },
      win32: {
        command: "rider",
        args: (dir) => [dir],
        options: { shell: true, windowsHide: true },
      },
      linux: {
        command: "rider",
        args: (dir) => [dir],
      },
    },
    detectBinaries: {
      win32: ["rider", "rider64"],
      linux: ["rider"],
    },
    detectMacApps: ["Rider"],
  },
  {
    id: "goland",
    label: "GoLand",
    iconName: "app-window",
    category: "editor",
    platforms: {
      darwin: {
        command: "open",
        args: (dir) => ["-a", "GoLand", dir],
      },
      win32: {
        command: "goland",
        args: (dir) => [dir],
        options: { shell: true, windowsHide: true },
      },
      linux: {
        command: "goland",
        args: (dir) => [dir],
      },
    },
    detectBinaries: {
      win32: ["goland", "goland64"],
      linux: ["goland"],
    },
    detectMacApps: ["GoLand"],
  },
  {
    id: "pycharm",
    label: "PyCharm",
    iconName: "app-window",
    category: "editor",
    platforms: {
      darwin: {
        command: "open",
        args: (dir) => ["-a", "PyCharm", dir],
      },
      win32: {
        command: "pycharm",
        args: (dir) => [dir],
        options: { shell: true, windowsHide: true },
      },
      linux: {
        command: "pycharm",
        args: (dir) => [dir],
      },
    },
    detectBinaries: {
      win32: ["pycharm", "pycharm64"],
      linux: ["pycharm"],
    },
    detectMacApps: ["PyCharm", "PyCharm CE"],
  },
  {
    id: "rustrover",
    label: "RustRover",
    iconName: "app-window",
    category: "editor",
    platforms: {
      darwin: {
        command: "open",
        args: (dir) => ["-a", "RustRover", dir],
      },
      win32: {
        command: "rustrover",
        args: (dir) => [dir],
        options: { shell: true, windowsHide: true },
      },
      linux: {
        command: "rustrover",
        args: (dir) => [dir],
      },
    },
    detectBinaries: {
      win32: ["rustrover", "rustrover64"],
      linux: ["rustrover"],
    },
    detectMacApps: ["RustRover"],
  },
  {
    id: "fleet-jb",
    label: "Fleet (JetBrains)",
    iconName: "app-window",
    category: "editor",
    platforms: {
      darwin: {
        command: "open",
        args: (dir) => ["-a", "Fleet", dir],
      },
      win32: {
        command: "fleet",
        args: (dir) => [dir],
        options: { shell: true, windowsHide: true },
      },
      linux: {
        command: "fleet",
        args: (dir) => [dir],
      },
    },
    detectBinaries: {
      win32: ["fleet"],
      linux: ["fleet"],
    },
    detectMacApps: ["Fleet"],
  },

  // ── Terminals ─────────────────────────────────────────────────────────────
  {
    id: "terminal",
    label: "System Terminal",
    iconName: "terminal",
    category: "terminal",
    alwaysAvailable: true,
    platforms: {
      darwin: {
        command: "open",
        args: () => ["-a", "Terminal", "."],
        options: { cwd: "directory" },
      },
      win32: {
        command: "cmd",
        args: () => ["/c", "start", "cmd", "/K"],
        options: { shell: true, cwd: "directory" },
      },
      linux: {
        command: "x-terminal-emulator",
        args: () => [],
        options: { cwd: "directory" },
      },
    },
  },
  {
    id: "wt",
    label: "Windows Terminal",
    iconName: "square-terminal",
    category: "terminal",
    platforms: {
      win32: {
        command: "wt",
        args: (dir) => ["-d", dir],
        options: { shell: true, windowsHide: true },
      },
    },
    detectBinaries: {
      win32: ["wt"],
    },
  },
  {
    id: "iterm2",
    label: "iTerm2",
    iconName: "square-terminal",
    category: "terminal",
    platforms: {
      darwin: {
        command: "open",
        args: (dir) => ["-a", "iTerm", dir],
      },
    },
    detectMacApps: ["iTerm"],
  },
  {
    id: "alacritty",
    label: "Alacritty",
    iconName: "square-terminal",
    category: "terminal",
    platforms: {
      darwin: {
        command: "alacritty",
        args: (dir) => ["--working-directory", dir],
      },
      win32: {
        command: "alacritty",
        args: (dir) => ["--working-directory", dir],
        options: { shell: true, windowsHide: true },
      },
      linux: {
        command: "alacritty",
        args: (dir) => ["--working-directory", dir],
      },
    },
    detectBinaries: {
      darwin: ["alacritty"],
      win32: ["alacritty"],
      linux: ["alacritty"],
    },
  },
  {
    id: "warp",
    label: "Warp",
    iconName: "square-terminal",
    category: "terminal",
    platforms: {
      darwin: {
        command: "open",
        args: (dir) => ["-a", "Warp", dir],
      },
      linux: {
        command: "warp-terminal",
        args: (dir) => [dir],
      },
    },
    detectBinaries: {
      linux: ["warp-terminal"],
    },
    detectMacApps: ["Warp"],
  },
  {
    id: "hyper",
    label: "Hyper",
    iconName: "square-terminal",
    category: "terminal",
    platforms: {
      darwin: {
        command: "open",
        args: (dir) => ["-a", "Hyper", dir],
      },
      win32: {
        command: "hyper",
        args: (dir) => [dir],
        options: { shell: true, windowsHide: true },
      },
      linux: {
        command: "hyper",
        args: (dir) => [dir],
      },
    },
    detectBinaries: {
      win32: ["hyper"],
      linux: ["hyper"],
    },
    detectMacApps: ["Hyper"],
  },
  {
    id: "kitty",
    label: "kitty",
    iconName: "square-terminal",
    category: "terminal",
    platforms: {
      darwin: {
        command: "kitty",
        args: (dir) => ["--directory", dir],
      },
      linux: {
        command: "kitty",
        args: (dir) => ["--directory", dir],
      },
    },
    detectBinaries: {
      darwin: ["kitty"],
      linux: ["kitty"],
    },
  },

  // ── File Explorers ────────────────────────────────────────────────────────
  {
    id: "explorer",
    label: "File Explorer",
    iconName: "folder-open",
    category: "explorer",
    alwaysAvailable: true,
    platforms: {
      darwin: {
        command: "open",
        args: (dir) => [dir],
      },
      win32: {
        command: "explorer",
        args: (dir) => [dir],
      },
      linux: {
        command: "xdg-open",
        args: (dir) => [dir],
      },
    },
  },
];

// ── Lookup helpers ──────────────────────────────────────────────────────────

const toolIndex = new Map<string, ToolDefinition>(
  BUILTIN_TOOLS.map((t) => [t.id, t])
);

/** Look up a builtin tool by ID. */
export function getToolById(id: string): ToolDefinition | undefined {
  return toolIndex.get(id);
}

/** Get all builtin tools in a given category. */
export function getToolsByCategory(category: ToolCategory): ToolDefinition[] {
  return BUILTIN_TOOLS.filter((t) => t.category === category);
}

/** Return every known builtin tool ID. */
export function getAllToolIds(): string[] {
  return BUILTIN_TOOLS.map((t) => t.id);
}

/** Check if an ID matches a builtin tool. */
export function isValidToolId(id: string): boolean {
  return toolIndex.has(id);
}

// ── Config-driven resolution ────────────────────────────────────────────────

export interface ResolvedTool {
  id: string;
  label: string;
  iconName: string;
  category: ToolCategory;
}

export interface WeaveToolOverride {
  command?: string;
  args?: string;
  hidden?: boolean;
}

export interface WeaveCustomTool {
  label: string;
  category: ToolCategory;
  iconName?: string;
  command: string;
  args?: string;
  platforms?: PlatformId[];
}

export interface WeaveToolsConfig {
  overrides?: Record<string, WeaveToolOverride>;
  custom?: Record<string, WeaveCustomTool>;
}

/**
 * Merge detected tools with config overrides and custom tool definitions.
 * Returns the final list of tools to show in the UI.
 */
export function resolveTools(
  detected: ToolDefinition[],
  config: WeaveToolsConfig | undefined
): ResolvedTool[] {
  const overrides = config?.overrides ?? {};
  const custom = config?.custom ?? {};
  const platform = process.platform as PlatformId;

  // Start with detected builtins, applying overrides
  const resolved: ResolvedTool[] = [];
  for (const tool of detected) {
    const override = overrides[tool.id];
    if (override?.hidden) continue;
    resolved.push({
      id: tool.id,
      label: tool.label,
      iconName: tool.iconName,
      category: tool.category,
    });
  }

  // Append custom tools (these skip detection — user guarantees they exist)
  for (const [id, def] of Object.entries(custom)) {
    if (overrides[id]?.hidden) continue;
    // Skip if restricted to other platforms
    if (def.platforms && !def.platforms.includes(platform)) continue;
    resolved.push({
      id,
      label: def.label,
      iconName: def.iconName ?? "wrench",
      category: def.category,
    });
  }

  return resolved;
}

/**
 * Build the spawn command for a given tool + directory, accounting for
 * config overrides and custom tool definitions.
 */
export function getSpawnCommand(
  toolId: string,
  directory: string,
  config: WeaveToolsConfig | undefined
): {
  command: string;
  args: string[];
  options: { detached: boolean; stdio: "ignore"; cwd?: string; shell?: boolean; windowsHide?: boolean };
} | null {
  const platform = process.platform as PlatformId;
  const override = config?.overrides?.[toolId];
  const customDef = config?.custom?.[toolId];

  // Try builtin first
  const builtin = getToolById(toolId);

  if (builtin) {
    const platformCmd = builtin.platforms[platform];
    if (!platformCmd) return null;

    const command = override?.command ?? platformCmd.command;
    const args = override?.args
      ? override.args.replace(/\$\{dir\}/g, directory).split(/\s+/).filter(Boolean)
      : platformCmd.args(directory);

    const options: {
      detached: boolean;
      stdio: "ignore";
      cwd?: string;
      shell?: boolean;
      windowsHide?: boolean;
    } = {
      detached: true,
      stdio: "ignore",
    };

    if (platformCmd.options?.shell) options.shell = true;
    if (platformCmd.options?.windowsHide) options.windowsHide = true;
    if (platformCmd.options?.cwd === "directory") options.cwd = directory;

    return { command, args, options };
  }

  // Try custom tool from config
  if (customDef) {
    if (customDef.platforms && !customDef.platforms.includes(platform)) return null;

    const command = override?.command ?? customDef.command;
    const argsTemplate = override?.args ?? customDef.args ?? "${dir}";
    const args = argsTemplate
      .replace(/\$\{dir\}/g, directory)
      .split(/\s+/)
      .filter(Boolean);

    return {
      command,
      args,
      options: {
        detached: true,
        stdio: "ignore",
        shell: platform === "win32" ? true : undefined,
        windowsHide: platform === "win32" ? true : undefined,
      },
    };
  }

  return null;
}
