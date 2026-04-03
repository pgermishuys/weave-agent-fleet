"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  CheckCircle,
  AlertCircle,
  Loader2,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useIntegrationsContext } from "@/contexts/integrations-context";
import { apiFetch } from "@/lib/api-client";
import { clearGoogleChatClientState } from "./storage";
import type { AuthUrlResponse } from "@/app/api/integrations/google-chat/auth/_types";

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

type ConnectState =
  | { status: "idle" }
  | { status: "fetching-url" }
  | { status: "connecting" }
  | { status: "complete" }
  | { status: "error"; message: string };

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Google Chat settings component — OAuth Authorization Code + PKCE flow.
 *
 * Flow:
 *   1. User clicks "Connect with Google Chat"
 *   2. Frontend calls GET /api/integrations/google-chat/auth/url
 *   3. Opens the returned URL in a new window/tab
 *   4. Polls /api/integrations until google-chat appears as connected
 *   5. Shows success state
 */
export function GoogleChatSettings() {
  const { integrations, refetch } = useIntegrationsContext();

  const [connectState, setConnectState] = useState<ConnectState>({
    status: "idle",
  });

  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef = useRef(true);

  const isConnected = integrations.some(
    (i) => i.id === "google-chat" && i.status === "connected"
  );

  // Cleanup on unmount
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    };
  }, []);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  // Poll /api/integrations until google-chat is connected
  const startPolling = useCallback(() => {
    async function poll() {
      if (!isMountedRef.current) return;

      try {
        await refetch();
      } catch {
        // ignore refetch errors — keep polling
      }

      if (!isMountedRef.current) return;

      // Check after refetch whether we're now connected
      // refetch updates the integrations context — re-read via closure won't
      // work here, so we schedule the check via state update
      pollTimerRef.current = setTimeout(poll, 2000);
    }

    pollTimerRef.current = setTimeout(poll, 2000);
  }, [refetch]);

  // When integrations update and google-chat becomes connected, finalize
  useEffect(() => {
    if (
      isConnected &&
      (connectState.status === "connecting" ||
        connectState.status === "fetching-url")
    ) {
      stopPolling();
      setConnectState({ status: "complete" });
    }
  }, [isConnected, connectState.status, stopPolling]);

  async function handleConnect() {
    setConnectState({ status: "fetching-url" });
    stopPolling();

    let data: AuthUrlResponse;
    try {
      const res = await apiFetch("/api/integrations/google-chat/auth/url");
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        setConnectState({
          status: "error",
          message: err.error ?? "Failed to generate authorization URL",
        });
        return;
      }
      data = (await res.json()) as AuthUrlResponse;
    } catch {
      setConnectState({ status: "error", message: "Network error" });
      return;
    }

    // Open OAuth window
    window.open(data.authorizationUrl, "_blank", "noopener,noreferrer");

    setConnectState({ status: "connecting" });
    startPolling();
  }

  function handleCancel() {
    stopPolling();
    setConnectState({ status: "idle" });
  }

  function handleTryAgain() {
    stopPolling();
    setConnectState({ status: "idle" });
  }

  // When already connected, settings tab handles disconnect
  if (isConnected) {
    return null;
  }

  return (
    <div className="space-y-3">
      {connectState.status === "idle" && (
        <Button size="sm" className="w-full" onClick={handleConnect}>
          Connect with Google Chat
        </Button>
      )}

      {connectState.status === "fetching-url" && (
        <Button size="sm" className="w-full" disabled>
          <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
          Preparing authorization…
        </Button>
      )}

      {connectState.status === "connecting" && (
        <div className="space-y-3 rounded-md border p-3 text-sm">
          <p className="text-muted-foreground">
            A browser window has opened. Sign in with Google and grant access to
            Weave Agent Fleet.
          </p>

          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Waiting for authorization…
          </div>

          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={handleCancel}>
              Cancel
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={handleConnect}
              className="text-xs text-muted-foreground"
            >
              <ExternalLink className="h-3 w-3 mr-1" />
              Reopen window
            </Button>
          </div>
        </div>
      )}

      {connectState.status === "complete" && (
        <div className="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400">
          <CheckCircle className="h-3.5 w-3.5" />
          Connected successfully
        </div>
      )}

      {connectState.status === "error" && (
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-xs text-destructive">
            <AlertCircle className="h-3.5 w-3.5" />
            {connectState.message}
          </div>
          <Button size="sm" variant="outline" onClick={handleTryAgain}>
            Try Again
          </Button>
        </div>
      )}
    </div>
  );
}

// Export for disconnect handler (used by integrations-tab)
export { handleDisconnectGoogleChat };

function handleDisconnectGoogleChat() {
  clearGoogleChatClientState();
}
