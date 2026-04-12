import { vi, describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@/lib/server/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/server/integration-store", () => ({
  setIntegrationConfig: vi.fn().mockReturnValue(true),
  getIntegrationConfig: vi.fn(),
  removeIntegrationConfig: vi.fn(),
}));

vi.mock("@/app/api/integrations/google-chat/auth/_pkce", () => ({
  consumePendingSession: vi.fn(),
  storePendingSession: vi.fn(),
  generateCodeVerifier: vi.fn(),
  generateCodeChallenge: vi.fn(),
  generateState: vi.fn(),
}));

// ─── Imports ──────────────────────────────────────────────────────────────────

import { GET } from "@/app/api/integrations/google-chat/auth/callback/route";
import { setIntegrationConfig } from "@/lib/server/integration-store";
import { consumePendingSession } from "@/app/api/integrations/google-chat/auth/_pkce";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTokenResponse() {
  return {
    access_token: "ya29.access-token",
    refresh_token: "1//refresh-token",
    expires_in: 3600,
    scope: "https://www.googleapis.com/auth/chat.spaces",
    token_type: "Bearer" as const,
  };
}

function makeCallbackRequest(params: Record<string, string>, host = "localhost"): NextRequest {
  const url = new URL(`http://${host}:3000/api/integrations/google-chat/auth/callback`);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  return new NextRequest(url.toString());
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("GET /api/integrations/google-chat/auth/callback", () => {
  const originalEnv = process.env.GOOGLE_CHAT_CLIENT_ID;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GOOGLE_CHAT_CLIENT_ID = "test-client-id";
    vi.mocked(consumePendingSession).mockReturnValue("test-code-verifier");
    vi.mocked(setIntegrationConfig).mockReturnValue(true);
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.GOOGLE_CHAT_CLIENT_ID;
    } else {
      process.env.GOOGLE_CHAT_CLIENT_ID = originalEnv;
    }
  });

  it("StoresTokensAndReturnsSuccessHtmlOnSuccess", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => makeTokenResponse(),
    } as Response);

    const req = makeCallbackRequest({ code: "auth-code-123", state: "state-abc" });
    const res = await GET(req);

    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("Connected successfully");
    expect(text).toContain("window.close()");
    expect(setIntegrationConfig).toHaveBeenCalledWith(
      "google-chat",
      expect.objectContaining({
        token: "ya29.access-token",
        refresh_token: "1//refresh-token",
        token_expiry: expect.any(Number),
        connectedAt: expect.any(String),
      })
    );
  });

  it("ReturnsHtmlNotJson", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => makeTokenResponse(),
    } as Response);

    const req = makeCallbackRequest({ code: "code", state: "state" });
    const res = await GET(req);

    expect(res.headers.get("Content-Type")).toContain("text/html");
  });

  it("DoesNotInterpolateQueryParamsIntoHtml", async () => {
    vi.mocked(consumePendingSession).mockReturnValue(null);

    const maliciousState = "<script>alert(1)</script>";
    const req = makeCallbackRequest({ code: "code", state: maliciousState });
    const res = await GET(req);

    const text = await res.text();
    expect(text).not.toContain("<script>alert(1)</script>");
    expect(text).not.toContain(maliciousState);
  });

  it("Returns400WhenNonLocalhostOrigin", async () => {
    const req = makeCallbackRequest({ code: "code", state: "state" }, "evil.example.com");
    const res = await GET(req);

    expect(res.status).toBe(400);
    // Response is HTML, not JSON
    const text = await res.text();
    expect(text).toContain("<!DOCTYPE html>");
  });

  it("Returns400WhenGoogleReturnsError", async () => {
    const req = makeCallbackRequest({ error: "access_denied", state: "state" });
    const res = await GET(req);

    expect(res.status).toBe(400);
    const text = await res.text();
    // Error value must NOT appear in the response
    expect(text).not.toContain("access_denied");
  });

  it("Returns400WhenMissingCode", async () => {
    const req = makeCallbackRequest({ state: "state-only" });
    const res = await GET(req);

    expect(res.status).toBe(400);
  });

  it("Returns400WhenStateNotInPendingStore", async () => {
    vi.mocked(consumePendingSession).mockReturnValue(null);

    const req = makeCallbackRequest({ code: "code", state: "unknown-state" });
    const res = await GET(req);

    expect(res.status).toBe(400);
  });

  it("Returns502WhenGoogleTokenEndpointFails", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: "invalid_grant" }),
    } as Response);

    const req = makeCallbackRequest({ code: "code", state: "state" });
    const res = await GET(req);

    expect(res.status).toBe(502);
  });

  it("Returns502OnNetworkError", async () => {
    vi.spyOn(global, "fetch").mockRejectedValue(new Error("ECONNREFUSED"));

    const req = makeCallbackRequest({ code: "code", state: "state" });
    const res = await GET(req);

    expect(res.status).toBe(502);
  });

  it("DoesNotExposeMissingRefreshTokenDetails", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        access_token: "ya29.token",
        // No refresh_token — should fail gracefully
        expires_in: 3600,
        scope: "",
        token_type: "Bearer",
      }),
    } as Response);

    const req = makeCallbackRequest({ code: "code", state: "state" });
    const res = await GET(req);

    expect(res.status).toBe(502);
    expect(setIntegrationConfig).not.toHaveBeenCalled();
  });
});
