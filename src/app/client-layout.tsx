"use client";

import { SessionsProvider } from "@/contexts/sessions-context";
import { SidebarProvider } from "@/contexts/sidebar-context";
import { KeybindingsProvider } from "@/contexts/keybindings-context";
import { CommandRegistryProvider } from "@/contexts/command-registry-context";
import { ThemeProvider } from "@/contexts/theme-context";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Sidebar } from "@/components/layout/sidebar";
import { NavigationCommands } from "@/components/commands/navigation-commands";
import { ViewCommands } from "@/components/commands/view-commands";
import { SessionCommands } from "@/components/commands/session-commands";
import { CommandPalette } from "@/components/command-palette";
import { TauriUpdateDialog } from "@/components/tauri-update-dialog";

export function ClientLayout({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <SessionsProvider>
        <SidebarProvider>
          <KeybindingsProvider>
            <CommandRegistryProvider>
              <TooltipProvider delayDuration={0}>
                <div className="flex h-screen overflow-hidden">
                  <Sidebar />
                  <main className="flex-1 overflow-auto">{children}</main>
                </div>
              </TooltipProvider>
              <NavigationCommands />
              <ViewCommands />
              <SessionCommands />
              <CommandPalette />
              <TauriUpdateDialog />
            </CommandRegistryProvider>
          </KeybindingsProvider>
        </SidebarProvider>
      </SessionsProvider>
    </ThemeProvider>
  );
}
