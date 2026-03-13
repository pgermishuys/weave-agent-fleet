"use client";

import { useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { LayoutGrid, Settings } from "lucide-react";
import { useCommandRegistry } from "@/contexts/command-registry-context";
import { useKeybindings } from "@/contexts/keybindings-context";

export function NavigationCommands() {
  const { registerCommand, unregisterCommand } = useCommandRegistry();
  const { bindings } = useKeybindings();
  const router = useRouter();

  const goToFleet = useCallback(() => router.push("/"), [router]);
  const goToSettings = useCallback(() => router.push("/settings"), [router]);

  useEffect(() => {
    registerCommand({
      id: "nav-fleet",
      label: "Go to Fleet",
      icon: LayoutGrid,
      category: "Navigation",
      paletteHotkey: bindings["nav-fleet"]?.paletteHotkey ?? undefined,
      keywords: ["home", "dashboard", "sessions"],
      action: goToFleet,
    });
    registerCommand({
      id: "nav-settings",
      label: "Go to Settings",
      icon: Settings,
      category: "Navigation",
      paletteHotkey: bindings["nav-settings"]?.paletteHotkey ?? undefined,
      keywords: ["preferences", "config"],
      action: goToSettings,
    });

    return () => {
      unregisterCommand("nav-fleet");
      unregisterCommand("nav-settings");
    };
  }, [
    registerCommand,
    unregisterCommand,
    bindings,
    goToFleet,
    goToSettings,
  ]);

  return null;
}
