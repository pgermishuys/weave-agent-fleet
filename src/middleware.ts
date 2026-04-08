/**
 * Next.js middleware — centralized authentication and CORS enforcement.
 *
 * This is the single enforcement point for all routes. It runs before every
 * request, providing:
 *
 * 1. Auth gate: when HOSTNAME is non-localhost, all routes except public paths
 *    require a valid cookie or Bearer token.
 * 2. CORS:
 *    - Auth disabled (localhost): Access-Control-Allow-Origin: * (original permissive behavior)
 *    - Auth enabled: Reflect the request Origin header with Access-Control-Allow-Credentials: true
 *      (safe because SameSite=Lax prevents cross-site cookie sending for non-navigation requests)
 *
 * Public paths (always accessible without auth):
 *   /login          — the login page itself
 *   /api/auth/*     — login and status endpoints
 *   /_next/*        — webpack assets, HMR
 *   /favicon.ico    — browser favicon
 *   /weave_logo.png — app logo (used by login page)
 *
 * Security notes:
 *   - returnUrl is validated to be a relative path to prevent open redirect attacks.
 *   - CORS origin reflection is safe because the auth cookie uses SameSite=Lax.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  isAuthRequired,
  validateToken,
  validateCookie,
  AUTH_COOKIE_NAME,
} from "@/lib/server/token-auth";

// ─── Public paths ─────────────────────────────────────────────────────────────

/**
 * Paths that are always accessible without authentication.
 * Checked as exact match or prefix (for paths ending with /*).
 */
const PUBLIC_PATH_PREFIXES = [
  "/login",
  "/api/auth/",
  "/_next/",
  "/favicon.ico",
  "/weave_logo.png",
];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATH_PREFIXES.some(
    (prefix) =>
      pathname === prefix ||
      // Strip query string, check prefix match
      pathname.startsWith(prefix)
  );
}

// ─── CORS header builders ─────────────────────────────────────────────────────

const CORS_METHODS = "GET, POST, PUT, PATCH, DELETE, OPTIONS";
const CORS_HEADERS_LIST = "Content-Type, Authorization";

function buildCorsHeaders(
  request: NextRequest,
  authRequired: boolean
): Record<string, string> {
  const origin = request.headers.get("origin");

  if (!authRequired) {
    // Auth disabled — use permissive wildcard (original behavior, backward compat)
    return {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": CORS_METHODS,
      "Access-Control-Allow-Headers": CORS_HEADERS_LIST,
    };
  }

  // Auth enabled — reflect Origin with credentials support.
  // Using the request Origin (rather than *) is required because:
  //   1. Cookies require a specific origin (not wildcard) to be sent cross-origin.
  //   2. SameSite=Lax prevents cross-site cookie abuse, making origin reflection safe.
  // If no Origin header is present (e.g. direct curl), use * (non-credentialed request).
  if (origin) {
    return {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": CORS_METHODS,
      "Access-Control-Allow-Headers": CORS_HEADERS_LIST,
      "Access-Control-Allow-Credentials": "true",
      Vary: "Origin",
    };
  }

  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": CORS_METHODS,
    "Access-Control-Allow-Headers": CORS_HEADERS_LIST,
  };
}

// ─── returnUrl validation ─────────────────────────────────────────────────────

/**
 * Validates that a returnUrl is a safe relative path.
 * Prevents open redirect attacks by rejecting absolute URLs and protocol-relative paths.
 */
function isSafeReturnUrl(url: string): boolean {
  if (!url) return false;
  // Must start with / but not // (protocol-relative) and must not contain ://
  return url.startsWith("/") && !url.startsWith("//") && !url.includes("://");
}

// ─── Middleware ───────────────────────────────────────────────────────────────

export function middleware(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;

  // ── Preflight (OPTIONS) ─────────────────────────────────────────────────────
  if (request.method === "OPTIONS") {
    const authRequired = isAuthRequired();
    return new NextResponse(null, {
      status: 204,
      headers: buildCorsHeaders(request, authRequired),
    });
  }

  // ── CORS headers for all responses ─────────────────────────────────────────
  const authRequired = isAuthRequired();
  const corsHeaders = buildCorsHeaders(request, authRequired);

  // ── Public paths — always pass through ─────────────────────────────────────
  if (isPublicPath(pathname)) {
    const response = NextResponse.next();
    for (const [key, value] of Object.entries(corsHeaders)) {
      response.headers.set(key, value);
    }
    return response;
  }

  // ── Auth disabled (localhost) — pass through all requests ──────────────────
  if (!authRequired) {
    const response = NextResponse.next();
    for (const [key, value] of Object.entries(corsHeaders)) {
      response.headers.set(key, value);
    }
    return response;
  }

  // ── Auth required — check credentials ──────────────────────────────────────

  // 1. Check Authorization: Bearer <token> header (for API clients, curl, etc.)
  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const candidateToken = authHeader.slice("Bearer ".length).trim();
    if (validateToken(candidateToken)) {
      const response = NextResponse.next();
      for (const [key, value] of Object.entries(corsHeaders)) {
        response.headers.set(key, value);
      }
      return response;
    }
  }

  // 2. Check session cookie (for browser requests, SSE streams)
  const cookieValue = request.cookies.get(AUTH_COOKIE_NAME)?.value;
  if (cookieValue && validateCookie(cookieValue)) {
    const response = NextResponse.next();
    for (const [key, value] of Object.entries(corsHeaders)) {
      response.headers.set(key, value);
    }
    return response;
  }

  // ── Not authenticated ───────────────────────────────────────────────────────

  // API routes → 401 JSON response
  if (pathname.startsWith("/api/")) {
    return new NextResponse(
      JSON.stringify({ error: "Unauthorized" }),
      {
        status: 401,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders,
        },
      }
    );
  }

  // Page routes → redirect to /login with returnUrl
  const returnUrl = pathname + request.nextUrl.search;
  const safeReturnUrl = isSafeReturnUrl(returnUrl) ? returnUrl : "/";
  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("returnUrl", safeReturnUrl);

  return NextResponse.redirect(loginUrl);
}

// ─── Matcher config ───────────────────────────────────────────────────────────

/**
 * Run middleware on all routes except Next.js static assets and image optimization.
 * These are handled by Next.js itself and don't need auth or CORS.
 */
export const config = {
  matcher: [
    /*
     * Match all request paths EXCEPT:
     *   - _next/static  (static files)
     *   - _next/image   (image optimization)
     */
    "/((?!_next/static|_next/image).*)",
  ],
};
