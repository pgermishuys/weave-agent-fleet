import { vi, describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@/lib/server/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/server/integration-store", () => ({
  getIntegrationConfig: vi.fn(),
  setIntegrationConfig: vi.fn().mockReturnValue(true),
  removeIntegrationConfig: vi.fn(),
}));

// ─── Imports ──────────────────────────────────────────────────────────────────

import { getIntegrationConfig } from "@/lib/server/integration-store";

const mockGetConfig = vi.mocked(getIntegrationConfig);

function makeConnectedConfig() {
  return {
    token: "ya29.access-token",
    refresh_token: "1//refresh",
    token_expiry: Date.now() + 60 * 60 * 1000,
    connectedAt: new Date().toISOString(),
  };
}

// ─── Space detail tests ────────────────────────────────────────────────────────

describe("GET /api/integrations/google-chat/spaces/[spaceId]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("Returns401WhenNotConnected", async () => {
    const { GET } = await import(
      "@/app/api/integrations/google-chat/spaces/[spaceId]/route"
    );
    mockGetConfig.mockReturnValue(null);

    const req = new NextRequest("http://localhost/api/integrations/google-chat/spaces/ABC123");
    const res = await GET(req, { params: Promise.resolve({ spaceId: "ABC123" }) });
    expect(res.status).toBe(401);
  });

  it("Returns400ForInvalidSpaceId", async () => {
    const { GET } = await import(
      "@/app/api/integrations/google-chat/spaces/[spaceId]/route"
    );

    const req = new NextRequest("http://localhost/api/integrations/google-chat/spaces/bad/id");
    const res = await GET(req, { params: Promise.resolve({ spaceId: "bad/id" }) });
    expect(res.status).toBe(400);
  });

  it("Returns400ForPathTraversalAttempt", async () => {
    const { GET } = await import(
      "@/app/api/integrations/google-chat/spaces/[spaceId]/route"
    );

    const req = new NextRequest("http://localhost/api/integrations/google-chat/spaces/..%2Fadmin");
    const res = await GET(req, { params: Promise.resolve({ spaceId: "../../admin" }) });
    expect(res.status).toBe(400);
  });

  it("ReturnsSpaceOnSuccess", async () => {
    const { GET } = await import(
      "@/app/api/integrations/google-chat/spaces/[spaceId]/route"
    );
    mockGetConfig.mockReturnValue(makeConnectedConfig());

    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ name: "spaces/ABC123", displayName: "Dev Chat" }),
    } as Response);

    const req = new NextRequest("http://localhost/api/integrations/google-chat/spaces/ABC123");
    const res = await GET(req, { params: Promise.resolve({ spaceId: "ABC123" }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe("spaces/ABC123");
  });
});

// ─── Messages list tests ───────────────────────────────────────────────────────

describe("GET /api/integrations/google-chat/spaces/[spaceId]/messages", () => {
  beforeEach(() => vi.clearAllMocks());

  it("Returns401WhenNotConnected", async () => {
    const { GET } = await import(
      "@/app/api/integrations/google-chat/spaces/[spaceId]/messages/route"
    );
    mockGetConfig.mockReturnValue(null);

    const req = new NextRequest("http://localhost/.../messages");
    const res = await GET(req, { params: Promise.resolve({ spaceId: "ABC123" }) });
    expect(res.status).toBe(401);
  });

  it("Returns400ForInvalidSpaceId", async () => {
    const { GET } = await import(
      "@/app/api/integrations/google-chat/spaces/[spaceId]/messages/route"
    );

    const req = new NextRequest("http://localhost/.../messages");
    const res = await GET(req, { params: Promise.resolve({ spaceId: "bad/id" }) });
    expect(res.status).toBe(400);
  });

  it("ReturnsMessagesOnSuccess", async () => {
    const { GET } = await import(
      "@/app/api/integrations/google-chat/spaces/[spaceId]/messages/route"
    );
    mockGetConfig.mockReturnValue(makeConnectedConfig());

    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        messages: [
          { name: "spaces/ABC123/messages/MSG1", text: "Hello world" },
        ],
      }),
    } as Response);

    const req = new NextRequest(
      "http://localhost/api/integrations/google-chat/spaces/ABC123/messages"
    );
    const res = await GET(req, { params: Promise.resolve({ spaceId: "ABC123" }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.messages).toHaveLength(1);
  });
});

// ─── Single message tests ──────────────────────────────────────────────────────

describe("GET /api/integrations/google-chat/spaces/[spaceId]/messages/[messageId]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("Returns400ForInvalidMessageId", async () => {
    const { GET } = await import(
      "@/app/api/integrations/google-chat/spaces/[spaceId]/messages/[messageId]/route"
    );

    const req = new NextRequest("http://localhost/...");
    const res = await GET(req, {
      params: Promise.resolve({ spaceId: "SPACE1", messageId: "bad/msg" }),
    });
    expect(res.status).toBe(400);
  });

  it("Returns401WhenNotConnected", async () => {
    const { GET } = await import(
      "@/app/api/integrations/google-chat/spaces/[spaceId]/messages/[messageId]/route"
    );
    mockGetConfig.mockReturnValue(null);

    const req = new NextRequest("http://localhost/...");
    const res = await GET(req, {
      params: Promise.resolve({ spaceId: "SPACE1", messageId: "MSG1" }),
    });
    expect(res.status).toBe(401);
  });

  it("ReturnsMessageOnSuccess", async () => {
    const { GET } = await import(
      "@/app/api/integrations/google-chat/spaces/[spaceId]/messages/[messageId]/route"
    );
    mockGetConfig.mockReturnValue(makeConnectedConfig());

    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        name: "spaces/SPACE1/messages/MSG1",
        text: "Hello",
      }),
    } as Response);

    const req = new NextRequest("http://localhost/...");
    const res = await GET(req, {
      params: Promise.resolve({ spaceId: "SPACE1", messageId: "MSG1" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe("spaces/SPACE1/messages/MSG1");
  });

  it("DoesNotReflectInvalidIdInErrorResponse", async () => {
    const { GET } = await import(
      "@/app/api/integrations/google-chat/spaces/[spaceId]/messages/[messageId]/route"
    );

    const req = new NextRequest("http://localhost/...");
    const res = await GET(req, {
      params: Promise.resolve({ spaceId: "SPACE1", messageId: "<script>xss</script>" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).not.toContain("<script>");
  });
});
