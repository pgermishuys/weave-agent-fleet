/**
 * Next.js auth middleware — guards all /api/* routes with bearer token auth.
 *
 * This middleware runs in the Edge Runtime (Next.js default for middleware).
 * Because the Edge Runtime does not support Node.js built-ins (no `fs`),
 * the token hash is passed via the FLEET_TOKEN_HASH environment variable.
 *
 * Flow:
 *   1. The `weave-fleet serve` CLI reads the hash from ~/.weave/api-token.hash
 *   2. It injects the hash as FLEET_TOKEN_HASH into the Next.js child process env
 *   3. This middleware reads FLEET_TOKEN_HASH and verifies the bearer token
 *
 * Dev mode bypass:
 *   Set FLEET_AUTH_DISABLED=true to skip auth entirely. This preserves the
 *   existing localhost-only dev workflow (npm run dev) without requiring a token.
 *
 * First-start guard:
 *   If FLEET_TOKEN_HASH is not set (no token has been generated yet), all
 *   requests are allowed through. In practice the CLI ensures a token is
 *   generated before the server starts, so this is a safety fallback only.
 */

import { NextRequest, NextResponse } from "next/server";
import * as bcrypt from "bcryptjs";

/** CORS headers included in 401 responses so preflight rejections are correct. */
function corsHeaders(requestOrigin: string | null): Record<string, string> {
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

function getAllowedOrigin(requestOrigin: string | null): string {
  const allowed = process.env.FLEET_ALLOWED_ORIGINS ?? "*";
  if (allowed === "*" || !requestOrigin) return "*";
  const origins = allowed.split(",").map((o) => o.trim());
  return origins.includes(requestOrigin) ? requestOrigin : "";
}

export async function middleware(request: NextRequest) {
  const origin = request.headers.get("origin");

  // Only guard API routes
  if (!request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  // Dev mode / auth-disabled bypass — preserves existing dev workflow
  if (process.env.FLEET_AUTH_DISABLED === "true") {
    return NextResponse.next();
  }

  // Safety guard: if no token hash has been configured yet, allow through.
  // The CLI ensures a token is generated before the server starts accepting
  // connections — this branch should never be hit in production.
  const storedHash = process.env.FLEET_TOKEN_HASH;
  if (!storedHash) {
    return NextResponse.next();
  }

  // Preflight — respond immediately with 204 + CORS headers
  if (request.method === "OPTIONS") {
    return new NextResponse(null, {
      status: 204,
      headers: corsHeaders(origin),
    });
  }

  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: corsHeaders(origin) }
    );
  }

  const token = authHeader.slice(7);
  let valid = false;
  try {
    valid = await bcrypt.compare(token, storedHash);
  } catch {
    // bcrypt errors should not crash the server — treat as invalid
  }

  if (!valid) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: corsHeaders(origin) }
    );
  }

  return NextResponse.next();
}

export const config = {
  matcher: "/api/:path*",
};
