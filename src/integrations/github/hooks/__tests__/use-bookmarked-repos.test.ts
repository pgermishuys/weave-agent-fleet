// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

const apiFetchMock = vi.fn();

vi.mock("@/lib/api-client", () => ({
  apiFetch: (...args: unknown[]) => apiFetchMock(...args),
}));

const removePersistedKeyMock = vi.fn((key: string) => {
  localStorage.removeItem(key);
});

vi.mock("@/hooks/use-persisted-state", () => ({
  removePersistedKey: (key: string) => removePersistedKeyMock(key),
}));

vi.mock("@/integrations/github/storage", () => ({
  GITHUB_BOOKMARKED_REPOS_KEY: "weave:github:repos",
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mockResponse(data: unknown, ok = true) {
  return {
    ok,
    json: async () => data,
  };
}

const repoA = { fullName: "acme/alpha", owner: "acme", name: "alpha" };
const repoB = { fullName: "acme/bravo", owner: "acme", name: "bravo" };
const repoC = { fullName: "acme/charlie", owner: "acme", name: "charlie" };

async function loadHook() {
  const mod = await import("@/integrations/github/hooks/use-bookmarked-repos");
  return mod;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("sortByName", () => {
  beforeEach(() => {
    vi.resetModules();
    apiFetchMock.mockReset();
    localStorage.clear();
  });

  it("sorts repos alphabetically by fullName", async () => {
    const { sortByName } = await loadHook();
    const sorted = sortByName([repoC, repoA, repoB]);
    expect(sorted.map((r) => r.fullName)).toEqual([
      "acme/alpha",
      "acme/bravo",
      "acme/charlie",
    ]);
  });

  it("returns a new array without mutating the input", async () => {
    const { sortByName } = await loadHook();
    const input = [repoC, repoA];
    const sorted = sortByName(input);
    expect(sorted).not.toBe(input);
    expect(input[0]?.fullName).toBe("acme/charlie");
  });
});

describe("useBookmarkedRepos", () => {
  beforeEach(() => {
    vi.resetModules();
    apiFetchMock.mockReset();
    localStorage.clear();
  });

  it("fetches bookmarks on mount and populates repos", async () => {
    apiFetchMock.mockResolvedValue(mockResponse([repoB, repoA]));

    const { useBookmarkedRepos } = await loadHook();
    const { result } = renderHook(() => useBookmarkedRepos());

    await waitFor(() => {
      expect(result.current.repos).toHaveLength(2);
    });

    // Should be sorted
    expect(result.current.repos[0]?.fullName).toBe("acme/alpha");
    expect(result.current.repos[1]?.fullName).toBe("acme/bravo");
    expect(result.current.error).toBeNull();
  });

  it("sets error state when initial fetch fails", async () => {
    apiFetchMock.mockRejectedValue(new Error("Network error"));

    const { useBookmarkedRepos } = await loadHook();
    const { result } = renderHook(() => useBookmarkedRepos());

    await waitFor(() => {
      expect(result.current.error).toBe("Failed to fetch bookmarks from server");
    });

    expect(result.current.repos).toHaveLength(0);
  });

  it("addRepo adds a repo to state and calls sync", async () => {
    apiFetchMock.mockResolvedValue(mockResponse([]));

    const { useBookmarkedRepos } = await loadHook();
    const { result } = renderHook(() => useBookmarkedRepos());

    await waitFor(() => {
      expect(result.current.repos).toHaveLength(0);
    });

    act(() => {
      result.current.addRepo(repoA);
    });

    await waitFor(() => {
      expect(result.current.repos).toHaveLength(1);
      expect(result.current.repos[0]?.fullName).toBe("acme/alpha");
    });

    // Should have called PUT to sync
    expect(apiFetchMock).toHaveBeenCalledWith(
      "/api/integrations/github/bookmarks",
      expect.objectContaining({ method: "PUT" })
    );
  });

  it("addRepo prevents duplicate entries", async () => {
    apiFetchMock.mockResolvedValue(mockResponse([repoA]));

    const { useBookmarkedRepos } = await loadHook();
    const { result } = renderHook(() => useBookmarkedRepos());

    await waitFor(() => {
      expect(result.current.repos).toHaveLength(1);
    });

    const putCallsBefore = apiFetchMock.mock.calls.filter(
      (c: unknown[]) => typeof c[1] === "object" && (c[1] as RequestInit).method === "PUT"
    ).length;

    act(() => {
      result.current.addRepo(repoA);
    });

    // Repos count unchanged
    expect(result.current.repos).toHaveLength(1);

    // No new PUT call
    const putCallsAfter = apiFetchMock.mock.calls.filter(
      (c: unknown[]) => typeof c[1] === "object" && (c[1] as RequestInit).method === "PUT"
    ).length;
    expect(putCallsAfter).toBe(putCallsBefore);
  });

  it("removeRepo removes a repo from state and calls sync", async () => {
    apiFetchMock.mockResolvedValue(mockResponse([repoA, repoB]));

    const { useBookmarkedRepos } = await loadHook();
    const { result } = renderHook(() => useBookmarkedRepos());

    await waitFor(() => {
      expect(result.current.repos).toHaveLength(2);
    });

    act(() => {
      result.current.removeRepo("acme/alpha");
    });

    await waitFor(() => {
      expect(result.current.repos).toHaveLength(1);
      expect(result.current.repos[0]?.fullName).toBe("acme/bravo");
    });
  });

  it("hasRepo returns correct boolean", async () => {
    apiFetchMock.mockResolvedValue(mockResponse([repoA]));

    const { useBookmarkedRepos } = await loadHook();
    const { result } = renderHook(() => useBookmarkedRepos());

    await waitFor(() => {
      expect(result.current.repos).toHaveLength(1);
    });

    expect(result.current.hasRepo("acme/alpha")).toBe(true);
    expect(result.current.hasRepo("acme/bravo")).toBe(false);
  });

  it("cross-instance sync: addRepo in one instance updates the other", async () => {
    apiFetchMock.mockResolvedValue(mockResponse([]));

    const { useBookmarkedRepos } = await loadHook();
    const { result: instance1 } = renderHook(() => useBookmarkedRepos());
    const { result: instance2 } = renderHook(() => useBookmarkedRepos());

    await waitFor(() => {
      expect(instance1.current.repos).toHaveLength(0);
      expect(instance2.current.repos).toHaveLength(0);
    });

    act(() => {
      instance1.current.addRepo(repoA);
    });

    await waitFor(() => {
      expect(instance1.current.repos).toHaveLength(1);
      expect(instance2.current.repos).toHaveLength(1);
      expect(instance2.current.repos[0]?.fullName).toBe("acme/alpha");
    });
  });

  it("cross-instance sync: removeRepo in one instance updates the other", async () => {
    apiFetchMock.mockResolvedValue(mockResponse([repoA, repoB]));

    const { useBookmarkedRepos } = await loadHook();
    const { result: instance1 } = renderHook(() => useBookmarkedRepos());
    const { result: instance2 } = renderHook(() => useBookmarkedRepos());

    await waitFor(() => {
      expect(instance1.current.repos).toHaveLength(2);
      expect(instance2.current.repos).toHaveLength(2);
    });

    act(() => {
      instance1.current.removeRepo("acme/alpha");
    });

    await waitFor(() => {
      expect(instance1.current.repos).toHaveLength(1);
      expect(instance2.current.repos).toHaveLength(1);
      expect(instance2.current.repos[0]?.fullName).toBe("acme/bravo");
    });
  });

  it("error propagates to all instances on sync failure", async () => {
    // Initial load succeeds
    apiFetchMock.mockResolvedValueOnce(mockResponse([]));
    apiFetchMock.mockResolvedValueOnce(mockResponse([]));

    const { useBookmarkedRepos } = await loadHook();
    const { result: instance1 } = renderHook(() => useBookmarkedRepos());
    const { result: instance2 } = renderHook(() => useBookmarkedRepos());

    await waitFor(() => {
      expect(instance1.current.error).toBeNull();
    });

    // Make the PUT call fail with a non-ok response
    apiFetchMock.mockResolvedValueOnce(mockResponse({ error: "Server error" }, false));

    act(() => {
      instance1.current.addRepo(repoA);
    });

    await waitFor(() => {
      expect(instance1.current.error).toBe("Server error");
      expect(instance2.current.error).toBe("Server error");
    });
  });

  it("migrates from localStorage and merges with server data", async () => {
    // Server has repoA
    apiFetchMock.mockResolvedValueOnce(mockResponse([repoA]));
    // The PUT for sync during migration succeeds
    apiFetchMock.mockResolvedValueOnce(mockResponse([repoA, repoB]));

    // localStorage has repoB (not on server)
    localStorage.setItem(
      "weave:github:repos",
      JSON.stringify([repoB])
    );

    const { useBookmarkedRepos } = await loadHook();
    const { result } = renderHook(() => useBookmarkedRepos());

    await waitFor(() => {
      expect(result.current.repos).toHaveLength(2);
    });

    // Both repos present, sorted
    expect(result.current.repos[0]?.fullName).toBe("acme/alpha");
    expect(result.current.repos[1]?.fullName).toBe("acme/bravo");

    // localStorage should be cleared
    expect(localStorage.getItem("weave:github:repos")).toBeNull();
  });
});
