// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useEffect } from "react";

import type { ShortcutEntry, WorkspaceManifest } from "@/lib/daemon/client";
import { spotlightShortcutCoolingDown } from "@/shortcuts/spotlight-cooldown";

type DispatchShortcutCommand = (commandId: string) => void;
type CommandEnabledPredicate = (commandId: string) => boolean;

type ParsedShortcut = {
  key: string;
  requireCommand: boolean;
  requireAlt?: boolean;
};

function parseShortcut(row: ShortcutEntry): ParsedShortcut | null {
  const keys = row.keys.trim();
  if (/^[A-Za-z]$/.test(keys)) {
    return { key: keys.toLowerCase(), requireCommand: false };
  }
  const commandMatch = keys.match(/^⌘\s+([A-Za-z])$/u);
  if (commandMatch) {
    return { key: commandMatch[1].toLowerCase(), requireCommand: true };
  }
  const commandAltMatch = keys.match(/^⌘\s+⌥\s+([A-Za-z])$/u);
  if (commandAltMatch) {
    return {
      key: commandAltMatch[1].toLowerCase(),
      requireCommand: true,
      requireAlt: true,
    };
  }
  return null;
}

function targetAllowsShortcut(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element) return true;
  return !(
    element.tagName === "INPUT" ||
    element.tagName === "TEXTAREA" ||
    element.tagName === "SELECT" ||
    element.isContentEditable
  );
}

function chartScopeIsClear(): boolean {
  if (typeof document === "undefined") return true;
  return (
    document.querySelector(
      '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]',
    ) === null
  );
}

export function useManifestShortcutDispatch(
  manifest: WorkspaceManifest | null,
  dispatch: DispatchShortcutCommand,
  isCommandEnabled: CommandEnabledPredicate = () => true,
): void {
  useEffect(() => {
    const rows = (manifest?.shortcuts ?? [])
      .filter((row) => row.bound && row.commandId)
      .map((row) => ({ row, parsed: parseShortcut(row) }))
      .filter(
        (entry): entry is { row: ShortcutEntry; parsed: ParsedShortcut } =>
          entry.parsed !== null,
      );
    if (rows.length === 0) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || !targetAllowsShortcut(event.target)) return;
      if (!chartScopeIsClear()) return;
      if (!event.metaKey && !event.ctrlKey && !event.altKey && spotlightShortcutCoolingDown()) {
        return;
      }
      const key = event.key.toLowerCase();
      for (const { row, parsed } of rows) {
        if (parsed.key !== key) continue;
        const commandHeld = event.metaKey || event.ctrlKey;
        if (parsed.requireCommand !== commandHeld) continue;
        if (Boolean(parsed.requireAlt) !== event.altKey) continue;
        if (!parsed.requireCommand && (event.metaKey || event.ctrlKey || event.altKey)) {
          continue;
        }
        if (!isCommandEnabled(row.commandId ?? "")) return;
        event.preventDefault();
        dispatch(row.commandId ?? "");
        return;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [manifest, dispatch, isCommandEnabled]);
}
