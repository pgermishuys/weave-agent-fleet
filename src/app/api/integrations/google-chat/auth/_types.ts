/**
 * Shared TypeScript types for the Google Chat Authorization Code + PKCE flow (RFC 7636).
 * Used by both the API routes and the frontend settings component.
 */

// ─── Client-facing types (sent over the wire) ─────────────────────────────────

/**
 * Response from GET /api/integrations/google-chat/auth/url.
 * The frontend opens this URL in a new browser window to initiate the OAuth flow.
 */
export interface AuthUrlResponse {
  /** The full Google OAuth authorization URL with all required parameters. */
  authorizationUrl: string;
}

// ─── Internal server-only types (never sent to the client) ────────────────────

/**
 * Query parameters received on the OAuth callback redirect from Google.
 * @internal
 */
export interface CallbackQueryParams {
  /** Authorization code to exchange for tokens. */
  code?: string;
  /** CSRF state token — must match the value stored in the PKCE pending store. */
  state?: string;
  /** Error code returned by Google if the user denied access or an error occurred. */
  error?: string;
  /** Human-readable error description from Google. */
  error_description?: string;
}

/**
 * Raw token response from Google's token endpoint (code exchange or refresh).
 * @internal
 */
export interface GoogleTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
  token_type: "Bearer";
  /** Present when using OpenID Connect scopes. */
  id_token?: string;
}

/**
 * Raw error response from Google's token endpoint.
 * @internal
 */
export interface GoogleTokenErrorResponse {
  error: string;
  error_description?: string;
}

/**
 * Shape stored in integrations.json for google-chat.
 * @internal
 */
export interface GoogleChatStoredConfig {
  /** Current access token (short-lived, ~1 hour). */
  token: string;
  /** Refresh token (long-lived, used to obtain new access tokens). Never sent to the client. */
  refresh_token: string;
  /** Unix timestamp (ms) when the access token expires. */
  token_expiry: number;
  /** ISO timestamp of when the integration was connected. */
  connectedAt: string;
  /** Index signature to satisfy IntegrationConfig compatibility. */
  [key: string]: unknown;
}
