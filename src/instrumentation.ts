/**
 * Next.js instrumentation hook — runs once when the server starts.
 * https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 *
 * Token bootstrap: ensures WEAVE_AUTH_TOKEN is set in the process environment
 * before any runtime (Node.js or Edge) loads token-auth.ts. Without this,
 * each runtime would generate its own random token — the proxy would print one
 * login URL but the login API would validate against a different token → always 401.
 *
 * This complements the launcher scripts (launcher.sh / launcher.cmd) which set
 * the token for production. This handles:
 *   - `bun run dev` / `next dev` (no launcher)
 *   - Launcher failures (e.g. broken PowerShell on older Windows)
 */
export async function register() {
  // Bootstrap auth token BEFORE any runtime loads token-auth.ts.
  // The Node.js runtime runs register() first; the Edge runtime (middleware)
  // inherits the same process.env since they share the same OS process.
  if (!process.env.WEAVE_AUTH_TOKEN) {
    if (process.env.NEXT_RUNTIME === "nodejs") {
      // Node.js runtime: use Node.js crypto for reliable random generation
      const { randomBytes } = await import("crypto");
      process.env.WEAVE_AUTH_TOKEN = randomBytes(16).toString("hex");
    } else {
      // Edge runtime fallback: use Web Crypto API
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      process.env.WEAVE_AUTH_TOKEN = Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    }
  }

  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { checkForUpdatesOnStartup } = await import("@/lib/server/version-check");
    checkForUpdatesOnStartup();
  }
}
