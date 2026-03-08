"use client";

import { useEffect, useCallback, useState } from "react";
import { Plus, RefreshCw } from "lucide-react";
import { useCommandRegistry } from "@/contexts/command-registry-context";
import { useSessionsContext } from "@/contexts/sessions-context";
import { NewSessionDialog } from "@/components/session/new-session-dialog";
import { useKeybindings } from "@/contexts/keybindings-context";
import { useCurrentSessionDirectory } from "@/hooks/use-current-session-directory";

export function SessionCommands() {
  const { registerCommand, unregisterCommand } = useCommandRegistry();
  const { refetch } = useSessionsContext();
  const { bindings } = useKeybindings();
  const [dialogOpen, setDialogOpen] = useState(false);
  const currentDirectory = useCurrentSessionDirectory();

  const openNewSession = useCallback(() => setDialogOpen(true), []);
  const refreshSessions = useCallback(() => refetch(), [refetch]);

  useEffect(() => {
    registerCommand({
      id: "new-session",
      label: "New Session",
      icon: Plus,
      category: "Session",
      paletteHotkey: bindings["new-session"]?.paletteHotkey ?? undefined,
      keywords: ["create", "spawn", "start"],
      action: openNewSession,
    });
    registerCommand({
      id: "refresh-sessions",
      label: "Refresh Sessions",
      icon: RefreshCw,
      category: "Session",
      paletteHotkey: bindings["refresh-sessions"]?.paletteHotkey ?? undefined,
      keywords: ["reload", "update"],
      action: refreshSessions,
    });

    return () => {
      unregisterCommand("new-session");
      unregisterCommand("refresh-sessions");
    };
  }, [registerCommand, unregisterCommand, bindings, openNewSession, refreshSessions]);

  return (
    <NewSessionDialog open={dialogOpen} onOpenChange={setDialogOpen} defaultDirectory={currentDirectory} />
  );
}
