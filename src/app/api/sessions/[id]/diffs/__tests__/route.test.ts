import { vi, describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock("@/lib/server/opencode-client", () => ({
  ensureInstanceForSession: vi.fn(),
}));

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import { GET } from "@/app/api/sessions/[id]/diffs/route";
import { ensureInstanceForSession } from "@/lib/server/opencode-client";

const mockEnsureInstanceForSession = vi.mocked(ensureInstanceForSession);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeContext(id: string) {
  return { params: Promise.resolve({ id }) };
}

function makeRequest(url: string) {
  return new NextRequest(url, { method: "GET" });
}

function makeMockClient(diffResponse: { data: unknown[] | null } = { data: [] }) {
  return {
    session: {
      diff: vi.fn().mockResolvedValue(diffResponse),
    },
  };
}

function makeInstanceResult(client: ReturnType<typeof makeMockClient>) {
  return {
    instance: { id: "inst-abc", status: "running", directory: "/tmp/proj" },
    client,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("GET /api/sessions/[id]/diffs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("Returns400WhenInstanceIdQueryParamIsMissing", async () => {
    const req = makeRequest("http://localhost/api/sessions/sess-1/diffs");
    const context = makeContext("sess-1");

    const res = await GET(req, context);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/instanceId/i);
  });

  it("Returns404WhenGetClientForInstanceThrows", async () => {
    mockEnsureInstanceForSession.mockRejectedValue(new Error("Instance not found"));

    const req = makeRequest("http://localhost/api/sessions/sess-1/diffs?instanceId=inst-abc");
    const context = makeContext("sess-1");

    const res = await GET(req, context);
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toMatch(/instance not found/i);
  });

  it("Returns200WithMappedFileDiffItemsOnSuccess", async () => {
    const client = makeMockClient({
      data: [
        { file: "src/foo.ts", before: "old", after: "new", additions: 5, deletions: 2 },
      ],
    });
    mockEnsureInstanceForSession.mockResolvedValue(makeInstanceResult(client) as never);

    const req = makeRequest("http://localhost/api/sessions/sess-1/diffs?instanceId=inst-abc");
    const context = makeContext("sess-1");

    const res = await GET(req, context);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toHaveLength(1);
    expect(body[0]).toEqual({
      file: "src/foo.ts",
      before: "old",
      after: "new",
      additions: 5,
      deletions: 2,
      status: "modified",
    });
  });

  it("InfersStatusAddedWhenBeforeIsEmpty", async () => {
    const client = makeMockClient({
      data: [
        { file: "src/new-file.ts", before: "", after: "content", additions: 10, deletions: 0 },
      ],
    });
    mockEnsureInstanceForSession.mockResolvedValue(makeInstanceResult(client) as never);

    const req = makeRequest("http://localhost/api/sessions/sess-1/diffs?instanceId=inst-abc");
    const context = makeContext("sess-1");

    const res = await GET(req, context);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body[0].status).toBe("added");
  });

  it("InfersStatusDeletedWhenAfterIsEmpty", async () => {
    const client = makeMockClient({
      data: [
        { file: "src/old-file.ts", before: "content", after: "", additions: 0, deletions: 8 },
      ],
    });
    mockEnsureInstanceForSession.mockResolvedValue(makeInstanceResult(client) as never);

    const req = makeRequest("http://localhost/api/sessions/sess-1/diffs?instanceId=inst-abc");
    const context = makeContext("sess-1");

    const res = await GET(req, context);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body[0].status).toBe("deleted");
  });

  it("InfersStatusModifiedWhenBothPresent", async () => {
    const client = makeMockClient({
      data: [
        { file: "src/mod.ts", before: "a", after: "b", additions: 1, deletions: 1 },
      ],
    });
    mockEnsureInstanceForSession.mockResolvedValue(makeInstanceResult(client) as never);

    const req = makeRequest("http://localhost/api/sessions/sess-1/diffs?instanceId=inst-abc");
    const context = makeContext("sess-1");

    const res = await GET(req, context);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body[0].status).toBe("modified");
  });

  it("Returns500WhenClientSessionDiffThrows", async () => {
    const client = makeMockClient();
    client.session.diff = vi.fn().mockRejectedValue(new Error("SDK error"));
    mockEnsureInstanceForSession.mockResolvedValue(makeInstanceResult(client) as never);

    const req = makeRequest("http://localhost/api/sessions/sess-1/diffs?instanceId=inst-abc");
    const context = makeContext("sess-1");

    const res = await GET(req, context);
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toMatch(/failed to retrieve diffs/i);
  });

  it("ReturnsEmptyArrayWhenSdkReturnsNullData", async () => {
    const client = makeMockClient({ data: null });
    mockEnsureInstanceForSession.mockResolvedValue(makeInstanceResult(client) as never);

    const req = makeRequest("http://localhost/api/sessions/sess-1/diffs?instanceId=inst-abc");
    const context = makeContext("sess-1");

    const res = await GET(req, context);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual([]);
  });

  it("ReturnsEmptyArrayWhenSdkReturnsEmptyArray", async () => {
    const client = makeMockClient({ data: [] });
    mockEnsureInstanceForSession.mockResolvedValue(makeInstanceResult(client) as never);

    const req = makeRequest("http://localhost/api/sessions/sess-1/diffs?instanceId=inst-abc");
    const context = makeContext("sess-1");

    const res = await GET(req, context);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual([]);
  });

  it("ForwardsMessageIDToSdkWhenProvided", async () => {
    const client = makeMockClient({ data: [] });
    mockEnsureInstanceForSession.mockResolvedValue(makeInstanceResult(client) as never);

    const req = makeRequest("http://localhost/api/sessions/sess-1/diffs?instanceId=inst-abc&messageID=msg-42");
    const context = makeContext("sess-1");

    const res = await GET(req, context);

    expect(res.status).toBe(200);
    expect(client.session.diff).toHaveBeenCalledWith(
      expect.objectContaining({ sessionID: "sess-1", messageID: "msg-42" })
    );
  });

  it("OmitsMessageIDFromSdkCallWhenNotProvided", async () => {
    const client = makeMockClient({ data: [] });
    mockEnsureInstanceForSession.mockResolvedValue(makeInstanceResult(client) as never);

    const req = makeRequest("http://localhost/api/sessions/sess-1/diffs?instanceId=inst-abc");
    const context = makeContext("sess-1");

    const res = await GET(req, context);

    expect(res.status).toBe(200);
    expect(client.session.diff).toHaveBeenCalledWith(
      expect.objectContaining({ sessionID: "sess-1" })
    );
    expect(client.session.diff).not.toHaveBeenCalledWith(
      expect.objectContaining({ messageID: expect.anything() })
    );
  });
});
