/**
 * POST /api/auth/logout — clears the auth cookie, ending the session.
 *
 * Returns { ok: true } after clearing the cookie.
 * This endpoint is on the middleware's public path list (/api/auth/)
 * so it is accessible regardless of auth state.
 */

import { NextResponse } from "next/server";
import { AUTH_COOKIE_NAME } from "@/lib/server/token-auth";

export function POST(): NextResponse {
  const response = NextResponse.json({ ok: true });

  // Clear the auth cookie by setting Max-Age=0
  response.cookies.set(AUTH_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    path: "/",
    maxAge: 0,
  });

  return response;
}
