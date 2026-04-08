/**
 * Token authentication module for Weave Fleet.
 *
 * Implements Aspire-style browser token authentication:
 * - Generates a 128-bit cryptographically random token at startup
 * - Requires authentication only when the server is bound to a non-localhost address
 * - Provides HMAC-signed cookies so sessions survive page reloads without server state
 * - Supports WEAVE_AUTH_TOKEN env var for deterministic tokens (automation / persistent sessions)
 *
 * Server restart behavior:
 *   - Without WEAVE_AUTH_TOKEN: a new token is generated on each restart, invalidating existing cookies.
 *   - With WEAVE_AUTH_TOKEN set: the token is stable across restarts; cookies remain valid.
 *
 * Security notes:
 *   - All token comparisons use crypto.timingSafeEqual to prevent timing attacks.
 *   - Cookie value is HMAC-SHA256(nonce, signingKey) where signingKey = HMAC-SHA256(token, purpose).
 *     This prevents cookie forgery without requiring server-side session storage.
 *   - Token is logged to the console on first use when auth is required (same pattern as Aspire).
 */

import { createHmac, randomBytes, timingSafeEqual } from "crypto";

// ─── Constants ────────────────────────────────────────────────────────────────

/** Cookie name used for browser session authentication. */
export const AUTH_COOKIE_NAME = "weave.auth";

/** Cookie max-age in seconds (3 days — matches .NET Aspire's default). */
export const AUTH_COOKIE_MAX_AGE = 3 * 24 * 60 * 60;

/** Minimum length for a user-provided WEAVE_AUTH_TOKEN (in characters). */
const MIN_TOKEN_LENGTH = 16;

/** HMAC purpose strings — domain-separated so the same token cannot be used across contexts. */
const COOKIE_SIGNING_PURPOSE = "weave-cookie-signing-key";

// ─── Module initialization ────────────────────────────────────────────────────

/**
 * Generates a 128-bit cryptographically random token encoded as 32 lowercase hex characters.
 */
function generateToken(): string {
  return randomBytes(16).toString("hex");
}

/**
 * Validates a user-provided token from WEAVE_AUTH_TOKEN.
 * Throws if the token is too short.
 */
function validateEnvToken(token: string): void {
  if (token.length < MIN_TOKEN_LENGTH) {
    throw new Error(
      `WEAVE_AUTH_TOKEN must be at least ${MIN_TOKEN_LENGTH} characters long (got ${token.length}).`
    );
  }
}

/**
 * Localhost addresses that indicate local-only binding (auth not required).
 */
const LOCALHOST_ADDRESSES = new Set(["127.0.0.1", "localhost", "::1", "0:0:0:0:0:0:0:1"]);

/** The active auth token — generated once at module load time. */
let _token: string;

const envToken = process.env.WEAVE_AUTH_TOKEN;
if (envToken) {
  validateEnvToken(envToken);
  _token = envToken;
} else {
  _token = generateToken();
}

/**
 * The HMAC signing key derived from the token, used to sign and verify cookies.
 * Derived once so the derivation cost is paid at startup, not per-request.
 */
const _signingKey = createHmac("sha256", _token)
  .update(COOKIE_SIGNING_PURPOSE)
  .digest();

/** Whether the login URL has been printed to the console (logged once). */
let _loginUrlPrinted = false;

// ─── Exported API ─────────────────────────────────────────────────────────────

/**
 * Returns true when authentication is required.
 * Auth is required when the server is bound to a non-localhost address.
 *
 * Reads the HOSTNAME env var (set by the launcher or Next.js directly).
 * Returns false for 127.0.0.1, localhost, and ::1; true for everything else
 * (e.g. 0.0.0.0, a LAN IP, a Tailscale IP).
 */
export function isAuthRequired(): boolean {
  const hostname = process.env.HOSTNAME ?? "";
  return !LOCALHOST_ADDRESSES.has(hostname);
}

/**
 * Returns the active auth token.
 * On first call when auth is required, prints the login URL to the console.
 */
export function getAuthToken(): string {
  if (isAuthRequired() && !_loginUrlPrinted) {
    _loginUrlPrinted = true;
    console.log(`\n  Access Weave Fleet at ${getLoginUrl()}\n`);
  }
  return _token;
}

/**
 * Returns the login URL with the token pre-filled as a query parameter.
 * Format: http://<HOSTNAME>:<PORT>/login?token=<token>
 */
export function getLoginUrl(): string {
  const hostname = process.env.HOSTNAME ?? "0.0.0.0";
  const port = process.env.PORT ?? "3000";
  // Use localhost in the URL when binding to 0.0.0.0 so it's clickable locally.
  const displayHost = hostname === "0.0.0.0" ? "localhost" : hostname;
  return `http://${displayHost}:${port}/login?token=${_token}`;
}

/**
 * Validates a candidate token using a timing-safe comparison.
 * Returns true only if the candidate exactly matches the active token.
 *
 * Both inputs are SHA-256 hashed before comparison so that:
 *   1. The comparison is always performed on equal-length buffers (required by timingSafeEqual).
 *   2. The HMAC output length is fixed regardless of candidate length.
 */
export function validateToken(candidate: string): boolean {
  if (typeof candidate !== "string" || candidate.length === 0) {
    return false;
  }
  try {
    // Hash both values with HMAC-SHA256 keyed with the signing key.
    // This normalises length (always 32 bytes) and preserves timing-safety.
    const expected = createHmac("sha256", _signingKey).update(_token).digest();
    const actual = createHmac("sha256", _signingKey).update(candidate).digest();
    return timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

/**
 * Creates an HMAC-signed cookie value.
 * Format: <nonce>.<hmac>
 *
 * The nonce is a random 16-byte hex string (32 chars).
 * The HMAC is HMAC-SHA256(nonce, _signingKey) encoded as hex (64 chars).
 * Total value length: 97 chars (<nonce>.<hmac>).
 */
export function createCookieValue(): string {
  const nonce = randomBytes(16).toString("hex");
  const hmac = createHmac("sha256", _signingKey).update(nonce).digest("hex");
  return `${nonce}.${hmac}`;
}

/**
 * Validates an HMAC-signed cookie value.
 * Returns true only if the cookie was created by this server instance
 * (i.e. the HMAC is valid for the nonce).
 */
export function validateCookie(cookieValue: string): boolean {
  if (typeof cookieValue !== "string" || !cookieValue.includes(".")) {
    return false;
  }
  const dotIndex = cookieValue.indexOf(".");
  const nonce = cookieValue.slice(0, dotIndex);
  const suppliedHmac = cookieValue.slice(dotIndex + 1);

  if (nonce.length === 0 || suppliedHmac.length === 0) {
    return false;
  }

  try {
    const expectedHmac = createHmac("sha256", _signingKey)
      .update(nonce)
      .digest("hex");
    const expectedBuf = Buffer.from(expectedHmac, "utf8");
    const suppliedBuf = Buffer.from(suppliedHmac, "utf8");

    // timingSafeEqual requires equal-length buffers.
    // If lengths differ, the HMAC is clearly invalid — reject immediately.
    // Note: length comparison here is safe because HMAC output length is not secret
    // (it's always 64 hex chars for SHA-256).
    if (expectedBuf.length !== suppliedBuf.length) {
      return false;
    }
    return timingSafeEqual(expectedBuf, suppliedBuf);
  } catch {
    return false;
  }
}

// ─── Internal helpers (exported for testing) ─────────────────────────────────

/** @internal Reset the login-URL-printed flag (for testing). */
export function _resetLoginUrlPrintedForTesting(): void {
  _loginUrlPrinted = false;
}

/** @internal Override the token (for testing env var scenarios only). */
export function _overrideTokenForTesting(newToken: string): void {
  _token = newToken;
}
