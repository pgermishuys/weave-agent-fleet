import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockSpawnDetachedStandaloneUpdateHelper,
  mockGetInstallRuntimeMetadata,
  mockGetCurrentVersion,
} = vi.hoisted(() => ({
  mockSpawnDetachedStandaloneUpdateHelper: vi.fn(),
  mockGetInstallRuntimeMetadata: vi.fn(),
  mockGetCurrentVersion: vi.fn(),
}));

vi.mock("@/lib/server/standalone-update-helper", () => ({
  spawnDetachedStandaloneUpdateHelper: mockSpawnDetachedStandaloneUpdateHelper,
}));

vi.mock("@/lib/server/standalone-update-state", () => ({
  getInstallRuntimeMetadata: mockGetInstallRuntimeMetadata,
}));

vi.mock("@/lib/server/version-check", () => ({
  getCurrentVersion: mockGetCurrentVersion,
}));

let testHome: string;

const { mockHomedir } = vi.hoisted(() => ({
  mockHomedir: vi.fn(() => "/tmp"),
}));

vi.mock("os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("os")>();
  return {
    ...actual,
    homedir: () => mockHomedir(),
  };
});

import { getStandaloneUpdateStatus, scheduleStandaloneUpdate } from "@/lib/server/standalone-updater";

describe("standalone-updater", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    testHome = mkdtempSync(join(tmpdir(), "weave-standalone-updater-test-"));
    mockHomedir.mockReturnValue(testHome);

    mockGetCurrentVersion.mockReturnValue("0.11.3");
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
    mockSpawnDetachedStandaloneUpdateHelper.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    rmSync(testHome, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("schedules update, persists stopping state, and triggers shutdown signal", () => {
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);

    const result = scheduleStandaloneUpdate("dev");
    expect(result.state).toBe("stopping");
    expect(mockSpawnDetachedStandaloneUpdateHelper).toHaveBeenCalledTimes(1);

    const statePath = join(testHome, ".weave", "standalone-update.json");
    expect(existsSync(statePath)).toBe(true);

    const parsed = JSON.parse(readFileSync(statePath, "utf-8")) as { state: string; channel: string };
    expect(parsed.state).toBe("stopping");
    expect(parsed.channel).toBe("dev");

    vi.runAllTimers();
    expect(killSpy).toHaveBeenCalledWith(process.pid, "SIGTERM");
  });

  it("rejects concurrent schedules while active state exists", () => {
    vi.spyOn(process, "kill").mockImplementation(() => true);

    scheduleStandaloneUpdate("stable");
    expect(() => scheduleStandaloneUpdate("dev")).toThrow(/already in progress/i);
  });

  it("returns idle state when no persisted state exists", () => {
    const status = getStandaloneUpdateStatus();
    expect(status.state).toBe("idle");
    expect(status.currentVersion).toBe("0.11.3");
  });

  it("parses persisted state files with a UTF-8 BOM", () => {
    const statePath = join(testHome, ".weave", "standalone-update.json");
    const payload = [
      "\uFEFF{",
      '  "state": "completed",',
      '  "channel": "stable",',
      '  "targetVersion": null,',
      '  "error": null,',
      '  "startedAt": null,',
      '  "updatedAt": "2026-01-01T00:00:00.000Z",',
      '  "reconnectHint": null',
      "}",
    ].join("\n");

    mkdirSync(join(testHome, ".weave"), { recursive: true });
    writeFileSync(statePath, payload, "utf8");

    const status = getStandaloneUpdateStatus();
    expect(status.state).toBe("completed");
    expect(status.channel).toBe("stable");
  });
});
