"use client";

import { createContext, useContext, useEffect } from "react";
import { usePersistedState } from "@/hooks/use-persisted-state";

export type Theme = "default" | "black" | "light";

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  /** "dark" for both default and black themes; "light" for light theme */
  resolvedTheme: "dark" | "light";
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function applyThemeClasses(theme: Theme) {
  const html = document.documentElement;
  html.classList.remove("dark", "theme-black", "theme-light");

  switch (theme) {
    case "black":
      html.classList.add("dark", "theme-black");
      break;
    case "light":
      html.classList.add("theme-light");
      break;
    case "default":
    default:
      html.classList.add("dark");
      break;
  }
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = usePersistedState<Theme>("weave-theme", "default");

  useEffect(() => {
    applyThemeClasses(theme);
  }, [theme]);

  const resolvedTheme = theme === "light" ? "light" : "dark";

  return (
    <ThemeContext.Provider value={{ theme, setTheme, resolvedTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}
