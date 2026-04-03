import { vi, describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@/lib/server/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// We don't mock _pkce — real PKCE functions are used to verify the URL structure
// But we do verify that the URL contains the expected parameters

// ─── Imports ──────────────────────────────────────────────────────────────────

import { GET } from "@/app/api/integrations/google-chat/auth/url/route";
import {
  GOOGLE_AUTH_URL,
  GOOGLE_CHAT_SCOPES,
} from "@/app/api/integrations/google-chat/auth/_config";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRequest(host = "localhost", port = "3000"): NextRequest {
  return new NextRequest(`http://${host}:${port}/api/integrations/google-chat/auth/url`);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("GET /api/integrations/google-chat/auth/url", () => {
  const originalEnv = process.env.GOOGLE_CHAT_CLIENT_ID;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GOOGLE_CHAT_CLIENT_ID = "test-client-id-12345";
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.GOOGLE_CHAT_CLIENT_ID;
    } else {
      process.env.GOOGLE_CHAT_CLIENT_ID = originalEnv;
    }
  });

  it("ReturnsAuthorizationUrlWithAllRequiredParams", async () => {
    const req = makeRequest();
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("authorizationUrl");

    const url = new URL(body.authorizationUrl as string);
    expect(url.origin + url.pathname).toBe(GOOGLE_AUTH_URL);
    expect(url.searchParams.get("client_id")).toBe("test-client-id-12345");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
  });

  it("IncludesAllRequiredScopes", async () => {
    const req = makeRequest();
    const res = await GET(req);
    const body = await res.json();
    const url = new URL(body.authorizationUrl as string);
    const scope = url.searchParams.get("scope") ?? "";

    for (const expectedScope of GOOGLE_CHAT_SCOPES) {
      expect(scope).toContain(expectedScope);
    }
  });

  it("IncludesStateAndCodeChallenge", async () => {
    const req = makeRequest();
    const res = await GET(req);
    const body = await res.json();
    const url = new URL(body.authorizationUrl as string);

    expect(url.searchParams.get("state")).toBeTruthy();
    expect(url.searchParams.get("code_challenge")).toBeTruthy();
  });

  it("DerivesRedirectUriFromRequestPort", async () => {
    const req = makeRequest("localhost", "4321");
    const res = await GET(req);
    const body = await res.json();
    const url = new URL(body.authorizationUrl as string);

    expect(url.searchParams.get("redirect_uri")).toBe(
      "http://localhost:4321/api/integrations/google-chat/auth/callback"
    );
  });

  it("Rejects400ForNonLocalhostOrigin", async () => {
    const req = makeRequest("evil.example.com", "3000");
    const res = await GET(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeTruthy();
  });

  it("Returns500WhenClientIdEnvVarMissing", async () => {
    delete process.env.GOOGLE_CHAT_CLIENT_ID;
    const req = makeRequest();
    const res = await GET(req);

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBeTruthy();
  });

  it("GeneratesUniqueStatePerRequest", async () => {
    const req1 = makeRequest();
    const req2 = makeRequest();

    const res1 = await GET(req1);
    const res2 = await GET(req2);

    const body1 = await res1.json();
    const body2 = await res2.json();

    const url1 = new URL(body1.authorizationUrl as string);
    const url2 = new URL(body2.authorizationUrl as string);

    expect(url1.searchParams.get("state")).not.toBe(
      url2.searchParams.get("state")
    );
  });
});
