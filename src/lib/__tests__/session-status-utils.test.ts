import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchSessionStatus } from "@/lib/session-status-utils";

// ─── Mock apiFetch ────────────────────────────────────────────────────────────

const mockApiFetch = vi.fn();
vi.mock("@/lib/api-client", () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("fetchSessionStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("ReturnsBusyWhenApiRespondsBusy", async () => {
    mockApiFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ status: "busy" }),
    });

    const result = await fetchSessionStatus("sess-1", "inst-abc");

    expect(result).toBe("busy");
    expect(mockApiFetch).toHaveBeenCalledWith(
      "/api/sessions/sess-1/status?instanceId=inst-abc",
      undefined,
      undefined
    );
  });

  it("ReturnsIdleWhenApiRespondsIdle", async () => {
    mockApiFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ status: "idle" }),
    });

    const result = await fetchSessionStatus("sess-1", "inst-abc");

    expect(result).toBe("idle");
  });

  it("ReturnsIdleWhenApiReturnsNon200", async () => {
    mockApiFetch.mockResolvedValue({
      ok: false,
      status: 404,
    });

    const result = await fetchSessionStatus("sess-1", "inst-abc");

    expect(result).toBe("idle");
  });

  it("ReturnsIdleWhenFetchThrows", async () => {
    mockApiFetch.mockRejectedValue(new Error("Network error"));

    const result = await fetchSessionStatus("sess-1", "inst-abc");

    expect(result).toBe("idle");
  });

  it("ReturnsIdleWhenApiReturnsUnexpectedStatus", async () => {
    mockApiFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ status: "unknown_value" }),
    });

    const result = await fetchSessionStatus("sess-1", "inst-abc");

    expect(result).toBe("idle");
  });

  it("ReturnsIdleWhenApiReturnsEmptyObject", async () => {
    mockApiFetch.mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });

    const result = await fetchSessionStatus("sess-1", "inst-abc");

    expect(result).toBe("idle");
  });

  it("EncodesSessionIdAndInstanceIdInUrl", async () => {
    mockApiFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ status: "idle" }),
    });

    await fetchSessionStatus("sess/with spaces", "inst&special");

    expect(mockApiFetch).toHaveBeenCalledWith(
      "/api/sessions/sess%2Fwith%20spaces/status?instanceId=inst%26special",
      undefined,
      undefined
    );
  });

  it("ForwardsConnectionIdToApiFetch", async () => {
    mockApiFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ status: "busy" }),
    });

    await fetchSessionStatus("sess-1", "inst-abc", "conn-remote-1");

    expect(mockApiFetch).toHaveBeenCalledWith(
      "/api/sessions/sess-1/status?instanceId=inst-abc",
      undefined,
      "conn-remote-1"
    );
  });
});
