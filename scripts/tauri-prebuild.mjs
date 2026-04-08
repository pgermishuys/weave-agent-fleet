#!/usr/bin/env node
// scripts/tauri-prebuild.mjs
// Pre-build script for Tauri desktop builds.
// Orchestrates: Next.js build → assemble standalone → download Node.js → prepare sidecar

import { execSync, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
  chmodSync,
  createWriteStream,
  unlinkSync,
} from "node:fs";
import { createReadStream } from "node:fs";
import { get as httpsGet } from "node:https";
import { join, resolve, dirname } from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, "..");

// ---------------------------------------------------------------------------
// Environment cleanup
// ---------------------------------------------------------------------------
// __NEXT_PRIVATE_STANDALONE_CONFIG is set by `next start` in standalone mode
// and leaks into child processes. If present during `next build`, it causes
// the config to be JSON-parsed (stripping function properties like
// generateBuildId), which breaks the build. Always clear it.
delete process.env.__NEXT_PRIVATE_STANDALONE_CONFIG;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function log(msg) {
  console.log(`[tauri-prebuild] ${msg}`);
}

function run(cmd, opts = {}) {
  log(`> ${cmd}`);
  execSync(cmd, { stdio: "inherit", cwd: PROJECT_ROOT, ...opts });
}

/** Download a URL to a file, following redirects. */
function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = createWriteStream(dest);
    const request = (url) => {
      httpsGet(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          file.close();
          request(res.headers.location);
          return;
        }
        if (res.statusCode !== 200) {
          file.close();
          reject(new Error(`Download failed: HTTP ${res.statusCode} for ${url}`));
          return;
        }
        pipeline(res, file).then(resolve).catch(reject);
      }).on("error", (err) => {
        file.close();
        reject(err);
      });
    };
    request(url);
  });
}

/** Fetch text content from a URL, following redirects. */
function fetchText(url) {
  return new Promise((resolve, reject) => {
    const request = (url) => {
      httpsGet(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          request(res.headers.location);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`Fetch failed: HTTP ${res.statusCode} for ${url}`));
          return;
        }
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => resolve(data));
      }).on("error", reject);
    };
    request(url);
  });
}

/** Compute SHA-256 hash of a file. */
async function sha256File(filePath) {
  const hash = createHash("sha256");
  const stream = createReadStream(filePath);
  for await (const chunk of stream) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const nodeVersion = readFileSync(join(PROJECT_ROOT, ".node-version"), "utf-8").trim();
const pkg = JSON.parse(readFileSync(join(PROJECT_ROOT, "package.json"), "utf-8"));
const updateChannel = process.env.WEAVE_UPDATE_CHANNEL === "dev" ? "dev" : "stable";
const devBuildId = process.env.WEAVE_DEV_BUILD_ID || process.env.GITHUB_RUN_NUMBER || null;

// Get Rust target triple – honour TAURI_TARGET_TRIPLE when cross-compiling
// (e.g. building x86_64-apple-darwin on an ARM64 runner).
const targetTriple = (
  process.env.TAURI_TARGET_TRIPLE ||
  execFileSync("rustc", ["--print", "host-tuple"], { encoding: "utf-8" })
).trim();

log(`Node.js version: v${nodeVersion}`);
log(`Rust target triple: ${targetTriple}`);
log(`Package version: ${pkg.version}`);
log(`Update channel: ${updateChannel}`);

// Platform mapping: target triple -> Node.js dist info
const PLATFORM_MAP = {
  "x86_64-pc-windows-msvc": { platform: "win", arch: "x64", ext: ".zip", binPath: "node.exe" },
  "aarch64-pc-windows-msvc": { platform: "win", arch: "arm64", ext: ".zip", binPath: "node.exe" },
  "x86_64-apple-darwin": { platform: "darwin", arch: "x64", ext: ".tar.gz", binPath: "bin/node" },
  "aarch64-apple-darwin": { platform: "darwin", arch: "arm64", ext: ".tar.gz", binPath: "bin/node" },
  "x86_64-unknown-linux-gnu": { platform: "linux", arch: "x64", ext: ".tar.gz", binPath: "bin/node" },
  "aarch64-unknown-linux-gnu": { platform: "linux", arch: "arm64", ext: ".tar.gz", binPath: "bin/node" },
};

const platformInfo = PLATFORM_MAP[targetTriple];
if (!platformInfo) {
  console.error(`Unsupported target triple: ${targetTriple}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Step 1: Sync version from package.json to tauri.conf.json
// ---------------------------------------------------------------------------

log("Step 1: Syncing version to tauri.conf.json...");
const tauriConfPath = join(PROJECT_ROOT, "src-tauri", "tauri.conf.json");
const tauriConf = JSON.parse(readFileSync(tauriConfPath, "utf-8"));

let channelVersion = pkg.version;
if (updateChannel === "dev") {
  const rawSuffix = devBuildId || `${Date.now()}`;
  // MSI pre-release identifiers must be numeric and ≤ 65535.
  // Modulo the build ID to stay within that limit.
  const suffix = Number(rawSuffix) ? (Number(rawSuffix) % 65536) : rawSuffix;
  channelVersion = `${pkg.version}-${suffix}`;
}

const stableEndpoint =
  "https://github.com/pgermishuys/weave-agent-fleet/releases/download/v__VERSION__/latest.json";
const devEndpoint =
  "https://github.com/pgermishuys/weave-agent-fleet/releases/download/dev/latest.json";

tauriConf.version = channelVersion;
if (!tauriConf.plugins) {
  tauriConf.plugins = {};
}
if (!tauriConf.plugins.updater) {
  tauriConf.plugins.updater = {};
}
tauriConf.plugins.updater.endpoints = [
  updateChannel === "dev" ? devEndpoint : stableEndpoint,
];
writeFileSync(tauriConfPath, JSON.stringify(tauriConf, null, 2) + "\n");
log(`  Version synced: ${channelVersion}`);
log(`  Updater endpoint: ${tauriConf.plugins.updater.endpoints[0]}`);

// ---------------------------------------------------------------------------
// Step 2: Build Next.js standalone + CLI
// ---------------------------------------------------------------------------

log("Step 2: Building Next.js standalone...");
run("bun run build");
run("bun run build:cli");

// ---------------------------------------------------------------------------
// Step 3: Assemble standalone (inline, cross-platform)
// ---------------------------------------------------------------------------

log("Step 3: Assembling standalone output...");

// Find the standalone directory (may be nested under project name)
const standaloneBase = join(PROJECT_ROOT, ".next", "standalone");
let standaloneDir = null;

if (existsSync(join(standaloneBase, "server.js"))) {
  standaloneDir = standaloneBase;
} else if (existsSync(standaloneBase)) {
  for (const entry of readdirSync(standaloneBase, { withFileTypes: true })) {
    if (entry.isDirectory() && existsSync(join(standaloneBase, entry.name, "server.js"))) {
      standaloneDir = join(standaloneBase, entry.name);
      break;
    }
  }
}

if (!standaloneDir || !existsSync(join(standaloneDir, "server.js"))) {
  console.error("standalone server.js not found. Did 'next build' succeed?");
  process.exit(1);
}

log(`  Standalone dir: ${standaloneDir}`);

// Copy static assets
const staticSrc = join(PROJECT_ROOT, ".next", "static");
const staticDst = join(standaloneDir, ".next", "static");
if (existsSync(staticSrc)) {
  log("  Copying .next/static/ ...");
  mkdirSync(staticDst, { recursive: true });
  cpSync(staticSrc, staticDst, { recursive: true });
}

// Copy public assets
const publicSrc = join(PROJECT_ROOT, "public");
const publicDst = join(standaloneDir, "public");
if (existsSync(publicSrc)) {
  log("  Copying public/ ...");
  mkdirSync(publicDst, { recursive: true });
  cpSync(publicSrc, publicDst, { recursive: true });
}

// Verify better-sqlite3 native addon
const sqliteAddon = join(
  standaloneDir,
  "node_modules",
  "better-sqlite3",
  "build",
  "Release",
  "better_sqlite3.node"
);
if (!existsSync(sqliteAddon)) {
  log("  better-sqlite3 addon missing, copying from node_modules...");
  const srcAddon = join(
    PROJECT_ROOT,
    "node_modules",
    "better-sqlite3",
    "build",
    "Release",
    "better_sqlite3.node"
  );
  if (existsSync(srcAddon)) {
    mkdirSync(dirname(sqliteAddon), { recursive: true });
    copyFileSync(srcAddon, sqliteAddon);
    log("  Copied better-sqlite3 native addon.");
  } else {
    console.error("better-sqlite3 native addon not found.");
    process.exit(1);
  }
}

// Copy CLI script
const cliJs = join(PROJECT_ROOT, "cli.js");
if (existsSync(cliJs)) {
  log("  Copying cli.js ...");
  copyFileSync(cliJs, join(standaloneDir, "cli.js"));
}

// Write VERSION file
writeFileSync(join(standaloneDir, "VERSION"), channelVersion);

// ---------------------------------------------------------------------------
// Step 4: Normalize standalone to app-bundle
// ---------------------------------------------------------------------------

log("Step 4: Normalizing standalone to src-tauri/app-bundle/ ...");
const appBundleDir = join(PROJECT_ROOT, "src-tauri", "app-bundle");

// Clean and recreate
if (existsSync(appBundleDir)) {
  execSync(
    process.platform === "win32"
      ? `rmdir /s /q "${appBundleDir}"`
      : `rm -rf "${appBundleDir}"`,
    { stdio: "inherit" }
  );
}
mkdirSync(appBundleDir, { recursive: true });

// Copy standalone dir contents to app-bundle (flattened).
// Filter out directories that are not needed at runtime and would cause
// circular-copy errors (src-tauri/ contains app-bundle/ itself, .git would
// conflict, target/ is huge Rust build output, etc.).
const EXCLUDED_DIRS = new Set([
  "src-tauri",
  ".git",
  "target",
  ".github",
  ".weave",
]);
cpSync(standaloneDir, appBundleDir, {
  recursive: true,
  dereference: true, // resolve symlinks (Windows requires admin for symlink creation)
  filter: (src) => {
    // Get the path segment relative to standaloneDir
    const rel = src.slice(standaloneDir.length + 1).split(/[\\/]/)[0];
    if (EXCLUDED_DIRS.has(rel)) return false;
    return true;
  },
});
log(`  Copied to ${appBundleDir}`);

// Verify server.js is at the expected flat path
if (!existsSync(join(appBundleDir, "server.js"))) {
  console.error("server.js not found in app-bundle after normalization!");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Step 5: Download Node.js binary for sidecar
// ---------------------------------------------------------------------------

log("Step 5: Downloading Node.js binary...");

const binariesDir = join(PROJECT_ROOT, "src-tauri", "binaries");
mkdirSync(binariesDir, { recursive: true });

const { platform: nodePlatform, arch: nodeArch, ext, binPath: nodeBinPath } = platformInfo;
const archiveName = `node-v${nodeVersion}-${nodePlatform}-${nodeArch}${ext}`;
const nodeDistUrl = `https://nodejs.org/dist/v${nodeVersion}/${archiveName}`;
const archivePath = join(binariesDir, archiveName);

// Determine sidecar binary name
const isWindows = targetTriple.includes("windows");
const sidecarName = `node-${targetTriple}${isWindows ? ".exe" : ""}`;
const sidecarPath = join(binariesDir, sidecarName);

if (existsSync(sidecarPath)) {
  log(`  Sidecar binary already exists: ${sidecarName}`);
} else {
  // Download archive
  log(`  Downloading ${nodeDistUrl} ...`);
  await download(nodeDistUrl, archivePath);

  // Verify checksum
  log("  Verifying SHA-256 checksum...");
  const shaUrl = `https://nodejs.org/dist/v${nodeVersion}/SHASUMS256.txt`;
  const shaText = await fetchText(shaUrl);
  const expectedHash = shaText
    .split("\n")
    .find((line) => line.includes(archiveName))
    ?.split(/\s+/)[0];

  if (!expectedHash) {
    console.error(`Could not find checksum for ${archiveName} in SHASUMS256.txt`);
    process.exit(1);
  }

  const actualHash = await sha256File(archivePath);
  if (actualHash !== expectedHash) {
    console.error(`Checksum mismatch!\n  Expected: ${expectedHash}\n  Actual:   ${actualHash}`);
    unlinkSync(archivePath);
    process.exit(1);
  }
  log("  Checksum verified ✓");

  // Extract the node binary
  log("  Extracting node binary...");
  const folderPrefix = `node-v${nodeVersion}-${nodePlatform}-${nodeArch}`;

  if (ext === ".zip") {
    // Windows: use PowerShell to extract
    const extractDir = join(binariesDir, "_extract");
    mkdirSync(extractDir, { recursive: true });
    execSync(
      `powershell -NoProfile -Command "Expand-Archive -Path '${archivePath}' -DestinationPath '${extractDir}' -Force"`,
      { stdio: "inherit" }
    );
    const nodeBin = join(extractDir, folderPrefix, nodeBinPath);
    copyFileSync(nodeBin, sidecarPath);
    // Clean up extract dir
    execSync(`rmdir /s /q "${extractDir}"`, { stdio: "inherit" });
  } else {
    // macOS/Linux: use tar
    execSync(`tar -xzf "${archivePath}" -C "${binariesDir}" "${folderPrefix}/${nodeBinPath}"`, {
      stdio: "inherit",
    });
    const nodeBin = join(binariesDir, folderPrefix, nodeBinPath);
    copyFileSync(nodeBin, sidecarPath);
    chmodSync(sidecarPath, 0o755);
    // Clean up extracted folder
    execSync(`rm -rf "${join(binariesDir, folderPrefix)}"`, { stdio: "inherit" });
  }

  // Clean up archive
  unlinkSync(archivePath);
  log(`  Sidecar binary ready: ${sidecarName}`);
}

// ---------------------------------------------------------------------------
// Step 6: Create frontend-dist placeholder
// ---------------------------------------------------------------------------

log("Step 6: Creating frontend-dist placeholder...");
const frontendDistDir = join(PROJECT_ROOT, "src-tauri", "frontend-dist");
mkdirSync(frontendDistDir, { recursive: true });
writeFileSync(
  join(frontendDistDir, "index.html"),
  `<!DOCTYPE html>
<html><head><title>Loading...</title></head>
<body><p>Loading Weave Fleet...</p></body></html>
`
);

// ---------------------------------------------------------------------------
// Done
// ---------------------------------------------------------------------------

log("Pre-build complete! Ready for 'tauri build'.");
log(`  Sidecar: ${sidecarPath}`);
log(`  App bundle: ${appBundleDir}`);
log(`  Frontend dist: ${frontendDistDir}`);
