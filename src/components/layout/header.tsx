"use client";

import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { NewSessionDialog } from "@/components/session/new-session-dialog";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { useCurrentSessionDirectory } from "@/hooks/use-current-session-directory";

interface HeaderProps {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}

export function Header({ title, subtitle, actions }: HeaderProps) {
  return (
    <header className="flex h-14 items-center justify-between border-b border-border px-6">
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        {subtitle && (
          <p className="text-xs text-muted-foreground">{subtitle}</p>
        )}
      </div>
      <div className="flex items-center gap-2">
        {actions}
        <NotificationBell />
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
          New Session
        </Button>
      }
    />
  );
}
