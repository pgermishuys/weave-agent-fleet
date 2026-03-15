// @vitest-environment jsdom
import { vi, describe, it, expect, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock("@/lib/api-client", () => ({
  apiFetch: vi.fn(),
}));

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import * as apiClient from "@/lib/api-client";
import { useForkSession } from "@/hooks/use-fork-session";

// ─── Typed mock helpers ───────────────────────────────────────────────────────

const mockApiFetch = vi.mocked(apiClient.apiFetch);

// ─── Shared fixtures ──────────────────────────────────────────────────────────

function makeForkResponse(overrides: Record<string, unknown> = {}) {
  return {
    instanceId: "inst-new",
    workspaceId: "ws-new",
    session: {
      id: "oc-new-session",
      title: "New Session",
      directory: "/home/user/project",
      projectID: "proj-1",
      version: "1",
      time: { created: 1700000000, updated: 1700000001 },
    },
    forkedFromSessionId: "source-session-id",
    ...overrides,
  };
}

function makeOkResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response;
}

function makeErrorResponse(status: number, errorMessage: string) {
  return {
    ok: false,
    status,
    json: vi.fn().mockResolvedValue({ error: errorMessage }),
  } as unknown as Response;
}

// ─── Hook tests ───────────────────────────────────────────────────────────────

describe("useForkSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns initial idle state", () => {
    const { result } = renderHook(() => useForkSession());

    expect(result.current.isForking).toBe(false);
    expect(result.current.forkingSessionId).toBeNull();
    expect(result.current.error).toBeUndefined();
    expect(typeof result.current.forkSession).toBe("function");
    expect(typeof result.current.clearError).toBe("function");
  });

  it("sets isForking and forkingSessionId to true/sessionId during the call", async () => {
    let resolveApiFetch!: (value: Response) => void;
    const pendingFetch = new Promise<Response>((resolve) => {
      resolveApiFetch = resolve;
    });
    mockApiFetch.mockReturnValue(pendingFetch);

    const { result } = renderHook(() => useForkSession());

    // Start the fork — do NOT await yet
    let forkPromise!: Promise<unknown>;
    act(() => {
      forkPromise = result.current.forkSession("db-sess-1");
    });

    // While fetch is pending, hook should reflect forking state
    await waitFor(() => {
      expect(result.current.isForking).toBe(true);
    });
    expect(result.current.forkingSessionId).toBe("db-sess-1");

    // Resolve the pending fetch so the hook can finish
    await act(async () => {
      resolveApiFetch(makeOkResponse(makeForkResponse()));
      await forkPromise;
    });
  });

  it("clears isForking and forkingSessionId after successful fork", async () => {
    mockApiFetch.mockResolvedValue(makeOkResponse(makeForkResponse()));

    const { result } = renderHook(() => useForkSession());

    await act(async () => {
      await result.current.forkSession("db-sess-1");
    });

    expect(result.current.isForking).toBe(false);
    expect(result.current.forkingSessionId).toBeNull();
    expect(result.current.error).toBeUndefined();
  });

  it("returns the deserialized fork response on success", async () => {
    const forkResponse = makeForkResponse();
    mockApiFetch.mockResolvedValue(makeOkResponse(forkResponse));

    const { result } = renderHook(() => useForkSession());

    let returnValue: unknown;
    await act(async () => {
      returnValue = await result.current.forkSession("db-sess-1");
    });

    expect(returnValue).toEqual(forkResponse);
  });

  it("sets error and clears forkingSessionId when the response is not ok", async () => {
    mockApiFetch.mockResolvedValue(makeErrorResponse(404, "Source session not found"));

    const { result } = renderHook(() => useForkSession());

    await act(async () => {
      await result.current.forkSession("db-sess-1").catch(() => {});
    });

    expect(result.current.error).toBe("Source session not found");
    expect(result.current.isForking).toBe(false);
    expect(result.current.forkingSessionId).toBeNull();
  });

  it("sets error and clears forkingSessionId when apiFetch throws", async () => {
    mockApiFetch.mockRejectedValue(new Error("Network failure"));

    const { result } = renderHook(() => useForkSession());

    await act(async () => {
      await result.current.forkSession("db-sess-1").catch(() => {});
    });

    expect(result.current.error).toBe("Network failure");
    expect(result.current.isForking).toBe(false);
    expect(result.current.forkingSessionId).toBeNull();
  });

  it("uses generic error message for non-Error throws", async () => {
    mockApiFetch.mockRejectedValue("string error");

    const { result } = renderHook(() => useForkSession());

    await act(async () => {
      await result.current.forkSession("db-sess-1").catch(() => {});
    });

    expect(result.current.error).toBe("Failed to fork session");
  });

  it("clears error at the start of a new forkSession call", async () => {
    // First call fails
    mockApiFetch.mockResolvedValueOnce(makeErrorResponse(500, "Server error"));
    const { result } = renderHook(() => useForkSession());
    await act(async () => {
      await result.current.forkSession("db-sess-1").catch(() => {});
    });
    expect(result.current.error).toBe("Server error");

    // Second call succeeds — error should clear at the start
    mockApiFetch.mockResolvedValueOnce(makeOkResponse(makeForkResponse()));
    await act(async () => {
      await result.current.forkSession("db-sess-1");
    });

    expect(result.current.error).toBeUndefined();
  });

  it("clears error when clearError is called", async () => {
    mockApiFetch.mockResolvedValue(makeErrorResponse(404, "Not found"));

    const { result } = renderHook(() => useForkSession());
    await act(async () => {
      await result.current.forkSession("db-sess-1").catch(() => {});
    });
    expect(result.current.error).toBe("Not found");

    act(() => {
      result.current.clearError();
    });

    expect(result.current.error).toBeUndefined();
  });

  it("calls apiFetch with the correct URL and method", async () => {
    mockApiFetch.mockResolvedValue(makeOkResponse(makeForkResponse()));

    const { result } = renderHook(() => useForkSession());
    await act(async () => {
      await result.current.forkSession("db-sess-1");
    });

    expect(mockApiFetch).toHaveBeenCalledWith(
      "/api/sessions/db-sess-1/fork",
      expect.objectContaining({ method: "POST" }),
      undefined
    );
  });

  it("encodes special characters in the session ID in the URL", async () => {
    mockApiFetch.mockResolvedValue(makeOkResponse(makeForkResponse()));

    const { result } = renderHook(() => useForkSession());
    await act(async () => {
      await result.current.forkSession("session/with spaces");
    });

    expect(mockApiFetch).toHaveBeenCalledWith(
      "/api/sessions/session%2Fwith%20spaces/fork",
      expect.anything(),
      undefined
    );
  });

  it("sends title in the request body when provided", async () => {
    mockApiFetch.mockResolvedValue(makeOkResponse(makeForkResponse()));

    const { result } = renderHook(() => useForkSession());
    await act(async () => {
      await result.current.forkSession("db-sess-1", { title: "My Fork" });
    });

    expect(mockApiFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: JSON.stringify({ title: "My Fork" }),
      }),
      undefined
    );
  });

  it("sends empty body object when no opts are provided", async () => {
    mockApiFetch.mockResolvedValue(makeOkResponse(makeForkResponse()));

    const { result } = renderHook(() => useForkSession());
    await act(async () => {
      await result.current.forkSession("db-sess-1");
    });

    expect(mockApiFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ body: "{}" }),
      undefined
    );
  });

  it("forwards connectionId to apiFetch", async () => {
    mockApiFetch.mockResolvedValue(makeOkResponse(makeForkResponse()));

    const { result } = renderHook(() => useForkSession());
    await act(async () => {
      await result.current.forkSession("db-sess-1", undefined, "conn-remote-1");
    });

    expect(mockApiFetch).toHaveBeenCalledWith(
      "/api/sessions/db-sess-1/fork",
      expect.objectContaining({ method: "POST" }),
      "conn-remote-1"
    );
  });
});
