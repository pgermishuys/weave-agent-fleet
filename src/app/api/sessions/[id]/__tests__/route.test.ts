import { vi } from "vitest";
import { NextRequest } from "next/server";

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock("@/lib/server/process-manager", () => ({
  _recoveryComplete: Promise.resolve(),
  destroyInstance: vi.fn(),
}));

vi.mock("@/lib/server/workspace-manager", () => ({
  cleanupWorkspace: vi.fn(),
}));

vi.mock("@/lib/server/callback-monitor", () => ({
  stopMonitoring: vi.fn(),
}));

vi.mock("@/lib/server/db-repository", () => ({
  getSession: vi.fn(),
  getSessionByOpencodeId: vi.fn(),
  getWorkspace: vi.fn(),
  updateSessionStatus: vi.fn(),
  updateSessionTitle: vi.fn(),
  getSessionsForInstance: vi.fn(() => []),
  getAnySessionForInstance: vi.fn(),
  deleteSession: vi.fn(),
  deleteNotificationsForSession: vi.fn(),
  deleteCallbacksForSession: vi.fn(),
  getSessionsForWorkspace: vi.fn(() => []),
}));

vi.mock("@/lib/server/opencode-client", () => ({
  getClientForInstance: vi.fn(),
}));

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import { GET } from "@/app/api/sessions/[id]/route";
import * as dbRepository from "@/lib/server/db-repository";
import * as opencodeClient from "@/lib/server/opencode-client";

// ─── Typed mock helpers ───────────────────────────────────────────────────────

const mockGetSession = vi.mocked(dbRepository.getSession);
const mockGetSessionByOpencodeId = vi.mocked(dbRepository.getSessionByOpencodeId);
const mockGetWorkspace = vi.mocked(dbRepository.getWorkspace);
const mockGetSessionsForInstance = vi.mocked(dbRepository.getSessionsForInstance);
const mockGetAnySessionForInstance = vi.mocked(dbRepository.getAnySessionForInstance);
const mockGetClientForInstance = vi.mocked(opencodeClient.getClientForInstance);

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
    instance_id: "inst-abc",
    opencode_session_id: "oc-session-abc",
    title: "Test Session",
    directory: "/home/user/project",
    status: "active" as const,
    created_at: new Date("2024-01-01T00:00:00Z").toISOString(),
    stopped_at: null,
    parent_session_id: null,
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

function makeRouteContext(id: string) {
  return { params: Promise.resolve({ id }) };
}

function makeClient(sessionData: unknown, messagesData: unknown[] = []) {
  return {
    session: {
      get: vi.fn().mockResolvedValue({ data: sessionData }),
      messages: vi.fn().mockResolvedValue({ data: messagesData }),
      abort: vi.fn(),
    },
  };
}

// ─── GET /api/sessions/[id] ──────────────────────────────────────────────────

describe("GET /api/sessions/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("Returns400WhenInstanceIdIsMissing", async () => {
    const req = new NextRequest("http://localhost/api/sessions/abc");
    const res = await GET(req, makeRouteContext("abc"));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/instanceId/i);
  });

  it("Returns404WhenInstanceNotFound", async () => {
    mockGetClientForInstance.mockImplementation(() => {
      throw new Error("Instance not found");
    });

    const req = new NextRequest("http://localhost/api/sessions/abc?instanceId=inst-abc");
    const res = await GET(req, makeRouteContext("abc"));
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toMatch(/instance not found/i);
  });

  it("ReturnsSessionWithAncestorsFromDbSession", async () => {
    const sdkSession = makeSdkSession();
    const dbSession = makeDbSession();
    const dbWorkspace = makeDbWorkspace();
    const client = makeClient(sdkSession);

    mockGetClientForInstance.mockReturnValue(client as never);
    mockGetSession.mockReturnValue(undefined as never);
    mockGetSessionByOpencodeId.mockReturnValue(dbSession as never);
    mockGetWorkspace.mockReturnValue(dbWorkspace as never);

    const req = new NextRequest("http://localhost/api/sessions/oc-session-abc?instanceId=inst-abc");
    const res = await GET(req, makeRouteContext("oc-session-abc"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.session).toBeDefined();
    expect(body.workspaceId).toBe("ws-123");
    expect(body.workspaceDirectory).toBe("/home/user/project");
  });

  // ─── parentSessionId query param tests ────────────────────────────────────

  it("UsesParentSessionIdHintWhenPresent", async () => {
    const sdkSession = makeSdkSession({ id: "child-session" });
    const parentDbSession = makeDbSession({
      id: "db-parent-1",
      opencode_session_id: "parent-oc-id",
      title: "Parent Session",
      instance_id: "inst-abc",
      workspace_id: "ws-123",
    });
    const dbWorkspace = makeDbWorkspace();
    const client = makeClient(sdkSession);

    mockGetClientForInstance.mockReturnValue(client as never);
    // Child session is not in DB
    mockGetSession.mockReturnValue(undefined as never);
    mockGetSessionByOpencodeId.mockImplementation((id: string) => {
      if (id === "child-session") return undefined as never;
      if (id === "parent-oc-id") return parentDbSession as never;
      return undefined as never;
    });
    mockGetWorkspace.mockReturnValue(dbWorkspace as never);

    const req = new NextRequest(
      "http://localhost/api/sessions/child-session?instanceId=inst-abc&parentSessionId=parent-oc-id"
    );
    const res = await GET(req, makeRouteContext("child-session"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ancestors).toHaveLength(1);
    expect(body.ancestors[0].opencodeSessionId).toBe("parent-oc-id");
    expect(body.ancestors[0].title).toBe("Parent Session");
    // Should NOT have called getAnySessionForInstance since parentSessionId resolved
    expect(mockGetAnySessionForInstance).not.toHaveBeenCalled();
  });

  it("FallsBackToGetAnySessionForInstanceWhenParentSessionIdIsInvalid", async () => {
    const sdkSession = makeSdkSession({ id: "child-session" });
    const fallbackSession = makeDbSession({
      id: "db-fallback-1",
      opencode_session_id: "fallback-oc-id",
      title: "Fallback Parent",
      instance_id: "inst-abc",
    });
    const dbWorkspace = makeDbWorkspace();
    const client = makeClient(sdkSession);

    mockGetClientForInstance.mockReturnValue(client as never);
    mockGetSession.mockReturnValue(undefined as never);
    // Both child and invalid parent return undefined
    mockGetSessionByOpencodeId.mockReturnValue(undefined as never);
    mockGetAnySessionForInstance.mockReturnValue(fallbackSession as never);
    mockGetWorkspace.mockReturnValue(dbWorkspace as never);

    const req = new NextRequest(
      "http://localhost/api/sessions/child-session?instanceId=inst-abc&parentSessionId=invalid-parent"
    );
    const res = await GET(req, makeRouteContext("child-session"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ancestors).toHaveLength(1);
    expect(body.ancestors[0].opencodeSessionId).toBe("fallback-oc-id");
    expect(mockGetAnySessionForInstance).toHaveBeenCalledWith("inst-abc");
  });

  it("FallsBackToGetAnySessionForInstanceWhenNoParentSessionIdProvided", async () => {
    const sdkSession = makeSdkSession({ id: "child-session" });
    const fallbackSession = makeDbSession({
      id: "db-fallback-1",
      opencode_session_id: "fallback-oc-id",
      title: "Fallback Parent",
      instance_id: "inst-abc",
    });
    const dbWorkspace = makeDbWorkspace();
    const client = makeClient(sdkSession);

    mockGetClientForInstance.mockReturnValue(client as never);
    mockGetSession.mockReturnValue(undefined as never);
    mockGetSessionByOpencodeId.mockReturnValue(undefined as never);
    mockGetAnySessionForInstance.mockReturnValue(fallbackSession as never);
    mockGetWorkspace.mockReturnValue(dbWorkspace as never);

    const req = new NextRequest(
      "http://localhost/api/sessions/child-session?instanceId=inst-abc"
    );
    const res = await GET(req, makeRouteContext("child-session"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ancestors).toHaveLength(1);
    expect(body.ancestors[0].opencodeSessionId).toBe("fallback-oc-id");
    expect(mockGetAnySessionForInstance).toHaveBeenCalledWith("inst-abc");
  });

  it("ReturnsNoAncestorsWhenFallbackReturnsSelf", async () => {
    const sdkSession = makeSdkSession({ id: "child-session" });
    // The fallback returns a session whose opencode_session_id matches the current session
    const selfSession = makeDbSession({
      id: "db-self-1",
      opencode_session_id: "child-session",
      title: "Self",
      instance_id: "inst-abc",
    });
    const client = makeClient(sdkSession);

    mockGetClientForInstance.mockReturnValue(client as never);
    mockGetSession.mockReturnValue(undefined as never);
    mockGetSessionByOpencodeId.mockReturnValue(undefined as never);
    mockGetAnySessionForInstance.mockReturnValue(selfSession as never);

    const req = new NextRequest(
      "http://localhost/api/sessions/child-session?instanceId=inst-abc"
    );
    const res = await GET(req, makeRouteContext("child-session"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ancestors).toHaveLength(0);
  });

  it("ReturnsNoAncestorsWhenNoSessionsExistOnInstance", async () => {
    const sdkSession = makeSdkSession({ id: "child-session" });
    const client = makeClient(sdkSession);

    mockGetClientForInstance.mockReturnValue(client as never);
    mockGetSession.mockReturnValue(undefined as never);
    mockGetSessionByOpencodeId.mockReturnValue(undefined as never);
    mockGetAnySessionForInstance.mockReturnValue(undefined as never);

    const req = new NextRequest(
      "http://localhost/api/sessions/child-session?instanceId=inst-abc"
    );
    const res = await GET(req, makeRouteContext("child-session"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ancestors).toHaveLength(0);
  });

  it("IncludesTerminalParentInAncestorsViaFallback", async () => {
    const sdkSession = makeSdkSession({ id: "child-session" });
    const stoppedParent = makeDbSession({
      id: "db-stopped-parent",
      opencode_session_id: "stopped-parent-oc",
      title: "Stopped Parent",
      instance_id: "inst-abc",
      status: "stopped" as const,
      stopped_at: new Date().toISOString(),
    });
    const dbWorkspace = makeDbWorkspace();
    const client = makeClient(sdkSession);

    mockGetClientForInstance.mockReturnValue(client as never);
    mockGetSession.mockReturnValue(undefined as never);
    mockGetSessionByOpencodeId.mockReturnValue(undefined as never);
    // getSessionsForInstance would NOT return stopped sessions — that's the bug we're fixing
    mockGetSessionsForInstance.mockReturnValue([]);
    // But getAnySessionForInstance includes all statuses
    mockGetAnySessionForInstance.mockReturnValue(stoppedParent as never);
    mockGetWorkspace.mockReturnValue(dbWorkspace as never);

    const req = new NextRequest(
      "http://localhost/api/sessions/child-session?instanceId=inst-abc"
    );
    const res = await GET(req, makeRouteContext("child-session"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ancestors).toHaveLength(1);
    expect(body.ancestors[0].title).toBe("Stopped Parent");
    expect(body.workspaceDirectory).toBe("/home/user/project");
  });

  it("PopulatesWorkspaceMetadataFromParentViaHint", async () => {
    const sdkSession = makeSdkSession({ id: "child-session" });
    const parentDbSession = makeDbSession({
      id: "db-parent-ws",
      opencode_session_id: "parent-ws-oc",
      title: "Parent With Workspace",
      instance_id: "inst-abc",
      workspace_id: "ws-456",
    });
    const dbWorkspace = makeDbWorkspace({
      id: "ws-456",
      directory: "/custom/workspace",
      isolation_strategy: "worktree",
      branch: "feature/test",
    });
    const client = makeClient(sdkSession);

    mockGetClientForInstance.mockReturnValue(client as never);
    mockGetSession.mockReturnValue(undefined as never);
    mockGetSessionByOpencodeId.mockImplementation((id: string) => {
      if (id === "child-session") return undefined as never;
      if (id === "parent-ws-oc") return parentDbSession as never;
      return undefined as never;
    });
    mockGetWorkspace.mockReturnValue(dbWorkspace as never);

    const req = new NextRequest(
      "http://localhost/api/sessions/child-session?instanceId=inst-abc&parentSessionId=parent-ws-oc"
    );
    const res = await GET(req, makeRouteContext("child-session"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.workspaceId).toBe("ws-456");
    expect(body.workspaceDirectory).toBe("/custom/workspace");
    expect(body.isolationStrategy).toBe("worktree");
    expect(body.branch).toBe("feature/test");
  });
});
