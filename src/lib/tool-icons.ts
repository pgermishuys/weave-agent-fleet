/**
 * Icon lookup map — maps icon name strings (from the server API)
 * to Lucide React components.
 *
 * The server sends `iconName` as a string because React components
 * can't be serialized to JSON. This module bridges the gap.
 */

import {
  Code2,
  MousePointer2,
  Terminal,
  FolderOpen,
  Wind,
  PenTool,
  Braces,
  SquareTerminal,
  AppWindow,
  Wrench,
} from "lucide-react";

type IconComponent = React.ComponentType<{ className?: string }>;

const TOOL_ICON_MAP: Record<string, IconComponent> = {
  "code-2": Code2,
  "mouse-pointer-2": MousePointer2,
  terminal: Terminal,
  "folder-open": FolderOpen,
  wind: Wind,
  "pen-tool": PenTool,
  braces: Braces,
  "square-terminal": SquareTerminal,
  "app-window": AppWindow,
  wrench: Wrench,
};

const DEFAULT_ICON: IconComponent = Wrench;

/** Resolve an icon name string to a Lucide component. */
export function getToolIcon(iconName: string): IconComponent {
  return TOOL_ICON_MAP[iconName] ?? DEFAULT_ICON;
}
