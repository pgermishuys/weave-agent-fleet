/**
 * Google OAuth 2.0 configuration for the Authorization Code + PKCE flow (RFC 7636).
 *
 * IMPORTANT — Google Cloud Console setup required:
 *   1. Create an OAuth 2.0 Client ID with type "Desktop application".
 *      Desktop application clients do NOT issue a client_secret — PKCE replaces it.
 *   2. Add the redirect URI to the list of authorized redirect URIs:
 *      http://localhost:{port}/api/integrations/google-chat/auth/callback
 *      (Replace {port} with the port Weave runs on, typically 3000.)
 *      Failure to register this URI causes a redirect_uri_mismatch error.
 *   3. Enable the Google Chat API in APIs & Services → Library.
 *   4. Set the GOOGLE_CHAT_CLIENT_ID environment variable to the Client ID value.
 *
 * There is no GOOGLE_CHAT_CLIENT_SECRET — Desktop application type does not issue one.
 */

/**
 * Google OAuth 2.0 Client ID for Weave Agent Fleet.
 * Must be set via the GOOGLE_CHAT_CLIENT_ID environment variable.
 * Obtained from Google Cloud Console → APIs & Services → Credentials.
 */
export function getGoogleChatClientId(): string {
  const clientId = process.env.GOOGLE_CHAT_CLIENT_ID;
  if (!clientId) {
    throw new Error(
      "GOOGLE_CHAT_CLIENT_ID environment variable is not set. " +
        "Create a 'Desktop application' OAuth client in Google Cloud Console " +
        "and set the Client ID as GOOGLE_CHAT_CLIENT_ID."
    );
  }
  return clientId;
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
