import { vi } from "vitest";
import { NextRequest } from "next/server";

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock("@/lib/server/process-manager", () => ({
  _recoveryComplete: Promise.resolve(),
}));

vi.mock("@/lib/server/opencode-client", () => ({
  getClientForInstance: vi.fn(),
}));

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import { GET } from "@/app/api/sessions/[id]/messages/route";
import * as openCodeClient from "@/lib/server/opencode-client";

const mockGetClientForInstance = vi.mocked(openCodeClient.getClientForInstance);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeSDKMessage(id: string) {
  return {
    info: {
      id,
      sessionID: "sess-1",
      role: "assistant",
      time: { created: 1000 },
    },
    parts: [],
  };
}

function makeContext(id = "sess-1") {
  return { params: Promise.resolve({ id }) };
}

function makeRequest(queryString: string) {
  return new NextRequest(
    `http://localhost/api/sessions/sess-1/messages?${queryString}`,
    { method: "GET" },
  );
}

function makeMockClient(messages: ReturnType<typeof makeSDKMessage>[]) {
  return {
    session: {
      messages: vi.fn().mockResolvedValue({ data: messages }),
    },
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("GET /api/sessions/[id]/messages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 when instanceId is missing", async () => {
    const req = makeRequest("");
    const res = await GET(req, makeContext());
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/instanceId/i);
  });

  it("returns 404 when instance not found", async () => {
    mockGetClientForInstance.mockImplementation(() => {
      throw new Error("Instance not found");
    });

    const req = makeRequest("instanceId=bad-inst");
    const res = await GET(req, makeContext());
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toMatch(/instance not found/i);
  });

  it("returns last 50 messages by default", async () => {
    const messages = Array.from({ length: 60 }, (_, i) =>
      makeSDKMessage(`msg-${i}`),
    );
    mockGetClientForInstance.mockReturnValue(makeMockClient(messages) as never);

    const req = makeRequest("instanceId=inst-1");
    const res = await GET(req, makeContext());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.messages).toHaveLength(50);
    expect(body.pagination.hasMore).toBe(true);
    expect(body.pagination.totalCount).toBe(60);
  });

  it("returns last N messages when limit is specified", async () => {
    const messages = Array.from({ length: 20 }, (_, i) =>
      makeSDKMessage(`msg-${i}`),
    );
    mockGetClientForInstance.mockReturnValue(makeMockClient(messages) as never);

    const req = makeRequest("instanceId=inst-1&limit=10");
    const res = await GET(req, makeContext());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.messages).toHaveLength(10);
    expect(body.messages[0].info.id).toBe("msg-10");
    expect(body.messages[9].info.id).toBe("msg-19");
  });

  it("returns messages before cursor when before param is set", async () => {
    const messages = Array.from({ length: 20 }, (_, i) =>
      makeSDKMessage(`msg-${i}`),
    );
    mockGetClientForInstance.mockReturnValue(makeMockClient(messages) as never);

    const req = makeRequest("instanceId=inst-1&limit=5&before=msg-10");
    const res = await GET(req, makeContext());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.messages).toHaveLength(5);
    expect(body.messages.map((m: { info: { id: string } }) => m.info.id)).toEqual([
      "msg-5",
      "msg-6",
      "msg-7",
      "msg-8",
      "msg-9",
    ]);
  });

  it("returns hasMore: false when all messages fit", async () => {
    const messages = Array.from({ length: 5 }, (_, i) =>
      makeSDKMessage(`msg-${i}`),
    );
    mockGetClientForInstance.mockReturnValue(makeMockClient(messages) as never);

    const req = makeRequest("instanceId=inst-1&limit=10");
    const res = await GET(req, makeContext());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.messages).toHaveLength(5);
    expect(body.pagination.hasMore).toBe(false);
    expect(body.pagination.totalCount).toBe(5);
  });

  it("handles empty message array", async () => {
    mockGetClientForInstance.mockReturnValue(makeMockClient([]) as never);

    const req = makeRequest("instanceId=inst-1");
    const res = await GET(req, makeContext());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.messages).toHaveLength(0);
    expect(body.pagination.hasMore).toBe(false);
    expect(body.pagination.totalCount).toBe(0);
  });

  it("returns correct oldestMessageId", async () => {
    const messages = Array.from({ length: 10 }, (_, i) =>
      makeSDKMessage(`msg-${i}`),
    );
    mockGetClientForInstance.mockReturnValue(makeMockClient(messages) as never);

    const req = makeRequest("instanceId=inst-1&limit=3");
    const res = await GET(req, makeContext());
    const body = await res.json();

    expect(body.pagination.oldestMessageId).toBe("msg-7");
  });

  // ─── `after` cursor tests ─────────────────────────────────────────────────

  it("returns messages after the given cursor (after param happy path)", async () => {
    const messages = Array.from({ length: 10 }, (_, i) =>
      makeSDKMessage(`msg-${i}`),
    );
    mockGetClientForInstance.mockReturnValue(makeMockClient(messages) as never);

    const req = makeRequest("instanceId=inst-1&after=msg-5");
    const res = await GET(req, makeContext());
    const body = await res.json();

    expect(res.status).toBe(200);
    // Should return msg-6 through msg-9 (4 messages after msg-5)
    expect(body.messages).toHaveLength(4);
    expect(body.messages.map((m: { info: { id: string } }) => m.info.id)).toEqual([
      "msg-6",
      "msg-7",
      "msg-8",
      "msg-9",
    ]);
    expect(body.pagination.hasMore).toBe(false);
    expect(body.pagination.totalCount).toBe(10);
  });

  it("returns ALL messages when after cursor is stale (not found)", async () => {
    const messages = Array.from({ length: 60 }, (_, i) =>
      makeSDKMessage(`msg-${i}`),
    );
    mockGetClientForInstance.mockReturnValue(makeMockClient(messages) as never);

    const req = makeRequest("instanceId=inst-1&after=nonexistent-cursor");
    const res = await GET(req, makeContext());
    const body = await res.json();

    expect(res.status).toBe(200);
    // Stale cursor must return ALL messages, not a paginated slice
    expect(body.messages).toHaveLength(60);
    expect(body.pagination.hasMore).toBe(false);
    expect(body.pagination.oldestMessageId).toBe("msg-0");
    expect(body.pagination.totalCount).toBe(60);
  });

  it("returns empty array when after cursor is the last message", async () => {
    const messages = Array.from({ length: 5 }, (_, i) =>
      makeSDKMessage(`msg-${i}`),
    );
    mockGetClientForInstance.mockReturnValue(makeMockClient(messages) as never);

    const req = makeRequest("instanceId=inst-1&after=msg-4");
    const res = await GET(req, makeContext());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.messages).toHaveLength(0);
    expect(body.pagination.hasMore).toBe(false);
    expect(body.pagination.totalCount).toBe(5);
  });

  it("returns ALL messages when after is used with empty message array (stale cursor)", async () => {
    mockGetClientForInstance.mockReturnValue(makeMockClient([]) as never);

    const req = makeRequest("instanceId=inst-1&after=some-cursor");
    const res = await GET(req, makeContext());
    const body = await res.json();

    expect(res.status).toBe(200);
    // Empty array — cursor can't be found, so stale-cursor fallback returns all (0) messages
    expect(body.messages).toHaveLength(0);
    expect(body.pagination.hasMore).toBe(false);
    expect(body.pagination.totalCount).toBe(0);
  });

  // ─── Other edge cases ───────────────────────────────────────────────────────

  it("handles SDK returning null data", async () => {
    const client = {
      session: {
        messages: vi.fn().mockResolvedValue({ data: null }),
      },
    };
    mockGetClientForInstance.mockReturnValue(client as never);

    const req = makeRequest("instanceId=inst-1");
    const res = await GET(req, makeContext());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.messages).toHaveLength(0);
    expect(body.pagination.totalCount).toBe(0);
  });
});
