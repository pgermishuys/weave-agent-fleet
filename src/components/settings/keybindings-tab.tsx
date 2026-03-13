"use client";

import { useCallback, useEffect, useState } from "react";
import {
  LayoutGrid,
  Settings,
  PanelLeftClose,
  Plus,
  RefreshCw,
  MessageSquare,
  OctagonX,
  RotateCcw,
  type LucideIcon,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useKeybindings } from "@/contexts/keybindings-context";
import { DEFAULT_KEYBINDINGS } from "@/lib/keybinding-types";
import { formatShortcut, type ConflictResult } from "@/lib/keybinding-utils";
import type { GlobalShortcut } from "@/lib/command-registry";

// ─── Static command metadata ─────────────────────────────────────────────────

interface CommandMeta {
  id: string;
  label: string;
  icon: LucideIcon;
  category: "Session" | "Navigation" | "View";
}

const COMMANDS: CommandMeta[] = [
  { id: "new-session",      label: "New Session",       icon: Plus,          category: "Session" },
  { id: "refresh-sessions", label: "Refresh Sessions",  icon: RefreshCw,     category: "Session" },
  { id: "focus-prompt",     label: "Focus Prompt Input",icon: MessageSquare, category: "Session" },
  { id: "interrupt-session", label: "Interrupt Session", icon: OctagonX,      category: "Session" },
  { id: "nav-fleet",        label: "Go to Fleet",       icon: LayoutGrid,    category: "Navigation" },
  { id: "nav-settings",     label: "Go to Settings",    icon: Settings,      category: "Navigation" },
  { id: "toggle-sidebar",   label: "Toggle Sidebar",    icon: PanelLeftClose,category: "View" },
];

const CATEGORY_ORDER: Array<"Session" | "Navigation" | "View"> = ["Session", "Navigation", "View"];

// ─── KeyRecorder ─────────────────────────────────────────────────────────────

interface KeyRecorderProps {
  type: "palette" | "global";
  onCapture: (key: string, shortcut?: GlobalShortcut) => void;
  onCancel: () => void;
}

function KeyRecorder({ type, onCapture, onCancel }: KeyRecorderProps) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (type === "palette") {
        if (e.key === "Escape") {
          onCancel();
          return;
        }
        if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
          onCapture(e.key.toLowerCase());
        }
      } else {
        // Global shortcuts: accept modifier+key OR special keys without modifiers
        if (e.key === "Escape" && !e.metaKey && !e.ctrlKey) {
          // Bare Escape: capture it as a global shortcut (not cancel)
          onCapture(e.key, { key: e.key });
        } else if ((e.metaKey || e.ctrlKey) && e.key.length === 1) {
          const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);
          onCapture(e.key.toLowerCase(), {
            key: e.key.toLowerCase(),
            platformModifier: (isMac && e.metaKey) || (!isMac && e.ctrlKey),
          });
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [type, onCapture, onCancel]);

  return (
    <span className="text-xs animate-pulse text-amber-600 dark:text-amber-400">Press a key…</span>
  );
}

// ─── BindingCell ─────────────────────────────────────────────────────────────

interface BindingCellProps {
  commandId: string;
  type: "palette" | "global";
  currentValue: string | null;
  isRecording: boolean;
  conflict: ConflictResult | null;
  onStartRecording: () => void;
  onCapture: (key: string, shortcut?: GlobalShortcut) => void;
  onCancelRecording: () => void;
}

function BindingCell({
  type,
  currentValue,
  isRecording,
  conflict,
  onStartRecording,
  onCapture,
  onCancelRecording,
}: BindingCellProps) {
  const isMac =
    typeof navigator !== "undefined" &&
    /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);

  if (isRecording) {
    return (
      <div className="flex items-center gap-2">
        <div className="min-w-[80px] rounded border border-amber-400/60 px-2 py-1 text-center animate-pulse">
          <KeyRecorder type={type} onCapture={onCapture} onCancel={onCancelRecording} />
        </div>
        <Button
          variant="ghost"
          size="xs"
          onClick={onCancelRecording}
          className="text-muted-foreground"
        >
          Cancel
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={onStartRecording}
        className="min-w-[80px] rounded border border-white/10 px-2 py-1 text-center text-xs hover:border-white/30 hover:bg-white/5 transition-colors cursor-pointer"
        title="Click to rebind"
      >
        {currentValue ? (
          <Badge variant="outline" className="font-mono text-xs">
            {type === "global"
              ? formatShortcut(
                  typeof currentValue === "string"
                    ? { key: currentValue }
                    : currentValue,
                  isMac
                )
              : currentValue.toUpperCase()}
          </Badge>
        ) : (
          <span className="text-muted-foreground text-xs">—</span>
        )}
      </button>
      {conflict && (
        <p className="text-[10px] text-amber-600 dark:text-amber-400">
          Conflicts with &quot;{conflict.conflictingCommandId}&quot;
        </p>
      )}
    </div>
  );
}

// ─── KeybindingsTab ──────────────────────────────────────────────────────────

type RecordingTarget = { commandId: string; type: "palette" | "global" } | null;

export function KeybindingsTab() {
  const { bindings, updateBinding, resetBinding, resetToDefaults, hasCustomBindings } =
    useKeybindings();

  const [recording, setRecording] = useState<RecordingTarget>(null);
  const [conflicts, setConflicts] = useState<Record<string, ConflictResult>>({});

  const startRecording = useCallback(
    (commandId: string, type: "palette" | "global") => {
      setRecording({ commandId, type });
      // Clear any prior conflict for this command+type key
      setConflicts((prev) => {
        const next = { ...prev };
        delete next[`${commandId}:${type}`];
        return next;
      });
    },
    []
  );

  const cancelRecording = useCallback(() => setRecording(null), []);

  const handleCapture = useCallback(
    (key: string, shortcut?: GlobalShortcut) => {
      if (!recording) return;
      const { commandId, type } = recording;

      let conflict: ConflictResult | null = null;
      if (type === "palette") {
        conflict = updateBinding(commandId, { paletteHotkey: key });
      } else if (shortcut) {
        conflict = updateBinding(commandId, { globalShortcut: shortcut });
      }

      if (conflict) {
        setConflicts((prev) => ({ ...prev, [`${commandId}:${type}`]: conflict! }));
      } else {
        setConflicts((prev) => {
          const next = { ...prev };
          delete next[`${commandId}:${type}`];
          return next;
        });
      }

      setRecording(null);
    },
    [recording, updateBinding]
  );

  const isDefaultBinding = useCallback(
    (commandId: string) => {
      const current = bindings[commandId];
      const def = DEFAULT_KEYBINDINGS[commandId];
      if (!current || !def) return true;
      return (
        current.paletteHotkey === def.paletteHotkey &&
        current.globalShortcut?.key === def.globalShortcut?.key &&
        !!current.globalShortcut?.platformModifier === !!def.globalShortcut?.platformModifier
      );
    },
    [bindings]
  );

  const grouped = CATEGORY_ORDER.map((cat) => ({
    category: cat,
    commands: COMMANDS.filter((c) => c.category === cat),
  }));

  const isMac =
    typeof navigator !== "undefined" &&
    /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">Keybindings</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Customize keyboard shortcuts for commands.
          </p>
        </div>
        {hasCustomBindings && (
          <Button variant="outline" size="sm" onClick={resetToDefaults} className="gap-1.5">
            <RotateCcw className="h-3.5 w-3.5" />
            Reset All to Defaults
          </Button>
        )}
      </div>

      {grouped.map(({ category, commands }) => (
        <Card key={category}>
          <CardContent className="p-4 space-y-1">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
              {category}
            </p>

            {/* Table header */}
            <div className="grid grid-cols-[1fr_100px_140px_auto] gap-3 items-center pb-2 border-b border-white/10">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Command</p>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Palette Key</p>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Global Shortcut</p>
              <span />
            </div>

            {commands.map((cmd) => {
              const binding = bindings[cmd.id] ?? DEFAULT_KEYBINDINGS[cmd.id];
              const isDefault = isDefaultBinding(cmd.id);
              const IconComponent = cmd.icon;

              const isRecordingPalette =
                recording?.commandId === cmd.id && recording.type === "palette";
              const isRecordingGlobal =
                recording?.commandId === cmd.id && recording.type === "global";

              const paletteConflict = conflicts[`${cmd.id}:palette`] ?? null;
              const globalConflict = conflicts[`${cmd.id}:global`] ?? null;

              const globalShortcutDisplay = binding?.globalShortcut
                ? formatShortcut(binding.globalShortcut, isMac)
                : null;

              return (
                <div
                  key={cmd.id}
                  className="grid grid-cols-[1fr_100px_140px_auto] gap-3 items-center py-2 border-b border-white/5 last:border-0"
                >
                  {/* Label */}
                  <div className="flex items-center gap-2">
                    <IconComponent className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                    <span className="text-sm">{cmd.label}</span>
                  </div>

                  {/* Palette Hotkey */}
                  <BindingCell
                    commandId={cmd.id}
                    type="palette"
                    currentValue={binding?.paletteHotkey ?? null}
                    isRecording={isRecordingPalette}
                    conflict={paletteConflict}
                    onStartRecording={() => startRecording(cmd.id, "palette")}
                    onCapture={handleCapture}
                    onCancelRecording={cancelRecording}
                  />

                  {/* Global Shortcut */}
                  <BindingCell
                    commandId={cmd.id}
                    type="global"
                    currentValue={globalShortcutDisplay}
                    isRecording={isRecordingGlobal}
                    conflict={globalConflict}
                    onStartRecording={() => startRecording(cmd.id, "global")}
                    onCapture={handleCapture}
                    onCancelRecording={cancelRecording}
                  />

                  {/* Per-row reset */}
                  <div className="w-8">
                    {!isDefault && (
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => resetBinding(cmd.id)}
                        title="Reset to default"
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <RotateCcw className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
