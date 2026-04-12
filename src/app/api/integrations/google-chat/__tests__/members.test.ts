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

import { GET } from "@/app/api/integrations/google-chat/spaces/[spaceId]/members/route";
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

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("GET /api/integrations/google-chat/spaces/[spaceId]/members", () => {
  beforeEach(() => vi.clearAllMocks());

  it("Returns401WhenNotConnected", async () => {
    mockGetConfig.mockReturnValue(null);

    const req = new NextRequest("http://localhost/.../members");
    const res = await GET(req, { params: Promise.resolve({ spaceId: "ABC123" }) });
    expect(res.status).toBe(401);
  });

  it("Returns400ForInvalidSpaceId", async () => {
    const req = new NextRequest("http://localhost/.../members");
    const res = await GET(req, { params: Promise.resolve({ spaceId: "bad/id" }) });
    expect(res.status).toBe(400);
  });

  it("ReturnsMembersOnSuccess", async () => {
    mockGetConfig.mockReturnValue(makeConnectedConfig());

    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        memberships: [
          {
            name: "spaces/ABC123/members/user1",
            state: "JOINED",
          },
        ],
      }),
    } as Response);

    const req = new NextRequest(
      "http://localhost/api/integrations/google-chat/spaces/ABC123/members"
    );
    const res = await GET(req, { params: Promise.resolve({ spaceId: "ABC123" }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.memberships).toHaveLength(1);
  });

  it("ForwardsPaginationParams", async () => {
    mockGetConfig.mockReturnValue(makeConnectedConfig());
    const mockFetch = vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ memberships: [] }),
    } as Response);

    const req = new NextRequest(
      "http://localhost/api/integrations/google-chat/spaces/ABC123/members?pageSize=25&pageToken=xyz"
    );
    await GET(req, { params: Promise.resolve({ spaceId: "ABC123" }) });

    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toContain("pageSize=25");
    expect(url).toContain("pageToken=xyz");
  });
});
