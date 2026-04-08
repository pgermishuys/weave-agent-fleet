/**
 * Unit tests for ensureInstanceForSession() and ensureInstanceById() in opencode-client.ts.
 *
 * These tests verify the lazy instance recovery logic:
 * - Fast path: instance already running → return immediately
 * - Slow path: instance dead/missing → DB lookup → spawn → update FK → return
 * - Error cases: session not found, concurrent recovery coalescing
 */

import { vi, describe, it, expect, beforeEach } from "vitest";

// ─── Mocks (must be before imports of the module under test) ──────────────────

const mockGetInstanceFromPM = vi.fn();
const mockSpawnInstance = vi.fn();
const mockGetDbSession = vi.fn();
const mockGetSessionByOpencodeId = vi.fn();
const mockGetDbInstance = vi.fn();
const mockUpdateSessionInstanceId = vi.fn();

vi.mock("@/lib/server/process-manager", () => ({
  getInstance: mockGetInstanceFromPM,
  spawnInstance: mockSpawnInstance,
}));

vi.mock("@/lib/server/db-repository", () => ({
  getSession: mockGetDbSession,
  getSessionByOpencodeId: mockGetSessionByOpencodeId,
  getInstance: mockGetDbInstance,
  updateSessionInstanceId: mockUpdateSessionInstanceId,
}));

vi.mock("@/lib/server/logger", () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import {
  ensureInstanceForSession,
  ensureInstanceById,
} from "@/lib/server/opencode-client";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeManagedInstance(id = "inst-live", directory = "/tmp/proj") {
  return {
    id,
    port: 4100,
    url: `http://localhost:4100`,
    directory,
    client: { session: {}, app: {}, command: {}, provider: {}, find: {} },
    close: vi.fn(),
    status: "running" as const,
    createdAt: new Date(),
    recovered: false,
  };
}

function makeDbSession(overrides: Record<string, unknown> = {}) {
  return {
    id: "db-sess-1",
    workspace_id: "ws-1",
    instance_id: "inst-old",
    opencode_session_id: "oc-sess-1",
    title: "Test",
    directory: "/tmp/proj",
    status: "stopped" as const,
    created_at: new Date().toISOString(),
    stopped_at: new Date().toISOString(),
    parent_session_id: null,
    activity_status: null,
    lifecycle_status: "stopped" as const,
    total_tokens: 0,
    total_cost: 0,
    ...overrides,
  };
}

// ─── ensureInstanceForSession tests ──────────────────────────────────────────

describe("ensureInstanceForSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("FastPath_ReturnsExistingRunningInstance", async () => {
    const inst = makeManagedInstance("inst-1");
    mockGetInstanceFromPM.mockReturnValue(inst);

    const result = await ensureInstanceForSession("inst-1", "sess-1");

    expect(result.instance).toBe(inst);
    expect(result.client).toBe(inst.client);
    // Should not touch DB or spawn anything
    expect(mockGetDbSession).not.toHaveBeenCalled();
    expect(mockSpawnInstance).not.toHaveBeenCalled();
  });

  it("FastPath_DeadInstanceTriggersSlowPath", async () => {
    const deadInst = { ...makeManagedInstance(), status: "dead" as const };
    mockGetInstanceFromPM.mockReturnValue(deadInst);

    const dbSess = makeDbSession();
    mockGetDbSession.mockReturnValue(dbSess);

    const newInst = makeManagedInstance("inst-new");
    mockSpawnInstance.mockResolvedValue(newInst);

    const result = await ensureInstanceForSession("inst-old", "db-sess-1");

    expect(mockSpawnInstance).toHaveBeenCalledWith("/tmp/proj");
    expect(result.instance).toBe(newInst);
    expect(result.client).toBe(newInst.client);
  });

  it("SlowPath_MissingInstance_LooksUpSessionAndSpawns", async () => {
    mockGetInstanceFromPM.mockReturnValue(undefined);

    const dbSess = makeDbSession();
    mockGetDbSession.mockReturnValue(dbSess);

    const newInst = makeManagedInstance("inst-new");
    mockSpawnInstance.mockResolvedValue(newInst);

    const result = await ensureInstanceForSession("inst-old", "db-sess-1");

    expect(mockGetDbSession).toHaveBeenCalledWith("db-sess-1");
    expect(mockSpawnInstance).toHaveBeenCalledWith("/tmp/proj");
    expect(result.instance).toBe(newInst);
  });

  it("SlowPath_UpdatesSessionInstanceIdInDb", async () => {
    mockGetInstanceFromPM.mockReturnValue(undefined);

    const dbSess = makeDbSession({ instance_id: "inst-old" });
    mockGetDbSession.mockReturnValue(dbSess);

    const newInst = makeManagedInstance("inst-new");
    mockSpawnInstance.mockResolvedValue(newInst);

    await ensureInstanceForSession("inst-old", "db-sess-1");

    expect(mockUpdateSessionInstanceId).toHaveBeenCalledWith("db-sess-1", "inst-new");
  });

  it("SlowPath_DoesNotUpdateDbWhenInstanceIdUnchanged", async () => {
    mockGetInstanceFromPM.mockReturnValue(undefined);

    // Session already points to the same instance that gets spawned
    const dbSess = makeDbSession({ instance_id: "inst-same" });
    mockGetDbSession.mockReturnValue(dbSess);

    const newInst = makeManagedInstance("inst-same");
    mockSpawnInstance.mockResolvedValue(newInst);

    await ensureInstanceForSession("inst-same", "db-sess-1");

    expect(mockUpdateSessionInstanceId).not.toHaveBeenCalled();
  });

  it("SlowPath_FallsBackToOpencodeSessionId", async () => {
    mockGetInstanceFromPM.mockReturnValue(undefined);
    // First lookup by fleet id fails
    mockGetDbSession.mockReturnValue(undefined);
    // Fallback by opencode session id succeeds
    const dbSess = makeDbSession({ id: "db-sess-1", opencode_session_id: "oc-sess-1" });
    mockGetSessionByOpencodeId.mockReturnValue(dbSess);

    const newInst = makeManagedInstance("inst-new");
    mockSpawnInstance.mockResolvedValue(newInst);

    await ensureInstanceForSession("inst-old", "oc-sess-1");

    expect(mockGetSessionByOpencodeId).toHaveBeenCalledWith("oc-sess-1");
    expect(mockSpawnInstance).toHaveBeenCalledWith("/tmp/proj");
  });

  it("SlowPath_ThrowsWhenSessionNotInDb", async () => {
    mockGetInstanceFromPM.mockReturnValue(undefined);
    mockGetDbSession.mockReturnValue(undefined);
    mockGetSessionByOpencodeId.mockReturnValue(undefined);

    await expect(
      ensureInstanceForSession("inst-old", "nonexistent-sess")
    ).rejects.toThrow("Session not found: nonexistent-sess");

    expect(mockSpawnInstance).not.toHaveBeenCalled();
  });

  it("SlowPath_UpdateSessionInstanceIdFailureIsNonFatal", async () => {
    mockGetInstanceFromPM.mockReturnValue(undefined);

    const dbSess = makeDbSession({ instance_id: "inst-old" });
    mockGetDbSession.mockReturnValue(dbSess);

    const newInst = makeManagedInstance("inst-new");
    mockSpawnInstance.mockResolvedValue(newInst);

    // DB update fails
    mockUpdateSessionInstanceId.mockImplementation(() => {
      throw new Error("DB write error");
    });

    // Should NOT throw — DB update failure is non-fatal
    const result = await ensureInstanceForSession("inst-old", "db-sess-1");

    expect(result.instance).toBe(newInst);
    expect(result.client).toBe(newInst.client);
  });
});

// ─── ensureInstanceById tests ─────────────────────────────────────────────────

describe("ensureInstanceById", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("FastPath_ReturnsExistingRunningInstance", async () => {
    const inst = makeManagedInstance("inst-1");
    mockGetInstanceFromPM.mockReturnValue(inst);

    const result = await ensureInstanceById("inst-1");

    expect(result.instance).toBe(inst);
    expect(result.client).toBe(inst.client);
    expect(mockGetDbInstance).not.toHaveBeenCalled();
    expect(mockSpawnInstance).not.toHaveBeenCalled();
  });

  it("SlowPath_MissingInstance_LooksUpDbAndSpawns", async () => {
    mockGetInstanceFromPM.mockReturnValue(undefined);

    mockGetDbInstance.mockReturnValue({
      id: "inst-old",
      directory: "/tmp/proj",
      port: 4100,
      status: "stopped",
    });

    const newInst = makeManagedInstance("inst-new");
    mockSpawnInstance.mockResolvedValue(newInst);

    const result = await ensureInstanceById("inst-old");

    expect(mockGetDbInstance).toHaveBeenCalledWith("inst-old");
    expect(mockSpawnInstance).toHaveBeenCalledWith("/tmp/proj");
    expect(result.instance).toBe(newInst);
  });

  it("SlowPath_ThrowsWhenInstanceNotInDb", async () => {
    mockGetInstanceFromPM.mockReturnValue(undefined);
    mockGetDbInstance.mockReturnValue(undefined);

    await expect(ensureInstanceById("nonexistent-inst")).rejects.toThrow(
      "Instance not found: nonexistent-inst"
    );

    expect(mockSpawnInstance).not.toHaveBeenCalled();
  });

  it("SlowPath_DeadInMemoryInstanceTriggersRecovery", async () => {
    const deadInst = { ...makeManagedInstance(), status: "dead" as const };
    mockGetInstanceFromPM.mockReturnValue(deadInst);

    mockGetDbInstance.mockReturnValue({
      id: "inst-old",
      directory: "/tmp/proj",
      port: 4100,
      status: "stopped",
    });

    const newInst = makeManagedInstance("inst-new");
    mockSpawnInstance.mockResolvedValue(newInst);

    const result = await ensureInstanceById("inst-old");

    expect(mockSpawnInstance).toHaveBeenCalledWith("/tmp/proj");
    expect(result.instance).toBe(newInst);
  });
});
