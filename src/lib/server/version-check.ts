import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { getInstallRuntimeMetadata, type InstallFlavor } from "@/lib/server/standalone-update-state";

const GITHUB_RELEASES_URL =
  "https://api.github.com/repos/pgermishuys/weave-agent-fleet/releases/latest";
const DEV_UPDATER_URL =
  "https://github.com/pgermishuys/weave-agent-fleet/releases/download/dev/latest.json";
const CHECK_TIMEOUT_MS = 3000;
const CACHE_DURATION_MS = 60 * 60 * 1000; // 1 hour

export type UpdateChannel = "stable" | "dev";

export interface VersionInfo {
  current: string;
  latest: string | null;
  updateAvailable: boolean;
  checkedAt: Date | null;
  installFlavor: InstallFlavor;
  canSelfUpdate: boolean;
}

const cachedVersionInfoByChannel = new Map<UpdateChannel, VersionInfo>();
const lastCheckTimeByChannel = new Map<UpdateChannel, number>();

/**
 * Returns the current version from the VERSION file (production install)
 * or package.json (dev mode). Returns null if neither is available.
 */
export function getCurrentVersion(): string | null {
  // Check VERSION file first (production/installed mode)
  const versionFilePath = join(process.cwd(), "VERSION");
  if (existsSync(versionFilePath)) {
    try {
      return readFileSync(versionFilePath, "utf-8").trim();
    } catch {
      // Fall through to package.json
    }
  }

  // Fall back to package.json
  const packageJsonPath = join(process.cwd(), "package.json");
  if (existsSync(packageJsonPath)) {
    try {
      const pkg = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
      return pkg.version || null;
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * Compares two semver version strings. Returns true if `latest` is newer than `current`.
 */
function isNewer(
  current: string,
  latest: string,
  channel: UpdateChannel,
): boolean {
  const parseSemver = (v: string) => {
    const clean = v.replace(/^v/, "");
    const [core, prerelease = ""] = clean.split("-");
    const parts = core.split(".").map(Number);
    return {
      major: parts[0] || 0,
      minor: parts[1] || 0,
      patch: parts[2] || 0,
      prerelease,
      raw: clean,
    };
  };

  const c = parseSemver(current);
  const l = parseSemver(latest);

  if (l.major !== c.major) return l.major > c.major;
  if (l.minor !== c.minor) return l.minor > c.minor;
  if (l.patch !== c.patch) return l.patch > c.patch;

  if (channel === "dev") {
    if (!c.prerelease && l.prerelease) return true;
    if (c.prerelease && !l.prerelease) return false;
    if (!c.prerelease && !l.prerelease) return false;

    const currentPre = c.prerelease.split(".");
    const latestPre = l.prerelease.split(".");
    for (let i = 0; i < Math.max(currentPre.length, latestPre.length); i += 1) {
      const currentPart = currentPre[i] ?? "";
      const latestPart = latestPre[i] ?? "";
      if (currentPart === latestPart) continue;

      const currentNum = Number(currentPart);
      const latestNum = Number(latestPart);
      if (!Number.isNaN(currentNum) && !Number.isNaN(latestNum)) {
        return latestNum > currentNum;
      }

      return latestPart > currentPart;
    }

    return false;
  }

  if (channel === "stable") {
    return Boolean(c.prerelease && !l.prerelease);
  }

  return false;
}

/**
 * Fetches the latest version from GitHub Releases API.
 * Returns null on any error (network, parse, timeout).
 */
async function fetchStableLatestVersion(): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);

    const response = await fetch(GITHUB_RELEASES_URL, {
      signal: controller.signal,
      headers: { Accept: "application/vnd.github.v3+json" },
    });

    clearTimeout(timeout);

    if (!response.ok) return null;

    const data = (await response.json()) as { tag_name?: string };
    const tagName = data.tag_name;
    if (!tagName) return null;

    return tagName.replace(/^v/, "");
  } catch {
    return null;
  }
}

async function fetchDevLatestVersion(): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);

    const response = await fetch(DEV_UPDATER_URL, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });

    clearTimeout(timeout);

    if (!response.ok) return null;

    const data = (await response.json()) as { version?: string };
    return data.version ?? null;
  } catch {
    return null;
  }
}

/**
 * Returns cached version info, fetching from GitHub if the cache is stale.
 * Never blocks — returns immediately if a check is already in progress.
 */
export async function getVersionInfo(channel: UpdateChannel = "stable"): Promise<VersionInfo> {
  const runtime = getInstallRuntimeMetadata();
  const current = getCurrentVersion();

  if (!current) {
    return {
      current: "dev",
      latest: null,
      updateAvailable: false,
      checkedAt: null,
      installFlavor: runtime.installFlavor,
      canSelfUpdate: runtime.canSelfUpdate,
    };
  }

  const now = Date.now();
  const cachedInfo = cachedVersionInfoByChannel.get(channel);
  const lastCheckedAt = lastCheckTimeByChannel.get(channel) ?? 0;
  if (cachedInfo && now - lastCheckedAt < CACHE_DURATION_MS) {
    return cachedInfo;
  }

  const latest =
    channel === "dev"
      ? await fetchDevLatestVersion()
      : await fetchStableLatestVersion();
  const info: VersionInfo = {
    current,
    latest,
    updateAvailable: latest !== null && isNewer(current, latest, channel),
    checkedAt: new Date(),
    installFlavor: runtime.installFlavor,
    canSelfUpdate: runtime.canSelfUpdate,
  };

  cachedVersionInfoByChannel.set(channel, info);
  lastCheckTimeByChannel.set(channel, now);

  return info;
}

/**
 * Fire-and-forget version check that logs to console if an update is available.
 * Only runs in production with a VERSION file present (i.e., installed via tarball).
 */
export function checkForUpdatesOnStartup(): void {
  // Only check in production installs (VERSION file present)
  if (process.env.NODE_ENV !== "production") return;
  if (!existsSync(join(process.cwd(), "VERSION"))) return;

  getVersionInfo()
    .then((info) => {
      if (info.updateAvailable && info.latest) {
        console.log(
          `\n  A newer version of Weave Fleet is available: v${info.latest} (current: v${info.current})` +
            `\n  Run 'weave-fleet update' to upgrade.\n`
        );
      }
    })
    .catch(() => {
      // Silently ignore — never block or crash on update check failure
    });
}
