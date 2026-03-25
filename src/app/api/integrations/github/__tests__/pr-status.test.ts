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

import { GET } from "@/app/api/integrations/github/repos/[owner]/[repo]/pulls/[number]/status/route";
import * as integrationStore from "@/lib/server/integration-store";

const mockGetConfig = vi.mocked(integrationStore.getIntegrationConfig);

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function makeParams(
  owner: string,
  repo: string,
  number: string
): Promise<{ params: Promise<{ owner: string; repo: string; number: string }> }> {
  return { params: Promise.resolve({ owner, repo, number }) };
}

function makeRequest(url: string): NextRequest {
  return new NextRequest(url);
}

function makePrResponse(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: 1,
    number: 42,
    title: "Add feature X",
    html_url: "https://github.com/acme/my-repo/pull/42",
    state: "open",
    merged_at: null,
    draft: false,
    head: { ref: "feature-x", sha: "abc123def456" },
    base: { ref: "main", sha: "000000" },
    ...overrides,
  };
}

function makeCheckSuitesResponse(
  suites: Array<{ status: string; conclusion: string | null }>
): Record<string, unknown> {
  return {
    total_count: suites.length,
    check_suites: suites.map((s, i) => ({ id: i + 1, ...s })),
  };
}

function mockFetchSequence(responses: Array<{ ok: boolean; status: number; body: unknown }>): void {
  const mockFetch = vi.spyOn(global, "fetch");
  for (const response of responses) {
    mockFetch.mockResolvedValueOnce({
      ok: response.ok,
      status: response.status,
      json: async () => response.body,
      headers: new Headers(),
    } as Response);
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("GET /api/integrations/github/repos/[owner]/[repo]/pulls/[number]/status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("Returns401WhenNoTokenConfigured", async () => {
    mockGetConfig.mockReturnValue(null);
    const req = makeRequest("http://localhost/api/integrations/github/repos/acme/my-repo/pulls/42/status");
    const res = await GET(req, await makeParams("acme", "my-repo", "42"));
    expect(res.status).toBe(401);
  });

  it("ReturnsCombinedStatusWithChecksPassingSuccess", async () => {
    mockGetConfig.mockReturnValue({ token: "ghp_test" });
    mockFetchSequence([
      { ok: true, status: 200, body: makePrResponse() },
      {
        ok: true,
        status: 200,
        body: makeCheckSuitesResponse([
          { status: "completed", conclusion: "success" },
          { status: "completed", conclusion: "neutral" },
        ]),
      },
    ]);

    const req = makeRequest("http://localhost/api/integrations/github/repos/acme/my-repo/pulls/42/status");
    const res = await GET(req, await makeParams("acme", "my-repo", "42"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.number).toBe(42);
    expect(body.title).toBe("Add feature X");
    expect(body.state).toBe("open");
    expect(body.merged).toBe(false);
    expect(body.checksStatus).toBe("success");
    expect(body.headRef).toBe("feature-x");
    expect(body.url).toBe("https://github.com/acme/my-repo/pull/42");
  });

  it("ReturnsCombinedStatusWithChecksRunning", async () => {
    mockGetConfig.mockReturnValue({ token: "ghp_test" });
    mockFetchSequence([
      { ok: true, status: 200, body: makePrResponse() },
      {
        ok: true,
        status: 200,
        body: makeCheckSuitesResponse([
          { status: "in_progress", conclusion: null },
          { status: "completed", conclusion: "success" },
        ]),
      },
    ]);

    const req = makeRequest("http://localhost/api/integrations/github/repos/acme/my-repo/pulls/42/status");
    const res = await GET(req, await makeParams("acme", "my-repo", "42"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.checksStatus).toBe("running");
  });

  it("ReturnsCombinedStatusWithQueuedSuitesAsRunning", async () => {
    mockGetConfig.mockReturnValue({ token: "ghp_test" });
    mockFetchSequence([
      { ok: true, status: 200, body: makePrResponse() },
      {
        ok: true,
        status: 200,
        body: makeCheckSuitesResponse([
          { status: "queued", conclusion: null },
        ]),
      },
    ]);

    const req = makeRequest("http://localhost/api/integrations/github/repos/acme/my-repo/pulls/42/status");
    const res = await GET(req, await makeParams("acme", "my-repo", "42"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.checksStatus).toBe("running");
  });

  it("ReturnsCombinedStatusWithChecksFailing", async () => {
    mockGetConfig.mockReturnValue({ token: "ghp_test" });
    mockFetchSequence([
      { ok: true, status: 200, body: makePrResponse() },
      {
        ok: true,
        status: 200,
        body: makeCheckSuitesResponse([
          { status: "completed", conclusion: "failure" },
          { status: "completed", conclusion: "success" },
        ]),
      },
    ]);

    const req = makeRequest("http://localhost/api/integrations/github/repos/acme/my-repo/pulls/42/status");
    const res = await GET(req, await makeParams("acme", "my-repo", "42"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.checksStatus).toBe("failure");
  });

  it("ReturnsNoneChecksStatusWhenNoCheckSuitesExist", async () => {
    mockGetConfig.mockReturnValue({ token: "ghp_test" });
    mockFetchSequence([
      { ok: true, status: 200, body: makePrResponse() },
      {
        ok: true,
        status: 200,
        body: { total_count: 0, check_suites: [] },
      },
    ]);

    const req = makeRequest("http://localhost/api/integrations/github/repos/acme/my-repo/pulls/42/status");
    const res = await GET(req, await makeParams("acme", "my-repo", "42"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.checksStatus).toBe("none");
  });

  it("ReturnsMergedTrueWhenMergedAtIsSet", async () => {
    mockGetConfig.mockReturnValue({ token: "ghp_test" });
    mockFetchSequence([
      {
        ok: true,
        status: 200,
        body: makePrResponse({ state: "closed", merged_at: "2026-01-01T00:00:00Z" }),
      },
      { ok: true, status: 200, body: { total_count: 0, check_suites: [] } },
    ]);

    const req = makeRequest("http://localhost/api/integrations/github/repos/acme/my-repo/pulls/42/status");
    const res = await GET(req, await makeParams("acme", "my-repo", "42"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.merged).toBe(true);
    expect(body.state).toBe("closed");
  });

  it("ForwardsGitHub404FromPrFetch", async () => {
    mockGetConfig.mockReturnValue({ token: "ghp_test" });
    mockFetchSequence([
      { ok: false, status: 404, body: { message: "Not Found" } },
    ]);

    const req = makeRequest("http://localhost/api/integrations/github/repos/acme/my-repo/pulls/42/status");
    const res = await GET(req, await makeParams("acme", "my-repo", "42"));
    expect(res.status).toBe(404);
  });

  it("GracefullyDegradeChecksStatusWhenChecksFetchFails403", async () => {
    mockGetConfig.mockReturnValue({ token: "ghp_test" });
    mockFetchSequence([
      { ok: true, status: 200, body: makePrResponse() },
      { ok: false, status: 403, body: { message: "Resource not accessible by integration" } },
    ]);

    const req = makeRequest("http://localhost/api/integrations/github/repos/acme/my-repo/pulls/42/status");
    const res = await GET(req, await makeParams("acme", "my-repo", "42"));
    // Should still return 200 with checksStatus: "none" when checks fetch fails
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.checksStatus).toBe("none");
  });

  it("Handles429RateLimitErrorFromPrFetch", async () => {
    mockGetConfig.mockReturnValue({ token: "ghp_test" });
    mockFetchSequence([
      {
        ok: false,
        status: 429,
        body: { message: "API rate limit exceeded" },
      },
    ]);

    const req = makeRequest("http://localhost/api/integrations/github/repos/acme/my-repo/pulls/42/status");
    const res = await GET(req, await makeParams("acme", "my-repo", "42"));
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toBe("API rate limit exceeded");
  });

  it("ReturnsDraftTrueForDraftPrs", async () => {
    mockGetConfig.mockReturnValue({ token: "ghp_test" });
    mockFetchSequence([
      { ok: true, status: 200, body: makePrResponse({ draft: true }) },
      { ok: true, status: 200, body: { total_count: 0, check_suites: [] } },
    ]);

    const req = makeRequest("http://localhost/api/integrations/github/repos/acme/my-repo/pulls/42/status");
    const res = await GET(req, await makeParams("acme", "my-repo", "42"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.draft).toBe(true);
  });

  it("SkippedNeutralConclusionsCountAsSuccess", async () => {
    mockGetConfig.mockReturnValue({ token: "ghp_test" });
    mockFetchSequence([
      { ok: true, status: 200, body: makePrResponse() },
      {
        ok: true,
        status: 200,
        body: makeCheckSuitesResponse([
          { status: "completed", conclusion: "skipped" },
          { status: "completed", conclusion: "neutral" },
          { status: "completed", conclusion: "success" },
        ]),
      },
    ]);

    const req = makeRequest("http://localhost/api/integrations/github/repos/acme/my-repo/pulls/42/status");
    const res = await GET(req, await makeParams("acme", "my-repo", "42"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.checksStatus).toBe("success");
  });
});
