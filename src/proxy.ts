import { NextRequest, NextResponse } from "next/server";

/**
 * CORS proxy for API routes.
 *
 * Adds CORS headers to all `/api/` responses so the frontend can be served
 * from a different origin (e.g. Tauri webview or a separate dev server).
 *
 * Configurable allowed origins:
 *   FLEET_ALLOWED_ORIGINS — comma-separated list of allowed origins.
 *   If unset or "*": wildcard — all origins allowed (default, dev-friendly).
 *   If set to specific origins: reflects the matching request origin;
 *   non-matching origins receive no ACAO header (browser blocks request).
 *
 * Single-tenant design note:
 *   CORS is purely about which *client* origins are allowed to call *this*
 *   server. This is configurable per server instance — not globally federated.
 */

/**
 * Resolves the allowed origin for a given request origin.
 * Returns "*" for wildcard mode, the matching origin string if allowed,
 * or "" if the request origin is not in the allowed list.
 */
function getAllowedOrigin(requestOrigin: string | null): string {
  const allowed = process.env.FLEET_ALLOWED_ORIGINS ?? "*";
  if (allowed === "*" || !requestOrigin) return "*";
  const origins = allowed.split(",").map((o) => o.trim());
  return origins.includes(requestOrigin) ? requestOrigin : "";
}

export function proxy(request: NextRequest) {
  const origin = request.headers.get("origin");
  const allowedOrigin = getAllowedOrigin(origin);

  const corsHeaders: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };

  if (allowedOrigin) {
    corsHeaders["Access-Control-Allow-Origin"] = allowedOrigin;
  }

  // Preflight requests — respond immediately with 204
  if (request.method === "OPTIONS") {
    if (!allowedOrigin) {
      // Origin not in allowed list — no ACAO header, browser will block
      return new NextResponse(null, { status: 204 });
    }
    return new NextResponse(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

  // Non-preflight: reject origins not in the allowed list
  if (origin && !allowedOrigin) {
    return new NextResponse(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  // All other requests — add CORS headers and continue
  const response = NextResponse.next();
  for (const [key, value] of Object.entries(corsHeaders)) {
    response.headers.set(key, value);
  }
  return response;
}

export const config = {
  matcher: "/api/:path*",
};
