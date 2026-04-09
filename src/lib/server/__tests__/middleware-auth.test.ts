/**
 * Proxy auth integration tests.
 *
 * Tests the proxy's auth enforcement, CORS handling, and public path bypass.
 * The token-auth module is mocked so tests control isAuthRequired/validateToken/validateCookie.
 */

import { NextRequest } from "next/server";
import { proxy } from "@/proxy";

// ─── Mock token-auth module ───────────────────────────────────────────────────

// We need fine-grained control over auth state in tests.
// The module is mocked so each test can set its own auth behavior.

let mockAuthRequired = false;
const mockValidToken = "test-token-32charshexhexhexhex";
const mockValidCookieValue = "valid-cookie-value";

vi.mock("@/lib/server/token-auth", () => ({
  AUTH_COOKIE_NAME: "weave.auth",
  isAuthRequired: () => mockAuthRequired,
  validateToken: (candidate: string) => candidate === mockValidToken,
  validateCookie: (cookieValue: string) => cookieValue === mockValidCookieValue,
  getAuthToken: () => mockValidToken,
  getLoginUrl: () => `http://localhost:3000/login?token=${mockValidToken}`,
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRequest(
  path: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    cookies?: Record<string, string>;
    origin?: string;
  } = {}
): NextRequest {
  const { method = "GET", headers = {}, cookies = {}, origin } = options;

  const url = `http://localhost:3000${path}`;
  const reqHeaders: Record<string, string> = { ...headers };
  if (origin) reqHeaders["origin"] = origin;

  // Build cookie header from cookies object
  if (Object.keys(cookies).length > 0) {
    reqHeaders["cookie"] = Object.entries(cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");
  }

  return new NextRequest(url, { method, headers: reqHeaders });
}

// ─── Auth disabled (localhost) ────────────────────────────────────────────────

describe("Auth disabled (isAuthRequired = false)", () => {
  beforeEach(() => {
    mockAuthRequired = false;
  });

  it("PassesThroughApiRequests", async () => {
    const req = makeRequest("/api/sessions");
    const res = await proxy(req);
    expect(res.status).not.toBe(401);
    expect(res.headers.get("x-middleware-next")).toBeTruthy();
  });

  it("PassesThroughPageRequests", async () => {
    const req = makeRequest("/");
    const res = await proxy(req);
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(302);
  });

  it("AddsCorsWildcardHeader", async () => {
    const req = makeRequest("/api/sessions", { origin: "http://tauri.localhost" });
    const res = await proxy(req);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("HandlesPreflight204", async () => {
    const req = makeRequest("/api/sessions", { method: "OPTIONS" });
    const res = await proxy(req);
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });
});

// ─── Auth enabled — public paths bypass ───────────────────────────────────────

describe("Auth enabled — public paths always accessible", () => {
  beforeEach(() => {
    mockAuthRequired = true;
  });

  it("AllowsLoginPage", async () => {
    const req = makeRequest("/login");
    const res = await proxy(req);
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(302);
  });

  it("AllowsLoginPageWithQueryParams", async () => {
    const req = makeRequest("/login?token=abc&returnUrl=/");
    const res = await proxy(req);
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(302);
  });

  it("AllowsAuthLoginEndpoint", async () => {
    const req = makeRequest("/api/auth/login", { method: "POST" });
    const res = await proxy(req);
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(302);
  });

  it("AllowsAuthStatusEndpoint", async () => {
    const req = makeRequest("/api/auth/status");
    const res = await proxy(req);
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(302);
  });

  it("AllowsAuthLogoutEndpoint", async () => {
    const req = makeRequest("/api/auth/logout", { method: "POST" });
    const res = await proxy(req);
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(302);
  });

  it("AllowsNextJsAssets", async () => {
    const req = makeRequest("/_next/webpack-hmr");
    const res = await proxy(req);
    expect(res.status).not.toBe(401);
  });

  it("AllowsFaviconIco", async () => {
    const req = makeRequest("/favicon.ico");
    const res = await proxy(req);
    expect(res.status).not.toBe(401);
  });

  it("AllowsWeaveLogo", async () => {
    const req = makeRequest("/weave_logo.png");
    const res = await proxy(req);
    expect(res.status).not.toBe(401);
  });
});

// ─── Auth enabled — unauthenticated requests ──────────────────────────────────

describe("Auth enabled — unauthenticated requests", () => {
  beforeEach(() => {
    mockAuthRequired = true;
  });

  it("Returns401ForUnauthenticatedApiRequest", async () => {
    const req = makeRequest("/api/sessions");
    const res = await proxy(req);
    expect(res.status).toBe(401);
  });

  it("Returns401JsonBodyForApiRequest", async () => {
    const req = makeRequest("/api/sessions");
    const res = await proxy(req);
    expect(res.status).toBe(401);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("Unauthorized");
  });

  it("RedirectsUnauthenticatedPageRequestToLogin", async () => {
    const req = makeRequest("/");
    const res = await proxy(req);
    expect(res.status).toBe(307);
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("/login");
    expect(location).toContain("returnUrl");
  });

  it("IncludesReturnUrlInLoginRedirect", async () => {
    const req = makeRequest("/sessions/abc123");
    const res = await proxy(req);
    expect(res.status).toBe(307);
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("returnUrl=%2Fsessions%2Fabc123");
  });

  it("Returns401WithCorsHeadersOnApiRequest", async () => {
    const req = makeRequest("/api/sessions", { origin: "http://remote.host" });
    const res = await proxy(req);
    expect(res.status).toBe(401);
    // CORS headers should still be present on 401
    expect(res.headers.get("access-control-allow-origin")).toBeTruthy();
  });
});

// ─── Auth enabled — valid Bearer token ────────────────────────────────────────

describe("Auth enabled — valid Bearer token", () => {
  beforeEach(() => {
    mockAuthRequired = true;
  });

  it("PassesRequestWithValidBearerToken", async () => {
    const req = makeRequest("/api/sessions", {
      headers: { authorization: `Bearer ${mockValidToken}` },
    });
    const res = await proxy(req);
    expect(res.status).not.toBe(401);
    expect(res.headers.get("x-middleware-next")).toBeTruthy();
  });

  it("Rejects401WithInvalidBearerToken", async () => {
    const req = makeRequest("/api/sessions", {
      headers: { authorization: "Bearer wrong-token-here-1234567890" },
    });
    const res = await proxy(req);
    expect(res.status).toBe(401);
  });

  it("Rejects401WithMalformedAuthHeader", async () => {
    const req = makeRequest("/api/sessions", {
      headers: { authorization: "Basic dXNlcjpwYXNz" },
    });
    const res = await proxy(req);
    expect(res.status).toBe(401);
  });
});

// ─── Auth enabled — valid cookie ─────────────────────────────────────────────

describe("Auth enabled — valid cookie", () => {
  beforeEach(() => {
    mockAuthRequired = true;
  });

  it("PassesRequestWithValidCookie", async () => {
    const req = makeRequest("/api/sessions", {
      cookies: { "weave.auth": mockValidCookieValue },
    });
    const res = await proxy(req);
    expect(res.status).not.toBe(401);
    expect(res.headers.get("x-middleware-next")).toBeTruthy();
  });

  it("Rejects401WithInvalidCookie", async () => {
    const req = makeRequest("/api/sessions", {
      cookies: { "weave.auth": "tampered-cookie-value" },
    });
    const res = await proxy(req);
    expect(res.status).toBe(401);
  });

  it("Rejects401WithExpiredOrMissingCookie", async () => {
    const req = makeRequest("/api/sessions");
    const res = await proxy(req);
    expect(res.status).toBe(401);
  });

  it("PassesPageRequestWithValidCookie", async () => {
    const req = makeRequest("/", {
      cookies: { "weave.auth": mockValidCookieValue },
    });
    const res = await proxy(req);
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(302);
    expect(res.status).not.toBe(307);
  });
});

// ─── CORS with auth enabled ────────────────────────────────────────────────────

describe("CORS headers — auth enabled", () => {
  beforeEach(() => {
    mockAuthRequired = true;
  });

  it("ReflectsOriginHeaderWhenPresent", async () => {
    const req = makeRequest("/api/sessions", {
      headers: { authorization: `Bearer ${mockValidToken}` },
      origin: "http://remote-client.tailscale.net",
    });
    const res = await proxy(req);
    expect(res.headers.get("access-control-allow-origin")).toBe(
      "http://remote-client.tailscale.net"
    );
  });

  it("AddsAccessControlAllowCredentials", async () => {
    const req = makeRequest("/api/sessions", {
      headers: { authorization: `Bearer ${mockValidToken}` },
      origin: "http://remote-client.tailscale.net",
    });
    const res = await proxy(req);
    expect(res.headers.get("access-control-allow-credentials")).toBe("true");
  });

  it("AddsVaryOriginHeader", async () => {
    const req = makeRequest("/api/sessions", {
      headers: { authorization: `Bearer ${mockValidToken}` },
      origin: "http://remote-client.tailscale.net",
    });
    const res = await proxy(req);
    expect(res.headers.get("vary")).toBe("Origin");
  });

  it("FallsBackToWildcardWhenNoOriginHeader", async () => {
    const req = makeRequest("/api/sessions", {
      headers: { authorization: `Bearer ${mockValidToken}` },
    });
    const res = await proxy(req);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("HandlesPreflight204WithCredentials", async () => {
    const req = makeRequest("/api/sessions", {
      method: "OPTIONS",
      origin: "http://remote-client.tailscale.net",
    });
    const res = await proxy(req);
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe(
      "http://remote-client.tailscale.net"
    );
    expect(res.headers.get("access-control-allow-credentials")).toBe("true");
  });
});
