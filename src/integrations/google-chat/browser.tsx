"use client";

import { MessageSquare } from "lucide-react";
import { SpaceSelector } from "./components/space-selector";
import { MessageList } from "./components/message-list";
import { usePersistedState } from "@/hooks/use-persisted-state";
import { useIntegrationsContext } from "@/contexts/integrations-context";
import { useGoogleChatSpaces } from "./hooks/use-google-chat-spaces";
import { GOOGLE_CHAT_LAST_SPACE_KEY } from "./storage";
import type { GoogleChatSpace } from "./types";

function GoogleChatBrowserInner({
  selectedSpace,
}: {
  selectedSpace: GoogleChatSpace;
}) {
  const spaceId = selectedSpace.name.split("/").pop() ?? selectedSpace.name;
  return <MessageList spaceId={spaceId} />;
}

export function GoogleChatBrowser() {
  const { connectedIntegrations } = useIntegrationsContext();
  const isConnected = connectedIntegrations.some(
    (i) => i.id === "google-chat"
  );
  const { refresh: refreshSpaces } = useGoogleChatSpaces();

  const [selectedSpace, setSelectedSpace] =
    usePersistedState<GoogleChatSpace | null>(GOOGLE_CHAT_LAST_SPACE_KEY, null);

  if (!isConnected) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-2 text-center">
        <MessageSquare className="h-8 w-8 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">
          Google Chat is not connected.
        </p>
        <p className="text-xs text-muted-foreground">
          Connect Google Chat in Settings to browse spaces and messages.
        </p>
      </div>
    );
  }

  return (
    <div>
      {/* Space selector bar */}
      <div className="mb-4">
        <SpaceSelector
          selected={selectedSpace}
          onSelect={(space) => {
            setSelectedSpace(space);
            refreshSpaces();
          }}
        />
      </div>

      {selectedSpace ? (
        <GoogleChatBrowserInner selectedSpace={selectedSpace} />
      ) : (
        <div className="flex flex-col items-center justify-center py-16 gap-2 text-center">
          <p className="text-sm text-muted-foreground">
            Select a space to browse messages.
          </p>
        </div>
      )}
    </div>
  );
}

export default GoogleChatBrowser;
