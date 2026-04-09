import { vi } from "vitest";
import { NextRequest } from "next/server";

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock("@/lib/server/process-manager", () => ({
  _recoveryComplete: Promise.resolve(),
}));

vi.mock("@/lib/server/opencode-client", () => ({
  ensureInstanceForSession: vi.fn(),
}));

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import { GET } from "@/app/api/sessions/[id]/status/route";
import * as opencodeClient from "@/lib/server/opencode-client";

const mockEnsureInstanceForSession = vi.mocked(opencodeClient.ensureInstanceForSession);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRequest(sessionId: string, instanceId?: string): NextRequest {
  const params = instanceId ? `?instanceId=${encodeURIComponent(instanceId)}` : "";
  return new NextRequest(
    `http://localhost/api/sessions/${encodeURIComponent(sessionId)}/status${params}`,
    { method: "GET" }
  );
}

function makeContext(sessionId: string) {
  return { params: Promise.resolve({ id: sessionId }) };
}

function makeInstanceAndClient(statusData: Record<string, { type: string }> | null = null) {
  const mockClient = {
    session: {
      status: vi.fn().mockResolvedValue({ data: statusData }),
    },
  };
  const instance = {
    id: "inst-abc",
    directory: "/home/user/project",
    status: "running" as const,
    client: mockClient,
  };
  return { instance, client: mockClient };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("GET /api/sessions/[id]/status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("Returns400WhenInstanceIdQueryParamIsMissing", async () => {
    const req = makeRequest("sess-1");
    const ctx = makeContext("sess-1");

    const res = await GET(req, ctx);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/instanceId/i);
  });

  it("Returns404WhenInstanceIsNotFound", async () => {
    mockEnsureInstanceForSession.mockRejectedValue(new Error("Instance not found: inst-missing"));

    const req = makeRequest("sess-1", "inst-missing");
    const ctx = makeContext("sess-1");

    const res = await GET(req, ctx);
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toMatch(/not found/i);
  });

  it("ReturnsBusyWhenSdkStatusMapContainsSessionWithTypeBusy", async () => {
    const { instance, client } = makeInstanceAndClient({ "sess-1": { type: "busy" } });
    mockEnsureInstanceForSession.mockResolvedValue({ instance, client } as never);

    const req = makeRequest("sess-1", "inst-abc");
    const ctx = makeContext("sess-1");

    const res = await GET(req, ctx);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe("busy");
    // Verify it called session.status with the instance directory
    expect(client.session.status).toHaveBeenCalledWith({ directory: "/home/user/project" });
  });

  it("ReturnsBusyWhenSdkStatusMapContainsSessionWithTypeRetry", async () => {
    const { instance, client } = makeInstanceAndClient({ "sess-1": { type: "retry" } });
    mockEnsureInstanceForSession.mockResolvedValue({ instance, client } as never);

    const req = makeRequest("sess-1", "inst-abc");
    const ctx = makeContext("sess-1");

    const res = await GET(req, ctx);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe("busy");
  });

  it("ReturnsIdleWhenSessionIsAbsentFromSdkStatusMap", async () => {
    const { instance, client } = makeInstanceAndClient({ "other-session": { type: "busy" } });
    mockEnsureInstanceForSession.mockResolvedValue({ instance, client } as never);

    const req = makeRequest("sess-1", "inst-abc");
    const ctx = makeContext("sess-1");

    const res = await GET(req, ctx);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe("idle");
  });

  it("ReturnsIdleWhenSdkStatusMapIsEmpty", async () => {
    const { instance, client } = makeInstanceAndClient({});
    mockEnsureInstanceForSession.mockResolvedValue({ instance, client } as never);

    const req = makeRequest("sess-1", "inst-abc");
    const ctx = makeContext("sess-1");

    const res = await GET(req, ctx);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe("idle");
  });

  it("ReturnsIdleWhenSdkReturnsNullData", async () => {
    const { instance, client } = makeInstanceAndClient(null);
    mockEnsureInstanceForSession.mockResolvedValue({ instance, client } as never);

    const req = makeRequest("sess-1", "inst-abc");
    const ctx = makeContext("sess-1");

    const res = await GET(req, ctx);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe("idle");
  });

  it("Returns500WhenSdkCallFails", async () => {
    const { instance } = makeInstanceAndClient();
    const failingClient = {
      session: {
        status: vi.fn().mockRejectedValue(new Error("SDK timeout")),
      },
    };
    mockEnsureInstanceForSession.mockResolvedValue({ instance, client: failingClient } as never);

    const req = makeRequest("sess-1", "inst-abc");
    const ctx = makeContext("sess-1");

    const res = await GET(req, ctx);
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toMatch(/failed to fetch/i);
  });
});
