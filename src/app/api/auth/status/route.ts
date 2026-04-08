/**
 * GET /api/auth/status — public endpoint that reports whether authentication is required.
 *
 * Used by the login page on mount to determine:
 *   - Whether auth is required at all (skips login page on localhost)
 *   - Whether the current request is already authenticated (skips re-login)
 *
 * This endpoint is on the middleware's public path list (/api/auth/)
 * so it does not require prior authentication to reach.
 *
 * Responses:
 *   { authRequired: false }                       — localhost, no auth needed
 *   { authRequired: true, authenticated: false }  — remote, not yet authenticated
 *   { authRequired: true, authenticated: true }   — remote, valid cookie present
 */

import { NextRequest, NextResponse } from "next/server";
import {
  isAuthRequired,
  validateCookie,
  AUTH_COOKIE_NAME,
} from "@/lib/server/token-auth";

export function GET(request: NextRequest): NextResponse {
  if (!isAuthRequired()) {
    return NextResponse.json({ authRequired: false });
  }

  const cookieValue = request.cookies.get(AUTH_COOKIE_NAME)?.value;
  const authenticated = !!cookieValue && validateCookie(cookieValue);

  return NextResponse.json({ authRequired: true, authenticated });
}
