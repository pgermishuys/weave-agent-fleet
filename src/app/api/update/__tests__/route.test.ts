import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockGetInstallRuntimeMetadata,
  mockGetStandaloneUpdateStatus,
  mockScheduleStandaloneUpdate,
} = vi.hoisted(() => ({
  mockGetInstallRuntimeMetadata: vi.fn(),
  mockGetStandaloneUpdateStatus: vi.fn(),
  mockScheduleStandaloneUpdate: vi.fn(),
}));

vi.mock("@/lib/server/standalone-update-state", () => ({
  getInstallRuntimeMetadata: mockGetInstallRuntimeMetadata,
}));

vi.mock("@/lib/server/standalone-updater", () => ({
  getStandaloneUpdateStatus: mockGetStandaloneUpdateStatus,
  scheduleStandaloneUpdate: mockScheduleStandaloneUpdate,
}));

import { GET, POST } from "../route";

describe("/api/update route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetInstallRuntimeMetadata.mockReturnValue({
      installFlavor: "standalone",
      canSelfUpdate: true,
      standaloneContext: {
        installDir: "/tmp/weave",
        launcherPath: "/tmp/weave/bin/weave-fleet",
        port: 3000,
        hostname: "0.0.0.0",
        platform: "posix",
      },
    });
  });

  it("returns durable status in standalone mode", async () => {
    mockGetStandaloneUpdateStatus.mockReturnValue({
      mode: "standalone",
      state: "idle",
      channel: null,
      targetVersion: null,
      currentVersion: "0.11.3",
      error: null,
      startedAt: null,
      updatedAt: "2026-01-01T00:00:00.000Z",
      reconnectHint: null,
    });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.state).toBe("idle");
  });

  it("rejects requests outside standalone mode", async () => {
    mockGetInstallRuntimeMetadata.mockReturnValue({
      installFlavor: "web",
      canSelfUpdate: false,
      standaloneContext: null,
    });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toMatch(/unavailable/i);
  });

  it("validates channel on schedule request", async () => {
    const response = await POST(
      new Request("http://localhost/api/update", {
        method: "POST",
        headers: {
          origin: "http://localhost",
        },
        body: JSON.stringify({ channel: "beta" }),
      }),
    );

    expect(response.status).toBe(400);
  });

  it("schedules update and returns accepted", async () => {
    mockScheduleStandaloneUpdate.mockReturnValue({
      mode: "standalone",
      state: "stopping",
      channel: "dev",
      targetVersion: null,
      currentVersion: "0.11.3",
      error: null,
      startedAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:01.000Z",
      reconnectHint: "Server will restart while update installs.",
    });

    const response = await POST(
      new Request("http://localhost/api/update", {
        method: "POST",
        headers: {
          origin: "http://localhost",
        },
        body: JSON.stringify({ channel: "dev" }),
      }),
    );

    const body = await response.json();
    expect(response.status).toBe(202);
    expect(body.state).toBe("stopping");
    expect(mockScheduleStandaloneUpdate).toHaveBeenCalledWith("dev");
  });

  it("rejects non-loopback callers for update scheduling", async () => {
    const response = await POST(
      new Request("http://192.168.1.10/api/update", {
        method: "POST",
        headers: {
          origin: "http://192.168.1.10",
        },
        body: JSON.stringify({ channel: "dev" }),
      }),
    );

    const body = await response.json();
    expect(response.status).toBe(403);
    expect(body.error).toMatch(/local browser sessions/i);
    expect(mockScheduleStandaloneUpdate).not.toHaveBeenCalled();
  });

  it("rejects forwarded non-loopback callers for update scheduling", async () => {
    const response = await POST(
      new Request("http://localhost/api/update", {
        method: "POST",
        headers: {
          origin: "http://localhost",
          "x-forwarded-for": "203.0.113.10",
        },
        body: JSON.stringify({ channel: "dev" }),
      }),
    );

    expect(response.status).toBe(403);
    expect(mockScheduleStandaloneUpdate).not.toHaveBeenCalled();
  });

  it("rejects cross-origin callers for update scheduling", async () => {
    const response = await POST(
      new Request("http://localhost/api/update", {
        method: "POST",
        headers: {
          origin: "https://evil.example",
        },
        body: JSON.stringify({ channel: "dev" }),
      }),
    );

    const body = await response.json();
    expect(response.status).toBe(403);
    expect(body.error).toMatch(/same-origin/i);
    expect(mockScheduleStandaloneUpdate).not.toHaveBeenCalled();
  });

  it("rejects requests missing browser origin headers", async () => {
    const response = await POST(
      new Request("http://localhost/api/update", {
        method: "POST",
        body: JSON.stringify({ channel: "dev" }),
      }),
    );

    const body = await response.json();
    expect(response.status).toBe(403);
    expect(body.error).toMatch(/same-origin/i);
    expect(mockScheduleStandaloneUpdate).not.toHaveBeenCalled();
  });
});
