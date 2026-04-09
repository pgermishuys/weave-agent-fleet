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
 *   - All token comparisons use constant-time comparison to prevent timing attacks.
 *   - Cookie value is HMAC-SHA256(nonce, signingKey) where signingKey = HMAC-SHA256(token, purpose).
 *     This prevents cookie forgery without requiring server-side session storage.
 *   - Token is logged to the console on first use when auth is required (same pattern as Aspire).
 *
 * Edge Runtime compatibility:
 *   - Uses the Web Crypto API (crypto.subtle + crypto.getRandomValues) instead of Node.js crypto.
 *   - All HMAC operations are async (Web Crypto is promise-based).
 */

// ─── Constants ────────────────────────────────────────────────────────────────

/** Cookie name used for browser session authentication. */
export const AUTH_COOKIE_NAME = "weave.auth";

/** Cookie max-age in seconds (3 days — matches .NET Aspire's default). */
export const AUTH_COOKIE_MAX_AGE = 3 * 24 * 60 * 60;

/** Minimum length for a user-provided WEAVE_AUTH_TOKEN (in characters). */
const MIN_TOKEN_LENGTH = 16;

/** HMAC purpose strings — domain-separated so the same token cannot be used across contexts. */
const COOKIE_SIGNING_PURPOSE = "weave-cookie-signing-key";

// ─── Web Crypto helpers ───────────────────────────────────────────────────────

const encoder = new TextEncoder();

/** Convert a Uint8Array to a lowercase hex string. */
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Generates a cryptographically random hex string using Web Crypto.
 * @param byteLength Number of random bytes (output hex string is 2× this length).
 */
function randomHex(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

/**
 * Computes HMAC-SHA256(data, key) using Web Crypto.
 * Returns the raw digest as a Uint8Array.
 */
async function hmacSha256(
  key: Uint8Array | string,
  data: string
): Promise<Uint8Array> {
  const keyBytes = typeof key === "string" ? encoder.encode(key) : key;
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBytes as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const dataBytes = encoder.encode(data);
  const signature = await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    dataBytes as BufferSource
  );
  return new Uint8Array(signature);
}

/**
 * Constant-time comparison of two Uint8Arrays.
 * Returns true only if they are equal in length and content.
 */
function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a[i] ^ b[i];
  }
  return result === 0;
}

// ─── Module initialization ────────────────────────────────────────────────────

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

/** The active auth token — generated once at module load time. */
let _token: string;

const envToken = process.env.WEAVE_AUTH_TOKEN;
if (envToken) {
  validateEnvToken(envToken);
  _token = envToken;
} else {
  _token = randomHex(16);
}

/**
 * The HMAC signing key derived from the token, used to sign and verify cookies.
 * Derived lazily on first use because Web Crypto is async.
 */
let _signingKeyPromise: Promise<Uint8Array> | null = null;

function getSigningKey(): Promise<Uint8Array> {
  if (!_signingKeyPromise) {
    _signingKeyPromise = hmacSha256(_token, COOKIE_SIGNING_PURPOSE);
  }
  return _signingKeyPromise;
}

/** Whether the login URL has been printed to the console (logged once). */
let _loginUrlPrinted = false;

// ─── Exported API ─────────────────────────────────────────────────────────────

/**
 * Returns true when authentication is required.
 * Auth is always required — token authentication protects all bindings
 * including localhost.
 */
export function isAuthRequired(): boolean {
  return true;
}

/**
 * Returns the active auth token.
 * On first call, prints the login URL to the console.
 */
export function getAuthToken(): string {
  if (!_loginUrlPrinted) {
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
 * Validates a candidate token using a constant-time comparison.
 * Returns true only if the candidate exactly matches the active token.
 *
 * Both inputs are HMAC-SHA256 hashed before comparison so that:
 *   1. The comparison is always performed on equal-length buffers.
 *   2. The HMAC output length is fixed regardless of candidate length.
 */
export async function validateToken(candidate: string): Promise<boolean> {
  if (typeof candidate !== "string" || candidate.length === 0) {
    return false;
  }
  try {
    const signingKey = await getSigningKey();
    const expected = await hmacSha256(signingKey, _token);
    const actual = await hmacSha256(signingKey, candidate);
    return constantTimeEqual(expected, actual);
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
export async function createCookieValue(): Promise<string> {
  const nonce = randomHex(16);
  const signingKey = await getSigningKey();
  const hmacBytes = await hmacSha256(signingKey, nonce);
  const hmac = bytesToHex(hmacBytes);
  return `${nonce}.${hmac}`;
}

/**
 * Validates an HMAC-signed cookie value.
 * Returns true only if the cookie was created by this server instance
 * (i.e. the HMAC is valid for the nonce).
 */
export async function validateCookie(cookieValue: string): Promise<boolean> {
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
    const signingKey = await getSigningKey();
    const expectedHmacBytes = await hmacSha256(signingKey, nonce);
    const expectedHmac = bytesToHex(expectedHmacBytes);

    const expectedBytes = encoder.encode(expectedHmac);
    const suppliedBytes = encoder.encode(suppliedHmac);

    // If lengths differ, the HMAC is clearly invalid — reject immediately.
    // Note: length comparison here is safe because HMAC output length is not secret
    // (it's always 64 hex chars for SHA-256).
    if (expectedBytes.length !== suppliedBytes.length) {
      return false;
    }
    return constantTimeEqual(expectedBytes, suppliedBytes);
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
  // Reset the signing key so it's re-derived from the new token
  _signingKeyPromise = null;
}
