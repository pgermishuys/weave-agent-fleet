/**
 * PKCE (Proof Key for Code Exchange, RFC 7636) utilities for the Google OAuth flow.
 *
 * Used by the Authorization Code + PKCE flow to bind the authorization request
 * to the token exchange request without a client_secret.
 */

import { createHash, randomBytes } from "crypto";

// ---------------------------------------------------------------------------
// PKCE helpers
// ---------------------------------------------------------------------------

/**
 * Generates a cryptographically random code verifier.
 * Length is 64 bytes → 86 base64url chars (well within the 43–128 char range).
 */
export function generateCodeVerifier(): string {
  return randomBytes(64).toString("base64url");
}

/**
 * Derives the code challenge from a verifier using S256 method.
 * code_challenge = BASE64URL(SHA256(ASCII(code_verifier)))
 */
export function generateCodeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

/**
 * Generates a cryptographically random state parameter for CSRF protection.
 * 32 bytes → 43 base64url chars.
 */
export function generateState(): string {
  return randomBytes(32).toString("base64url");
}

// ---------------------------------------------------------------------------
// Pending PKCE session store
// ---------------------------------------------------------------------------

interface PendingSession {
  codeVerifier: string;
  createdAt: number;
}

/** Maximum age for a pending PKCE session: 10 minutes */
const MAX_AGE_MS = 10 * 60 * 1000;

/** Maximum number of concurrent pending sessions (prevents memory exhaustion) */
const MAX_SESSIONS = 10;

const pendingStore = new Map<string, PendingSession>();

/** Removes all expired sessions from the store. */
function pruneExpired(): void {
  const now = Date.now();
  for (const [state, session] of pendingStore) {
    if (now - session.createdAt > MAX_AGE_MS) {
      pendingStore.delete(state);
    }
  }
}

/**
 * Stores a pending PKCE session keyed by state.
 * Prunes expired entries before inserting.
 * Oldest entry is evicted if the store is at capacity.
 */
export function storePendingSession(
  state: string,
  codeVerifier: string
): void {
  pruneExpired();

  // Evict oldest entry if at capacity
  if (pendingStore.size >= MAX_SESSIONS) {
    const oldestKey = pendingStore.keys().next().value;
    if (oldestKey !== undefined) {
      pendingStore.delete(oldestKey);
    }
  }

  pendingStore.set(state, { codeVerifier, createdAt: Date.now() });
}

/**
 * Retrieves and consumes a pending PKCE session by state.
 * Returns the code verifier if found and not expired, or null otherwise.
 */
export function consumePendingSession(state: string): string | null {
  pruneExpired();

  const session = pendingStore.get(state);
  if (!session) {
    return null;
  }

  pendingStore.delete(state);

  if (Date.now() - session.createdAt > MAX_AGE_MS) {
    return null;
  }

  return session.codeVerifier;
}

/** Returns the number of active (non-expired) pending sessions. Intended for tests. */
export function pendingSessionCount(): number {
  pruneExpired();
  return pendingStore.size;
}

/** Clears all pending sessions. Intended for tests. */
export function clearPendingSessions(): void {
  pendingStore.clear();
}
