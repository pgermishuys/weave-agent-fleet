import { existsSync } from "fs";
import { join } from "path";

export type InstallFlavor = "standalone" | "tauri" | "web";
export type StandalonePlatform = "posix" | "windows";

/**
 * Launcher -> server restart contract for standalone self-update handoff.
 *
 * Launchers must export these environment variables before starting Node:
 * - WEAVE_INSTALL_FLAVOR=standalone
 * - WEAVE_STANDALONE_CAN_SELF_UPDATE=1
 * - WEAVE_STANDALONE_INSTALL_DIR=<absolute install dir>
 * - WEAVE_STANDALONE_LAUNCHER_PATH=<absolute launcher path>
 * - WEAVE_STANDALONE_PORT=<resolved listen port>
 * - WEAVE_STANDALONE_HOSTNAME=<resolved hostname>
 * - WEAVE_STANDALONE_PLATFORM=posix|windows
 */
export interface StandaloneRestartContext {
  installDir: string;
  launcherPath: string;
  port: number;
  hostname: string;
  platform: StandalonePlatform;
}

export interface InstallRuntimeMetadata {
  installFlavor: InstallFlavor;
  canSelfUpdate: boolean;
  standaloneContext: StandaloneRestartContext | null;
}

function readEnv(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function parsePort(value: string | null): number | null {
  if (!value) return null;
  if (!/^\d+$/.test(value)) return null;
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : null;
}

function normalizeHost(host: string): string {
  const trimmed = host.trim();
  if (trimmed.startsWith("[")) {
    const endBracket = trimmed.indexOf("]");
    return endBracket >= 0 ? trimmed.slice(1, endBracket).toLowerCase() : trimmed.toLowerCase();
  }

  const colonCount = (trimmed.match(/:/g) ?? []).length;
  if (colonCount > 1) {
    return trimmed.toLowerCase();
  }

  return trimmed.split(":")[0].toLowerCase();
}

function isLoopbackHost(host: string): boolean {
  const normalized = normalizeHost(host);
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
}

function resolveStandaloneContext(): StandaloneRestartContext | null {
  const flavor = readEnv("WEAVE_INSTALL_FLAVOR");
  const canSelfUpdate = readEnv("WEAVE_STANDALONE_CAN_SELF_UPDATE");
  if (flavor !== "standalone" || canSelfUpdate !== "1") {
    return null;
  }

  const installDir = readEnv("WEAVE_STANDALONE_INSTALL_DIR");
  const launcherPath = readEnv("WEAVE_STANDALONE_LAUNCHER_PATH");
  const hostname = readEnv("WEAVE_STANDALONE_HOSTNAME");
  const port = parsePort(readEnv("WEAVE_STANDALONE_PORT"));
  const platform = readEnv("WEAVE_STANDALONE_PLATFORM");

  if (!installDir || !launcherPath || !hostname || !port) {
    return null;
  }

  if (platform !== "posix" && platform !== "windows") {
    return null;
  }

  return {
    installDir,
    launcherPath,
    port,
    hostname,
    platform,
  };
}

function isTauriRuntime(): boolean {
  return Boolean(
    process.env.TAURI_ENV_PLATFORM || process.env.TAURI_ENV_ARCH || process.env.TAURI_ENV_DEBUG,
  );
}

export function getInstallRuntimeMetadata(): InstallRuntimeMetadata {
  const standaloneContext = resolveStandaloneContext();
  if (standaloneContext) {
    return {
      installFlavor: "standalone",
      canSelfUpdate: isLoopbackHost(standaloneContext.hostname),
      standaloneContext,
    };
  }

  if (isTauriRuntime()) {
    return {
      installFlavor: "tauri",
      canSelfUpdate: false,
      standaloneContext: null,
    };
  }

  // Production Node server launched without standalone contract variables.
  // Includes `weave-fleet` web installs served from source and dev server runs.
  if (!existsSync(join(process.cwd(), "VERSION"))) {
    return {
      installFlavor: "web",
      canSelfUpdate: false,
      standaloneContext: null,
    };
  }

  return {
    installFlavor: "web",
    canSelfUpdate: false,
    standaloneContext: null,
  };
}
