/**
 * `weave-fleet serve` — starts the Fleet API server in standalone mode.
 *
 * This module handles token lifecycle and spawns the Next.js server process.
 *
 * Standalone startup strategy:
 *   The Next.js build produces a `server.js` at .next/standalone/server.js
 *   (assembled into the same directory as cli.js by assemble-standalone.sh).
 *   We spawn it as a Node.js child process with PORT and HOSTNAME env vars,
 *   piping stdio through so logs are visible in the terminal.
 *
 *   If running from source (development), we fall back to the project root's
 *   .next/standalone/server.js resolved relative to this module's __dirname.
 *
 * FLEET_INJECT_TOKEN:
 *   When started in monolithic mode (weave-fleet binary, not serve subcommand),
 *   the plaintext token is written to FLEET_INJECT_TOKEN so layout.tsx can
 *   inject it into the served HTML for zero-friction local auth.
 *   In standalone API-only mode (weave-fleet serve), FLEET_INJECT_TOKEN is
 *   NOT set — remote users must register via the Add Server dialog.
 *
 * FLEET_TOKEN_HASH:
 *   The bcrypt hash of the token is passed to the Next.js process via this
 *   env var so the Edge middleware can verify bearer tokens without fs calls.
 *
 * Supported env vars:
 *   FLEET_PORT           Override default port (3000)
 *   FLEET_HOST           Override default host (0.0.0.0)
 *   FLEET_NAME           Server display name (default: "Fleet Server")
 *   FLEET_DESCRIPTION    Server description (default: "")
 *   FLEET_ALLOWED_ORIGINS Comma-separated allowed CORS origins (default: "*")
 *   FLEET_AUTH_DISABLED  Set to "true" to disable auth (dev mode only)
 */

import { spawn } from "child_process";
import { existsSync, readFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";
import {
  tokenExists,
  generateAndPersistToken,
  rotateToken,
} from "@/lib/server/token-manager";
import { getTokenHashPath } from "@/cli/config-paths";

export interface ServeOptions {
  /** Port to bind (default: 3000, env: FLEET_PORT) */
  port?: number;
  /** Host to bind (default: "0.0.0.0", env: FLEET_HOST) */
  host?: string;
  /** If true, rotate the token and exit without starting the server */
  rotateToken?: boolean;
  /**
   * If true, inject the plaintext token into FLEET_INJECT_TOKEN for the
   * Next.js process (monolithic mode). Default false for standalone serve.
   */
  injectToken?: boolean;
}

/** Box-art token display — makes the one-time display unmissable. */
function printTokenBox(token: string): void {
  console.log();
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║  Fleet API Token (shown once — store it securely)           ║");
  console.log("║                                                              ║");
  console.log(`║  ${token.padEnd(60)}  ║`);
  console.log("║                                                              ║");
  console.log("║  This token is required to connect clients to this server.  ║");
  console.log("║  It will never be shown again. To rotate:                   ║");
  console.log("║    weave-fleet serve --rotate-token                         ║");
  console.log("╚══════════════════════════════════════════════════════════════╝");
  console.log();
}

/**
 * Locate the Next.js standalone server.js.
 *
 * When assembled via assemble-standalone.sh, server.js lives alongside cli.js.
 * In development (running as the bundled cli.js at the project root), it lives
 * under .next/standalone/ relative to __dirname.
 */
function findServerJs(): string {
  // Assembled standalone: server.js is next to cli.js (__dirname)
  const standaloneNext = join(__dirname, "server.js");
  if (existsSync(standaloneNext)) {
    return standaloneNext;
  }

  // Development fallback: when running the bundled cli.js from the project root,
  // __dirname IS the project root (not src/cli/). .next/standalone is a sibling.
  const projectRoot = __dirname;
  const devNext = join(projectRoot, ".next", "standalone", "server.js");
  if (existsSync(devNext)) {
    return devNext;
  }

  // Nested standalone (Turbopack): .next/standalone/<name>/server.js
  const standaloneDir = join(projectRoot, ".next", "standalone");
  if (existsSync(standaloneDir)) {
    const { readdirSync } = require("fs") as typeof import("fs");
    for (const entry of readdirSync(standaloneDir)) {
      const nested = join(standaloneDir, entry, "server.js");
      if (existsSync(nested)) {
        return nested;
      }
    }
  }

  throw new Error(
    "Could not locate Next.js standalone server.js.\n" +
      "Run `npm run build:standalone` to produce the standalone output.\n" +
      `Looked in:\n  ${standaloneNext}\n  ${devNext}`
  );
}

export async function runServe(options: ServeOptions = {}): Promise<void> {
  // ── Rotate-token path ────────────────────────────────────────────────────
  if (options.rotateToken) {
    console.log("Rotating Fleet API token...");
    const newToken = await rotateToken();
    console.log();
    console.log("Token rotated successfully.");
    printTokenBox(newToken);
    console.log("Restart the server to use the new token.");
    return;
  }

  // ── Token lifecycle ──────────────────────────────────────────────────────
  let plaintextToken: string | undefined;

  if (!tokenExists()) {
    console.log("Generating Fleet API token...");
    plaintextToken = await generateAndPersistToken();
    printTokenBox(plaintextToken);
  } else {
    console.log("Fleet API token loaded. Starting server...");
  }

  // Read the stored hash to pass to the Next.js process env.
  // The middleware reads FLEET_TOKEN_HASH to verify bearer tokens without fs.
  const hashPath = getTokenHashPath();
  let tokenHash: string | undefined;
  try {
    tokenHash = readFileSync(hashPath, { encoding: "utf8" }).trim();
  } catch (err) {
    console.error(`Warning: could not read token hash from ${hashPath}:`, err);
  }

  // ── Resolve port / host ──────────────────────────────────────────────────
  const resolvedPort = options.port ?? Number(process.env.FLEET_PORT ?? "3000");
  const resolvedHost = options.host ?? process.env.FLEET_HOST ?? "0.0.0.0";

  // ── Locate server.js ────────────────────────────────────────────────────
  const serverJs = findServerJs();

  console.log(`Starting Fleet API server on ${resolvedHost}:${resolvedPort}`);
  console.log(`  server.js: ${serverJs}`);
  console.log();

  // ── Build child process env ──────────────────────────────────────────────
  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    PORT: String(resolvedPort),
    HOSTNAME: resolvedHost,
  };

  if (tokenHash) {
    childEnv.FLEET_TOKEN_HASH = tokenHash;
  }

  // In monolithic mode, inject the plaintext token so layout.tsx can
  // embed it in the HTML for zero-friction local browser auth.
  if (options.injectToken && plaintextToken) {
    childEnv.FLEET_INJECT_TOKEN = plaintextToken;
  }

  // ── Spawn Next.js ────────────────────────────────────────────────────────
  const child = spawn("node", [serverJs], {
    env: childEnv,
    stdio: "inherit",
  });

  // Forward SIGINT / SIGTERM to the child for clean shutdown
  const forwardSignal = (signal: NodeJS.Signals) => {
    child.kill(signal);
  };
  process.on("SIGINT", () => forwardSignal("SIGINT"));
  process.on("SIGTERM", () => forwardSignal("SIGTERM"));

  child.on("exit", (code, signal) => {
    if (signal) {
      process.exit(0);
    } else {
      process.exit(code ?? 0);
    }
  });

  child.on("error", (err) => {
    console.error("Failed to start server:", err.message);
    process.exit(1);
  });
}
