/**
 * Server-side tool detection.
 *
 * Probes the host system to determine which tools from the registry
 * are actually installed. Results are cached in-memory with a TTL.
 *
 * Platform strategies:
 *   - Windows : `where.exe <binary>` (checks PATH + PATHEXT)
 *   - macOS   : `which <binary>` for CLI + /Applications/<name>.app for GUI
 *   - Linux   : `which <binary>`
 */

import { execFile } from "child_process";
import { existsSync } from "fs";
import { join } from "path";
import {
  BUILTIN_TOOLS,
  type ToolDefinition,
  type PlatformId,
} from "./tool-registry";

// ── Cache ───────────────────────────────────────────────────────────────────

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

let cachedResult: ToolDefinition[] | null = null;
let cacheTimestamp = 0;

/** Force the next `detectInstalledTools` call to re-scan. */
export function invalidateDetectionCache(): void {
  cachedResult = null;
  cacheTimestamp = 0;
}

// ── Detection primitives ────────────────────────────────────────────────────

const DETECT_TIMEOUT_MS = 2_000;

/**
 * Run a command and resolve `true` if it exits 0, `false` otherwise.
 * Rejects are caught and treated as "not found".
 */
function probe(command: string, args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    const child = execFile(command, args, { timeout: DETECT_TIMEOUT_MS }, (err) => {
      resolve(!err);
    });
    // Safety: if the child somehow hangs beyond the timeout, kill it.
    child.unref?.();
  });
}

/** Check if a binary is on PATH using the platform-appropriate command. */
function isBinaryOnPath(binary: string, platform: PlatformId): Promise<boolean> {
  if (platform === "win32") {
    return probe("where.exe", [binary]);
  }
  // macOS & Linux
  return probe("which", [binary]);
}

/** Check if a macOS .app bundle exists in /Applications. */
function isMacAppInstalled(appName: string): boolean {
  return existsSync(join("/Applications", `${appName}.app`));
}

// ── Main detection ──────────────────────────────────────────────────────────

/**
 * Detect which builtin tools are installed on the current system.
 *
 * - Tools with `alwaysAvailable: true` are included unconditionally
 *   (as long as they have a platform entry for the current OS).
 * - Other tools are probed via binary lookup / app bundle check.
 * - Results are cached for `CACHE_TTL_MS`.
 */
export async function detectInstalledTools(): Promise<ToolDefinition[]> {
  // Return cache if still fresh
  if (cachedResult && Date.now() - cacheTimestamp < CACHE_TTL_MS) {
    return cachedResult;
  }

  const platform = process.platform as PlatformId;

  // Filter to tools that have a config for this platform
  const candidates = BUILTIN_TOOLS.filter((t) => t.platforms[platform]);

  // Build detection promises
  const checks = candidates.map(async (tool): Promise<ToolDefinition | null> => {
    // Always-available tools skip detection
    if (tool.alwaysAvailable) return tool;

    // macOS: check .app bundles first (fast, no subprocess)
    if (platform === "darwin" && tool.detectMacApps?.length) {
      for (const appName of tool.detectMacApps) {
        if (isMacAppInstalled(appName)) return tool;
      }
    }

    // Check binaries on PATH
    const binaries = tool.detectBinaries?.[platform];
    if (binaries?.length) {
      // Probe all binaries in parallel — any hit is sufficient
      const results = await Promise.allSettled(
        binaries.map((bin) => isBinaryOnPath(bin, platform))
      );
      for (const r of results) {
        if (r.status === "fulfilled" && r.value) return tool;
      }
    }

    // macOS fallback: if no detectBinaries and no detectMacApps,
    // try deriving the binary from the platform command
    if (platform === "darwin" && !binaries?.length && !tool.detectMacApps?.length) {
      const cmd = tool.platforms.darwin;
      if (cmd && cmd.command !== "open") {
        const found = await isBinaryOnPath(cmd.command, platform);
        if (found) return tool;
      }
    }

    // Linux/Windows fallback: derive binary from platform command
    if (platform !== "darwin" && !binaries?.length) {
      const cmd = tool.platforms[platform];
      if (cmd) {
        const found = await isBinaryOnPath(cmd.command, platform);
        if (found) return tool;
      }
    }

    return null;
  });

  const results = await Promise.allSettled(checks);
  const detected: ToolDefinition[] = [];
  for (const r of results) {
    if (r.status === "fulfilled" && r.value) {
      detected.push(r.value);
    }
  }

  // Update cache
  cachedResult = detected;
  cacheTimestamp = Date.now();

  return detected;
}
