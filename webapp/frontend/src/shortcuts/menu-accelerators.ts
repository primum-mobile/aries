// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useEffect } from "react";

import type { NativeMenuNode, WorkspaceManifest } from "@/lib/daemon/client";
import {
  chordAvailable,
  chordMatchesEvent,
  parseAcceleratorChord,
  usesAppleShortcuts,
  type ShortcutChord,
} from "@/lib/shortcut-display";
import { getShellMenuStateSnapshot, resolveShellHost } from "@/lib/shell-host";

export type MenuAccelerator = { id: string; chord: ShortcutChord };

/** Every daemon menu item with an accelerator the platform can offer. */
export function collectMenuAccelerators(
  menus: readonly NativeMenuNode[],
  apple: boolean,
): MenuAccelerator[] {
  const accelerators: MenuAccelerator[] = [];
  const visit = (node: NativeMenuNode) => {
    if (node.type === "separator") return;
    if (node.type === "submenu") {
      node.children.forEach(visit);
      return;
    }
    if (!node.accelerator) return;
    const chord = parseAcceleratorChord(node.accelerator);
    if (chord && chordAvailable(chord, apple)) accelerators.push({ id: node.id, chord });
  };
  menus.forEach(visit);
  return accelerators;
}

/**
 * Where the daemon menu's accelerators are dispatched by the page: the
 * desktop app without a native menu bar (Windows), and browser tabs on
 * Windows and Linux, whose in-page menu lists Ctrl+O, Ctrl+S and the rest and
 * whose browser would otherwise act on them (open file, save page). A browser
 * on Apple platforms keeps its previous behaviour.
 */
export function usesInPageMenuAccelerators(
  hostKind: "tauri" | "browser",
  nativeMenu: boolean,
  apple: boolean,
): boolean {
  return hostKind === "tauri" ? !nativeMenu : !apple;
}

/**
 * Menu accelerators for the desktop app when it has no native menu bar
 * (Windows draws the daemon menu inside the titlebar), and for browser tabs
 * off Apple platforms (browser-reserved chords such as Ctrl+N are skipped by
 * `chordAvailable`).
 *
 * Native menus resolve a key equivalent only after the page declined it
 * (macOS offers WKWebView the key first), so a page handler that already owns
 * a chord (Ctrl+R, Ctrl+G, manifest shortcuts) keeps it. Reproduce that order:
 * the capture listener recognises the chord, then a listener added for the
 * same dispatch runs last in the window bubble phase and acts only if no page
 * handler called preventDefault. Disabled items still consume the chord, as a
 * native menu does, so the webview's own browser shortcut never fires instead.
 */
export function useInPageMenuAccelerators(
  manifest: WorkspaceManifest | null,
  dispatch: (commandId: string) => void,
  isCommandEnabled: (commandId: string) => boolean,
): void {
  useEffect(() => {
    const host = resolveShellHost();
    const apple = usesAppleShortcuts();
    if (!usesInPageMenuAccelerators(host.kind, host.capabilities.nativeMenu, apple)) return;
    const accelerators = collectMenuAccelerators(manifest?.nativeMenu?.menus ?? [], apple);
    if (accelerators.length === 0) return;

    const onKeyDownCapture = (event: KeyboardEvent) => {
      if (event.repeat || event.isComposing) return;
      const match = accelerators.find(({ chord }) => chordMatchesEvent(chord, event, apple));
      if (!match) return;
      const finish = (bubbled: KeyboardEvent) => {
        if (bubbled !== event) return;
        window.removeEventListener("keydown", finish);
        if (event.defaultPrevented) return;
        event.preventDefault();
        const enabled = getShellMenuStateSnapshot().enabled[match.id] ?? isCommandEnabled(match.id);
        if (enabled) dispatch(match.id);
      };
      window.addEventListener("keydown", finish);
      // A handler that stops propagation skips the bubble phase entirely.
      window.setTimeout(() => window.removeEventListener("keydown", finish), 0);
    };

    window.addEventListener("keydown", onKeyDownCapture, true);
    return () => window.removeEventListener("keydown", onKeyDownCapture, true);
  }, [manifest, dispatch, isCommandEnabled]);
}
