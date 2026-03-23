import { afterEach, describe, expect, it } from "vitest";
import { getInstallRuntimeMetadata } from "@/lib/server/standalone-update-state";

const ENV_KEYS = [
  "WEAVE_INSTALL_FLAVOR",
  "WEAVE_STANDALONE_CAN_SELF_UPDATE",
  "WEAVE_STANDALONE_INSTALL_DIR",
  "WEAVE_STANDALONE_LAUNCHER_PATH",
  "WEAVE_STANDALONE_PORT",
  "WEAVE_STANDALONE_HOSTNAME",
  "WEAVE_STANDALONE_PLATFORM",
  "TAURI_ENV_PLATFORM",
  "TAURI_ENV_ARCH",
  "TAURI_ENV_DEBUG",
] as const;

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  for (const key of ENV_KEYS) {
    if (!(key in ORIGINAL_ENV)) {
      delete process.env[key];
    }
  }
});

describe("getInstallRuntimeMetadata", () => {
  it("detects standalone metadata from launcher contract env vars", () => {
    process.env.WEAVE_INSTALL_FLAVOR = "standalone";
    process.env.WEAVE_STANDALONE_CAN_SELF_UPDATE = "1";
    process.env.WEAVE_STANDALONE_INSTALL_DIR = "/tmp/weave";
    process.env.WEAVE_STANDALONE_LAUNCHER_PATH = "/tmp/weave/bin/weave-fleet";
    process.env.WEAVE_STANDALONE_PORT = "3000";
    process.env.WEAVE_STANDALONE_HOSTNAME = "127.0.0.1";
    process.env.WEAVE_STANDALONE_PLATFORM = "posix";

    const metadata = getInstallRuntimeMetadata();

    expect(metadata.installFlavor).toBe("standalone");
    expect(metadata.canSelfUpdate).toBe(true);
    expect(metadata.standaloneContext).toEqual({
      installDir: "/tmp/weave",
      launcherPath: "/tmp/weave/bin/weave-fleet",
      port: 3000,
      hostname: "127.0.0.1",
      platform: "posix",
    });
  });

  it("falls back to tauri flavor when tauri env vars are present", () => {
    process.env.TAURI_ENV_PLATFORM = "darwin";

    const metadata = getInstallRuntimeMetadata();

    expect(metadata.installFlavor).toBe("tauri");
    expect(metadata.canSelfUpdate).toBe(false);
    expect(metadata.standaloneContext).toBeNull();
  });

  it("disables self-update when standalone server is not loopback-bound", () => {
    process.env.WEAVE_INSTALL_FLAVOR = "standalone";
    process.env.WEAVE_STANDALONE_CAN_SELF_UPDATE = "1";
    process.env.WEAVE_STANDALONE_INSTALL_DIR = "/tmp/weave";
    process.env.WEAVE_STANDALONE_LAUNCHER_PATH = "/tmp/weave/bin/weave-fleet";
    process.env.WEAVE_STANDALONE_PORT = "3000";
    process.env.WEAVE_STANDALONE_HOSTNAME = "0.0.0.0";
    process.env.WEAVE_STANDALONE_PLATFORM = "posix";

    const metadata = getInstallRuntimeMetadata();

    expect(metadata.installFlavor).toBe("standalone");
    expect(metadata.canSelfUpdate).toBe(false);
    expect(metadata.standaloneContext?.hostname).toBe("0.0.0.0");
  });
});
