"use client";

/**
 * Login page — Aspire-style browser token authentication.
 *
 * Behavior:
 * 1. On mount, calls /api/auth/status to check if already authenticated.
 *    - If already authenticated: redirects to returnUrl or /.
 * 2. If URL contains ?token=<value>, auto-submits the token (from console clickable URL).
 *    After auto-submit, strips the token from the URL via history.replaceState to prevent
 *    it lingering in browser history.
 * 3. User can paste the token manually into the form.
 * 4. On success: redirects to returnUrl or /.
 * 5. On failure: shows "Invalid token" error inline.
 *
 * Security: <meta name="referrer" content="no-referrer"> is set in layout.tsx metadata
 * to prevent the token from leaking via Referer header.
 */

import { useState, useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";

export default function LoginPage() {
  const searchParams = useSearchParams();

  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isChecking, setIsChecking] = useState(true);
  const hasAutoSubmitted = useRef(false);

  // Validate and sanitize returnUrl to prevent open redirect attacks
  // and redirect loops back to /login.
  // Must be a relative path starting with / (not // or containing ://).
  function getSafeReturnUrl(): string {
    const raw = searchParams.get("returnUrl") ?? "/";
    if (raw.startsWith("/") && !raw.startsWith("//") && !raw.includes("://")) {
      // Prevent redirect loops — never redirect back to the login page itself
      if (raw === "/login" || raw.startsWith("/login?") || raw.startsWith("/login/")) {
        return "/";
      }
      return raw;
    }
    return "/";
  }

  async function submitToken(candidateToken: string): Promise<void> {
    if (!candidateToken.trim()) {
      setError("Please enter your access token.");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: candidateToken.trim() }),
      });

      if (response.ok) {
        // Strip token from URL before navigating (Warp recommendation: prevent history leakage)
        if (typeof window !== "undefined" && window.location.search.includes("token=")) {
          const cleanUrl = new URL(window.location.href);
          cleanUrl.searchParams.delete("token");
          window.history.replaceState(null, "", cleanUrl.toString());
        }
        // Use hard navigation (not router.replace) so the browser does a full
        // page load with the newly-set auth cookie. Client-side navigation can
        // race: React renders the target page and providers fire API calls
        // before the cookie from the login response is available, causing a
        // spurious 401 "Failed to load sessions" flash.
        window.location.href = getSafeReturnUrl();
      } else {
        setError("Invalid token. Please check the URL printed in the server console.");
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  // On mount: check auth status, then auto-submit URL token if present
  useEffect(() => {
    async function checkAndAutoSubmit(): Promise<void> {
      try {
        const statusRes = await fetch("/api/auth/status");
        if (statusRes.ok) {
          const status = await statusRes.json() as { authRequired: boolean; authenticated?: boolean };

          // Already authenticated — redirect to destination
          if (status.authenticated) {
            window.location.href = getSafeReturnUrl();
            return;
          }
        }
      } catch {
        // Continue to show login form even if status check fails
      }

      setIsChecking(false);

      // Auto-submit URL token (from console clickable URL) — only once
      if (!hasAutoSubmitted.current) {
        const urlToken = searchParams.get("token");
        if (urlToken) {
          hasAutoSubmitted.current = true;
          setToken(urlToken);
          await submitToken(urlToken);
        }
      }
    }

    void checkAndAutoSubmit();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: run once on mount
  }, []);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    void submitToken(token);
  }

  // Show minimal loading state while checking auth status
  if (isChecking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950">
        <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 p-4">
      <div className="w-full max-w-sm">
        {/* Branding */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4"
            style={{
              background: "linear-gradient(135deg, #3B82F6 0%, #A855F7 50%, #EC4899 100%)",
            }}
          >
            <span className="text-white font-bold text-2xl select-none">W</span>
          </div>
          <h1 className="text-white text-xl font-semibold">Weave Fleet</h1>
          <p className="text-slate-400 text-sm mt-1">Enter your access token to continue</p>
        </div>

        {/* Login card */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-2xl">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="token-input"
                className="block text-sm font-medium text-slate-300 mb-2"
              >
                Access Token
              </label>
              <input
                id="token-input"
                type="password"
                autoComplete="one-time-code"
                value={token}
                onChange={(e) => {
                  setToken(e.target.value);
                  if (error) setError(null);
                }}
                placeholder="Paste token from server console"
                disabled={isSubmitting}
                className={[
                  "w-full px-3 py-2 bg-slate-800 border rounded-lg text-white text-sm",
                  "placeholder:text-slate-500",
                  "focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent",
                  "disabled:opacity-50 disabled:cursor-not-allowed",
                  error
                    ? "border-red-500 focus:ring-red-500"
                    : "border-slate-700",
                ].join(" ")}
              />
              {error && (
                <p className="mt-2 text-sm text-red-400" role="alert">
                  {error}
                </p>
              )}
            </div>

            <button
              type="submit"
              disabled={isSubmitting || !token.trim()}
              className={[
                "w-full py-2 px-4 rounded-lg font-medium text-sm transition-colors",
                "focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-slate-900",
                "disabled:opacity-50 disabled:cursor-not-allowed",
                "bg-blue-600 hover:bg-blue-500 text-white",
              ].join(" ")}
            >
              {isSubmitting ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Signing in…
                </span>
              ) : (
                "Sign In"
              )}
            </button>
          </form>
        </div>

        {/* Help text */}
        <p className="mt-4 text-center text-xs text-slate-500">
          Find your token in the server console output.
        </p>
      </div>
    </div>
  );
}
