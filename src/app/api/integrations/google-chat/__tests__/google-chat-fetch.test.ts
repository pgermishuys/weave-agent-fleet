import { vi, describe, it, expect, beforeEach } from "vitest";

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

import {
  getGoogleChatToken,
  googleChatFetch,
} from "@/app/api/integrations/google-chat/_lib/google-chat-fetch";
import {
  getIntegrationConfig,
  setIntegrationConfig,
  removeIntegrationConfig,
} from "@/lib/server/integration-store";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeStoredConfig(overrides?: Partial<{
  token: string;
  refresh_token: string;
  token_expiry: number;
}>) {
  return {
    token: "ya29.access-token",
    refresh_token: "1//refresh-token",
    token_expiry: Date.now() + 60 * 60 * 1000, // 1 hour from now
    connectedAt: new Date().toISOString(),
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("getGoogleChatToken", () => {
  const originalEnv = process.env.GOOGLE_CHAT_CLIENT_ID;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GOOGLE_CHAT_CLIENT_ID = "test-client-id";
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.GOOGLE_CHAT_CLIENT_ID;
    } else {
      process.env.GOOGLE_CHAT_CLIENT_ID = originalEnv;
    }
  });

  it("ReturnsStoredTokenWhenNotExpired", async () => {
    vi.mocked(getIntegrationConfig).mockReturnValue(makeStoredConfig());

    const token = await getGoogleChatToken();
    expect(token).toBe("ya29.access-token");
    expect(global.fetch).toBeUndefined; // No fetch should happen
  });

  it("ReturnsNullWhenNotConfigured", async () => {
    vi.mocked(getIntegrationConfig).mockReturnValue(null);

    const token = await getGoogleChatToken();
    expect(token).toBeNull();
  });

  it("RefreshesTokenWhenExpired", async () => {
    vi.mocked(getIntegrationConfig).mockReturnValue(
      makeStoredConfig({ token_expiry: Date.now() - 1000 })
    );

    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        access_token: "ya29.new-token",
        expires_in: 3600,
        token_type: "Bearer",
        scope: "",
      }),
    } as Response);

    const token = await getGoogleChatToken();
    expect(token).toBe("ya29.new-token");
    expect(setIntegrationConfig).toHaveBeenCalledWith(
      "google-chat",
      expect.objectContaining({ token: "ya29.new-token" })
    );
  });

  it("RemovesConfigOnInvalidGrant", async () => {
    vi.mocked(getIntegrationConfig).mockReturnValue(
      makeStoredConfig({ token_expiry: Date.now() - 1000 })
    );

    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: "invalid_grant" }),
    } as Response);

    const token = await getGoogleChatToken();
    expect(token).toBeNull();
    expect(removeIntegrationConfig).toHaveBeenCalledWith("google-chat");
  });

  it("ReturnsNullOnRefreshNetworkError", async () => {
    vi.mocked(getIntegrationConfig).mockReturnValue(
      makeStoredConfig({ token_expiry: Date.now() - 1000 })
    );

    vi.spyOn(global, "fetch").mockRejectedValue(new Error("ECONNREFUSED"));

    const token = await getGoogleChatToken();
    expect(token).toBeNull();
  });
});

describe("googleChatFetch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("MakesAuthenticatedGetRequest", async () => {
    const mockFetch = vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ spaces: [] }),
    } as Response);

    const result = await googleChatFetch("/spaces", "test-token");

    expect(result.status).toBe(200);
    expect(result.data).toEqual({ spaces: [] });

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("https://chat.googleapis.com/v1/spaces");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer test-token");
  });

  it("ForwardsQueryParams", async () => {
    const mockFetch = vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    } as Response);

    await googleChatFetch("/spaces", "token", {
      params: { pageSize: 50, pageToken: "abc" },
    });

    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toContain("pageSize=50");
    expect(url).toContain("pageToken=abc");
  });

  it("SkipsUndefinedParams", async () => {
    const mockFetch = vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    } as Response);

    await googleChatFetch("/spaces", "token", {
      params: { pageSize: 50, pageToken: undefined },
    });

    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).not.toContain("pageToken");
  });

  it("ReturnsErrorOnNon200", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({
        error: { message: "The caller does not have permission" },
      }),
    } as Response);

    const result = await googleChatFetch("/spaces", "token");

    expect(result.status).toBe(403);
    expect(result.error).toBe("The caller does not have permission");
    expect(result.data).toBeUndefined();
  });

  it("Returns502OnNetworkError", async () => {
    vi.spyOn(global, "fetch").mockRejectedValue(new Error("ECONNREFUSED"));

    const result = await googleChatFetch("/spaces", "token");

    expect(result.status).toBe(502);
    expect(result.error).toBe("Network error");
  });
});
