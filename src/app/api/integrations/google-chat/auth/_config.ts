/**
 * Google OAuth 2.0 configuration for the Authorization Code + PKCE flow (RFC 7636).
 *
 * The default client ID below is a "Desktop application" OAuth client owned by the
 * Weave Agent Fleet project.  Desktop clients do NOT issue a client_secret — PKCE
 * replaces it.  Users can override this by setting the GOOGLE_CHAT_CLIENT_ID
 * environment variable.
 *
 * There is no GOOGLE_CHAT_CLIENT_SECRET — Desktop application type does not issue one.
 */

/**
 * Default Google OAuth 2.0 Client ID for Weave Agent Fleet (Desktop application type).
 * Can be overridden via the GOOGLE_CHAT_CLIENT_ID environment variable.
 */
const DEFAULT_GOOGLE_CHAT_CLIENT_ID =
  "739753924831-k8bovd4if5ntiqujepf69gl2dh2t504b.apps.googleusercontent.com";

export function getGoogleChatClientId(): string {
  return process.env.GOOGLE_CHAT_CLIENT_ID ?? DEFAULT_GOOGLE_CHAT_CLIENT_ID;
}

/** Google OAuth 2.0 authorization endpoint */
export const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";

/** Google OAuth 2.0 token endpoint (code exchange + refresh) */
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

/** Google OAuth 2.0 token revocation endpoint */
export const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";

/**
 * OAuth 2.0 scopes requested for Google Chat.
 * Full URI form is required by Google's OAuth server.
 * - chat.spaces: Create and manage spaces (read + write)
 * - chat.messages: Read and send messages (read + write)
 * - chat.memberships.readonly: View space members
 */
export const GOOGLE_CHAT_SCOPES = [
  "https://www.googleapis.com/auth/chat.spaces",
  "https://www.googleapis.com/auth/chat.messages",
  "https://www.googleapis.com/auth/chat.memberships.readonly",
];

/**
 * The OAuth callback path (relative).
 * Must be registered in Google Cloud Console as an authorized redirect URI
 * in the form: http://localhost:{port}/api/integrations/google-chat/auth/callback
 */
export const GOOGLE_REDIRECT_PATH =
  "/api/integrations/google-chat/auth/callback";

/**
 * Derives the full redirect URI from a NextRequest.
 *
 * In dev mode (e.g. `bun run dev:ui`) Next.js may proxy requests, so
 * `request.url` can report a different port than the one the browser is
 * actually on.  The `Host` / `x-forwarded-host` header carries the real
 * host:port the user's browser connected to.
 */
export function getRedirectUri(request: { url: string; headers: { get(name: string): string | null } }): string {
  const forwarded = request.headers.get("x-forwarded-host");
  const host = forwarded ?? request.headers.get("host");

  if (host) {
    return `http://${host}${GOOGLE_REDIRECT_PATH}`;
  }

  // Fallback: derive from request.url
  const url = new URL(request.url);
  return `http://localhost:${url.port || "3000"}${GOOGLE_REDIRECT_PATH}`;
}
