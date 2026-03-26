import { vi } from "vitest";
import { NextRequest } from "next/server";

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock("@/lib/server/process-manager", () => ({
  spawnInstance: vi.fn(),
  _recoveryComplete: Promise.resolve(),
}));

vi.mock("@/lib/server/workspace-manager", () => ({
  createWorkspace: vi.fn(),
}));

vi.mock("@/lib/server/db-repository", () => ({
  getSession: vi.fn(),
  getSessionByOpencodeId: vi.fn(),
  getWorkspace: vi.fn(),
  insertSession: vi.fn(),
}));

vi.mock("@/lib/server/logger", () => ({
  log: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock("crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("crypto")>();
  const mocked = {
    ...actual,
    randomUUID: vi.fn(() => "new-db-session-uuid"),
  };
  return { ...mocked, default: mocked };
});

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import { POST } from "@/app/api/sessions/[id]/fork/route";
import * as processManager from "@/lib/server/process-manager";
import * as workspaceManager from "@/lib/server/workspace-manager";
import * as dbRepository from "@/lib/server/db-repository";

// ─── Typed mock helpers ───────────────────────────────────────────────────────

const mockSpawnInstance = vi.mocked(processManager.spawnInstance);
const mockCreateWorkspace = vi.mocked(workspaceManager.createWorkspace);
const mockGetSession = vi.mocked(dbRepository.getSession);
const mockGetSessionByOpencodeId = vi.mocked(dbRepository.getSessionByOpencodeId);
const mockGetWorkspace = vi.mocked(dbRepository.getWorkspace);
const mockInsertSession = vi.mocked(dbRepository.insertSession);

// ─── Shared fixtures ──────────────────────────────────────────────────────────

function makeDbSession(overrides: Record<string, unknown> = {}) {
  return {
    id: "db-sess-1",
    workspace_id: "ws-123",
    instance_id: "inst-old",
    opencode_session_id: "oc-session-abc",
    title: "Source Session",
    directory: "/home/user/project",
    status: "idle" as const,
    parent_session_id: null,
    created_at: new Date("2024-01-01T00:00:00Z").toISOString(),
    stopped_at: null,
    ...overrides,
  };
}

function makeDbWorkspace(overrides: Record<string, unknown> = {}) {
  return {
    id: "ws-123",
    directory: "/home/user/project",
    source_directory: null,
    isolation_strategy: "existing",
    branch: null,
    display_name: null,
    cleaned_up_at: null,
    created_at: new Date("2024-01-01T00:00:00Z").toISOString(),
    ...overrides,
  };
}

function makeSdkSession(overrides: Record<string, unknown> = {}) {
  return {
    id: "oc-new-session",
    title: "New Session",
    directory: "/home/user/project",
    projectID: "proj-1",
    version: "1",
    time: { created: 1700000000, updated: 1700000001 },
    ...overrides,
  };
}

function makeNewWorkspace(overrides: Record<string, unknown> = {}) {
  return {
    id: "ws-new",
    directory: "/home/user/project",
    source_directory: null,
    isolation_strategy: "existing",
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
        create: vi.fn().mockResolvedValue({ data: makeSdkSession() }),
      },
    },
    ...overrides,
  };
}

function makeRequest(sessionId: string, body?: Record<string, unknown>) {
  return new NextRequest(`http://localhost/api/sessions/${sessionId}/fork`, {
    method: "POST",
    ...(body !== undefined
      ? {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
  });
}

function makeContext(sessionId: string) {
  return { params: Promise.resolve({ id: sessionId }) };
}

// ─── POST /api/sessions/[id]/fork ─────────────────────────────────────────────

describe("POST /api/sessions/[id]/fork", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSessionByOpencodeId.mockReturnValue(undefined as never);
  });

  it("Returns404WhenSourceSessionNotFoundInDb", async () => {
    mockGetSession.mockReturnValue(undefined as never);
    mockGetSessionByOpencodeId.mockReturnValue(undefined as never);

    const res = await POST(makeRequest("unknown-session"), makeContext("unknown-session"));
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toMatch(/source session not found/i);
  });

  it("Returns404WhenSourceSessionWorkspaceNotFoundInDb", async () => {
    mockGetSession.mockReturnValue(makeDbSession() as never);
    mockGetWorkspace.mockReturnValue(undefined as never);

    const res = await POST(makeRequest("db-sess-1"), makeContext("db-sess-1"));
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toMatch(/workspace not found/i);
  });

  it("Returns200WithNewSessionDataOnSuccess", async () => {
    const instance = makeManagedInstance();
    mockGetSession.mockReturnValue(makeDbSession() as never);
    mockGetWorkspace.mockReturnValue(makeDbWorkspace() as never);
    mockCreateWorkspace.mockResolvedValue(makeNewWorkspace() as never);
    mockSpawnInstance.mockResolvedValue(instance as never);

    const res = await POST(makeRequest("db-sess-1"), makeContext("db-sess-1"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.instanceId).toBe("inst-new");
    expect(body.workspaceId).toBe("ws-new");
    expect(body.session.id).toBe("oc-new-session");
    expect(body.forkedFromSessionId).toBe("db-sess-1");
  });

  it("UsesSourceDirectoryFromWorkspaceForWorktreeStrategy", async () => {
    const workspaceWithSource = makeDbWorkspace({
      source_directory: "/home/user/original-repo",
      isolation_strategy: "worktree",
    });
    const instance = makeManagedInstance();
    mockGetSession.mockReturnValue(makeDbSession() as never);
    mockGetWorkspace.mockReturnValue(workspaceWithSource as never);
    mockCreateWorkspace.mockResolvedValue(makeNewWorkspace() as never);
    mockSpawnInstance.mockResolvedValue(instance as never);

    await POST(makeRequest("db-sess-1"), makeContext("db-sess-1"));

    expect(mockCreateWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({ sourceDirectory: "/home/user/original-repo" })
    );
  });

  it("FallsBackToWorkspaceDirectoryWhenSourceDirectoryIsNull", async () => {
    const workspaceNoSource = makeDbWorkspace({ source_directory: null });
    const instance = makeManagedInstance();
    mockGetSession.mockReturnValue(makeDbSession() as never);
    mockGetWorkspace.mockReturnValue(workspaceNoSource as never);
    mockCreateWorkspace.mockResolvedValue(makeNewWorkspace() as never);
    mockSpawnInstance.mockResolvedValue(instance as never);

    await POST(makeRequest("db-sess-1"), makeContext("db-sess-1"));

    expect(mockCreateWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({ sourceDirectory: "/home/user/project" })
    );
  });

  it("AlwaysUsesExistingIsolationStrategyForFork", async () => {
    const instance = makeManagedInstance();
    mockGetSession.mockReturnValue(makeDbSession() as never);
    mockGetWorkspace.mockReturnValue(makeDbWorkspace() as never);
    mockCreateWorkspace.mockResolvedValue(makeNewWorkspace() as never);
    mockSpawnInstance.mockResolvedValue(instance as never);

    await POST(makeRequest("db-sess-1"), makeContext("db-sess-1"));

    expect(mockCreateWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({ strategy: "existing" })
    );
  });

  it("SetsParentSessionIdToNullForForkedSessions", async () => {
    const dbSession = makeDbSession({ id: "db-sess-1" });
    const instance = makeManagedInstance();
    mockGetSession.mockReturnValue(dbSession as never);
    mockGetWorkspace.mockReturnValue(makeDbWorkspace() as never);
    mockCreateWorkspace.mockResolvedValue(makeNewWorkspace() as never);
    mockSpawnInstance.mockResolvedValue(instance as never);

    await POST(makeRequest("db-sess-1"), makeContext("db-sess-1"));

    expect(mockInsertSession).toHaveBeenCalledWith(
      expect.objectContaining({ parent_session_id: null })
    );
  });

  it("UsesTitleFromRequestBodyWhenProvided", async () => {
    const sdkSession = makeSdkSession({ title: "My Forked Session" });
    const instance = makeManagedInstance();
    (instance.client.session.create as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: sdkSession,
    });

    mockGetSession.mockReturnValue(makeDbSession() as never);
    mockGetWorkspace.mockReturnValue(makeDbWorkspace() as never);
    mockCreateWorkspace.mockResolvedValue(makeNewWorkspace() as never);
    mockSpawnInstance.mockResolvedValue(instance as never);

    const res = await POST(
      makeRequest("db-sess-1", { title: "My Forked Session" }),
      makeContext("db-sess-1")
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(instance.client.session.create).toHaveBeenCalledWith(
      expect.objectContaining({ title: "My Forked Session" })
    );
    expect(body.session.title).toBe("My Forked Session");
  });

  it("DefaultsToNewSessionTitleWhenBodyTitleIsOmitted", async () => {
    const instance = makeManagedInstance();
    mockGetSession.mockReturnValue(makeDbSession() as never);
    mockGetWorkspace.mockReturnValue(makeDbWorkspace() as never);
    mockCreateWorkspace.mockResolvedValue(makeNewWorkspace() as never);
    mockSpawnInstance.mockResolvedValue(instance as never);

    await POST(makeRequest("db-sess-1"), makeContext("db-sess-1"));

    expect(instance.client.session.create).toHaveBeenCalledWith(
      expect.objectContaining({ title: "New Session" })
    );
  });

  it("Returns400WhenRequestBodyIsInvalidJson", async () => {
    mockGetSession.mockReturnValue(makeDbSession() as never);
    mockGetWorkspace.mockReturnValue(makeDbWorkspace() as never);

    const req = new NextRequest("http://localhost/api/sessions/db-sess-1/fork", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{ invalid json }",
    });

    const res = await POST(req, makeContext("db-sess-1"));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/invalid json/i);
  });

  it("Returns500WhenSdkSessionCreateReturnsNoData", async () => {
    const instance = makeManagedInstance();
    (instance.client.session.create as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: null,
    });

    mockGetSession.mockReturnValue(makeDbSession() as never);
    mockGetWorkspace.mockReturnValue(makeDbWorkspace() as never);
    mockCreateWorkspace.mockResolvedValue(makeNewWorkspace() as never);
    mockSpawnInstance.mockResolvedValue(instance as never);

    const res = await POST(makeRequest("db-sess-1"), makeContext("db-sess-1"));
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toMatch(/failed to create session/i);
  });

  it("Returns500WhenSpawnInstanceThrows", async () => {
    mockGetSession.mockReturnValue(makeDbSession() as never);
    mockGetWorkspace.mockReturnValue(makeDbWorkspace() as never);
    mockCreateWorkspace.mockResolvedValue(makeNewWorkspace() as never);
    mockSpawnInstance.mockRejectedValue(new Error("spawn failed"));

    const res = await POST(makeRequest("db-sess-1"), makeContext("db-sess-1"));
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toMatch(/failed to fork session/i);
  });

  it("Returns200EvenWhenDbInsertSessionFails", async () => {
    const instance = makeManagedInstance();
    mockGetSession.mockReturnValue(makeDbSession() as never);
    mockGetWorkspace.mockReturnValue(makeDbWorkspace() as never);
    mockCreateWorkspace.mockResolvedValue(makeNewWorkspace() as never);
    mockSpawnInstance.mockResolvedValue(instance as never);
    mockInsertSession.mockImplementation(() => {
      throw new Error("DB write failed");
    });

    const res = await POST(makeRequest("db-sess-1"), makeContext("db-sess-1"));
    const body = await res.json();

    // insertSession failure is non-fatal — session still runs in-memory
    expect(res.status).toBe(200);
    expect(body.instanceId).toBe("inst-new");
  });

  it("FallsBackToOpencodeSessionIdLookupWhenFleetIdNotFound", async () => {
    const dbSession = makeDbSession({ opencode_session_id: "oc-session-abc" });
    const instance = makeManagedInstance();

    mockGetSession.mockReturnValue(undefined as never);
    mockGetSessionByOpencodeId.mockReturnValue(dbSession as never);
    mockGetWorkspace.mockReturnValue(makeDbWorkspace() as never);
    mockCreateWorkspace.mockResolvedValue(makeNewWorkspace() as never);
    mockSpawnInstance.mockResolvedValue(instance as never);

    const res = await POST(
      makeRequest("oc-session-abc"),
      makeContext("oc-session-abc")
    );

    expect(res.status).toBe(200);
    expect(mockGetSessionByOpencodeId).toHaveBeenCalledWith("oc-session-abc");
  });
});
