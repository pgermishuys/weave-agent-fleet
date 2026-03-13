import { writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";
import { homedir } from "os";
import { resolve } from "path";
import { allocatePort, releasePort, _resetForTests, validateDirectory, getAllowedRoots, getEnvRoots, buildAgentModelConfig, _tcpPortAliveForTests } from "@/lib/server/process-manager";
import { _resetDbForTests } from "@/lib/server/database";
import { getInstance as getDbInstance, getRunningInstances, insertWorkspaceRoot } from "@/lib/server/db-repository";
import { createSecureTempDir, writeTempFile } from "./test-temp-utils";

// ---------------------------------------------------------------------------
// Mock config-paths so buildAgentModelConfig tests use temp directories
// instead of real user config. The mock variables are set per-test in
// the buildAgentModelConfig describe block.
// ---------------------------------------------------------------------------
let mockConfigDir: string = join(tmpdir(), "pm-mock-config-fallback");
vi.mock("@/cli/config-paths", () => ({
  getUserConfigDir: () => mockConfigDir,
  getUserWeaveConfigPath: () => join(mockConfigDir, "weave-opencode.jsonc"),
  getSkillsDir: () => join(mockConfigDir, "skills"),
  getProjectConfigDir: (dir: string) => join(dir, ".opencode"),
  getProjectWeaveConfigPath: (dir: string) => join(dir, ".opencode", "weave-opencode.jsonc"),
  getDataDir: () => join(mockConfigDir, "data"),
  getAuthJsonPath: () => join(mockConfigDir, "data", "auth.json"),
}));

// Use an isolated temp DB for all process-manager tests
beforeAll(() => {
  process.env.WEAVE_DB_PATH = join(tmpdir(), `pm-test-${randomUUID()}.db`);
});

afterAll(() => {
  _resetDbForTests();
  delete process.env.WEAVE_DB_PATH;
});

// ---------------------------------------------------------------------------
// Port allocation
// ---------------------------------------------------------------------------

describe("allocatePort", () => {
  beforeEach(() => {
    _resetForTests();
  });

  it("AllocatesFirstPortAs4097", () => {
    expect(allocatePort()).toBe(4097);
  });

  it("AllocatesSequentialPorts", () => {
    expect(allocatePort()).toBe(4097);
    expect(allocatePort()).toBe(4098);
    expect(allocatePort()).toBe(4099);
  });

  it("ThrowsWhenAllPortsExhausted", () => {
    // Allocate all 104 ports (4097–4200 inclusive)
    for (let i = 0; i < 104; i++) {
      allocatePort();
    }
    expect(() => allocatePort()).toThrow("No available ports in range 4097\u20134200");
  });

  it("ReusesReleasedPort", () => {
    const first = allocatePort();   // 4097
    const second = allocatePort();  // 4098
    releasePort(first);             // free 4097
    expect(allocatePort()).toBe(first); // 4097 reused
    expect(second).toBe(4098);
  });

  it("AllocatesSkippingReleasedMiddlePort", () => {
    allocatePort(); // 4097
    allocatePort(); // 4098
    allocatePort(); // 4099
    releasePort(4098);
    // Next allocation should find 4098 first
    expect(allocatePort()).toBe(4098);
  });
});

// ---------------------------------------------------------------------------
// releasePort
// ---------------------------------------------------------------------------

describe("releasePort", () => {
  beforeEach(() => {
    _resetForTests();
  });

  it("IsNoOpForUnallocatedPort", () => {
    // Should not throw
    expect(() => releasePort(4097)).not.toThrow();
    expect(() => releasePort(9999)).not.toThrow();
  });

  it("AllowsPortToBeReallocatedAfterRelease", () => {
    allocatePort(); // 4097
    releasePort(4097);
    expect(allocatePort()).toBe(4097);
  });
});

// ---------------------------------------------------------------------------
// _resetForTests
// ---------------------------------------------------------------------------

describe("_resetForTests", () => {
  it("ClearsUsedPortsStateAfterAllocation", () => {
    allocatePort(); // 4097
    allocatePort(); // 4098
    _resetForTests();
    // After reset the first port should be 4097 again
    expect(allocatePort()).toBe(4097);
  });
});

// ---------------------------------------------------------------------------
// validateDirectory
// ---------------------------------------------------------------------------

describe("validateDirectory", () => {
  afterEach(() => {
    delete process.env.ORCHESTRATOR_WORKSPACE_ROOTS;
  });

  it("ReturnsResolvedPathForValidDirectoryUnderConfiguredRoot", () => {
    process.env.ORCHESTRATOR_WORKSPACE_ROOTS = "/tmp";
    const result = validateDirectory("/tmp");
    expect(result).toBe(resolve("/tmp"));
  });

  it("ReturnsResolvedPathForSubdirectoryUnderConfiguredRoot", () => {
    process.env.ORCHESTRATOR_WORKSPACE_ROOTS = "/tmp";
    const result = validateDirectory("/tmp/.");
    expect(result).toBe(resolve("/tmp"));
  });

  it("ThrowsWhenPathTraversalEscapesAllowedRoot", () => {
    // /tmp/../etc resolves to /etc which is not under /tmp
    process.env.ORCHESTRATOR_WORKSPACE_ROOTS = "/tmp";
    expect(() => validateDirectory("/tmp/../etc")).toThrow(
      "Directory is outside the allowed workspace roots"
    );
  });

  it("ThrowsForDirectoryNotUnderAnyRoot", () => {
    process.env.ORCHESTRATOR_WORKSPACE_ROOTS = "/tmp";
    expect(() => validateDirectory("/var")).toThrow(
      "Directory is outside the allowed workspace roots"
    );
  });

  it("ThrowsForNonExistentDirectory", () => {
    process.env.ORCHESTRATOR_WORKSPACE_ROOTS = "/tmp";
    expect(() => validateDirectory("/tmp/__nonexistent_vitest_dir_xyz123__")).toThrow(
      "Directory does not exist"
    );
  });

  it("ThrowsWhenPathExistsButIsAFile", () => {
    process.env.ORCHESTRATOR_WORKSPACE_ROOTS = "/tmp";
    const tempFile = "/tmp/__vitest_process_manager_test_file__.txt";
    writeFileSync(tempFile, "test");
    try {
      expect(() => validateDirectory(tempFile)).toThrow("Path exists but is not a directory");
    } finally {
      rmSync(tempFile, { force: true });
    }
  });

  it("AcceptsMultipleRootsAndValidatesUnderFirstRoot", () => {
    process.env.ORCHESTRATOR_WORKSPACE_ROOTS = "/tmp:/var";
    // /tmp is a valid root — should succeed
    const result = validateDirectory("/tmp");
    expect(result).toBe(resolve("/tmp"));
  });

  it("AcceptsMultipleRootsAndValidatesUnderSecondRoot", () => {
    process.env.ORCHESTRATOR_WORKSPACE_ROOTS = "/tmp:/var";
    // /var is a valid root on macOS — should succeed
    const result = validateDirectory("/var");
    expect(result).toBe(resolve("/var"));
  });

  it("ThrowsWhenDirectoryNotUnderAnyOfMultipleRoots", () => {
    process.env.ORCHESTRATOR_WORKSPACE_ROOTS = "/tmp:/var";
    expect(() => validateDirectory("/usr")).toThrow(
      "Directory is outside the allowed workspace roots"
    );
  });

  it("DefaultsToHomedirWhenEnvVarIsUnset", () => {
    // ORCHESTRATOR_WORKSPACE_ROOTS is not set — defaults to homedir()
    const home = homedir();
    const result = validateDirectory(home);
    expect(result).toBe(resolve(home));
  });

  it("ThrowsForPathOutsideHomedirWhenEnvVarIsUnset", () => {
    // /tmp is not under homedir() when env var is unset
    expect(() => validateDirectory("/tmp")).toThrow(
      "Directory is outside the allowed workspace roots"
    );
  });

  it("ReturnsResolvedAbsolutePathNotRawInput", () => {
    process.env.ORCHESTRATOR_WORKSPACE_ROOTS = "/tmp";
    // Pass a path with redundant segments; expect the canonical resolved form
    const result = validateDirectory("/tmp/./");
    expect(result).toBe(resolve("/tmp"));
    expect(result).not.toContain(".");
  });

  it("AllowsRootItselfNotJustSubdirectories", () => {
    process.env.ORCHESTRATOR_WORKSPACE_ROOTS = "/tmp";
    // The root itself (/tmp === /tmp) should be allowed
    expect(() => validateDirectory("/tmp")).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// _resetForTests — does not reset DB (DB tests are in db-repository.test.ts)
// ---------------------------------------------------------------------------

describe("_resetForTests with DB", () => {
  beforeEach(() => {
    _resetForTests();
  });

  it("ClearsUsedPortsStateAfterAllocationWithDbPresent", () => {
    allocatePort(); // 4097
    allocatePort(); // 4098
    _resetForTests();
    expect(allocatePort()).toBe(4097);
  });
});

// ---------------------------------------------------------------------------
// DB integration — verifies that DB functions are accessible from tests
// ---------------------------------------------------------------------------

describe("DB integration — repository accessible", () => {
  it("GetRunningInstancesReturnsEmptyWhenNoneInserted", () => {
    const running = getRunningInstances();
    expect(Array.isArray(running)).toBe(true);
  });

  it("GetDbInstanceReturnsUndefinedForUnknownId", () => {
    expect(getDbInstance("nonexistent-id")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// getEnvRoots
// ---------------------------------------------------------------------------

describe("getEnvRoots", () => {
  afterEach(() => {
    delete process.env.ORCHESTRATOR_WORKSPACE_ROOTS;
  });

  it("ReturnsOnlyEnvVarRoots", () => {
    process.env.ORCHESTRATOR_WORKSPACE_ROOTS = "/tmp:/var";
    const roots = getEnvRoots();
    expect(roots).toEqual([resolve("/tmp"), resolve("/var")]);
  });

  it("ReturnsHomedirWhenEnvVarIsUnset", () => {
    const roots = getEnvRoots();
    expect(roots).toEqual([resolve(homedir())]);
  });
});

// ---------------------------------------------------------------------------
// getAllowedRoots — merging env + DB roots
// ---------------------------------------------------------------------------

describe("getAllowedRoots with DB roots", () => {
  beforeEach(() => {
    _resetDbForTests();
    process.env.WEAVE_DB_PATH = join(tmpdir(), `pm-roots-test-${randomUUID()}.db`);
  });

  afterEach(() => {
    delete process.env.ORCHESTRATOR_WORKSPACE_ROOTS;
    _resetDbForTests();
    delete process.env.WEAVE_DB_PATH;
  });

  // getAllowedRoots always includes the Weave workspace root (~/.weave/workspaces)
  // in addition to env and DB roots.
  const weaveWsRoot = resolve(homedir(), ".weave", "workspaces");

  it("ReturnsEnvRootsWhenNoDbRootsExist", () => {
    process.env.ORCHESTRATOR_WORKSPACE_ROOTS = "/tmp";
    const roots = getAllowedRoots();
    expect(roots).toContain(resolve("/tmp"));
    expect(roots).toContain(weaveWsRoot);
    expect(roots.length).toBe(2);
  });

  it("MergesEnvAndDbRoots", () => {
    process.env.ORCHESTRATOR_WORKSPACE_ROOTS = "/tmp";
    insertWorkspaceRoot({ id: randomUUID(), path: "/var" });
    const roots = getAllowedRoots();
    expect(roots).toContain(resolve("/tmp"));
    expect(roots).toContain(resolve("/var"));
    expect(roots).toContain(weaveWsRoot);
    expect(roots.length).toBe(3);
  });

  it("DeduplicatesByResolvedPath", () => {
    process.env.ORCHESTRATOR_WORKSPACE_ROOTS = "/tmp";
    insertWorkspaceRoot({ id: randomUUID(), path: resolve("/tmp") });
    const roots = getAllowedRoots();
    expect(roots).toContain(resolve("/tmp"));
    expect(roots).toContain(weaveWsRoot);
    expect(roots.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// buildAgentModelConfig — agent model injection
// ---------------------------------------------------------------------------

describe("buildAgentModelConfig", () => {
  let testProjectDir: string;

  beforeEach(() => {
    // Point the hoisted vi.mock to a fresh temp dir for user config
    mockConfigDir = createSecureTempDir("model-cfg-test-");
    testProjectDir = createSecureTempDir("model-proj-test-");
  });

  afterEach(() => {
    for (const dir of [mockConfigDir, testProjectDir]) {
      try { rmSync(dir, { recursive: true, force: true }); } catch {}
    }
  });

  it("ReturnsEmptyObjectWhenNoModelsConfigured", () => {
    // No config files exist in either user or project dirs
    const result = buildAgentModelConfig(testProjectDir);
    expect(result).toEqual({});
  });

  it("ReturnsAgentConfigWhenModelsAreSet", () => {
    // Write user-level config with model fields
    writeTempFile(
      mockConfigDir,
      "weave-opencode.jsonc",
      JSON.stringify({
        agents: {
          tapestry: { skills: ["skill-a"], model: "anthropic/claude-sonnet-4-5" },
          shuttle: { skills: ["skill-b"] },
          weft: { model: "openai/gpt-4.1" },
        },
      })
    );

    const result = buildAgentModelConfig(testProjectDir);
    expect(result).toEqual({
      agent: {
        tapestry: { model: "anthropic/claude-sonnet-4-5" },
        weft: { model: "openai/gpt-4.1" },
      },
    });
    // shuttle should NOT be included (no model field)
    expect((result as Record<string, Record<string, unknown>>).agent?.shuttle).toBeUndefined();
  });

  it("MergesProjectConfigModelOverrides", () => {
    // User config has model for tapestry
    writeTempFile(
      mockConfigDir,
      "weave-opencode.jsonc",
      JSON.stringify({
        agents: {
          tapestry: { model: "anthropic/claude-sonnet-4-5" },
        },
      })
    );

    // Project config overrides tapestry model
    writeTempFile(
      testProjectDir,
      join(".opencode", "weave-opencode.jsonc"),
      JSON.stringify({
        agents: {
          tapestry: { model: "openai/gpt-4.1" },
        },
      })
    );

    const result = buildAgentModelConfig(testProjectDir);
    expect(result).toEqual({
      agent: {
        tapestry: { model: "openai/gpt-4.1" },
      },
    });
  });
});

// ---------------------------------------------------------------------------
// tcpPortAlive — TCP probe tests
// ---------------------------------------------------------------------------

describe("tcpPortAlive", () => {
  it("ReturnsTrueWhenServerIsListening", async () => {
    const { createServer: createTcpServer } = await import("net");
    const server = createTcpServer();
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;

    try {
      const alive = await _tcpPortAliveForTests(port, 5000);
      expect(alive).toBe(true);
    } finally {
      server.close();
    }
  });

  it("ReturnsFalseWhenNothingIsListening", async () => {
    // Port 1 is almost certainly not in use and requires root to bind
    const alive = await _tcpPortAliveForTests(1, 1000);
    expect(alive).toBe(false);
  });

  it("ReturnsFalseWhenTimeoutIsVeryShort", async () => {
    // Use a non-routable IP-like port scenario — timeout should fire
    // Port 1 with a 1ms timeout should fail fast
    const alive = await _tcpPortAliveForTests(1, 1);
    expect(alive).toBe(false);
  });
});
