import { vi, describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@/lib/server/integration-store", () => ({
  getIntegrationConfig: vi.fn(),
  setIntegrationConfig: vi.fn(),
}));

vi.mock("@/lib/server/logger", () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// ─── Imports ──────────────────────────────────────────────────────────────────

import { GET, PUT } from "@/app/api/integrations/github/bookmarks/route";
import * as integrationStore from "@/lib/server/integration-store";

const mockGetConfig = vi.mocked(integrationStore.getIntegrationConfig);
const mockSetConfig = vi.mocked(integrationStore.setIntegrationConfig);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makePutRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/integrations/github/bookmarks", {
    method: "PUT",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

const sampleRepo = { fullName: "acme/my-project", owner: "acme", name: "my-project" };

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("GET /api/integrations/github/bookmarks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("ReturnsEmptyArrayWhenNoGitHubConfigExists", async () => {
    mockGetConfig.mockReturnValue(null);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it("ReturnsEmptyArrayWhenConfigHasNoBookmarkedReposField", async () => {
    mockGetConfig.mockReturnValue({ token: "ghp_test", connectedAt: "2025-01-01" });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it("ReturnsBookmarkedReposWhenPresentInConfig", async () => {
    mockGetConfig.mockReturnValue({
      token: "ghp_test",
      connectedAt: "2025-01-01",
      bookmarkedRepos: [sampleRepo],
    });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([sampleRepo]);
  });
});

describe("PUT /api/integrations/github/bookmarks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("SavesBookmarksAndReturnsThem", async () => {
    mockGetConfig.mockReturnValue({ token: "ghp_test", connectedAt: "2025-01-01" });
    mockSetConfig.mockReturnValue(true);

    const req = makePutRequest({ bookmarks: [sampleRepo] });
    const res = await PUT(req);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([sampleRepo]);
  });

  it("PreservesExistingConfigFieldsWhenWritingBookmarks", async () => {
    mockGetConfig.mockReturnValue({ token: "ghp_test", connectedAt: "2025-01-01" });
    mockSetConfig.mockReturnValue(true);

    const req = makePutRequest({ bookmarks: [sampleRepo] });
    await PUT(req);

    expect(mockSetConfig).toHaveBeenCalledWith("github", {
      token: "ghp_test",
      connectedAt: "2025-01-01",
      bookmarkedRepos: [sampleRepo],
    });
  });

  it("CreatesNewConfigEntryWhenNoPriorGitHubConfigExists", async () => {
    mockGetConfig.mockReturnValue(null);
    mockSetConfig.mockReturnValue(true);

    const req = makePutRequest({ bookmarks: [sampleRepo] });
    const res = await PUT(req);
    expect(res.status).toBe(200);
    expect(mockSetConfig).toHaveBeenCalledWith("github", {
      bookmarkedRepos: [sampleRepo],
    });
  });

  it("Returns400WhenBodyIsMissingBookmarksField", async () => {
    const req = makePutRequest({ other: "stuff" });
    const res = await PUT(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  it("Returns400WhenBookmarksIsNotAnArray", async () => {
    const req = makePutRequest({ bookmarks: "not-an-array" });
    const res = await PUT(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  it("Returns400WhenBodyIsInvalidJson", async () => {
    const req = new NextRequest(
      "http://localhost/api/integrations/github/bookmarks",
      {
        method: "PUT",
        body: "not-json",
        headers: { "Content-Type": "application/json" },
      }
    );
    const res = await PUT(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  it("SavesEmptyArrayWhenBookmarksIsEmpty", async () => {
    mockGetConfig.mockReturnValue({ token: "ghp_test" });
    mockSetConfig.mockReturnValue(true);

    const req = makePutRequest({ bookmarks: [] });
    const res = await PUT(req);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });
});
