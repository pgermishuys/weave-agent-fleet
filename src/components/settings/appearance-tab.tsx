"use client";

import { Card, CardContent } from "@/components/ui/card";
import { ThemeSwitcher } from "@/components/settings/theme-switcher";

export function AppearanceTab() {
  return (
    <div className="space-y-6 max-w-xl">
      <Card>
        <CardContent className="p-4 space-y-3">
          <h4 className="text-sm font-semibold">Theme</h4>
          <p className="text-sm text-muted-foreground">
            Choose the appearance for the dashboard.
          </p>
          <ThemeSwitcher />
        </CardContent>
      </Card>
    </div>
  );
}
