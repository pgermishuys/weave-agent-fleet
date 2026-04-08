/**
 * POST /api/auth/login — validates a token and sets the auth cookie.
 *
 * Accepts: { token: string } in the JSON body.
 * On success: sets the weave.auth HttpOnly cookie and returns { ok: true }.
 * On failure: returns 401 { error: "Invalid token" }.
 *
 * This endpoint is on the middleware's public path list (/api/auth/)
 * so it does not require prior authentication to reach.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  validateToken,
  createCookieValue,
  AUTH_COOKIE_NAME,
  AUTH_COOKIE_MAX_AGE,
} from "@/lib/server/token-auth";

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 }
    );
  }

  if (
    !body ||
    typeof body !== "object" ||
    !("token" in body) ||
    typeof (body as Record<string, unknown>).token !== "string"
  ) {
    return NextResponse.json(
      { error: "Missing or invalid token field" },
      { status: 400 }
    );
  }

  const candidate = (body as { token: string }).token;

  if (!validateToken(candidate)) {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  // Token is valid — create a signed cookie value and set it in the response
  const cookieValue = createCookieValue();

  const response = NextResponse.json({ ok: true });

  // Set the HttpOnly session cookie
  // - HttpOnly: prevents XSS from reading the cookie
  // - SameSite=Lax: prevents CSRF for state-changing requests while allowing navigations
  // - Secure=false: necessary for HTTP on LAN/Tailscale (no TLS)
  // - Path=/: cookie is sent with all requests
  // - MaxAge: 3 days (matches .NET Aspire default)
  response.cookies.set(AUTH_COOKIE_NAME, cookieValue, {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    path: "/",
    maxAge: AUTH_COOKIE_MAX_AGE,
  });

  return response;
}
