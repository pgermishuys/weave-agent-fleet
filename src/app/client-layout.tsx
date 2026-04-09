"use client";

import { SessionsProvider } from "@/contexts/sessions-context";
import { SidebarProvider } from "@/contexts/sidebar-context";
import { KeybindingsProvider } from "@/contexts/keybindings-context";
import { CommandRegistryProvider } from "@/contexts/command-registry-context";
import { ThemeProvider } from "@/contexts/theme-context";
import { IntegrationsProvider } from "@/contexts/integrations-context";
import { GitHubRepoCacheWarmer } from "@/integrations/github/components/repo-cache-warmer";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Sidebar } from "@/components/layout/sidebar";
import { NavigationCommands } from "@/components/commands/navigation-commands";
import { ViewCommands } from "@/components/commands/view-commands";
import { SessionCommands } from "@/components/commands/session-commands";
import { CommandPalette } from "@/components/command-palette";
import { useRef, useCallback, lazy, Suspense } from "react";
import { useSidebar } from "@/contexts/sidebar-context";
import { useVisualViewport } from "@/hooks/use-visual-viewport";
import { usePathname } from "next/navigation";

// Dynamically import Tauri-only dialog — not needed in mobile web bundle
const TauriUpdateDialog = lazy(() =>
  import("@/components/tauri-update-dialog").then((m) => ({ default: m.TauriUpdateDialog }))
);

function SwipeableLayout({ children }: { children: React.ReactNode }) {
  const { isMobileNav, mobileDrawerOpen, setMobileDrawerOpen } = useSidebar();
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (!isMobileNav || mobileDrawerOpen) return;
    const touch = e.touches[0];
    // Only track touches starting from the left edge (first 24px)
    if (touch.clientX <= 24) {
      touchStartX.current = touch.clientX;
      touchStartY.current = touch.clientY;
    } else {
      touchStartX.current = null;
    }
  }, [isMobileNav, mobileDrawerOpen]);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (touchStartX.current === null || touchStartY.current === null) return;
    const touch = e.changedTouches[0];
    const dx = touch.clientX - touchStartX.current;
    const dy = Math.abs(touch.clientY - touchStartY.current);
    // Open if horizontal movement >= 50px and mostly horizontal (not a scroll)
    if (dx >= 50 && dy < 60) {
      setMobileDrawerOpen(true);
    }
    touchStartX.current = null;
    touchStartY.current = null;
  }, [setMobileDrawerOpen]);

  return (
    <div
      className="flex h-screen overflow-hidden"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      <Sidebar />
      <main className="flex-1 overflow-auto thin-scrollbar">{children}</main>
    </div>
  );
}

export function ClientLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isLoginPage = pathname === "/login";

  // Keep --visual-vh CSS property in sync with the actual visible viewport
  // (shrinks when the mobile virtual keyboard opens, unlike dvh on Android)
  useVisualViewport();

  // Login page: render children directly without providers, sidebar, or
  // any components that make authenticated API calls. This prevents the
  // sidebar/icon rail from showing and avoids spurious 401 errors from
  // SessionsProvider, SSE hooks, etc. when the user is not yet authenticated.
  if (isLoginPage) {
    return <>{children}</>;
  }

  return (
    <ThemeProvider>
      <SessionsProvider>
        <IntegrationsProvider>
          <GitHubRepoCacheWarmer />
          <SidebarProvider>
            <KeybindingsProvider>
              <CommandRegistryProvider>
                <TooltipProvider delayDuration={0}>
                  <SwipeableLayout>{children}</SwipeableLayout>
                </TooltipProvider>
                <NavigationCommands />
                <ViewCommands />
                <SessionCommands />
                <CommandPalette />
                <Suspense><TauriUpdateDialog /></Suspense>
              </CommandRegistryProvider>
            </KeybindingsProvider>
          </SidebarProvider>
        </IntegrationsProvider>
      </SessionsProvider>
    </ThemeProvider>
  );
}
