"use client";

import { useEffect, useState, useCallback } from "react";
import { Loader2, FolderOpen, ExternalLink, RefreshCw } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useConfig } from "@/hooks/use-config";
import { useGlobalSSE } from "@/hooks/use-global-sse";
import { apiFetch } from "@/lib/api-client";
import { isTauri, tauriInvoke } from "@/lib/tauri";
import { useUpdatePreferences } from "@/lib/update-preferences";
import type {
  StandaloneUpdateStatusResponse,
  UpdateChannel,
  VersionResponse,
} from "@/lib/api-types";

interface VersionInfo {
  version: string;
  latest: string | null;
  updateAvailable: boolean;
  checkedAt: string | null;
  channel?: "stable" | "dev";
  installFlavor?: "standalone" | "tauri" | "web";
  canSelfUpdate?: boolean;
}

type UpdateState = "idle" | "scheduled" | "stopping" | "installing" | "restarting";

function isUpdateInProgress(state: string): state is UpdateState {
  return (
    state === "scheduled" ||
    state === "stopping" ||
    state === "installing" ||
    state === "restarting"
  );
}

function formatStandaloneMessage(status: StandaloneUpdateStatusResponse): string {
  switch (status.state) {
    case "scheduled":
      return `Standalone ${status.channel ?? "stable"} update scheduled.`;
    case "stopping":
      return "Stopping server for standalone update...";
    case "installing":
      return "Installing standalone update...";
    case "restarting":
      return "Restarting standalone server...";
    case "completed":
      return "Standalone update completed. Reloading...";
    case "failed":
      return status.error ?? "Standalone update failed.";
    default:
      return "";
  }
}

function isLoopbackBrowserHost(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
}

export function AboutTab() {
  const tauri = isTauri();
  const sse = useGlobalSSE();
  const localBrowserSession =
    typeof window !== "undefined" && isLoopbackBrowserHost(window.location.hostname);
  const { paths, isLoading: configLoading } = useConfig();
  const [updatePreferences, setUpdatePreferences] = useUpdatePreferences();
  const [versionInfo, setVersionInfo] = useState<VersionInfo | null>(null);
  const [versionLoading, setVersionLoading] = useState(true);
  const [updatingChannel, setUpdatingChannel] = useState<UpdateChannel | null>(null);
  const [updateMessage, setUpdateMessage] = useState<string | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);

  useEffect(() => {
    setVersionLoading(true);
    apiFetch(`/api/version?channel=${updatePreferences.channel}`)
      .then((res) => res.json())
      .then(setVersionInfo)
      .catch(() => {})
      .finally(() => setVersionLoading(false));
  }, [updatePreferences.channel]);

  const loadVersionInfo = useCallback(async () => {
    const response = await apiFetch(`/api/version?channel=${updatePreferences.channel}`);
    const payload = (await response.json()) as VersionResponse;
    setVersionInfo(payload);
    return payload;
  }, [updatePreferences.channel]);

  const loadStandaloneStatus = useCallback(async () => {
    const response = await apiFetch("/api/update");
    if (!response.ok) {
      return null;
    }

    const status = (await response.json()) as StandaloneUpdateStatusResponse;
    if (status.state === "failed") {
      setUpdateError(status.error ?? "Standalone update failed.");
    } else {
      setUpdateError(null);
    }

    const message = formatStandaloneMessage(status);
    setUpdateMessage(message || null);

    if (!isUpdateInProgress(status.state)) {
      setUpdatingChannel(null);
    }

    if (status.state === "completed") {
      const latestVersion = await loadVersionInfo().catch(() => null);
      if (latestVersion) {
        setTimeout(() => window.location.reload(), 500);
      }
    }

    return status;
  }, [loadVersionInfo]);

  const handleForceUpdate = useCallback(async (channel: UpdateChannel) => {
    setUpdateMessage(null);
    setUpdateError(null);
    setUpdatingChannel(channel);

    try {
      if (tauri) {
        const available = await tauriInvoke<{ version: string; current_version: string } | null>(
          "check_for_updates",
        );

        if (!available) {
          setUpdateMessage(`No ${channel} update is currently available.`);
          return;
        }

        setUpdateMessage(`Installing ${channel} v${available.version}...`);
        await tauriInvoke("install_update");
        return;
      }

      const response = await apiFetch("/api/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? "Failed to schedule standalone update.");
      }

      const status = (await response.json()) as StandaloneUpdateStatusResponse;
      setUpdateMessage(formatStandaloneMessage(status));
    } catch (error) {
      setUpdateError(
        error instanceof Error ? error.message : "Failed to start the update.",
      );
      setUpdatingChannel(null);
    } finally {
      if (tauri) {
        setUpdatingChannel(null);
      }
    }
  }, [tauri]);

  useEffect(() => {
    if (!versionInfo?.canSelfUpdate || versionInfo.installFlavor !== "standalone") {
      return;
    }

    void loadStandaloneStatus();
  }, [versionInfo?.canSelfUpdate, versionInfo?.installFlavor, loadStandaloneStatus]);

  useEffect(() => {
    const handler = (event: unknown) => {
      const payload = (event as { payload?: { state?: string; message?: string } }).payload;
      if (!payload?.state) return;
      if (payload.message) {
        setUpdateMessage(payload.message);
      }
      if (!isUpdateInProgress(payload.state)) {
        setUpdatingChannel(null);
      }
    };

    sse.on("standalone_update", handler);
    return () => {
      sse.off("standalone_update", handler);
    };
  }, [sse]);

  useEffect(() => {
    if (versionInfo?.installFlavor !== "standalone" || !versionInfo.canSelfUpdate) {
      return;
    }

    const interval = setInterval(() => {
      void loadStandaloneStatus();
    }, 3000);

    return () => clearInterval(interval);
  }, [versionInfo?.canSelfUpdate, versionInfo?.installFlavor, loadStandaloneStatus]);

  const isLoading = configLoading || versionLoading;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-xl">
      <Card>
        <CardContent className="p-4 space-y-3">
          <h4 className="text-sm font-semibold">Version</h4>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                Weave Fleet
              </span>
              <div className="flex items-center gap-2">
                <code className="text-sm font-mono">
                  v{versionInfo?.version ?? "unknown"}
                </code>
                {versionInfo?.updateAvailable && (
                  <Badge
                    variant="secondary"
                    className="text-[10px] bg-blue-500/10 text-blue-600 dark:text-blue-400"
                  >
                    Update available: v{versionInfo.latest}
                  </Badge>
                )}
                {versionInfo?.channel === "dev" && (
                  <Badge variant="outline" className="text-[10px]">
                    Dev channel
                  </Badge>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 space-y-4">
          <h4 className="text-sm font-semibold">Updates</h4>

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm">Auto-update</p>
                <p className="text-xs text-muted-foreground">
                  Download in background and apply on next start
                </p>
              </div>
              <Switch
                checked={updatePreferences.autoUpdate}
                onCheckedChange={(checked) =>
                  setUpdatePreferences((prev) => ({
                    ...prev,
                    autoUpdate: checked,
                  }))
                }
              />
            </div>

            <div className="space-y-2">
              <p className="text-sm">Update Channel</p>
              <Select
                value={updatePreferences.channel}
                onValueChange={(value) =>
                  setUpdatePreferences((prev) => ({
                    ...prev,
                    channel: value === "dev" ? "dev" : "stable",
                  }))
                }
              >
                <SelectTrigger className="w-[220px]">
                  <SelectValue placeholder="Select channel" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="stable">stable</SelectItem>
                  <SelectItem value="dev">dev</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                The dev channel tracks `main` and may be less stable.
              </p>
            </div>

            <div className="text-xs text-muted-foreground">
              Mode: {updatePreferences.autoUpdate ? "auto-download" : "manual"} ·
              Channel: {updatePreferences.channel}
            </div>

            {(tauri ||
              (versionInfo?.installFlavor === "standalone" && versionInfo.canSelfUpdate)) && (
              <div className="space-y-2">
                <p className="text-sm">Force Update</p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    onClick={() => void handleForceUpdate(updatePreferences.channel)}
                    disabled={updatingChannel !== null || (!tauri && !localBrowserSession)}
                    className="gap-1.5"
                  >
                    {updatingChannel === updatePreferences.channel ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="h-3.5 w-3.5" />
                    )}
                    Force update {updatePreferences.channel}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  {tauri
                    ? "Immediately checks the selected channel and installs the latest available build."
                    : localBrowserSession
                      ? "Schedules a standalone self-update, restarts the server, then reconnects this browser session."
                      : "Available only from a local browser session on this machine."}
                </p>
                {updateMessage && (
                  <p className="text-xs text-muted-foreground">{updateMessage}</p>
                )}
                {updateError && (
                  <p className="text-xs text-red-600 dark:text-red-400">{updateError}</p>
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 space-y-3">
          <h4 className="text-sm font-semibold">Configuration Files</h4>
          <div className="space-y-2">
            <div className="flex items-start gap-2">
              <FolderOpen className="h-3.5 w-3.5 mt-0.5 text-muted-foreground shrink-0" />
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">User Config</p>
                <code className="text-xs font-mono break-all">
                  {paths?.userConfig ?? "~/.config/opencode/weave-opencode.jsonc"}
                </code>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <FolderOpen className="h-3.5 w-3.5 mt-0.5 text-muted-foreground shrink-0" />
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">Skills Directory</p>
                <code className="text-xs font-mono break-all">
                  {paths?.skillsDir ?? "~/.config/opencode/skills/"}
                </code>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 space-y-3">
          <h4 className="text-sm font-semibold">Links</h4>
          <div className="space-y-2">
            <a
              href="https://github.com/pgermishuys/weave-agent-fleet"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-sm text-blue-600 dark:text-blue-400 hover:text-blue-500 dark:hover:text-blue-300 transition-colors"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              GitHub Repository
            </a>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
