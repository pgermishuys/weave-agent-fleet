/**
 * API client — configurable base URL for all frontend API calls.
 *
 * When `NEXT_PUBLIC_API_BASE_URL` is unset (default / standalone mode),
 * paths are returned as-is (relative URLs like `/api/sessions`).
 *
 * When set (e.g. `http://localhost:3000`), paths are prefixed with the
 * base URL to enable cross-origin split-mode development.
 *
 * This is a `NEXT_PUBLIC_` variable — inlined at build time by Next.js.
 *
 * --- Multi-fleet extension ---
 * Pass an optional `connectionId` to route calls to a different Fleet Server.
 * When omitted (or `undefined`), behaviour is identical to before — backward-
 * compatible for all existing callers.
 */

import { connectionRegistry } from "@/lib/fleet-connection-registry";

const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "").replace(
  /\/$/,
  ""
);

/**
 * Build a full API URL from a path.
 * @param path - Must start with "/" (e.g. "/api/sessions")
 * @param connectionId - Optional connection id. When provided, builds an
 *   absolute URL using the connection's base URL instead of `API_BASE`.
 */
export function apiUrl(path: string, connectionId?: string): string {
  if (connectionId) {
    const conn = connectionRegistry.getConnections().find((c) => c.id === connectionId);
    if (conn && conn.url) {
      return `${conn.url.replace(/\/$/, "")}${path}`;
    }
    // Fallback: if connection not found or url is empty (Local), use default
  }
  return API_BASE ? `${API_BASE}${path}` : path;
}

/**
 * Build a full SSE URL from a path. Semantically identical to `apiUrl`
 * but named distinctly for readability at EventSource call sites.
 */
export function sseUrl(path: string, connectionId?: string): string {
  return apiUrl(path, connectionId);
}

/**
 * Thin wrapper around `fetch()` that prepends the API base URL.
 * Drop-in replacement: `fetch("/api/foo")` → `apiFetch("/api/foo")`.
 *
 * @param connectionId - Optional. When provided, uses the connection's base
 *   URL and injects an Authorization header if a token is available.
 *   Omit for existing/local behaviour.
 */
export function apiFetch(
  path: string,
  init?: RequestInit,
  connectionId?: string
): Promise<Response> {
  const url = apiUrl(path, connectionId);

  if (!connectionId) {
    return fetch(url, init);
  }

  // Inject auth header for remote connections
  const token = connectionRegistry.getTokenForConnection(connectionId);
  if (token) {
    const headers = new Headers(init?.headers);
    headers.set("Authorization", `Bearer ${token}`);
    return fetch(url, { ...init, headers });
  }

  return fetch(url, init);
}
