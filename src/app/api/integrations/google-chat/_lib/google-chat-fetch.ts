/**
 * Authenticated HTTP client for the Google Chat REST API.
 *
 * Handles:
 * - Token retrieval from the integration store
 * - Automatic access token refresh (5-minute pre-expiry window)
 * - Concurrent refresh deduplication via a module-level promise mutex
 * - Force-disconnect on invalid_grant (revoked or expired refresh token)
 */

import {
  getIntegrationConfig,
  setIntegrationConfig,
  removeIntegrationConfig,
} from "@/lib/server/integration-store";
import { log } from "@/lib/server/logger";
import { getGoogleChatClientId, GOOGLE_TOKEN_URL } from "../auth/_config";
import type {
  GoogleChatStoredConfig,
  GoogleTokenResponse,
  GoogleTokenErrorResponse,
} from "../auth/_types";

const GOOGLE_CHAT_API_BASE = "https://chat.googleapis.com/v1";

/** Buffer before token expiry to trigger a proactive refresh (5 minutes). */
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

// ---------------------------------------------------------------------------
// Token retrieval + refresh
// ---------------------------------------------------------------------------

/** Module-level mutex to deduplicate concurrent refresh requests. */
let refreshPromise: Promise<string | null> | null = null;

/**
 * Returns a valid Google Chat access token, refreshing if necessary.
 * Returns null if the integration is not configured or refresh fails fatally.
 */
export async function getGoogleChatToken(): Promise<string | null> {
  const config = getIntegrationConfig("google-chat") as GoogleChatStoredConfig | null;

  if (
    !config?.token ||
    typeof config.token !== "string" ||
    !config.refresh_token ||
    typeof config.refresh_token !== "string"
  ) {
    return null;
  }

  const expiry = typeof config.token_expiry === "number" ? config.token_expiry : 0;
  const needsRefresh = Date.now() >= expiry - REFRESH_BUFFER_MS;

  if (!needsRefresh) {
    return config.token;
  }

  // Deduplicate concurrent refresh calls
  if (refreshPromise) {
    return refreshPromise;
  }

  refreshPromise = performRefresh(config.refresh_token).finally(() => {
    refreshPromise = null;
  });

  return refreshPromise;
}

async function performRefresh(refreshToken: string): Promise<string | null> {
  let clientId: string;
  try {
    clientId = getGoogleChatClientId();
  } catch {
    log.warn("google-chat-fetch", "Cannot refresh — GOOGLE_CHAT_CLIENT_ID not set", {});
    return null;
  }

  let response: Response;
  try {
    response = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "weave-agent-fleet",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: clientId,
      }).toString(),
    });
  } catch (err) {
    log.warn("google-chat-fetch", "Network error refreshing access token", { err });
    return null;
  }

  let responseData: unknown;
  try {
    responseData = await response.json();
  } catch {
    log.warn("google-chat-fetch", "Failed to parse token refresh response", {});
    return null;
  }

  if (!response.ok) {
    const errorData = responseData as GoogleTokenErrorResponse;
    log.warn("google-chat-fetch", "Token refresh failed", {
      error: errorData.error,
    });

    // invalid_grant means the refresh token has been revoked or expired — force disconnect
    if (errorData.error === "invalid_grant") {
      log.warn("google-chat-fetch", "Removing google-chat config due to invalid_grant", {});
      removeIntegrationConfig("google-chat");
    }

    return null;
  }

  const tokenData = responseData as GoogleTokenResponse;

  // Update the stored access token and expiry; keep existing refresh_token
  const existing = getIntegrationConfig("google-chat") as GoogleChatStoredConfig | null;
  if (existing) {
    setIntegrationConfig("google-chat", {
      ...existing,
      token: tokenData.access_token,
      token_expiry: Date.now() + tokenData.expires_in * 1000,
    });
  }

  return tokenData.access_token;
}

// ---------------------------------------------------------------------------
// Authenticated fetch
// ---------------------------------------------------------------------------

export interface GoogleChatFetchOptions {
  params?: Record<string, string | number | undefined>;
  method?: string;
  body?: string;
}

export interface GoogleChatFetchResult<T> {
  data?: T;
  error?: string;
  status: number;
}

/**
 * Makes an authenticated request to the Google Chat REST API.
 * Path should start with `/` and be relative to the v1 base URL.
 */
export async function googleChatFetch<T>(
  path: string,
  token: string,
  options?: GoogleChatFetchOptions
): Promise<GoogleChatFetchResult<T>> {
  const url = new URL(`${GOOGLE_CHAT_API_BASE}${path}`);

  if (options?.params) {
    for (const [key, value] of Object.entries(options.params)) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }
  }

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method: options?.method ?? "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": "weave-agent-fleet",
      },
      ...(options?.body ? { body: options.body } : {}),
    });
  } catch (err) {
    log.warn("google-chat-fetch", "Network error calling Google Chat API", {
      path,
      err,
    });
    return { error: "Network error", status: 502 };
  }

  if (!response.ok) {
    let errorMessage = `Google Chat API error: ${response.status}`;
    try {
      const errorBody = (await response.json()) as { error?: { message?: string } };
      if (errorBody.error?.message) {
        errorMessage = errorBody.error.message;
      }
    } catch {
      // ignore JSON parse error
    }
    return { error: errorMessage, status: response.status };
  }

  let data: T;
  try {
    data = (await response.json()) as T;
  } catch (err) {
    log.warn("google-chat-fetch", "Failed to parse Google Chat API response", {
      path,
      err,
    });
    return { error: "Invalid response from Google Chat", status: 502 };
  }

  return { data, status: response.status };
}
