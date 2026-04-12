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

import { GET } from "@/app/api/integrations/google-chat/spaces/route";
import { getIntegrationConfig } from "@/lib/server/integration-store";

const mockGetConfig = vi.mocked(getIntegrationConfig);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeConnectedConfig() {
  return {
    token: "ya29.access-token",
    refresh_token: "1//refresh",
    token_expiry: Date.now() + 60 * 60 * 1000,
    connectedAt: new Date().toISOString(),
  };
}

function makeRequest(query = ""): NextRequest {
  return new NextRequest(
    `http://localhost/api/integrations/google-chat/spaces${query}`
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("GET /api/integrations/google-chat/spaces", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("Returns401WhenNotConnected", async () => {
    mockGetConfig.mockReturnValue(null);
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Google Chat not connected");
  });

  it("ReturnsSpacesOnSuccess", async () => {
    mockGetConfig.mockReturnValue(makeConnectedConfig());

    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        spaces: [{ name: "spaces/AAAA", displayName: "My Space" }],
      }),
    } as Response);

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.spaces).toHaveLength(1);
    expect(body.spaces[0].name).toBe("spaces/AAAA");
  });

  it("ForwardsPaginationParams", async () => {
    mockGetConfig.mockReturnValue(makeConnectedConfig());
    const mockFetch = vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ spaces: [] }),
    } as Response);

    await GET(makeRequest("?pageSize=50&pageToken=abc123"));

    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toContain("pageSize=50");
    expect(url).toContain("pageToken=abc123");
  });

  it("ForwardsGoogleErrorResponse", async () => {
    mockGetConfig.mockReturnValue(makeConnectedConfig());
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ error: { message: "Permission denied" } }),
    } as Response);

    const res = await GET(makeRequest());
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("Permission denied");
  });
});
