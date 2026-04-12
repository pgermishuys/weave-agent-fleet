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

import { useGoogleChatMessages } from "@/integrations/google-chat/hooks/use-google-chat-messages";

describe("useGoogleChatMessages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiFetchMock.mockReset();
  });

  it("StartsWithEmptyMessages", () => {
    const { result } = renderHook(() => useGoogleChatMessages(null));
    expect(result.current.messages).toEqual([]);
    expect(result.current.isLoading).toBe(false);
  });

  it("DoesNotFetchWhenSpaceIdIsNull", async () => {
    const { result } = renderHook(() => useGoogleChatMessages(null));
    await act(async () => { await Promise.resolve(); });
    expect(apiFetchMock).not.toHaveBeenCalled();
    expect(result.current.messages).toEqual([]);
  });

  it("FetchesMessagesWhenSpaceIdProvided", async () => {
    apiFetchMock.mockResolvedValueOnce(
      mockResponse({
        messages: [
          { name: "spaces/SPACE1/messages/MSG1", text: "Hello" },
        ],
      })
    );

    const { result } = renderHook(() =>
      useGoogleChatMessages("SPACE1")
    );

    await waitFor(() => {
      expect(result.current.messages).toHaveLength(1);
      expect(result.current.messages[0]?.text).toBe("Hello");
    });
  });

  it("SetsErrorOnFailedFetch", async () => {
    apiFetchMock.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: "Not connected" }),
    });

    const { result } = renderHook(() =>
      useGoogleChatMessages("SPACE1")
    );

    await waitFor(() => {
      expect(result.current.error).toBeTruthy();
      expect(result.current.isLoading).toBe(false);
    });
  });

  it("ResetsMessagesWhenSpaceIdChanges", async () => {
    apiFetchMock
      .mockResolvedValueOnce(
        mockResponse({
          messages: [{ name: "spaces/SPACE1/messages/MSG1", text: "A" }],
        })
      )
      .mockResolvedValueOnce(
        mockResponse({
          messages: [{ name: "spaces/SPACE2/messages/MSG2", text: "B" }],
        })
      );

    const { result, rerender } = renderHook(
      ({ spaceId }: { spaceId: string }) =>
        useGoogleChatMessages(spaceId),
      { initialProps: { spaceId: "SPACE1" } }
    );

    await waitFor(() => {
      expect(result.current.messages).toHaveLength(1);
    });

    rerender({ spaceId: "SPACE2" });

    await waitFor(() => {
      expect(result.current.messages).toHaveLength(1);
      expect(result.current.messages[0]?.text).toBe("B");
    });
  });

  it("RefetchReloadsMessages", async () => {
    apiFetchMock
      .mockResolvedValueOnce(
        mockResponse({ messages: [{ name: "spaces/S/messages/1", text: "v1" }] })
      )
      .mockResolvedValueOnce(
        mockResponse({ messages: [{ name: "spaces/S/messages/2", text: "v2" }] })
      );

    const { result } = renderHook(() => useGoogleChatMessages("S"));

    await waitFor(() => {
      expect(result.current.messages[0]?.text).toBe("v1");
    });

    await act(async () => {
      result.current.refetch();
    });

    await waitFor(() => {
      expect(result.current.messages[0]?.text).toBe("v2");
    });
  });

  it("SetsHasMoreWhenNextPageTokenPresent", async () => {
    apiFetchMock.mockResolvedValueOnce(
      mockResponse({
        messages: [{ name: "spaces/S/messages/1", text: "msg" }],
        nextPageToken: "token123",
      })
    );

    const { result } = renderHook(() => useGoogleChatMessages("S"));

    await waitFor(() => {
      expect(result.current.hasMore).toBe(true);
    });
  });
});
