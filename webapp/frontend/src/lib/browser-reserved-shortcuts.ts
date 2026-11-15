// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

// Chords a browser tab never hands to the page on Windows and Linux. Chrome
// and Edge (Chromium's BrowserCommandController::IsReservedCommandOrKey) and
// Firefox (menu keys marked reserved) run these before any keydown listener,
// so preventDefault cannot keep them: Ctrl+N opens a browser window instead
// of a new chart. The browser build leaves them unbound and unlisted; their
// commands stay in the menus. Every other Ctrl chord Aries uses (Ctrl+O,
// Ctrl+S, Ctrl+F, Ctrl+R, ...) reaches the page first and is kept.
//
// Apple platforms and the desktop app are unaffected: the desktop webview has
// no browser commands, and macOS keeps its Cmd chords as they were.

import { resolveNativeShellPlatform } from "@/lib/shell-host";

type ReservableChord = {
  command: boolean;
  control: boolean;
  alt: boolean;
  shift: boolean;
  key: string;
};

/** Ctrl+key: new window, new tab, close tab; Firefox quits on Linux with Ctrl+Q. */
const RESERVED_CTRL = new Set(["n", "t", "w", "q", "tab", "pageup", "pagedown"]);
/** Ctrl+Shift+key: private window, reopen tab, close window, Firefox private window, quit. */
const RESERVED_CTRL_SHIFT = new Set(["n", "t", "w", "p", "q", "tab", "pageup", "pagedown"]);

/** True when Aries runs in a browser tab rather than the desktop app. */
export function runsInBrowserTab(): boolean {
  return typeof window !== "undefined" && resolveNativeShellPlatform() === null;
}

/** Windows/Linux browser chords the page can never receive. Callers apply
 * this off Apple platforms only. */
export function chordReservedByBrowserTab(
  chord: ReservableChord,
  inBrowserTab: boolean = runsInBrowserTab(),
): boolean {
  if (!inBrowserTab || chord.alt || !(chord.command || chord.control)) return false;
  const key = chord.key.toLowerCase();
  return (chord.shift ? RESERVED_CTRL_SHIFT : RESERVED_CTRL).has(key);
}

/** Alt+Left/Right are Back/Forward in Windows and Linux browsers, and Aries
 * steps minutes with them. When the page does not consume the chord (focus in
 * a field or a dialog), the browser would leave Aries; nothing in Aries uses
 * history navigation, so the browser build always keeps these keys. */
export function isBrowserHistoryChord(
  event: Pick<KeyboardEvent, "key" | "altKey" | "ctrlKey" | "metaKey" | "shiftKey">,
): boolean {
  return event.altKey && !event.ctrlKey && !event.metaKey
    && (event.key === "ArrowLeft" || event.key === "ArrowRight");
}
