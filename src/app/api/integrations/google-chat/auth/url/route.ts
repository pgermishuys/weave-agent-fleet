import { NextRequest, NextResponse } from "next/server";
import { log } from "@/lib/server/logger";
import {
  getGoogleChatClientId,
  GOOGLE_AUTH_URL,
  GOOGLE_CHAT_SCOPES,
  GOOGLE_REDIRECT_PATH,
} from "../_config";
import {
  generateCodeVerifier,
  generateCodeChallenge,
  generateState,
  storePendingSession,
} from "../_pkce";
import type { AuthUrlResponse } from "../_types";

/**
 * GET /api/integrations/google-chat/auth/url
 *
 * Generates a Google OAuth 2.0 authorization URL using PKCE (RFC 7636).
 * Stores the code verifier in the server-side pending session store,
 * keyed by the generated state parameter.
 *
 * The redirect_uri is derived from the incoming request's host. Only
 * requests originating from localhost are accepted — all other origins
 * are rejected with 400 to prevent authorization URL generation for
 * non-local deployments.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const requestUrl = new URL(request.url);

  // Enforce localhost-only — reject any non-localhost origin
  if (requestUrl.hostname !== "localhost") {
    log.warn(
      "google-chat-auth-url",
      "Rejected non-localhost origin for auth URL generation",
      { hostname: requestUrl.hostname }
    );
    return NextResponse.json(
      { error: "OAuth authorization is only supported from localhost" },
      { status: 400 }
    );
  }

  let clientId: string;
  try {
    clientId = getGoogleChatClientId();
  } catch (err) {
    log.warn("google-chat-auth-url", "GOOGLE_CHAT_CLIENT_ID not configured", {
      err,
    });
    return NextResponse.json(
      {
        error:
          "Google Chat integration is not configured. Set GOOGLE_CHAT_CLIENT_ID.",
      },
      { status: 500 }
    );
  }

  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const state = generateState();

  storePendingSession(state, codeVerifier);

  const redirectUri = `http://localhost:${requestUrl.port || "3000"}${GOOGLE_REDIRECT_PATH}`;

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GOOGLE_CHAT_SCOPES.join(" "),
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    access_type: "offline",
    prompt: "consent",
  });

  const authorizationUrl = `${GOOGLE_AUTH_URL}?${params.toString()}`;

  const result: AuthUrlResponse = { authorizationUrl };
  return NextResponse.json(result);
}
