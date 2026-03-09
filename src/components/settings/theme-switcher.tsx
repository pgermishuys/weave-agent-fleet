"use client";

import { useTheme, type Theme } from "@/contexts/theme-context";
import { cn } from "@/lib/utils";
import { Check } from "lucide-react";

const themes: { id: Theme; label: string; colors: { bg: string; card: string; accent: string; text: string } }[] = [
  {
    id: "default",
    label: "Default Dark",
    colors: { bg: "#0F172A", card: "#1E293B", accent: "#A855F7", text: "#F8FAFC" },
  },
  {
    id: "black",
    label: "Dark (Black)",
    colors: { bg: "#000000", card: "#0A0A0A", accent: "#A855F7", text: "#FAFAFA" },
  },
  {
    id: "light",
    label: "Light",
    colors: { bg: "#FFFFFF", card: "#F1F5F9", accent: "#9333EA", text: "#0F172A" },
  },
];

export function ThemeSwitcher() {
  const { theme, setTheme } = useTheme();

  return (
    <div className="grid grid-cols-3 gap-3">
      {themes.map((t) => {
        const isActive = theme === t.id;
        return (
          <button
            key={t.id}
            onClick={() => setTheme(t.id)}
            className={cn(
              "relative flex flex-col items-center gap-2 rounded-lg border-2 p-3 transition-all",
              "hover:border-primary/50",
              isActive
                ? "border-primary bg-primary/5"
                : "border-border bg-card"
            )}
          >
            {/* Mini swatch preview */}
            <div
              className="w-full aspect-[4/3] rounded-md overflow-hidden border border-border/50"
              style={{ backgroundColor: t.colors.bg }}
            >
              <div className="p-1.5 h-full flex flex-col gap-1">
                {/* Mini "sidebar" + "content" layout */}
                <div className="flex gap-1 flex-1">
                  <div
                    className="w-1/3 rounded-sm"
                    style={{ backgroundColor: t.colors.card }}
                  />
                  <div className="flex-1 flex flex-col gap-0.5">
                    <div
                      className="h-1.5 w-3/4 rounded-full"
                      style={{ backgroundColor: t.colors.accent }}
                    />
                    <div
                      className="h-1 w-1/2 rounded-full opacity-50"
                      style={{ backgroundColor: t.colors.text }}
                    />
                    <div
                      className="h-1 w-2/3 rounded-full opacity-30"
                      style={{ backgroundColor: t.colors.text }}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Label */}
            <span className="text-xs font-medium">{t.label}</span>

            {/* Checkmark */}
            {isActive && (
              <div className="absolute top-1.5 right-1.5 h-4 w-4 rounded-full bg-primary flex items-center justify-center">
                <Check className="h-2.5 w-2.5 text-primary-foreground" />
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}
