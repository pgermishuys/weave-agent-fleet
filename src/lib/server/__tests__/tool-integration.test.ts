/**
 * Integration tests — verifies that tool-registry, tool-detector, and
 * config-manager work together correctly end-to-end.
 */

import { rmSync } from "fs";
import { join } from "path";
import {
  getToolById,
  isValidToolId,
  resolveTools,
  getSpawnCommand,
  type WeaveToolsConfig,
} from "@/lib/server/tool-registry";
import {
  detectInstalledTools,
  invalidateDetectionCache,
} from "@/lib/server/tool-detector";
import { createSecureTempDir, writeTempFile } from "./test-temp-utils";

// ---------------------------------------------------------------------------
// Mock config-paths so getMergedToolsConfig reads from temp directories
// ---------------------------------------------------------------------------
let mockConfigDir: string;

vi.mock("@/cli/config-paths", () => ({
  getUserConfigDir: () => mockConfigDir,
  getUserWeaveConfigPath: () => join(mockConfigDir, "weave-opencode.jsonc"),
  getSkillsDir: () => join(mockConfigDir, "skills"),
  getProjectConfigDir: (dir: string) => join(dir, ".opencode"),
  getProjectWeaveConfigPath: (dir: string) =>
    join(dir, ".opencode", "weave-opencode.jsonc"),
  getDataDir: () => join(mockConfigDir, "data"),
  getAuthJsonPath: () => join(mockConfigDir, "data", "auth.json"),
}));

// Import AFTER the mock so config-manager picks up the mock
import { getMergedToolsConfig } from "@/lib/server/config-manager";

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  invalidateDetectionCache();
  mockConfigDir = createSecureTempDir("tool-integ-");
});

afterEach(() => {
  try {
    rmSync(mockConfigDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

// ---------------------------------------------------------------------------
// End-to-end: detect → resolve → spawn
// ---------------------------------------------------------------------------

describe("detect → resolve → getSpawnCommand pipeline", () => {
  it("DetectsToolsThenResolvesAndBuildsSpawnForExplorer", async () => {
    const detected = await detectInstalledTools();
    expect(detected.length).toBeGreaterThan(0);

    const resolved = resolveTools(detected, undefined);
    expect(resolved.length).toBeGreaterThan(0);

    // "explorer" is always-available
    const explorerResolved = resolved.find((t) => t.id === "explorer");
    expect(explorerResolved).toBeDefined();

    const spawn = getSpawnCommand("explorer", "/test/dir", undefined);
    expect(spawn).not.toBeNull();
    expect(spawn!.command).toBeTruthy();
  });

  it("DetectsToolsThenResolvesAndBuildsSpawnForTerminal", async () => {
    const detected = await detectInstalledTools();
    const resolved = resolveTools(detected, undefined);

    const terminalResolved = resolved.find((t) => t.id === "terminal");
    expect(terminalResolved).toBeDefined();

    const spawn = getSpawnCommand("terminal", "/test/dir", undefined);
    expect(spawn).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Config integration: overrides and custom tools flow through detection → UI
// ---------------------------------------------------------------------------

describe("config integration", () => {
  it("HidesToolViaConfigOverrideInResolvedList", async () => {
    const detected = await detectInstalledTools();
    const config: WeaveToolsConfig = {
      overrides: { terminal: { hidden: true } },
    };

    const resolved = resolveTools(detected, config);
    const ids = resolved.map((t) => t.id);
    expect(ids).not.toContain("terminal");
  });

  it("AddsCustomToolToResolvedList", async () => {
    const platform = process.platform as "win32" | "darwin" | "linux";
    const detected = await detectInstalledTools();
    const config: WeaveToolsConfig = {
      custom: {
        "my-editor": {
          label: "My Custom Editor",
          category: "editor",
          command: "my-editor-bin",
          args: "${dir}",
          platforms: [platform],
        },
      },
    };

    const resolved = resolveTools(detected, config);
    const myEditor = resolved.find((t) => t.id === "my-editor");
    expect(myEditor).toBeDefined();
    expect(myEditor!.label).toBe("My Custom Editor");
  });

  it("CustomToolCanBeSpawnedViaGetSpawnCommand", () => {
    const platform = process.platform as "win32" | "darwin" | "linux";
    const config: WeaveToolsConfig = {
      custom: {
        "my-editor": {
          label: "My Custom Editor",
          category: "editor",
          command: "my-editor-bin",
          args: "--open ${dir}",
          platforms: [platform],
        },
      },
    };

    const spawn = getSpawnCommand("my-editor", "/projects/foo", config);
    expect(spawn).not.toBeNull();
    expect(spawn!.command).toBe("my-editor-bin");
    expect(spawn!.args).toEqual(["--open", "/projects/foo"]);
  });

  it("OverrideCommandAppliesToBuiltinToolSpawn", () => {
    const config: WeaveToolsConfig = {
      overrides: {
        explorer: { command: "custom-file-manager" },
      },
    };

    const spawn = getSpawnCommand("explorer", "/test/dir", config);
    expect(spawn).not.toBeNull();
    expect(spawn!.command).toBe("custom-file-manager");
  });
});

// ---------------------------------------------------------------------------
// getMergedToolsConfig from config-manager
// ---------------------------------------------------------------------------

describe("getMergedToolsConfig", () => {
  it("ReturnsEmptyConfigWhenNoConfigFileExists", () => {
    const config = getMergedToolsConfig();
    expect(config).toEqual({});
  });

  it("ReturnsToolsConfigFromUserConfigFile", () => {
    writeTempFile(
      mockConfigDir,
      "weave-opencode.jsonc",
      JSON.stringify({
        tools: {
          overrides: {
            vscode: { command: "code-custom" },
          },
          custom: {
            "my-tool": {
              label: "My Tool",
              category: "editor",
              command: "my-tool-bin",
            },
          },
        },
      })
    );

    const config = getMergedToolsConfig();
    expect(config.overrides?.vscode?.command).toBe("code-custom");
    expect(config.custom?.["my-tool"]?.label).toBe("My Tool");
  });

  it("MergesProjectAndUserToolsConfig", () => {
    const projectDir = createSecureTempDir("tool-integ-proj-");

    try {
      // User config
      writeTempFile(
        mockConfigDir,
        "weave-opencode.jsonc",
        JSON.stringify({
          tools: {
            overrides: {
              vscode: { command: "code-user" },
            },
          },
        })
      );

      // Project config overrides vscode command
      writeTempFile(
        projectDir,
        join(".opencode", "weave-opencode.jsonc"),
        JSON.stringify({
          tools: {
            overrides: {
              vscode: { command: "code-project" },
            },
          },
        })
      );

      const config = getMergedToolsConfig(projectDir);
      // Project overrides beat user overrides
      expect(config.overrides?.vscode?.command).toBe("code-project");
    } finally {
      try {
        rmSync(projectDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Backward compatibility — original 4 tool IDs
// ---------------------------------------------------------------------------

describe("backward compatibility", () => {
  const originalToolIds = ["vscode", "cursor", "terminal", "explorer"];

  it("AllOriginalToolIdsAreValid", () => {
    for (const id of originalToolIds) {
      expect(isValidToolId(id)).toBe(true);
    }
  });

  it("AllOriginalToolIdsHaveSpawnCommandsOnCurrentPlatform", () => {
    for (const id of originalToolIds) {
      const tool = getToolById(id);
      expect(tool).toBeDefined();
      const platform = process.platform as string;
      // All 4 original tools have entries for all 3 platforms
      expect(tool!.platforms).toHaveProperty(platform);
    }
  });

  it("AllOriginalToolIdsReturnNonNullSpawnCommand", () => {
    for (const id of originalToolIds) {
      const result = getSpawnCommand(id, "/test/dir", undefined);
      expect(result).not.toBeNull();
    }
  });

  it("DetectionAlwaysIncludesTerminalAndExplorer", async () => {
    const tools = await detectInstalledTools();
    const ids = tools.map((t) => t.id);
    expect(ids).toContain("terminal");
    expect(ids).toContain("explorer");
  });
});
