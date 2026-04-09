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
 */

const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "").replace(
  /\/$/,
  ""
);

/**
 * Build a full API URL from a path.
 * @param path - Must start with "/" (e.g. "/api/sessions")
 */
export function apiUrl(path: string): string {
  return API_BASE ? `${API_BASE}${path}` : path;
}

/**
 * Build a full SSE URL from a path. Semantically identical to `apiUrl`
 * but named distinctly for readability at EventSource call sites.
 */
export const sseUrl = apiUrl;

/**
 * Redirects the browser to the login page, preserving the current path as returnUrl.
 * No-op when running server-side (SSR/Node.js context) or when already on /login
 * (prevents redirect loops when ClientLayout providers fire 401s on the login page).
 */
function redirectToLogin(): void {
  if (typeof window === "undefined") return;
  if (window.location.pathname === "/login") return;
  const returnUrl = encodeURIComponent(window.location.pathname + window.location.search);
  window.location.href = `/login?returnUrl=${returnUrl}`;
}

/**
 * Thin wrapper around `fetch()` that prepends the API base URL.
 * Drop-in replacement: `fetch("/api/foo")` → `apiFetch("/api/foo")`.
 *
 * On 401 responses: redirects to the login page with the current path as returnUrl,
 * then throws an error so callers don't attempt to process the unauthorized response.
 */
export async function apiFetch(
  path: string,
  init?: RequestInit
): Promise<Response> {
  const response = await fetch(apiUrl(path), init);

  if (response.status === 401) {
    redirectToLogin();
    throw new Error("Unauthorized — redirecting to login");
  }

  return response;
}

/**
 * Checks whether the current session is authenticated.
 * Returns false if auth is not required (localhost) or if the cookie is valid.
 * Returns true only when auth is required AND the session is not authenticated.
 */
export async function isSessionUnauthenticated(): Promise<boolean> {
  try {
    const res = await fetch("/api/auth/status");
    if (!res.ok) return false;
    const data = await res.json() as { authRequired: boolean; authenticated?: boolean };
    return data.authRequired === true && data.authenticated === false;
  } catch {
    return false;
  }
}
