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

const {
  mockGetInstanceFromPM,
  mockSpawnInstance,
  mockGetDbSession,
  mockGetSessionByOpencodeId,
  mockGetDbInstance,
  mockUpdateSessionInstanceId,
  mockUpdateSessionStatus,
  mockFetch,
} = vi.hoisted(() => ({
  mockGetInstanceFromPM: vi.fn(),
  mockSpawnInstance: vi.fn(),
  mockGetDbSession: vi.fn(),
  mockGetSessionByOpencodeId: vi.fn(),
  mockGetDbInstance: vi.fn(),
  mockUpdateSessionInstanceId: vi.fn(),
  mockUpdateSessionStatus: vi.fn(),
  mockFetch: vi.fn(),
}));

vi.mock("@/lib/server/process-manager", () => ({
  getInstance: mockGetInstanceFromPM,
  spawnInstance: mockSpawnInstance,
}));

vi.mock("@/lib/server/db-repository", () => ({
  getSession: mockGetDbSession,
  getSessionByOpencodeId: mockGetSessionByOpencodeId,
  getInstance: mockGetDbInstance,
  updateSessionInstanceId: mockUpdateSessionInstanceId,
  updateSessionStatus: mockUpdateSessionStatus,
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
  respondToQuestion,
  rejectQuestion,
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

  it.each(["stopped", "completed", "disconnected", "error"] as const)(
    "SlowPath_TransitionsTerminalStatus_%s_ToIdle",
    async (terminalStatus) => {
      mockGetInstanceFromPM.mockReturnValue(undefined);

      const dbSess = makeDbSession({ instance_id: "inst-old", status: terminalStatus });
      mockGetDbSession.mockReturnValue(dbSess);

      const newInst = makeManagedInstance("inst-new");
      mockSpawnInstance.mockResolvedValue(newInst);

      await ensureInstanceForSession("inst-old", "db-sess-1");

      expect(mockUpdateSessionStatus).toHaveBeenCalledWith("db-sess-1", "idle");
    }
  );

  it("SlowPath_DoesNotTransitionActiveSessionToIdle", async () => {
    mockGetInstanceFromPM.mockReturnValue(undefined);

    const dbSess = makeDbSession({ instance_id: "inst-old", status: "active" });
    mockGetDbSession.mockReturnValue(dbSess);

    const newInst = makeManagedInstance("inst-new");
    mockSpawnInstance.mockResolvedValue(newInst);

    await ensureInstanceForSession("inst-old", "db-sess-1");

    expect(mockUpdateSessionStatus).not.toHaveBeenCalled();
  });

  it("SlowPath_DoesNotTransitionIdleSessionToIdle", async () => {
    mockGetInstanceFromPM.mockReturnValue(undefined);

    const dbSess = makeDbSession({ instance_id: "inst-old", status: "idle" });
    mockGetDbSession.mockReturnValue(dbSess);

    const newInst = makeManagedInstance("inst-new");
    mockSpawnInstance.mockResolvedValue(newInst);

    await ensureInstanceForSession("inst-old", "db-sess-1");

    expect(mockUpdateSessionStatus).not.toHaveBeenCalled();
  });

  it("SlowPath_StatusTransitionFailureIsNonFatal", async () => {
    mockGetInstanceFromPM.mockReturnValue(undefined);

    const dbSess = makeDbSession({ instance_id: "inst-old", status: "stopped" });
    mockGetDbSession.mockReturnValue(dbSess);

    const newInst = makeManagedInstance("inst-new");
    mockSpawnInstance.mockResolvedValue(newInst);

    // Status update fails
    mockUpdateSessionStatus.mockImplementation(() => {
      throw new Error("DB write error");
    });

    // Should NOT throw — status transition failure is non-fatal
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

// ─── respondToQuestion tests ──────────────────────────────────────────────────

describe("respondToQuestion", () => {
  const VALID_ID = "q_abc123";
  const VALID_ANSWERS = [["yes"], ["no", "maybe"]];

  function mockResponse(
    status: number,
    body: string = ""
  ): Response {
    return {
      ok: status >= 200 && status < 300,
      status,
      text: vi.fn().mockResolvedValue(body),
    } as unknown as Response;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetInstanceFromPM.mockReturnValue(makeManagedInstance("inst-live"));
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("ThrowsOnInvalidQuestionId", async () => {
    await expect(
      respondToQuestion("inst-live", "../traversal", VALID_ANSWERS)
    ).rejects.toThrow("Invalid question ID");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("ThrowsWhenInstanceNotFound", async () => {
    mockGetInstanceFromPM.mockReturnValue(undefined);
    await expect(
      respondToQuestion("missing-inst", VALID_ID, VALID_ANSWERS)
    ).rejects.toThrow("Instance not found: missing-inst");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("ReturnsOkTrueOn2xx", async () => {
    mockFetch.mockResolvedValue(mockResponse(200, '{"ok":true}'));
    const result = await respondToQuestion(
      "inst-live",
      VALID_ID,
      VALID_ANSWERS
    );
    expect(result).toEqual({
      ok: true,
      status: 200,
      alreadyAnswered: false,
      body: '{"ok":true}',
    });
    expect(mockFetch).toHaveBeenCalledWith(
      "http://127.0.0.1:4100/question/q_abc123/reply?directory=%2Ftmp%2Fproj",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("IncludesDirectoryQueryParamForWorkspaceRouting", async () => {
    // Regression test: without ?directory=, OpenCode routes to process.cwd()
    // instead of the workspace directory, causing QuestionNotFoundError.
    mockFetch.mockResolvedValue(mockResponse(200, '{"ok":true}'));
    await respondToQuestion("inst-live", VALID_ID, VALID_ANSWERS);
    const calledUrl: string = mockFetch.mock.calls[0][0];
    expect(calledUrl).toContain("?directory=");
    expect(calledUrl).toContain(encodeURIComponent("/tmp/proj"));
  });

  it("ReturnsAlreadyAnsweredTrueOn404", async () => {
    mockFetch.mockResolvedValue(mockResponse(404, "not found"));
    const result = await respondToQuestion(
      "inst-live",
      VALID_ID,
      VALID_ANSWERS
    );
    expect(result).toEqual({
      ok: false,
      status: 404,
      alreadyAnswered: true,
      body: "not found",
    });
  });

  it("ReturnsAlreadyAnsweredTrueOn409", async () => {
    mockFetch.mockResolvedValue(mockResponse(409, "conflict"));
    const result = await respondToQuestion(
      "inst-live",
      VALID_ID,
      VALID_ANSWERS
    );
    expect(result.alreadyAnswered).toBe(true);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(409);
  });

  it("ReturnsAlreadyAnsweredFalseOn500", async () => {
    mockFetch.mockResolvedValue(mockResponse(500, "server error"));
    const result = await respondToQuestion(
      "inst-live",
      VALID_ID,
      VALID_ANSWERS
    );
    expect(result).toEqual({
      ok: false,
      status: 500,
      alreadyAnswered: false,
      body: "server error",
    });
  });

  it("ReturnsStatus0WhenFetchThrows", async () => {
    mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));
    const result = await respondToQuestion(
      "inst-live",
      VALID_ID,
      VALID_ANSWERS
    );
    expect(result).toEqual({
      ok: false,
      status: 0,
      alreadyAnswered: false,
      body: null,
    });
  });

  it("ReturnsBodyNullWhenTextThrows", async () => {
    const res = mockResponse(200, "");
    (res.text as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("stream error")
    );
    mockFetch.mockResolvedValue(res);
    const result = await respondToQuestion(
      "inst-live",
      VALID_ID,
      VALID_ANSWERS
    );
    expect(result.body).toBeNull();
    expect(result.ok).toBe(true);
  });

  it("SendsAnswersInRequestBody", async () => {
    mockFetch.mockResolvedValue(mockResponse(200));
    await respondToQuestion("inst-live", VALID_ID, VALID_ANSWERS);
    const callArgs = mockFetch.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(callArgs.body as string)).toEqual({
      answers: VALID_ANSWERS,
    });
    expect(callArgs.headers).toEqual({
      "Content-Type": "application/json",
    });
  });
});

// ─── rejectQuestion tests ─────────────────────────────────────────────────────

describe("rejectQuestion", () => {
  const VALID_ID = "q_abc123";

  function mockResponse(
    status: number,
    body: string = ""
  ): Response {
    return {
      ok: status >= 200 && status < 300,
      status,
      text: vi.fn().mockResolvedValue(body),
    } as unknown as Response;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetInstanceFromPM.mockReturnValue(makeManagedInstance("inst-live"));
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("ThrowsOnInvalidQuestionId", async () => {
    await expect(
      rejectQuestion("inst-live", "bad/id")
    ).rejects.toThrow("Invalid question ID");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("ThrowsWhenInstanceNotFound", async () => {
    mockGetInstanceFromPM.mockReturnValue(undefined);
    await expect(rejectQuestion("missing-inst", VALID_ID)).rejects.toThrow(
      "Instance not found: missing-inst"
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("ReturnsOkTrueOn2xx", async () => {
    mockFetch.mockResolvedValue(mockResponse(200, ""));
    const result = await rejectQuestion("inst-live", VALID_ID);
    expect(result).toEqual({
      ok: true,
      status: 200,
      alreadyAnswered: false,
      body: "",
    });
    expect(mockFetch).toHaveBeenCalledWith(
      "http://127.0.0.1:4100/question/q_abc123/reject?directory=%2Ftmp%2Fproj",
      { method: "POST" }
    );
  });

  it("IncludesDirectoryQueryParamForWorkspaceRouting", async () => {
    // Regression test: without ?directory=, OpenCode routes to process.cwd()
    // instead of the workspace directory, causing QuestionNotFoundError.
    mockFetch.mockResolvedValue(mockResponse(200, ""));
    await rejectQuestion("inst-live", VALID_ID);
    const calledUrl: string = mockFetch.mock.calls[0][0];
    expect(calledUrl).toContain("?directory=");
    expect(calledUrl).toContain(encodeURIComponent("/tmp/proj"));
  });

  it("ReturnsAlreadyAnsweredTrueOn404", async () => {
    mockFetch.mockResolvedValue(mockResponse(404, "gone"));
    const result = await rejectQuestion("inst-live", VALID_ID);
    expect(result).toEqual({
      ok: false,
      status: 404,
      alreadyAnswered: true,
      body: "gone",
    });
  });

  it("ReturnsAlreadyAnsweredTrueOn409", async () => {
    mockFetch.mockResolvedValue(mockResponse(409, "conflict"));
    const result = await rejectQuestion("inst-live", VALID_ID);
    expect(result.alreadyAnswered).toBe(true);
    expect(result.ok).toBe(false);
  });

  it("ReturnsAlreadyAnsweredFalseOn500", async () => {
    mockFetch.mockResolvedValue(mockResponse(500, "err"));
    const result = await rejectQuestion("inst-live", VALID_ID);
    expect(result.alreadyAnswered).toBe(false);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(500);
  });

  it("ReturnsStatus0WhenFetchThrows", async () => {
    mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));
    const result = await rejectQuestion("inst-live", VALID_ID);
    expect(result).toEqual({
      ok: false,
      status: 0,
      alreadyAnswered: false,
      body: null,
    });
  });

  it("UsesPostMethodWithoutBody", async () => {
    mockFetch.mockResolvedValue(mockResponse(200));
    await rejectQuestion("inst-live", VALID_ID);
    const callArgs = mockFetch.mock.calls[0][1] as RequestInit;
    expect(callArgs.method).toBe("POST");
    expect(callArgs.body).toBeUndefined();
  });
});
