// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useEffect } from "react";

import type { ShortcutEntry, WorkspaceManifest } from "@/lib/daemon/client";
import {
  glyphShortcutAvailable,
  isAltGraphEvent,
  usesAppleShortcuts,
} from "@/lib/shortcut-display";
import { spotlightShortcutCoolingDown } from "@/shortcuts/spotlight-cooldown";

type DispatchShortcutCommand = (commandId: string) => void;
type CommandEnabledPredicate = (commandId: string) => boolean;

export const EMBEDDED_MANIFEST_SHORTCUT_EVENT =
  "aries://embedded-manifest-shortcut";

export type ParsedShortcut = {
  key: string;
  requireCommand: boolean;
  requireAlt?: boolean;
  requireShift?: boolean;
  matchCode?: boolean;
};

export type ShortcutGesture = {
  key: string;
  code?: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
};

export type EmbeddedManifestShortcutDetail = Partial<ShortcutGesture> & {
  repeat?: boolean;
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
  // Option+letter yields a composed character on macOS (⌥A -> "å"), so this
  // chord matches the physical key via event.code.
  const altMatch = keys.match(/^⌥\s+([A-Za-z])$/u);
  if (altMatch) {
    return {
      key: altMatch[1].toLowerCase(),
      requireCommand: false,
      requireAlt: true,
      matchCode: true,
    };
  }
  const commandAltMatch = keys.match(/^⌘\s+⌥\s+([A-Za-z])$/u);
  if (commandAltMatch) {
    return {
      key: commandAltMatch[1].toLowerCase(),
      requireCommand: true,
      requireAlt: true,
    };
  }
  const commandShiftMatch = keys.match(/^⌘\s+⇧\s+([A-Za-z0-9])$/u);
  if (commandShiftMatch) {
    return {
      key: commandShiftMatch[1].toLowerCase(),
      requireCommand: true,
      requireShift: true,
    };
  }
  return null;
}

export function targetAllowsShortcut(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element) return true;
  return !(
    element.tagName === "INPUT" ||
    element.tagName === "TEXTAREA" ||
    element.tagName === "SELECT" ||
    element.isContentEditable
  );
}

export function chartScopeIsClear(): boolean {
  if (typeof document === "undefined") return true;
  return (
    document.querySelector(
      '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]',
    ) === null
  );
}

export type ManifestShortcutBinding = { row: ShortcutEntry; parsed: ParsedShortcut };

/** Bound manifest rows the platform can offer, parsed for dispatch. Chords
 * Windows/Linux keyboards reserve (AltGr, Redo) stay unbound there. */
export function manifestShortcutBindings(
  manifest: WorkspaceManifest | null,
  apple: boolean,
): ManifestShortcutBinding[] {
  return (manifest?.shortcuts ?? [])
    .filter((row) => row.bound && row.commandId)
    .filter((row) => glyphShortcutAvailable(row.keys, apple))
    .map((row) => ({ row, parsed: parseShortcut(row) }))
    .filter((entry): entry is ManifestShortcutBinding => entry.parsed !== null);
}

/** The manifest row a key gesture triggers, if any. On Apple platforms ⌘ or
 * Control stands for ⌘; elsewhere only Ctrl does, and the Windows key (which
 * the browser reports as Meta) belongs to the OS and never forms a chord. */
export function matchManifestShortcut(
  bindings: readonly ManifestShortcutBinding[],
  gesture: ShortcutGesture,
  apple = true,
): ShortcutEntry | null {
  if (!apple && gesture.metaKey) return null;
  const key = gesture.key.toLowerCase();
  for (const { row, parsed } of bindings) {
    if (parsed.matchCode) {
      if (gesture.code !== `Key${parsed.key.toUpperCase()}`) continue;
    } else if (parsed.key !== key) continue;
    const commandHeld = gesture.metaKey || gesture.ctrlKey;
    if (parsed.requireCommand !== commandHeld) continue;
    if (Boolean(parsed.requireAlt) !== gesture.altKey) continue;
    if (Boolean(parsed.requireShift) !== gesture.shiftKey) continue;
    if (!parsed.requireCommand && (gesture.metaKey || gesture.ctrlKey || (gesture.altKey && !parsed.requireAlt))) {
      continue;
    }
    return row;
  }
  return null;
}

export function useManifestShortcutDispatch(
  manifest: WorkspaceManifest | null,
  dispatch: DispatchShortcutCommand,
  isCommandEnabled: CommandEnabledPredicate = () => true,
): void {
  useEffect(() => {
    const apple = usesAppleShortcuts();
    const bindings = manifestShortcutBindings(manifest, apple);
    if (bindings.length === 0) return;

    const dispatchGesture = (
      gesture: ShortcutGesture,
      preventDefault: () => void,
    ) => {
      if (
        !gesture.metaKey &&
        !gesture.ctrlKey &&
        !gesture.altKey &&
        spotlightShortcutCoolingDown()
      ) {
        return;
      }
      const row = matchManifestShortcut(bindings, gesture, apple);
      if (!row || !isCommandEnabled(row.commandId ?? "")) return;
      preventDefault();
      dispatch(row.commandId ?? "");
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || !targetAllowsShortcut(event.target)) return;
      // AltGr (Ctrl+Alt on Windows) types characters; it is never a chord.
      if (!apple && isAltGraphEvent(event)) return;
      if (!chartScopeIsClear()) return;
      dispatchGesture(event, () => event.preventDefault());
    };

    const onEmbeddedShortcut = (event: Event) => {
      const detail = (
        event as CustomEvent<EmbeddedManifestShortcutDetail>
      ).detail;
      if (
        detail?.repeat ||
        typeof detail?.key !== "string" ||
        detail.key.length === 0 ||
        !chartScopeIsClear()
      ) {
        return;
      }
      dispatchGesture(
        {
          key: detail.key,
          code: typeof detail.code === "string" ? detail.code : undefined,
          metaKey: detail.metaKey === true,
          ctrlKey: detail.ctrlKey === true,
          altKey: detail.altKey === true,
          shiftKey: detail.shiftKey === true,
        },
        () => undefined,
      );
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener(
      EMBEDDED_MANIFEST_SHORTCUT_EVENT,
      onEmbeddedShortcut,
    );
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener(
        EMBEDDED_MANIFEST_SHORTCUT_EVENT,
        onEmbeddedShortcut,
      );
    };
  }, [manifest, dispatch, isCommandEnabled]);
}
