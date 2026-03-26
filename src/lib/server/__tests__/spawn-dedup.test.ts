/**
 * Tests for spawn deduplication (inflight-spawn coalescing) in process-manager.
 *
 * These tests verify that concurrent `spawnInstance()` calls for the same
 * directory return the same promise (dedup) while different directories
 * proceed independently. A separate file is used because we need heavy
 * mocking of child_process, SDK, DB, filesystem, and net — which would
 * conflict with the existing process-manager.test.ts tests.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "events";
import { join } from "path";

// ─── Controllable mock child process factory ──────────────────────────────────

interface MockChildProcess extends EventEmitter {
  pid: number;
  exitCode: null;
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: ReturnType<typeof vi.fn>;
}

let spawnCalls: Array<{ command: string; args: string[]; mockProc: MockChildProcess }> = [];

function createMockProc(pid: number): MockChildProcess {
  const proc = new EventEmitter() as MockChildProcess;
  proc.pid = pid;
  proc.exitCode = null;
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = vi.fn();
  return proc;
}

let nextPid = 10000;

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("child_process", () => {
  const mocked = {
    spawn: vi.fn((...args: unknown[]) => {
      const proc = createMockProc(nextPid++);
      spawnCalls.push({
        command: args[0] as string,
        args: args[1] as string[],
        mockProc: proc,
      });
      return proc;
    }),
  };
  return { ...mocked, default: mocked };
});

vi.mock("@opencode-ai/sdk/v2", () => ({
  createOpencodeClient: vi.fn(() => ({
    session: { list: vi.fn(async () => ({ sessions: [] })) },
    event: {
      subscribe: vi.fn(async () => ({
        [Symbol.asyncIterator]: () => ({
          next: async () => ({ done: true, value: undefined }),
        }),
      })),
    },
  })),
}));

vi.mock("@/lib/server/db-repository", () => ({
  insertInstance: vi.fn(),
  updateInstanceStatus: vi.fn(),
  markAllInstancesStopped: vi.fn(),
  markAllNonTerminalSessionsStopped: vi.fn(),
  getSessionsForInstance: vi.fn(() => []),
  updateSessionStatus: vi.fn(),
  listWorkspaceRoots: vi.fn(() => []),
  getSessionByOpencodeId: vi.fn(() => undefined),
  getSession: vi.fn(() => undefined),
  getActiveChildSessions: vi.fn(() => []),
}));

vi.mock("@/lib/server/session-status-watcher", () => ({
  ensureWatching: vi.fn(),
  stopWatching: vi.fn(),
}));

vi.mock("@/lib/server/config-manager", () => ({
  getMergedConfig: vi.fn(() => ({})),
}));

vi.mock("@/cli/config-paths", () => ({
  getUserConfigDir: () => "/tmp/mock-config",
  getUserWeaveConfigPath: () => "/tmp/mock-config/weave-opencode.jsonc",
  getSkillsDir: () => "/tmp/mock-config/skills",
  getProjectConfigDir: (dir: string) => join(dir, ".opencode"),
  getProjectWeaveConfigPath: (dir: string) =>
    join(dir, ".opencode", "weave-opencode.jsonc"),
  getDataDir: () => "/tmp/mock-config/data",
  getAuthJsonPath: () => "/tmp/mock-config/data/auth.json",
}));

// Mock net — isPortAvailable uses createServer to check port availability
vi.mock("net", async () => {
  const { EventEmitter: EE } = await vi.importActual<typeof import("events")>("events");
  const mocked = {
    createServer: vi.fn(() => {
      const server = new EE() as unknown as Record<string, unknown>;
      server.listen = vi.fn(() => {
        // Simulate: port is available — emit 'listening' next tick then close
        process.nextTick(() => (server as unknown as InstanceType<typeof EE>).emit("listening"));
      });
      server.close = vi.fn((cb?: () => void) => {
        if (cb) process.nextTick(cb);
      });
      return server;
    }),
    Socket: class extends EE {
      connect() { return this; }
      destroy() {}
      setTimeout() {}
    },
  };
  return { ...mocked, default: mocked };
});

// Mock fs — validateDirectory is NOT called by spawnInstance, but the module
// top-level code checks OPENCODE_BIN via existsSync.
vi.mock("fs", async () => {
  const actual = await vi.importActual<typeof import("fs")>("fs");
  const mocked = {
    ...actual,
    existsSync: vi.fn((p: string) => {
      if (typeof p === "string" && p.startsWith("/tmp")) return true;
      return actual.existsSync(p);
    }),
    statSync: vi.fn((p: string) => {
      if (typeof p === "string" && p.startsWith("/tmp"))
        return { isDirectory: (): boolean => true };
      return actual.statSync(p);
    }),
  };
  return { ...mocked, default: mocked };
});

// ─── Import SUT after all mocks ───────────────────────────────────────────────

import { spawnInstance, _resetForTests } from "@/lib/server/process-manager";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Make a mock process emit its "listening" line so spawnOpencodeServer resolves. */
function emitListening(mockProc: MockChildProcess, port: number): void {
  mockProc.stdout.emit(
    "data",
    Buffer.from(`opencode server listening on http://127.0.0.1:${port}\n`)
  );
}

// ─── Setup / Teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  _resetForTests();
  spawnCalls = [];
  nextPid = 10000;
  process.env.ORCHESTRATOR_WORKSPACE_ROOTS = "/tmp";
});

afterEach(() => {
  delete process.env.ORCHESTRATOR_WORKSPACE_ROOTS;
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Spawn deduplication (inflightSpawns)", () => {
  it("DeduplicatesConcurrentSpawnsForSameDirectory", async () => {
    const dir = "/tmp/test-dedup-same";

    // Fire two concurrent spawnInstance calls for the same directory
    const promise1 = spawnInstance(dir);
    const promise2 = spawnInstance(dir);

    // Allow isPortAvailable's process.nextTick to fire
    await new Promise((r) => setTimeout(r, 50));

    // Only ONE child_process.spawn should have been called
    expect(spawnCalls.length).toBe(1);

    // Complete the spawn by emitting the listening line
    emitListening(spawnCalls[0].mockProc, 4097);

    // Both promises should resolve to the exact same instance
    const [instance1, instance2] = await Promise.all([promise1, promise2]);
    expect(instance1).toBe(instance2);
    expect(instance1.directory).toBe(dir);
    expect(instance1.status).toBe("running");
  });

  it("SpawnsIndependentlyForDifferentDirectories", async () => {
    const dirA = "/tmp/test-dedup-a";
    const dirB = "/tmp/test-dedup-b";

    // Fire concurrent spawnInstance calls for DIFFERENT directories
    const promiseA = spawnInstance(dirA);
    const promiseB = spawnInstance(dirB);

    // Allow isPortAvailable ticks to fire
    await new Promise((r) => setTimeout(r, 50));

    // TWO child_process.spawn calls should have been made
    expect(spawnCalls.length).toBe(2);

    // Complete both spawns (ports are allocated sequentially starting at 4097)
    emitListening(spawnCalls[0].mockProc, 4097);
    emitListening(spawnCalls[1].mockProc, 4098);

    const [instanceA, instanceB] = await Promise.all([promiseA, promiseB]);

    expect(instanceA).not.toBe(instanceB);
    expect(instanceA.directory).toBe(dirA);
    expect(instanceB.directory).toBe(dirB);
  });

  it("CleansUpInflightEntryAfterSpawnCompletes", async () => {
    const dir = "/tmp/test-dedup-cleanup";

    const promise1 = spawnInstance(dir);

    // Allow isPortAvailable tick to fire
    await new Promise((r) => setTimeout(r, 50));

    emitListening(spawnCalls[0].mockProc, 4097);
    await promise1;

    // After the first spawn completes, a second call should reuse the existing
    // running instance (via directoryToInstanceId). It should NOT spawn a new
    // child process — the inflight entry was cleaned up, and the running
    // instance is still there.
    const promise2 = spawnInstance(dir);
    const instance2 = await promise2;

    expect(instance2.directory).toBe(dir);
    expect(instance2.status).toBe("running");

    // Only 1 child_process.spawn call total — second call reuses running instance
    expect(spawnCalls.length).toBe(1);
  });
});
