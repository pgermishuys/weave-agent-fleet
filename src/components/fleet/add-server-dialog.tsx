"use client";

import { useState, useEffect } from "react";
import { Loader2, AlertCircle, CheckCircle2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useFleetConnections } from "@/hooks/use-fleet-connections";
import type { FleetConnection } from "@/lib/fleet-connection-registry";

interface AddServerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When provided, dialog is in edit mode and pre-fills with connection data */
  editConnection?: FleetConnection;
}

interface TestedIdentity {
  name: string;
  version: string;
  capabilities: string[];
}

function generateId(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    || `server-${Date.now()}`;
}

export function AddServerDialog({
  open,
  onOpenChange,
  editConnection,
}: AddServerDialogProps) {
  const { addConnection, updateConnection } = useFleetConnections();
  const isEditMode = !!editConnection;

  const [url, setUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [testedIdentity, setTestedIdentity] = useState<TestedIdentity | null>(null);

  // Pre-fill when edit mode
  useEffect(() => {
    if (open && editConnection) {
      setUrl(editConnection.url);
      setApiKey(editConnection.token ?? "");
      setDisplayName(editConnection.name);
      setTestedIdentity(null);
      setError(undefined);
    } else if (!open) {
      // Reset on close
      setUrl("");
      setApiKey("");
      setDisplayName("");
      setIsLoading(false);
      setError(undefined);
      setTestedIdentity(null);
    }
  }, [open, editConnection]);

  const handleTest = async () => {
    if (!url.trim()) {
      setError("Please enter a URL.");
      return;
    }

    setIsLoading(true);
    setError(undefined);
    setTestedIdentity(null);

    const normalizedUrl = url.trim().replace(/\/$/, "");

    try {
      const headers: Record<string, string> = {};
      if (apiKey.trim()) {
        headers["Authorization"] = `Bearer ${apiKey.trim()}`;
      }

      const response = await fetch(`${normalizedUrl}/api/fleet/identity`, {
        headers,
        signal: AbortSignal.timeout(10_000),
      });

      if (response.status === 401) {
        setError("Invalid API key — check the key and try again.");
        return;
      }

      if (!response.ok) {
        setError(`Server responded with ${response.status}. Check the URL.`);
        return;
      }

      const identity = (await response.json()) as TestedIdentity;
      setTestedIdentity(identity);
      if (!displayName.trim()) {
        setDisplayName(identity.name);
      }
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "TimeoutError") {
        setError("Could not reach server at that URL — request timed out.");
      } else {
        setError("Could not reach server at that URL — check the URL and your network.");
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = () => {
    if (!testedIdentity && !isEditMode) return;

    const normalizedUrl = url.trim().replace(/\/$/, "");
    const name = displayName.trim() || testedIdentity?.name || normalizedUrl;

    if (isEditMode && editConnection) {
      updateConnection(editConnection.id, {
        url: normalizedUrl,
        name,
        token: apiKey.trim() || undefined,
      });
    } else {
      const id = generateId(name);
      addConnection({
        id,
        name,
        url: normalizedUrl,
        token: apiKey.trim() || undefined,
        isLocal: false,
      });
    }

    onOpenChange(false);
  };

  const handleCancel = () => {
    onOpenChange(false);
  };

  const canSave = isEditMode ? true : !!testedIdentity;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isEditMode ? `Edit "${editConnection?.name}"` : "Add Fleet Server"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* URL */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="server-url">
              URL
            </label>
            <Input
              id="server-url"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                setTestedIdentity(null);
                setError(undefined);
              }}
              placeholder="https://dev.company.com:3000"
              disabled={isLoading}
            />
          </div>

          {/* API Key */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="server-api-key">
              API Key
            </label>
            <Input
              id="server-api-key"
              type="password"
              value={apiKey}
              onChange={(e) => {
                setApiKey(e.target.value);
                setTestedIdentity(null);
                setError(undefined);
              }}
              placeholder="••••••••••••"
              disabled={isLoading}
            />
            <p className="text-[10px] text-muted-foreground">
              Stored in browser local storage. Use the desktop app for secure key storage.
            </p>
          </div>

          {/* Display Name */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="server-display-name">
              Display Name
            </label>
            <Input
              id="server-display-name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="My Fleet Server"
              disabled={isLoading}
            />
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-start gap-2 rounded-md bg-red-500/10 border border-red-500/20 px-3 py-2 text-xs text-red-600 dark:text-red-400">
              <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Success — tested identity */}
          {testedIdentity && (
            <div className="flex items-start gap-2 rounded-md bg-green-500/10 border border-green-500/20 px-3 py-2 text-xs text-green-700 dark:text-green-400">
              <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <div className="space-y-0.5">
                <p className="font-medium">{testedIdentity.name} v{testedIdentity.version}</p>
                {testedIdentity.capabilities.length > 0 && (
                  <p className="text-[10px] opacity-80">
                    {testedIdentity.capabilities.join(", ")}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={handleCancel} disabled={isLoading}>
            Cancel
          </Button>
          {!isEditMode && (
            <Button
              type="button"
              variant="outline"
              onClick={handleTest}
              disabled={isLoading || !url.trim()}
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Connecting…
                </>
              ) : (
                "Connect"
              )}
            </Button>
          )}
          <Button
            type="button"
            onClick={handleSave}
            disabled={!canSave || isLoading}
            className="weave-gradient-bg hover:opacity-90 border-0"
          >
            {isEditMode ? "Save" : "Add Server"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
