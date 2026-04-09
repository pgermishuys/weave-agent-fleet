"use client";

import { Button } from "@/components/ui/button";
import { Menu, Plus } from "lucide-react";
import { NewSessionDialog } from "@/components/session/new-session-dialog";
import { useCurrentSessionDirectory } from "@/hooks/use-current-session-directory";
import { useSidebar } from "@/contexts/sidebar-context";

interface HeaderProps {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}

export function Header({ title, subtitle, actions }: HeaderProps) {
  const { isMobileNav, mobileDrawerOpen, setMobileDrawerOpen } = useSidebar();

  return (
    <header className="flex h-14 items-center justify-between border-b border-border px-4 sm:px-6">
      <div className="flex items-center gap-2 min-w-0">
        {isMobileNav && (
          <Button
            variant="ghost"
            size="icon"
            aria-label="Open menu"
            aria-expanded={mobileDrawerOpen}
            onClick={() => setMobileDrawerOpen(true)}
            className="shrink-0 fold:hidden"
          >
            <Menu className="h-5 w-5" />
          </Button>
        )}
        <div className="min-w-0">
          <h2 className="text-base sm:text-lg font-semibold truncate">{title}</h2>
          {subtitle && (
            <p className="text-xs text-muted-foreground truncate">{subtitle}</p>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1 sm:gap-2 shrink-0">
        {actions}
      </div>
    </header>
  );
}

export function NewSessionButton() {
  const currentDirectory = useCurrentSessionDirectory();
  return (
    <NewSessionDialog
      defaultDirectory={currentDirectory}
      trigger={
        <Button size="sm" className="gap-1.5 weave-gradient-bg hover:opacity-90 border-0">
          <Plus className="h-3.5 w-3.5" />
          <span className="hidden xs:inline">New Session</span>
          <span className="xs:hidden">New</span>
        </Button>
      }
    />
  );
}
