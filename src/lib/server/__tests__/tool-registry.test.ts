import { resolve } from "path";
import {
  BUILTIN_TOOLS,
  getToolById,
  getToolsByCategory,
  getAllToolIds,
  isValidToolId,
  resolveTools,
  getSpawnCommand,
  type ToolDefinition,
  type WeaveToolsConfig,
} from "@/lib/server/tool-registry";

// ---------------------------------------------------------------------------
// BUILTIN_TOOLS structure
// ---------------------------------------------------------------------------

describe("BUILTIN_TOOLS", () => {
  it("ContainsAtLeast20Tools", () => {
    expect(BUILTIN_TOOLS.length).toBeGreaterThanOrEqual(20);
  });

  it("HasUniqueIds", () => {
    const ids = BUILTIN_TOOLS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("EveryToolHasRequiredFields", () => {
    for (const tool of BUILTIN_TOOLS) {
      expect(tool.id).toBeTruthy();
      expect(tool.label).toBeTruthy();
      expect(tool.iconName).toBeTruthy();
      expect(["editor", "terminal", "explorer"]).toContain(tool.category);
      expect(Object.keys(tool.platforms).length).toBeGreaterThan(0);
    }
  });

  it("IncludesOriginalFourToolIds", () => {
    // Backward compatibility: the original 4 tool IDs must always exist
    const ids = BUILTIN_TOOLS.map((t) => t.id);
    expect(ids).toContain("vscode");
    expect(ids).toContain("cursor");
    expect(ids).toContain("terminal");
    expect(ids).toContain("explorer");
  });

  it("PlatformCommandArgsReturnArrayOfStrings", () => {
    for (const tool of BUILTIN_TOOLS) {
      for (const [, cmd] of Object.entries(tool.platforms)) {
        if (!cmd) continue;
        const args = cmd.args("/test/dir");
        expect(Array.isArray(args)).toBe(true);
        for (const arg of args) {
          expect(typeof arg).toBe("string");
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// getToolById
// ---------------------------------------------------------------------------

describe("getToolById", () => {
  it("ReturnsToolDefinitionForKnownId", () => {
    const tool = getToolById("vscode");
    expect(tool).toBeDefined();
    expect(tool!.id).toBe("vscode");
    expect(tool!.label).toBe("VS Code");
    expect(tool!.category).toBe("editor");
  });

  it("ReturnsUndefinedForUnknownId", () => {
    expect(getToolById("nonexistent-tool")).toBeUndefined();
  });

  it("ReturnsUndefinedForEmptyString", () => {
    expect(getToolById("")).toBeUndefined();
  });

  it("ReturnsCorrectToolForEachCategory", () => {
    expect(getToolById("terminal")!.category).toBe("terminal");
    expect(getToolById("explorer")!.category).toBe("explorer");
    expect(getToolById("vscode")!.category).toBe("editor");
  });
});

// ---------------------------------------------------------------------------
// getToolsByCategory
// ---------------------------------------------------------------------------

describe("getToolsByCategory", () => {
  it("ReturnsOnlyEditorToolsForEditorCategory", () => {
    const editors = getToolsByCategory("editor");
    expect(editors.length).toBeGreaterThan(0);
    for (const t of editors) {
      expect(t.category).toBe("editor");
    }
  });

  it("ReturnsOnlyTerminalToolsForTerminalCategory", () => {
    const terminals = getToolsByCategory("terminal");
    expect(terminals.length).toBeGreaterThan(0);
    for (const t of terminals) {
      expect(t.category).toBe("terminal");
    }
  });

  it("ReturnsOnlyExplorerToolsForExplorerCategory", () => {
    const explorers = getToolsByCategory("explorer");
    expect(explorers.length).toBeGreaterThan(0);
    for (const t of explorers) {
      expect(t.category).toBe("explorer");
    }
  });

  it("ReturnsSameToolsAsFilteringBUILTIN_TOOLS", () => {
    const editors = getToolsByCategory("editor");
    const expected = BUILTIN_TOOLS.filter((t) => t.category === "editor");
    expect(editors).toEqual(expected);
  });
});

// ---------------------------------------------------------------------------
// getAllToolIds
// ---------------------------------------------------------------------------

describe("getAllToolIds", () => {
  it("ReturnsArrayOfStrings", () => {
    const ids = getAllToolIds();
    expect(Array.isArray(ids)).toBe(true);
    for (const id of ids) {
      expect(typeof id).toBe("string");
    }
  });

  it("MatchesBUILTIN_TOOLSLength", () => {
    expect(getAllToolIds().length).toBe(BUILTIN_TOOLS.length);
  });

  it("IncludesKnownToolIds", () => {
    const ids = getAllToolIds();
    expect(ids).toContain("vscode");
    expect(ids).toContain("terminal");
    expect(ids).toContain("explorer");
  });
});

// ---------------------------------------------------------------------------
// isValidToolId
// ---------------------------------------------------------------------------

describe("isValidToolId", () => {
  it("ReturnsTrueForBuiltinToolIds", () => {
    expect(isValidToolId("vscode")).toBe(true);
    expect(isValidToolId("cursor")).toBe(true);
    expect(isValidToolId("terminal")).toBe(true);
    expect(isValidToolId("explorer")).toBe(true);
    expect(isValidToolId("windsurf")).toBe(true);
    expect(isValidToolId("zed")).toBe(true);
  });

  it("ReturnsFalseForUnknownIds", () => {
    expect(isValidToolId("nonexistent")).toBe(false);
    expect(isValidToolId("")).toBe(false);
    expect(isValidToolId("VSCODE")).toBe(false); // Case-sensitive
  });
});

// ---------------------------------------------------------------------------
// resolveTools
// ---------------------------------------------------------------------------

describe("resolveTools", () => {
  const makeTool = (partial: Partial<ToolDefinition> & { id: string }): ToolDefinition => ({
    label: partial.label ?? partial.id,
    iconName: partial.iconName ?? "test-icon",
    category: partial.category ?? "editor",
    platforms: partial.platforms ?? {},
    ...partial,
  });

  const toolA = makeTool({ id: "a", label: "Tool A", iconName: "icon-a", category: "editor" });
  const toolB = makeTool({ id: "b", label: "Tool B", iconName: "icon-b", category: "terminal" });

  it("ReturnsDetectedToolsWhenNoConfig", () => {
    const resolved = resolveTools([toolA, toolB], undefined);
    expect(resolved).toEqual([
      { id: "a", label: "Tool A", iconName: "icon-a", category: "editor" },
      { id: "b", label: "Tool B", iconName: "icon-b", category: "terminal" },
    ]);
  });

  it("ReturnsDetectedToolsWithEmptyConfig", () => {
    const resolved = resolveTools([toolA, toolB], {});
    expect(resolved.length).toBe(2);
  });

  it("HidesToolsMarkedHiddenInOverrides", () => {
    const config: WeaveToolsConfig = {
      overrides: { a: { hidden: true } },
    };
    const resolved = resolveTools([toolA, toolB], config);
    expect(resolved.map((t) => t.id)).toEqual(["b"]);
  });

  it("AppendsCustomToolsFromConfig", () => {
    const platform = process.platform as "win32" | "darwin" | "linux";
    const config: WeaveToolsConfig = {
      custom: {
        "my-tool": {
          label: "My Tool",
          category: "editor",
          command: "my-tool",
          platforms: [platform],
        },
      },
    };
    const resolved = resolveTools([toolA], config);
    expect(resolved.length).toBe(2);
    expect(resolved[1].id).toBe("my-tool");
    expect(resolved[1].label).toBe("My Tool");
    expect(resolved[1].iconName).toBe("wrench"); // default icon
  });

  it("FiltersCustomToolsByPlatform", () => {
    const otherPlatform = process.platform === "win32" ? "darwin" : "win32";
    const config: WeaveToolsConfig = {
      custom: {
        "other-platform-tool": {
          label: "Other",
          category: "editor",
          command: "other",
          platforms: [otherPlatform as "win32" | "darwin" | "linux"],
        },
      },
    };
    const resolved = resolveTools([], config);
    expect(resolved.length).toBe(0);
  });

  it("HidesCustomToolsWhenOverriddenWithHidden", () => {
    const platform = process.platform as "win32" | "darwin" | "linux";
    const config: WeaveToolsConfig = {
      overrides: { "my-tool": { hidden: true } },
      custom: {
        "my-tool": {
          label: "My Tool",
          category: "editor",
          command: "my-tool",
          platforms: [platform],
        },
      },
    };
    const resolved = resolveTools([], config);
    expect(resolved.length).toBe(0);
  });

  it("UsesCustomIconNameWhenProvided", () => {
    const platform = process.platform as "win32" | "darwin" | "linux";
    const config: WeaveToolsConfig = {
      custom: {
        "icon-tool": {
          label: "Icon Tool",
          category: "editor",
          iconName: "star",
          command: "icon-tool",
          platforms: [platform],
        },
      },
    };
    const resolved = resolveTools([], config);
    expect(resolved[0].iconName).toBe("star");
  });

  it("IncludesCustomToolWithNoPlatformRestriction", () => {
    const config: WeaveToolsConfig = {
      custom: {
        "unrestricted": {
          label: "Unrestricted",
          category: "editor",
          command: "unrestricted",
        },
      },
    };
    const resolved = resolveTools([], config);
    expect(resolved.length).toBe(1);
    expect(resolved[0].id).toBe("unrestricted");
  });
});

// ---------------------------------------------------------------------------
// getSpawnCommand
// ---------------------------------------------------------------------------

describe("getSpawnCommand", () => {
  const platform = process.platform as "win32" | "darwin" | "linux";

  it("ReturnsSpawnConfigForKnownBuiltinTool", () => {
    // "explorer" is alwaysAvailable on all platforms
    const result = getSpawnCommand("explorer", "/test/dir", undefined);
    expect(result).not.toBeNull();
    expect(result!.command).toBeTruthy();
    expect(Array.isArray(result!.args)).toBe(true);
    expect(result!.options.detached).toBe(true);
    expect(result!.options.stdio).toBe("ignore");
  });

  it("ReturnsNullForUnknownTool", () => {
    expect(getSpawnCommand("nonexistent", "/test/dir", undefined)).toBeNull();
  });

  it("ReturnsNullForToolOnUnsupportedPlatform", () => {
    // "wt" (Windows Terminal) only exists on win32
    if (platform !== "win32") {
      expect(getSpawnCommand("wt", "/test/dir", undefined)).toBeNull();
    }
    // "iterm2" only exists on darwin
    if (platform !== "darwin") {
      expect(getSpawnCommand("iterm2", "/test/dir", undefined)).toBeNull();
    }
  });

  it("AppliesCommandOverrideFromConfig", () => {
    const config: WeaveToolsConfig = {
      overrides: {
        explorer: { command: "my-explorer" },
      },
    };
    const result = getSpawnCommand("explorer", "/test/dir", config);
    expect(result).not.toBeNull();
    expect(result!.command).toBe("my-explorer");
  });

  it("AppliesArgsOverrideWithDirSubstitution", () => {
    const config: WeaveToolsConfig = {
      overrides: {
        explorer: { args: "--path ${dir} --flag" },
      },
    };
    const result = getSpawnCommand("explorer", "/test/dir", config);
    expect(result).not.toBeNull();
    expect(result!.args).toEqual(["--path", resolve("/test/dir"), "--flag"]);
  });

  it("ReturnsSpawnConfigForCustomToolFromConfig", () => {
    const config: WeaveToolsConfig = {
      custom: {
        "my-editor": {
          label: "My Editor",
          category: "editor",
          command: "my-editor-bin",
          args: "${dir}",
          platforms: [platform],
        },
      },
    };
    const result = getSpawnCommand("my-editor", "/test/dir", config);
    expect(result).not.toBeNull();
    expect(result!.command).toBe("my-editor-bin");
    expect(result!.args).toEqual([resolve("/test/dir")]);
  });

  it("ReturnsNullForCustomToolOnWrongPlatform", () => {
    const otherPlatform = platform === "win32" ? "darwin" : "win32";
    const config: WeaveToolsConfig = {
      custom: {
        "other-tool": {
          label: "Other",
          category: "editor",
          command: "other",
          platforms: [otherPlatform as "win32" | "darwin" | "linux"],
        },
      },
    };
    expect(getSpawnCommand("other-tool", "/test/dir", config)).toBeNull();
  });

  it("UsesDefaultDirArgForCustomToolWithNoArgs", () => {
    const config: WeaveToolsConfig = {
      custom: {
        "simple-tool": {
          label: "Simple",
          category: "editor",
          command: "simple-bin",
          platforms: [platform],
        },
      },
    };
    const result = getSpawnCommand("simple-tool", "/my/dir", config);
    expect(result).not.toBeNull();
    // Default args template is "${dir}" → just the directory
    expect(result!.args).toEqual([resolve("/my/dir")]);
  });

  it("PrefersBuiltinOverCustomWhenBothExist", () => {
    // If a custom tool has the same ID as a builtin, builtin wins
    const config: WeaveToolsConfig = {
      custom: {
        explorer: {
          label: "Custom Explorer",
          category: "explorer",
          command: "custom-explorer",
          platforms: [platform],
        },
      },
    };
    const result = getSpawnCommand("explorer", "/test/dir", config);
    expect(result).not.toBeNull();
    // Should use the builtin explorer command, not "custom-explorer"
    expect(result!.command).not.toBe("custom-explorer");
  });

  it("SetsCwdForTerminalWithDirectoryOption", () => {
    // "terminal" has options.cwd = "directory"
    const result = getSpawnCommand("terminal", "/test/dir", undefined);
    expect(result).not.toBeNull();
    expect(result!.options.cwd).toBe(resolve("/test/dir"));
  });

  it("AppliesOverrideCommandToCustomTool", () => {
    const config: WeaveToolsConfig = {
      overrides: {
        "my-tool": { command: "overridden-bin" },
      },
      custom: {
        "my-tool": {
          label: "My Tool",
          category: "editor",
          command: "original-bin",
          platforms: [platform],
        },
      },
    };
    const result = getSpawnCommand("my-tool", "/test/dir", config);
    expect(result).not.toBeNull();
    expect(result!.command).toBe("overridden-bin");
  });

  it("PreservesDirectoryWithSpacesAsOneArgInCustomTool", () => {
    const config: WeaveToolsConfig = {
      custom: {
        "space-tool": {
          label: "Space Tool",
          category: "editor",
          command: "my-editor",
          args: "--open ${dir} --flag",
          platforms: [platform],
        },
      },
    };
    const dirWithSpaces = "/Users/john doe/my projects";
    const result = getSpawnCommand("space-tool", dirWithSpaces, config);
    expect(result).not.toBeNull();
    // The directory should remain a single argument, not split on spaces
    expect(result!.args).toEqual(["--open", resolve(dirWithSpaces), "--flag"]);
  });

  it("PreservesDirectoryWithSpacesAsOneArgInOverrideArgs", () => {
    const config: WeaveToolsConfig = {
      overrides: {
        vscode: { args: "--new-window ${dir}" },
      },
    };
    const dirWithSpaces = "/Users/john doe/my projects";
    const result = getSpawnCommand("vscode", dirWithSpaces, config);
    expect(result).not.toBeNull();
    // The directory should remain a single argument, not split on spaces
    expect(result!.args).toEqual(["--new-window", resolve(dirWithSpaces)]);
  });
});
