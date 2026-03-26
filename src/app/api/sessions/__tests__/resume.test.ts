import { vi } from "vitest";
import { NextRequest } from "next/server";

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock("@/lib/server/process-manager", () => ({
  spawnInstance: vi.fn(),
  validateDirectory: vi.fn((dir: string) => dir),
  _recoveryComplete: Promise.resolve(),
}));

vi.mock("@/lib/server/db-repository", () => ({
  getSession: vi.fn(),
  getSessionByOpencodeId: vi.fn(),
  getWorkspace: vi.fn(),
  updateSessionForResume: vi.fn(),
}));

vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  const mocked = {
    ...actual,
    existsSync: vi.fn(() => true),
  };
  return { ...mocked, default: mocked };
});

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import { POST } from "@/app/api/sessions/[id]/resume/route";
import * as processManager from "@/lib/server/process-manager";
import * as dbRepository from "@/lib/server/db-repository";
import * as fs from "fs";

// ─── Typed mock helpers ───────────────────────────────────────────────────────

const mockSpawnInstance = vi.mocked(processManager.spawnInstance);
const mockValidateDirectory = vi.mocked(processManager.validateDirectory);
const mockGetSession = vi.mocked(dbRepository.getSession);
const mockGetSessionByOpencodeId = vi.mocked(dbRepository.getSessionByOpencodeId);
const mockGetWorkspace = vi.mocked(dbRepository.getWorkspace);
const mockUpdateSessionForResume = vi.mocked(dbRepository.updateSessionForResume);
const mockExistsSync = vi.mocked(fs.existsSync);

// ─── Shared fixtures ──────────────────────────────────────────────────────────

function makeSdkSession(overrides: Record<string, unknown> = {}) {
  return {
    id: "oc-session-abc",
    title: "Test Session",
    directory: "/home/user/project",
    projectID: "proj-1",
    version: "1",
    time: { created: 1700000000, updated: 1700000001 },
    ...overrides,
  };
}

function makeDbSession(overrides: Record<string, unknown> = {}) {
  return {
    id: "db-sess-1",
    workspace_id: "ws-123",
    instance_id: "inst-old",
    opencode_session_id: "oc-session-abc",
    title: "Test Session",
    directory: "/home/user/project",
    status: "disconnected" as const,
    created_at: new Date("2024-01-01T00:00:00Z").toISOString(),
    stopped_at: new Date("2024-01-02T00:00:00Z").toISOString(),
    ...overrides,
  };
}

function makeDbWorkspace(overrides: Record<string, unknown> = {}) {
  return {
    id: "ws-123",
    directory: "/home/user/project",
    isolation_strategy: "existing",
    source_directory: "/home/user/project",
    branch: null,
    display_name: null,
    cleaned_up_at: null,
    created_at: new Date("2024-01-01T00:00:00Z").toISOString(),
    ...overrides,
  };
}

function makeManagedInstance(overrides: Record<string, unknown> = {}) {
  return {
    id: "inst-new",
    port: 4097,
    url: "http://localhost:4097",
    directory: "/home/user/project",
    status: "running" as const,
    createdAt: new Date(),
    recovered: false,
    close: vi.fn(),
    client: {
      session: {
        get: vi.fn(),
      },
    },
    ...overrides,
  };
}

function makeRequest(sessionId: string) {
  return new NextRequest(`http://localhost/api/sessions/${sessionId}/resume`, {
    method: "POST",
  });
}

function makeContext(sessionId: string) {
  return { params: Promise.resolve({ id: sessionId }) };
}

// ─── POST /api/sessions/[id]/resume ──────────────────────────────────────────

describe("POST /api/sessions/[id]/resume", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockValidateDirectory.mockImplementation((dir: string) => dir);
    mockExistsSync.mockReturnValue(true);
    mockGetSessionByOpencodeId.mockReturnValue(undefined as never);
  });

  it("Returns404WhenSessionNotFoundInDb", async () => {
    mockGetSession.mockReturnValue(undefined as never);
    mockGetSessionByOpencodeId.mockReturnValue(undefined as never);

    const res = await POST(makeRequest("unknown-session"), makeContext("unknown-session"));
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toMatch(/session not found/i);
  });

  it("Returns409WhenSessionIsAlreadyActive", async () => {
    mockGetSession.mockReturnValue(makeDbSession({ status: "active" }) as never);

    const res = await POST(makeRequest("db-sess-1"), makeContext("db-sess-1"));
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toMatch(/already active/i);
  });

  it("Returns409WhenSessionIsIdle", async () => {
    mockGetSession.mockReturnValue(makeDbSession({ status: "idle" }) as never);

    const res = await POST(makeRequest("db-sess-1"), makeContext("db-sess-1"));
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toMatch(/already active/i);
  });

  it("Returns200ForDisconnectedSessionWithValidDirectory", async () => {
    const dbSession = makeDbSession({ status: "disconnected" });
    const workspace = makeDbWorkspace();
    const sdkSession = makeSdkSession();
    const instance = makeManagedInstance();
    instance.client.session.get = vi.fn().mockResolvedValue({ data: sdkSession });

    mockGetSession.mockReturnValue(dbSession as never);
    mockGetWorkspace.mockReturnValue(workspace as never);
    mockSpawnInstance.mockResolvedValue(instance as never);

    const res = await POST(makeRequest("db-sess-1"), makeContext("db-sess-1"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.instanceId).toBe("inst-new");
    expect(body.session.id).toBe("oc-session-abc");
  });

  it("Returns200ForStoppedSessionWithValidDirectory", async () => {
    const dbSession = makeDbSession({ status: "stopped" });
    const workspace = makeDbWorkspace();
    const sdkSession = makeSdkSession();
    const instance = makeManagedInstance();
    instance.client.session.get = vi.fn().mockResolvedValue({ data: sdkSession });

    mockGetSession.mockReturnValue(dbSession as never);
    mockGetWorkspace.mockReturnValue(workspace as never);
    mockSpawnInstance.mockResolvedValue(instance as never);

    const res = await POST(makeRequest("db-sess-1"), makeContext("db-sess-1"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.instanceId).toBe("inst-new");
  });

  it("Returns200ForCompletedSessionWithValidDirectory", async () => {
    const dbSession = makeDbSession({ status: "completed" });
    const workspace = makeDbWorkspace();
    const sdkSession = makeSdkSession();
    const instance = makeManagedInstance();
    instance.client.session.get = vi.fn().mockResolvedValue({ data: sdkSession });

    mockGetSession.mockReturnValue(dbSession as never);
    mockGetWorkspace.mockReturnValue(workspace as never);
    mockSpawnInstance.mockResolvedValue(instance as never);

    const res = await POST(makeRequest("db-sess-1"), makeContext("db-sess-1"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.instanceId).toBe("inst-new");
  });

  it("Returns400WhenWorkspaceNotFoundInDb", async () => {
    mockGetSession.mockReturnValue(makeDbSession() as never);
    mockGetWorkspace.mockReturnValue(undefined as never);

    const res = await POST(makeRequest("db-sess-1"), makeContext("db-sess-1"));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/workspace not found/i);
  });

  it("Returns400WhenWorkspaceDirectoryNoLongerExists", async () => {
    mockGetSession.mockReturnValue(makeDbSession() as never);
    mockGetWorkspace.mockReturnValue(makeDbWorkspace() as never);
    mockExistsSync.mockReturnValue(false);

    const res = await POST(makeRequest("db-sess-1"), makeContext("db-sess-1"));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/no longer exists/i);
  });

  it("Returns400WhenValidateDirectoryThrows", async () => {
    mockGetSession.mockReturnValue(makeDbSession() as never);
    mockGetWorkspace.mockReturnValue(makeDbWorkspace() as never);
    mockExistsSync.mockReturnValue(true);
    mockValidateDirectory.mockImplementation(() => {
      throw new Error("Directory is outside the allowed workspace roots");
    });

    const res = await POST(makeRequest("db-sess-1"), makeContext("db-sess-1"));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe("Directory is outside the allowed workspace roots");
  });

  it("Returns404WhenOpencodeSessionNotFoundInInstance", async () => {
    const instance = makeManagedInstance();
    instance.client.session.get = vi.fn().mockResolvedValue({ data: null });

    mockGetSession.mockReturnValue(makeDbSession() as never);
    mockGetWorkspace.mockReturnValue(makeDbWorkspace() as never);
    mockSpawnInstance.mockResolvedValue(instance as never);

    const res = await POST(makeRequest("db-sess-1"), makeContext("db-sess-1"));
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toMatch(/no longer exists in opencode/i);
  });

  it("Returns404WhenOpencodeSessionGetThrows", async () => {
    const instance = makeManagedInstance();
    instance.client.session.get = vi.fn().mockRejectedValue(new Error("session not found"));

    mockGetSession.mockReturnValue(makeDbSession() as never);
    mockGetWorkspace.mockReturnValue(makeDbWorkspace() as never);
    mockSpawnInstance.mockResolvedValue(instance as never);

    const res = await POST(makeRequest("db-sess-1"), makeContext("db-sess-1"));
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toMatch(/no longer exists in opencode/i);
  });

  it("Returns500WhenSpawnInstanceThrows", async () => {
    mockGetSession.mockReturnValue(makeDbSession() as never);
    mockGetWorkspace.mockReturnValue(makeDbWorkspace() as never);
    mockSpawnInstance.mockRejectedValue(new Error("spawn failed"));

    const res = await POST(makeRequest("db-sess-1"), makeContext("db-sess-1"));
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toMatch(/failed to start opencode instance/i);
  });

  it("UpdatesSessionInstanceIdInDbOnSuccess", async () => {
    const dbSession = makeDbSession({ status: "disconnected" });
    const sdkSession = makeSdkSession();
    const instance = makeManagedInstance();
    instance.client.session.get = vi.fn().mockResolvedValue({ data: sdkSession });

    mockGetSession.mockReturnValue(dbSession as never);
    mockGetWorkspace.mockReturnValue(makeDbWorkspace() as never);
    mockSpawnInstance.mockResolvedValue(instance as never);

    await POST(makeRequest("db-sess-1"), makeContext("db-sess-1"));

    expect(mockUpdateSessionForResume).toHaveBeenCalledWith("db-sess-1", "inst-new");
  });

  it("ReturnsCorrectInstanceIdAndSessionDataInResponse", async () => {
    const sdkSession = makeSdkSession({ id: "oc-session-xyz", title: "My Resumed Session" });
    const instance = makeManagedInstance({ id: "inst-fresh" });
    (instance.client.session.get as ReturnType<typeof vi.fn>).mockResolvedValue({ data: sdkSession });

    mockGetSession.mockReturnValue(makeDbSession({ status: "stopped" }) as never);
    mockGetWorkspace.mockReturnValue(makeDbWorkspace() as never);
    mockSpawnInstance.mockResolvedValue(instance as never);

    const res = await POST(makeRequest("db-sess-1"), makeContext("db-sess-1"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.instanceId).toBe("inst-fresh");
    expect(body.session.id).toBe("oc-session-xyz");
    expect(body.session.title).toBe("My Resumed Session");
  });

  it("FallsBackToOpencodeSessionIdLookupWhenFleetIdNotFound", async () => {
    const dbSession = makeDbSession({ opencode_session_id: "oc-session-abc" });
    const sdkSession = makeSdkSession();
    const instance = makeManagedInstance();
    instance.client.session.get = vi.fn().mockResolvedValue({ data: sdkSession });

    mockGetSession.mockReturnValue(undefined as never);
    mockGetSessionByOpencodeId.mockReturnValue(dbSession as never);
    mockGetWorkspace.mockReturnValue(makeDbWorkspace() as never);
    mockSpawnInstance.mockResolvedValue(instance as never);

    const res = await POST(makeRequest("oc-session-abc"), makeContext("oc-session-abc"));

    expect(res.status).toBe(200);
    expect(mockGetSessionByOpencodeId).toHaveBeenCalledWith("oc-session-abc");
  });

  it("Returns200EvenWhenDbUpdateForResumeFails", async () => {
    const sdkSession = makeSdkSession();
    const instance = makeManagedInstance();
    instance.client.session.get = vi.fn().mockResolvedValue({ data: sdkSession });

    mockGetSession.mockReturnValue(makeDbSession({ status: "disconnected" }) as never);
    mockGetWorkspace.mockReturnValue(makeDbWorkspace() as never);
    mockSpawnInstance.mockResolvedValue(instance as never);
    mockUpdateSessionForResume.mockImplementation(() => {
      throw new Error("DB write failed");
    });

    const res = await POST(makeRequest("db-sess-1"), makeContext("db-sess-1"));
    const body = await res.json();

    // DB update failure is non-fatal — session is functional
    expect(res.status).toBe(200);
    expect(body.instanceId).toBe("inst-new");
  });
});
