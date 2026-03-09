import {
  detectInstalledTools,
  invalidateDetectionCache,
} from "@/lib/server/tool-detector";
import { BUILTIN_TOOLS, type ToolDefinition } from "@/lib/server/tool-registry";

// ---------------------------------------------------------------------------
// invalidateDetectionCache
// ---------------------------------------------------------------------------

describe("invalidateDetectionCache", () => {
  it("DoesNotThrowWhenCalledBeforeAnyDetection", () => {
    expect(() => invalidateDetectionCache()).not.toThrow();
  });

  it("DoesNotThrowWhenCalledMultipleTimes", () => {
    invalidateDetectionCache();
    invalidateDetectionCache();
    invalidateDetectionCache();
  });
});

// ---------------------------------------------------------------------------
// detectInstalledTools
// ---------------------------------------------------------------------------

describe("detectInstalledTools", () => {
  beforeEach(() => {
    invalidateDetectionCache();
  });

  it("ReturnsAnArray", async () => {
    const tools = await detectInstalledTools();
    expect(Array.isArray(tools)).toBe(true);
  });

  it("AlwaysIncludesAlwaysAvailableToolsForCurrentPlatform", async () => {
    const platform = process.platform;
    const alwaysAvailable = BUILTIN_TOOLS.filter(
      (t) => t.alwaysAvailable && t.platforms[platform as keyof typeof t.platforms]
    );

    const tools = await detectInstalledTools();
    const toolIds = tools.map((t) => t.id);

    for (const expected of alwaysAvailable) {
      expect(toolIds).toContain(expected.id);
    }
  });

  it("IncludesTerminalToolAsAlwaysAvailable", async () => {
    const tools = await detectInstalledTools();
    const toolIds = tools.map((t) => t.id);
    expect(toolIds).toContain("terminal");
  });

  it("IncludesExplorerToolAsAlwaysAvailable", async () => {
    const tools = await detectInstalledTools();
    const toolIds = tools.map((t) => t.id);
    expect(toolIds).toContain("explorer");
  });

  it("OnlyReturnsToolsWithPlatformEntryForCurrentOS", async () => {
    const platform = process.platform as string;
    const tools = await detectInstalledTools();
    for (const tool of tools) {
      expect(tool.platforms).toHaveProperty(platform);
    }
  });

  it("ReturnsFullToolDefinitionObjects", async () => {
    const tools = await detectInstalledTools();
    for (const tool of tools) {
      expect(tool.id).toBeTruthy();
      expect(tool.label).toBeTruthy();
      expect(tool.iconName).toBeTruthy();
      expect(["editor", "terminal", "explorer"]).toContain(tool.category);
      expect(typeof tool.platforms).toBe("object");
    }
  });

  it("ReturnsCachedResultOnSecondCall", async () => {
    const first = await detectInstalledTools();
    const second = await detectInstalledTools();
    // Should be the exact same array reference due to caching
    expect(first).toBe(second);
  });

  it("ReturnsNewResultAfterCacheInvalidation", async () => {
    const first = await detectInstalledTools();
    invalidateDetectionCache();
    const second = await detectInstalledTools();
    // Should NOT be the same reference (re-scanned)
    expect(first).not.toBe(second);
    // But should have the same contents (same system)
    expect(first.map((t) => t.id).sort()).toEqual(second.map((t) => t.id).sort());
  });

  it("DoesNotIncludeToolsForOtherPlatforms", async () => {
    const platform = process.platform;
    const tools = await detectInstalledTools();

    // Find tools that are only defined for other platforms
    const otherPlatformOnly = BUILTIN_TOOLS.filter(
      (t) => !t.platforms[platform as keyof typeof t.platforms]
    );

    const detectedIds = new Set(tools.map((t) => t.id));
    for (const tool of otherPlatformOnly) {
      expect(detectedIds.has(tool.id)).toBe(false);
    }
  });

  it("CompletesWithinReasonableTime", async () => {
    const start = Date.now();
    await detectInstalledTools();
    const elapsed = Date.now() - start;
    // Should complete well within 30 seconds even scanning all tools
    expect(elapsed).toBeLessThan(30_000);
  });
});
