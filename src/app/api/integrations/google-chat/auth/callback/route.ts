import { NextRequest, NextResponse } from "next/server";
import { log } from "@/lib/server/logger";
import { setIntegrationConfig } from "@/lib/server/integration-store";
import {
  getGoogleChatClientId,
  GOOGLE_TOKEN_URL,
  getRedirectUri,
} from "../_config";
import { consumePendingSession } from "../_pkce";
import type {
  CallbackQueryParams,
  GoogleTokenResponse,
  GoogleChatStoredConfig,
} from "../_types";

// ---------------------------------------------------------------------------
// Static HTML responses — NEVER interpolate request data into these strings
// ---------------------------------------------------------------------------

const SUCCESS_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Connected</title>
  <style>
    body { font-family: system-ui, sans-serif; display: flex; align-items: center;
           justify-content: center; min-height: 100vh; margin: 0; background: #0f172a; color: #f1f5f9; }
    .card { text-align: center; padding: 2rem; border-radius: 0.75rem;
            background: #1e293b; box-shadow: 0 4px 24px rgba(0,0,0,0.4); max-width: 360px; }
    .icon { font-size: 3rem; margin-bottom: 1rem; }
    h1 { font-size: 1.25rem; font-weight: 600; margin: 0 0 0.5rem; }
    p { color: #94a3b8; margin: 0; font-size: 0.875rem; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">✅</div>
    <h1>Connected successfully!</h1>
    <p>You can close this window. Returning to Weave…</p>
  </div>
  <script>
    setTimeout(function() { window.close(); }, 1500);
  </script>
</body>
</html>`;

const ERROR_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Connection failed</title>
  <style>
    body { font-family: system-ui, sans-serif; display: flex; align-items: center;
           justify-content: center; min-height: 100vh; margin: 0; background: #0f172a; color: #f1f5f9; }
    .card { text-align: center; padding: 2rem; border-radius: 0.75rem;
            background: #1e293b; box-shadow: 0 4px 24px rgba(0,0,0,0.4); max-width: 360px; }
    .icon { font-size: 3rem; margin-bottom: 1rem; }
    h1 { font-size: 1.25rem; font-weight: 600; margin: 0 0 0.5rem; }
    p { color: #94a3b8; margin: 0; font-size: 0.875rem; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">❌</div>
    <h1>Connection failed</h1>
    <p>Something went wrong. Please close this window and try again.</p>
  </div>
  <script>
    setTimeout(function() { window.close(); }, 4000);
  </script>
</body>
</html>`;

function htmlResponse(html: string, status: number): NextResponse {
  return new NextResponse(html, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

/**
 * GET /api/integrations/google-chat/auth/callback
 *
 * OAuth 2.0 redirect handler. Google redirects the browser here after the user
 * grants or denies access. This route:
 *   1. Validates the request is from localhost.
 *   2. Reads code + state from query params.
 *   3. Looks up and consumes the PKCE session for the given state.
 *   4. Exchanges the code for tokens at Google's token endpoint.
 *   5. Stores the tokens in integrations.json.
 *   6. Returns static HTML that closes the window.
 *
 * SECURITY: No query parameter values are interpolated into the HTML response.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const requestUrl = new URL(request.url);

  // Enforce localhost-only
  if (requestUrl.hostname !== "localhost") {
    log.warn(
      "google-chat-callback",
      "Rejected non-localhost callback request",
      { hostname: requestUrl.hostname }
    );
    return htmlResponse(ERROR_HTML, 400);
  }

  const params = requestUrl.searchParams;
  const query: CallbackQueryParams = {
    code: params.get("code") ?? undefined,
    state: params.get("state") ?? undefined,
    error: params.get("error") ?? undefined,
    error_description: params.get("error_description") ?? undefined,
  };

  // Google returned an error (user denied access, etc.)
  if (query.error) {
    log.warn("google-chat-callback", "Google returned OAuth error", {
      error: query.error,
    });
    return htmlResponse(ERROR_HTML, 400);
  }

  if (!query.code || !query.state) {
    log.warn("google-chat-callback", "Missing code or state in callback", {
      hasCode: !!query.code,
      hasState: !!query.state,
    });
    return htmlResponse(ERROR_HTML, 400);
  }

  // Look up and consume the PKCE session
  const codeVerifier = consumePendingSession(query.state);
  if (!codeVerifier) {
    log.warn(
      "google-chat-callback",
      "No pending PKCE session found for state (expired or invalid)",
      {}
    );
    return htmlResponse(ERROR_HTML, 400);
  }

  // Get client ID
  let clientId: string;
  try {
    clientId = getGoogleChatClientId();
  } catch (err) {
    log.warn("google-chat-callback", "GOOGLE_CHAT_CLIENT_ID not configured", {
      err,
    });
    return htmlResponse(ERROR_HTML, 500);
  }

  const redirectUri = getRedirectUri(request);

  // Exchange authorization code for tokens
  let tokenResponse: Response;
  try {
    tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "weave-agent-fleet",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: query.code,
        redirect_uri: redirectUri,
        client_id: clientId,
        code_verifier: codeVerifier,
      }).toString(),
    });
  } catch (err) {
    log.warn(
      "google-chat-callback",
      "Network error exchanging code for tokens",
      { err }
    );
    return htmlResponse(ERROR_HTML, 502);
  }

  if (!tokenResponse.ok) {
    let errorBody: unknown;
    try {
      errorBody = await tokenResponse.json();
    } catch {
      errorBody = await tokenResponse.text().catch(() => "(unreadable)");
    }
    log.warn(
      "google-chat-callback",
      "Google token endpoint returned non-200",
      { status: tokenResponse.status, errorBody, redirectUri }
    );
    return htmlResponse(ERROR_HTML, 502);
  }

  let tokenData: GoogleTokenResponse;
  try {
    tokenData = (await tokenResponse.json()) as GoogleTokenResponse;
  } catch (err) {
    log.warn("google-chat-callback", "Failed to parse token response", { err });
    return htmlResponse(ERROR_HTML, 502);
  }

  if (!tokenData.refresh_token) {
    log.warn(
      "google-chat-callback",
      "Token response missing refresh_token — ensure prompt=consent and access_type=offline",
      {}
    );
    return htmlResponse(ERROR_HTML, 502);
  }

  // Store tokens server-side in integrations.json
  const config: GoogleChatStoredConfig = {
    token: tokenData.access_token,
    refresh_token: tokenData.refresh_token,
    token_expiry: Date.now() + tokenData.expires_in * 1000,
    connectedAt: new Date().toISOString(),
  };

  const stored = setIntegrationConfig("google-chat", config);
  if (!stored) {
    log.warn(
      "google-chat-callback",
      "Failed to persist Google Chat integration config",
      {}
    );
    return htmlResponse(ERROR_HTML, 500);
  }

  log.info("google-chat-callback", "Google Chat integration connected", {});
  return htmlResponse(SUCCESS_HTML, 200);
}
