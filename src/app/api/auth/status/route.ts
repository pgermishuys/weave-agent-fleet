/**
 * GET /api/auth/status — public endpoint that reports authentication state.
 *
 * Used by the login page on mount to determine whether the current request
 * is already authenticated (skips re-login if a valid cookie is present).
 *
 * This endpoint is on the proxy's public path list (/api/auth/)
 * so it does not require prior authentication to reach.
 *
 * Responses:
 *   { authRequired: true, authenticated: false }  — not yet authenticated
 *   { authRequired: true, authenticated: true }   — valid cookie present
 */

import { NextRequest, NextResponse } from "next/server";
import {
  validateCookie,
  AUTH_COOKIE_NAME,
} from "@/lib/server/token-auth";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const cookieValue = request.cookies.get(AUTH_COOKIE_NAME)?.value;
  const authenticated = !!cookieValue && await validateCookie(cookieValue);

  return NextResponse.json({ authRequired: true, authenticated });
}
