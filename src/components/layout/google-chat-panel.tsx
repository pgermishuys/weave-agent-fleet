"use client";

import { MessageSquare } from "lucide-react";
import { useIntegrationsContext } from "@/contexts/integrations-context";
import { lazy, Suspense } from "react";

const GoogleChatBrowser = lazy(() =>
  import("@/integrations/google-chat/browser").then((m) => ({
    default: m.GoogleChatBrowser,
  }))
);

export function GoogleChatPanel() {
  const { connectedIntegrations } = useIntegrationsContext();
  const isConnected = connectedIntegrations.some((i) => i.id === "google-chat");

  return (
    <nav className="flex-1 overflow-y-auto thin-scrollbar p-2 space-y-1">
      {/* Header row */}
      <div className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground">
        <MessageSquare className="h-4 w-4 shrink-0" />
        <span className="flex-1 whitespace-nowrap">Google Chat</span>
      </div>

      {!isConnected && (
        <p className="px-3 py-2 text-xs text-muted-foreground">
          Google Chat is not connected. Open Settings to connect.
        </p>
      )}

      {isConnected && (
        <div className="px-2 pt-1">
          <Suspense fallback={null}>
            <GoogleChatBrowser />
          </Suspense>
        </div>
      )}
    </nav>
  );
}
