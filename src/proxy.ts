import { NextRequest, NextResponse } from "next/server";
import * as bcrypt from "bcryptjs";

/**
 * Next.js proxy — combines CORS and bearer token auth for all /api/* routes.
 *
 * CORS:
 *   Configurable via FLEET_ALLOWED_ORIGINS (comma-separated list, or "*" for
 *   wildcard). Adds CORS headers to all /api/ responses and handles OPTIONS
 *   preflights so the frontend can be served from a different origin
 *   (e.g. Tauri webview or a separate dev server).
 *
 * Auth:
 *   Guards /api/* with bearer token auth when FLEET_TOKEN_HASH is set.
 *   The token hash is passed via the FLEET_TOKEN_HASH environment variable
 *   because the Edge Runtime has no filesystem access (no `fs`).
 *
 * Flow:
 *   1. The `weave-fleet serve` CLI reads the hash from ~/.weave/api-token.hash
 *   2. It injects the hash as FLEET_TOKEN_HASH into the Next.js child process env
 *   3. This proxy reads FLEET_TOKEN_HASH and verifies the bearer token
 *
 * Dev mode bypass:
 *   Set FLEET_AUTH_DISABLED=true to skip auth entirely (preserves the existing
 *   localhost-only dev workflow; npm run dev sets this automatically).
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

function buildCorsHeaders(requestOrigin: string | null): Record<string, string> {
  const allowedOrigin = getAllowedOrigin(requestOrigin);
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
  if (allowedOrigin) {
    headers["Access-Control-Allow-Origin"] = allowedOrigin;
  }
  return headers;
}

/** Adds CORS headers to a NextResponse (mutates in-place, returns it). */
function addCorsHeaders(
  response: NextResponse,
  requestOrigin: string | null
): NextResponse {
  for (const [key, value] of Object.entries(buildCorsHeaders(requestOrigin))) {
    response.headers.set(key, value);
  }
  return response;
}

export async function proxy(request: NextRequest) {
  const origin = request.headers.get("origin");

  // Only handle API routes
  if (!request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  // Preflight — respond immediately with 204 + CORS headers (before auth check
  // so browsers can always complete the OPTIONS handshake)
  if (request.method === "OPTIONS") {
    const allowedOrigin = getAllowedOrigin(origin);
    if (!allowedOrigin) {
      // Origin not in allowed list — no ACAO header, browser will block
      return new NextResponse(null, { status: 204 });
    }
    return new NextResponse(null, {
      status: 204,
      headers: buildCorsHeaders(origin),
    });
  }

  // Non-preflight: reject origins not in the allowed list
  const allowedOrigin = getAllowedOrigin(origin);
  if (origin && !allowedOrigin) {
    return new NextResponse(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Dev mode / auth-disabled bypass — preserves existing dev workflow
  if (process.env.FLEET_AUTH_DISABLED === "true") {
    return addCorsHeaders(NextResponse.next(), origin);
  }

  // Safety guard: if no token hash has been configured yet, allow through.
  // The CLI ensures a token is generated before the server starts — this is
  // a fallback only.
  const storedHash = process.env.FLEET_TOKEN_HASH;
  if (!storedHash) {
    return addCorsHeaders(NextResponse.next(), origin);
  }

  const authHeader = request.headers.get("authorization");
  const tokenParam = request.nextUrl.searchParams.get("token");

  if (!authHeader?.startsWith("Bearer ") && !tokenParam) {
    return new NextResponse(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: {
        "Content-Type": "application/json",
        ...buildCorsHeaders(origin),
      },
    });
  }

  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : (tokenParam ?? "");
  let valid = false;
  try {
    valid = await bcrypt.compare(token, storedHash);
  } catch {
    // bcrypt errors should not crash the server — treat as invalid
  }

  if (!valid) {
    return new NextResponse(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: {
        "Content-Type": "application/json",
        ...buildCorsHeaders(origin),
      },
    });
  }

  return addCorsHeaders(NextResponse.next(), origin);
}

export const config = {
  matcher: "/api/:path*",
};
