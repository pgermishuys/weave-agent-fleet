import type { NextConfig } from "next";
import { execSync } from "child_process";
import { randomBytes } from "crypto";
import packageJson from "./package.json" with { type: "json" };

function getGitCommitSha(): string {
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf-8" }).trim();
  } catch {
    return "unknown";
  }
}

function getAppVersion(): string {
  // CI sets APP_VERSION from the git tag (e.g. "v0.4.0" → "0.4.0")
  if (process.env.APP_VERSION) {
    return process.env.APP_VERSION.replace(/^v/, "");
  }
  // Fallback to package.json for local dev
  return packageJson.version;
}

// ── Auth token bootstrap ──────────────────────────────────────────────────────
// Ensure WEAVE_AUTH_TOKEN is always set in the process environment before any
// Next.js runtime (Node.js or Edge) loads token-auth.ts.
//
// Why here? Next.js runs proxy (Edge Runtime) and API routes (Node.js Runtime)
// in separate module contexts. If each context generates its own random token,
// the proxy prints one login URL but the login API validates against a different
// token → always 401. Setting the env var here (in next.config.ts, which runs
// once in the main process before workers are created) ensures all runtimes
// see the same token.
//
// The launcher scripts (launcher.sh / launcher.cmd) already set WEAVE_AUTH_TOKEN
// for production. This handles the `bun run dev` / `next dev` case.
if (!process.env.WEAVE_AUTH_TOKEN) {
  process.env.WEAVE_AUTH_TOKEN = randomBytes(16).toString("hex");
}

const nextConfig: NextConfig = {
  output: 'standalone',
  compress: true,
  // Allow any local-network device (e.g. phone on Tailscale / LAN) to use HMR
  allowedDevOrigins: ["100.*.*.*", "192.168.*.*", "10.*.*.*", "172.*.*.*"],
  serverExternalPackages: ["@opencode-ai/sdk", "better-sqlite3"],
  env: {
    NEXT_PUBLIC_APP_VERSION: getAppVersion(),
    NEXT_PUBLIC_COMMIT_SHA: getGitCommitSha(),
    // NEXT_PUBLIC_WEAVE_PROFILE — baked at build time as fallback; the
    // /api/profile endpoint provides the authoritative runtime value.
    NEXT_PUBLIC_WEAVE_PROFILE: process.env.WEAVE_PROFILE || "default",
    // NEXT_PUBLIC_API_BASE_URL — set at build time to point the frontend at
    // an external API server (e.g. "http://localhost:3000"). When unset or
    // empty, all fetch calls use relative URLs (same-origin / standalone mode).
    // See also: .env.development.split for split-mode dev setup.
  },
};

export default nextConfig;
