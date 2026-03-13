import type { GlobalShortcut } from "@/lib/command-registry";

export interface KeyBinding {
  paletteHotkey: string | null;
  globalShortcut: GlobalShortcut | null;
}

export type KeyBindingsConfig = Record<string, KeyBinding>;

export const DEFAULT_KEYBINDINGS: KeyBindingsConfig = {
  "nav-fleet":          { paletteHotkey: "f", globalShortcut: null },
  "nav-settings":       { paletteHotkey: "s", globalShortcut: null },
  "toggle-sidebar":     { paletteHotkey: "b", globalShortcut: { key: "b", platformModifier: true } },
  "new-session":        { paletteHotkey: "n", globalShortcut: null },
  "refresh-sessions":   { paletteHotkey: "r", globalShortcut: null },
  "focus-prompt":       { paletteHotkey: "/", globalShortcut: null },
  "interrupt-session":  { paletteHotkey: null, globalShortcut: { key: "Escape" } },
};
