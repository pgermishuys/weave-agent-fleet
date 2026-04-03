// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const apiFetchMock = vi.fn();

vi.mock("@/lib/api-client", () => ({
  apiFetch: (...args: unknown[]) => apiFetchMock(...args),
}));

function mockResponse(data: unknown) {
  return { ok: true, json: async () => data };
}

function mockErrorResponse(status: number) {
  return {
    ok: false,
    status,
    json: async () => ({ error: "Server error" }),
  };
}

async function loadHook() {
  const mod = await import(
    "@/integrations/google-chat/hooks/use-google-chat-spaces"
  );
  return mod.useGoogleChatSpaces;
}

describe("useGoogleChatSpaces", () => {
  beforeEach(() => {
    vi.resetModules();
    apiFetchMock.mockReset();
  });

  it("StartsWithEmptySpacesList", async () => {
    const useGoogleChatSpaces = await loadHook();
    const { result } = renderHook(() => useGoogleChatSpaces());
    expect(result.current.spaces).toEqual([]);
    expect(result.current.isLoading).toBe(false);
  });

  it("LoadsSpacesOnRefresh", async () => {
    apiFetchMock.mockResolvedValueOnce(
      mockResponse({
        spaces: [{ name: "spaces/AAAA", displayName: "My Space" }],
      })
    );

    const useGoogleChatSpaces = await loadHook();
    const { result } = renderHook(() => useGoogleChatSpaces());

    await act(async () => {
      result.current.refresh();
    });

    await waitFor(() => {
      expect(result.current.spaces).toHaveLength(1);
      expect(result.current.spaces[0]?.displayName).toBe("My Space");
    });
  });

  it("SetsErrorOnFailedFetch", async () => {
    apiFetchMock.mockResolvedValueOnce(mockErrorResponse(401));

    const useGoogleChatSpaces = await loadHook();
    const { result } = renderHook(() => useGoogleChatSpaces());

    await act(async () => {
      result.current.refresh();
    });

    await waitFor(() => {
      expect(result.current.error).toBeTruthy();
      expect(result.current.isLoading).toBe(false);
    });
  });

  it("DeduplicatesConcurrentRefreshCalls", async () => {
    apiFetchMock.mockResolvedValue(mockResponse({ spaces: [] }));

    const useGoogleChatSpaces = await loadHook();
    const { result } = renderHook(() => useGoogleChatSpaces());

    act(() => {
      result.current.refresh();
      result.current.refresh();
    });

    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalledTimes(1);
    });
  });

  it("ClearsSpacesOnClear", async () => {
    apiFetchMock.mockResolvedValueOnce(
      mockResponse({ spaces: [{ name: "spaces/A" }] })
    );

    const useGoogleChatSpaces = await loadHook();
    const { result } = renderHook(() => useGoogleChatSpaces());

    await act(async () => {
      result.current.refresh();
    });

    await waitFor(() => {
      expect(result.current.spaces).toHaveLength(1);
    });

    act(() => {
      result.current.clear();
    });

    expect(result.current.spaces).toEqual([]);
    expect(result.current.lastUpdated).toBeNull();
  });

  it("PaginatesUntilNoNextPageToken", async () => {
    apiFetchMock
      .mockResolvedValueOnce(
        mockResponse({
          spaces: [{ name: "spaces/A" }],
          nextPageToken: "token1",
        })
      )
      .mockResolvedValueOnce(
        mockResponse({
          spaces: [{ name: "spaces/B" }],
        })
      );

    const useGoogleChatSpaces = await loadHook();
    const { result } = renderHook(() => useGoogleChatSpaces());

    await act(async () => {
      result.current.refresh();
    });

    await waitFor(() => {
      expect(result.current.spaces).toHaveLength(2);
    });

    expect(apiFetchMock).toHaveBeenCalledTimes(2);
  });
});
