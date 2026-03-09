"use client";

import { Loader2, Plug, Wifi, WifiOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { useConfig } from "@/hooks/use-config";

function authTypeLabel(authType: "api" | "oauth" | "wellknown" | null): string {
  switch (authType) {
    case "api":
      return "API Key";
    case "oauth":
      return "OAuth";
    case "wellknown":
      return "Well-Known";
    default:
      return "";
  }
}

export function ProvidersTab() {
  const { providers, isLoading } = useConfig();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const connectedCount = providers.filter((p) => p.connected).length;

  if (connectedCount === 0) {
    return (
      <div className="space-y-4">
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <Plug className="h-8 w-8 mb-3 opacity-40" />
          <p className="text-sm">No providers connected</p>
          <p className="text-xs mt-1">
            Run{" "}
            <code className="font-mono text-[10px] bg-muted px-1 py-0.5 rounded">
              opencode auth &lt;provider&gt;
            </code>{" "}
            to connect a provider.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
          {providers.map((provider) => (
            <Card key={provider.id} className="opacity-60">
              <CardContent className="p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold">{provider.name}</h4>
                  <Badge variant="outline" className="text-[10px] text-muted-foreground">
                    <WifiOff className="h-3 w-3 mr-1" />
                    Not Connected
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  {provider.models.length} model{provider.models.length !== 1 ? "s" : ""} available
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {connectedCount} provider{connectedCount !== 1 ? "s" : ""} connected.
      </p>

      <div className="grid gap-4 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
        {providers.map((provider) => (
          <Card key={provider.id} className={provider.connected ? "" : "opacity-60"}>
            <CardContent className="p-4 space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold">{provider.name}</h4>
                {provider.connected ? (
                  <Badge
                    variant="secondary"
                    className="text-[10px] bg-green-500/10 text-green-600 dark:text-green-400"
                  >
                    <Wifi className="h-3 w-3 mr-1" />
                    Connected
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-[10px] text-muted-foreground">
                    <WifiOff className="h-3 w-3 mr-1" />
                    Not Connected
                  </Badge>
                )}
              </div>

              <div className="flex items-center gap-2">
                {provider.connected && provider.authType && (
                  <Badge variant="outline" className="text-[10px]">
                    {authTypeLabel(provider.authType)}
                  </Badge>
                )}
                <span className="text-xs text-muted-foreground">
                  {provider.models.length} model{provider.models.length !== 1 ? "s" : ""}
                </span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
