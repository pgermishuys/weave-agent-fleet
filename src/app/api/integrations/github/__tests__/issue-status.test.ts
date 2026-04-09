import { vi, describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@/lib/server/integration-store", () => ({
  getIntegrationConfig: vi.fn(),
}));

vi.mock("@/lib/server/logger", () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// ─── Imports ──────────────────────────────────────────────────────────────────

import { GET } from "@/app/api/integrations/github/repos/[owner]/[repo]/issues/[number]/status/route";
import * as integrationStore from "@/lib/server/integration-store";

const mockGetConfig = vi.mocked(integrationStore.getIntegrationConfig);

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function makeParams(
  owner: string,
  repo: string,
  number: string
): Promise<{
  params: Promise<{ owner: string; repo: string; number: string }>;
}> {
  return { params: Promise.resolve({ owner, repo, number }) };
}

function makeRequest(url: string): NextRequest {
  return new NextRequest(url);
}

function makeIssueResponse(
  overrides: Partial<Record<string, unknown>> = {}
): Record<string, unknown> {
  return {
    id: 1,
    number: 42,
    title: "Bug: something broken",
    body: "It is broken",
    html_url: "https://github.com/acme/my-repo/issues/42",
    state: "open",
    labels: [
      { name: "bug", color: "d73a4a" },
      { name: "high-priority", color: "ff0000" },
    ],
    user: { login: "alice", avatar_url: "https://example.com/alice.png" },
    comments: 3,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-02T00:00:00Z",
    ...overrides,
  };
}

function mockFetchResponses(
  responses: Array<{
    ok: boolean;
    status: number;
    body: unknown;
    headers?: Headers;
  }>
): void {
  const mockFetch = vi.spyOn(global, "fetch");
  for (const response of responses) {
    mockFetch.mockResolvedValueOnce({
      ok: response.ok,
      status: response.status,
      json: async () => response.body,
      headers: response.headers ?? new Headers(),
    } as Response);
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("GET /api/integrations/github/repos/[owner]/[repo]/issues/[number]/status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("Returns401WhenNoTokenConfigured", async () => {
    mockGetConfig.mockReturnValue(null);
    const req = makeRequest(
      "http://localhost/api/integrations/github/repos/acme/my-repo/issues/42/status"
    );
    const res = await GET(req, await makeParams("acme", "my-repo", "42"));
    expect(res.status).toBe(401);
  });

  it("ReturnsCorrectStatusForOpenIssue", async () => {
    mockGetConfig.mockReturnValue({ token: "ghp_test" });
    mockFetchResponses([
      { ok: true, status: 200, body: makeIssueResponse() },
    ]);

    const req = makeRequest(
      "http://localhost/api/integrations/github/repos/acme/my-repo/issues/42/status"
    );
    const res = await GET(req, await makeParams("acme", "my-repo", "42"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.number).toBe(42);
    expect(body.title).toBe("Bug: something broken");
    expect(body.state).toBe("open");
    expect(body.url).toBe("https://github.com/acme/my-repo/issues/42");
  });

  it("ReturnsCorrectStateForClosedIssue", async () => {
    mockGetConfig.mockReturnValue({ token: "ghp_test" });
    mockFetchResponses([
      { ok: true, status: 200, body: makeIssueResponse({ state: "closed" }) },
    ]);

    const req = makeRequest(
      "http://localhost/api/integrations/github/repos/acme/my-repo/issues/42/status"
    );
    const res = await GET(req, await makeParams("acme", "my-repo", "42"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.state).toBe("closed");
  });

  it("IncludesLabelsInResponse", async () => {
    mockGetConfig.mockReturnValue({ token: "ghp_test" });
    mockFetchResponses([
      { ok: true, status: 200, body: makeIssueResponse() },
    ]);

    const req = makeRequest(
      "http://localhost/api/integrations/github/repos/acme/my-repo/issues/42/status"
    );
    const res = await GET(req, await makeParams("acme", "my-repo", "42"));
    const body = await res.json();
    expect(body.labels).toEqual([
      { name: "bug", color: "d73a4a" },
      { name: "high-priority", color: "ff0000" },
    ]);
  });

  it("ForwardsGitHub404", async () => {
    mockGetConfig.mockReturnValue({ token: "ghp_test" });
    mockFetchResponses([
      { ok: false, status: 404, body: { message: "Not Found" } },
    ]);

    const req = makeRequest(
      "http://localhost/api/integrations/github/repos/acme/my-repo/issues/999/status"
    );
    const res = await GET(req, await makeParams("acme", "my-repo", "999"));
    expect(res.status).toBe(404);
  });

  it("IncludesRateLimitFieldsWhenAvailable", async () => {
    mockGetConfig.mockReturnValue({ token: "ghp_test" });
    const headers = new Headers({
      "X-RateLimit-Remaining": "4200",
      "X-RateLimit-Reset": "1700000000",
    });
    mockFetchResponses([
      { ok: true, status: 200, body: makeIssueResponse(), headers },
    ]);

    const req = makeRequest(
      "http://localhost/api/integrations/github/repos/acme/my-repo/issues/42/status"
    );
    const res = await GET(req, await makeParams("acme", "my-repo", "42"));
    const body = await res.json();
    expect(body.rateLimitRemaining).toBe(4200);
    expect(body.rateLimitReset).toBe(1700000000);
  });

  it("HandlesEmptyLabelsArray", async () => {
    mockGetConfig.mockReturnValue({ token: "ghp_test" });
    mockFetchResponses([
      { ok: true, status: 200, body: makeIssueResponse({ labels: [] }) },
    ]);

    const req = makeRequest(
      "http://localhost/api/integrations/github/repos/acme/my-repo/issues/42/status"
    );
    const res = await GET(req, await makeParams("acme", "my-repo", "42"));
    const body = await res.json();
    expect(body.labels).toEqual([]);
  });
});
