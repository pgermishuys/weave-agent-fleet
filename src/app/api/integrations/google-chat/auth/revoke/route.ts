import { NextResponse } from "next/server";
import {
  getIntegrationConfig,
  removeIntegrationConfig,
} from "@/lib/server/integration-store";
import { GOOGLE_REVOKE_URL } from "../_config";

/**
 * POST /api/integrations/google-chat/auth/revoke
 *
 * Revokes the refresh_token (preferred) or access_token (fallback) at Google's
 * revocation endpoint, then removes the integration config from the store.
 *
 * Revoking the refresh_token automatically invalidates all associated access
 * tokens, providing defense-in-depth. If the token has already been revoked
 * or is unavailable, the route still proceeds to clean up local state.
 */
export async function POST(): Promise<NextResponse> {
  const config = getIntegrationConfig("google-chat");

  if (!config) {
    // Nothing to revoke — already disconnected
    return NextResponse.json({ ok: true });
  }

  const tokenToRevoke =
    (config.refresh_token as string | undefined) ??
    (config.token as string | undefined);

  if (tokenToRevoke) {
    try {
      const body = new URLSearchParams({ token: tokenToRevoke });
      const res = await fetch(GOOGLE_REVOKE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      });

      // 200 = successfully revoked; 400 = already revoked / invalid token.
      // Both are acceptable — we proceed to remove local state either way.
      if (!res.ok && res.status !== 400) {
        return NextResponse.json(
          { error: "Failed to revoke token" },
          { status: 500 }
        );
      }
    } catch {
      // Network error during revocation — still proceed to remove local config
    }
  }

  removeIntegrationConfig("google-chat");

  return NextResponse.json({ ok: true });
}
