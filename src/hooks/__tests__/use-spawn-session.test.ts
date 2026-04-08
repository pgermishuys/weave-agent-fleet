// @vitest-environment jsdom
import { vi, describe, it, expect, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock("@/lib/api-client", () => ({
  apiFetch: vi.fn(),
}));

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import * as apiClient from "@/lib/api-client";
import { useSpawnSession } from "@/hooks/use-spawn-session";

// ─── Typed mock helpers ───────────────────────────────────────────────────────

const mockApiFetch = vi.mocked(apiClient.apiFetch);

// ─── Shared fixtures ──────────────────────────────────────────────────────────

function makeCreateResponse(overrides: Record<string, unknown> = {}) {
  return {
    instanceId: "inst-new",
    workspaceId: "ws-new",
    session: {
      id: "oc-new-session",
      title: "Refactor auth",
      directory: "/home/user/project-worktrees/refactor-auth",
      projectID: "proj-1",
      version: "1",
      time: { created: 1700000000, updated: 1700000001 },
    },
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

const baseOpts = {
  directory: "/home/user/project",
  title: "Refactor auth module",
  branch: "weave/refactor-auth-module",
  initialPrompt: "# Task: Refactor auth\n\nPlease refactor the auth module.",
};

// ─── Hook tests ───────────────────────────────────────────────────────────────

describe("useSpawnSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns initial idle state", () => {
    const { result } = renderHook(() => useSpawnSession());

    expect(result.current.isSpawning).toBe(false);
    expect(result.current.error).toBeUndefined();
    expect(typeof result.current.spawnSession).toBe("function");
    expect(typeof result.current.clearError).toBe("function");
  });

  it("sets isSpawning to true during the call", async () => {
    let resolveApiFetch!: (value: Response) => void;
    const pendingFetch = new Promise<Response>((resolve) => {
      resolveApiFetch = resolve;
    });
    mockApiFetch.mockReturnValue(pendingFetch);

    const { result } = renderHook(() => useSpawnSession());

    let spawnPromise!: Promise<unknown>;
    act(() => {
      spawnPromise = result.current.spawnSession(baseOpts);
    });

    await waitFor(() => {
      expect(result.current.isSpawning).toBe(true);
    });

    await act(async () => {
      resolveApiFetch(makeOkResponse(makeCreateResponse()));
      await spawnPromise;
    });
  });

  it("clears isSpawning after successful spawn", async () => {
    mockApiFetch.mockResolvedValue(makeOkResponse(makeCreateResponse()));

    const { result } = renderHook(() => useSpawnSession());

    await act(async () => {
      await result.current.spawnSession(baseOpts);
    });

    expect(result.current.isSpawning).toBe(false);
    expect(result.current.error).toBeUndefined();
  });

  it("returns the deserialized create-session response on success", async () => {
    const createResponse = makeCreateResponse();
    mockApiFetch.mockResolvedValue(makeOkResponse(createResponse));

    const { result } = renderHook(() => useSpawnSession());

    let returnValue: unknown;
    await act(async () => {
      returnValue = await result.current.spawnSession(baseOpts);
    });

    expect(returnValue).toEqual(createResponse);
  });

  it("always sends isolationStrategy: 'worktree' in the request body", async () => {
    mockApiFetch.mockResolvedValue(makeOkResponse(makeCreateResponse()));

    const { result } = renderHook(() => useSpawnSession());
    await act(async () => {
      await result.current.spawnSession(baseOpts);
    });

    const [, fetchInit] = mockApiFetch.mock.calls[0];
    const body = JSON.parse((fetchInit as RequestInit).body as string);
    expect(body.isolationStrategy).toBe("worktree");
  });

  it("sends the correct payload shape", async () => {
    mockApiFetch.mockResolvedValue(makeOkResponse(makeCreateResponse()));

    const { result } = renderHook(() => useSpawnSession());
    await act(async () => {
      await result.current.spawnSession(baseOpts);
    });

    expect(mockApiFetch).toHaveBeenCalledWith(
      "/api/sessions",
      expect.objectContaining({ method: "POST" })
    );

    const [, fetchInit] = mockApiFetch.mock.calls[0];
    const body = JSON.parse((fetchInit as RequestInit).body as string);
    expect(body).toMatchObject({
      directory: baseOpts.directory,
      title: baseOpts.title,
      branch: baseOpts.branch,
      initialPrompt: baseOpts.initialPrompt,
      isolationStrategy: "worktree",
    });
  });

  it("sets error and clears isSpawning when the response is not ok", async () => {
    mockApiFetch.mockResolvedValue(makeErrorResponse(400, "Branch already exists"));

    const { result } = renderHook(() => useSpawnSession());

    await act(async () => {
      await result.current.spawnSession(baseOpts).catch(() => {});
    });

    expect(result.current.error).toBe("Branch already exists");
    expect(result.current.isSpawning).toBe(false);
  });

  it("sets error and clears isSpawning when apiFetch throws", async () => {
    mockApiFetch.mockRejectedValue(new Error("Network failure"));

    const { result } = renderHook(() => useSpawnSession());

    await act(async () => {
      await result.current.spawnSession(baseOpts).catch(() => {});
    });

    expect(result.current.error).toBe("Network failure");
    expect(result.current.isSpawning).toBe(false);
  });

  it("uses a generic error message for non-Error throws", async () => {
    mockApiFetch.mockRejectedValue("string error");

    const { result } = renderHook(() => useSpawnSession());

    await act(async () => {
      await result.current.spawnSession(baseOpts).catch(() => {});
    });

    expect(result.current.error).toBe("Failed to spawn session");
  });

  it("clears error at the start of a new spawnSession call", async () => {
    mockApiFetch.mockResolvedValueOnce(makeErrorResponse(500, "Server error"));
    const { result } = renderHook(() => useSpawnSession());
    await act(async () => {
      await result.current.spawnSession(baseOpts).catch(() => {});
    });
    expect(result.current.error).toBe("Server error");

    mockApiFetch.mockResolvedValueOnce(makeOkResponse(makeCreateResponse()));
    await act(async () => {
      await result.current.spawnSession(baseOpts);
    });

    expect(result.current.error).toBeUndefined();
  });

  it("clears error when clearError is called", async () => {
    mockApiFetch.mockResolvedValue(makeErrorResponse(404, "Not found"));

    const { result } = renderHook(() => useSpawnSession());
    await act(async () => {
      await result.current.spawnSession(baseOpts).catch(() => {});
    });
    expect(result.current.error).toBe("Not found");

    act(() => {
      result.current.clearError();
    });

    expect(result.current.error).toBeUndefined();
  });
});
