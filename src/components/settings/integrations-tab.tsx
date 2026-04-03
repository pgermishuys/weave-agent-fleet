"use client";

import { Suspense } from "react";
import { Wifi, WifiOff, RefreshCw, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useIntegrationsContext } from "@/contexts/integrations-context";
import { getIntegrations } from "@/integrations/registry";
import { useGitHubRepos } from "@/integrations/github/hooks/use-github-repos";
import { useGoogleChatSpaces } from "@/integrations/google-chat/hooks/use-google-chat-spaces";
import { handleDisconnectGoogleChat } from "@/integrations/google-chat/settings";

function formatRelativeTime(ts: number | null): string {
  if (ts === null) return "Never";
  const seconds = Math.floor((Date.now() - ts) / 1000);
  if (seconds < 60) return "Just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function GitHubConnectedActions({
  onDisconnect,
}: {
  onDisconnect: () => void;
}) {
  const { repos, isLoading, lastUpdated, refresh } = useGitHubRepos();

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={onDisconnect}>
          Disconnect
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={refresh}
          disabled={isLoading}
        >
          {isLoading ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <RefreshCw className="h-3 w-3" />
          )}
          Refresh repos
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {repos.length} repos loaded · Updated {formatRelativeTime(lastUpdated)}
      </p>
    </div>
  );
}

function GoogleChatConnectedActions({
  onDisconnect,
}: {
  onDisconnect: () => void;
}) {
  const { spaces, isLoading, lastUpdated, refresh } = useGoogleChatSpaces();

  function handleDisconnect() {
    handleDisconnectGoogleChat();
    onDisconnect();
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={handleDisconnect}>
          Disconnect
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={refresh}
          disabled={isLoading}
        >
          {isLoading ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <RefreshCw className="h-3 w-3" />
          )}
          Refresh spaces
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {spaces.length} spaces loaded · Updated {formatRelativeTime(lastUpdated)}
      </p>
    </div>
  );
}

export function IntegrationsTab() {
  const { connect, disconnect, integrations } = useIntegrationsContext();
  const manifests = getIntegrations();

  const isConnected = (id: string) =>
    integrations.some((i) => i.id === id && i.status === "connected");

  if (manifests.length === 0) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Connect external services to browse their content and create sessions
          with context.
        </p>
        <p className="text-sm text-muted-foreground italic">
          No integrations available.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Connect external services to browse their content and create sessions
        with context.
      </p>

      <div className="grid gap-4 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
        {manifests.map((manifest) => {
          const connected = isConnected(manifest.id);
          const Icon = manifest.icon;
          const SettingsComponent = manifest.settingsComponent;

          return (
            <Card key={manifest.id} className={connected ? "" : "opacity-80"}>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Icon size={20} />
                    <h4 className="text-sm font-semibold">{manifest.name}</h4>
                  </div>
                  {connected ? (
                    <Badge
                      variant="secondary"
                      className="text-[10px] bg-green-500/10 text-green-600 dark:text-green-400"
                    >
                      <Wifi className="h-3 w-3 mr-1" />
                      Connected
                    </Badge>
                  ) : (
                    <Badge
                      variant="outline"
                      className="text-[10px] text-muted-foreground"
                    >
                      <WifiOff className="h-3 w-3 mr-1" />
                      Not Connected
                    </Badge>
                  )}
                </div>

                {connected ? (
                  manifest.id === "github" ? (
                    <GitHubConnectedActions
                      onDisconnect={() => disconnect(manifest.id)}
                    />
                  ) : manifest.id === "google-chat" ? (
                    <GoogleChatConnectedActions
                      onDisconnect={() => disconnect(manifest.id)}
                    />
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => disconnect(manifest.id)}
                    >
                      Disconnect
                    </Button>
                  )
                ) : SettingsComponent ? (
                  <Suspense fallback={null}>
                    <SettingsComponent />
                  </Suspense>
                ) : (
                  <p className="text-xs text-muted-foreground italic">
                    No configuration available.
                  </p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
