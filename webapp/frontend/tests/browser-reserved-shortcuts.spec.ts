// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import { expect, test } from "@playwright/test";

import {
  chordReservedByBrowserTab,
  isBrowserHistoryChord,
} from "../src/lib/browser-reserved-shortcuts";
import {
  acceleratorAvailable,
  glyphShortcutAvailable,
  parseAcceleratorChord,
} from "../src/lib/shortcut-display";
import { usesInPageMenuAccelerators } from "../src/shortcuts/menu-accelerators";

function chord(accelerator: string) {
  const parsed = parseAcceleratorChord(accelerator);
  if (!parsed) throw new Error(accelerator);
  return parsed;
}

test("browser tabs reserve Ctrl+N/T/W and their Shift forms", () => {
  for (const accelerator of [
    "CmdOrCtrl+N", "CmdOrCtrl+T", "CmdOrCtrl+W", "CmdOrCtrl+Q",
    "CmdOrCtrl+Shift+N", "CmdOrCtrl+Shift+T", "CmdOrCtrl+Shift+W", "CmdOrCtrl+Shift+P",
    "Ctrl+Tab", "Ctrl+PageDown",
  ]) {
    expect(chordReservedByBrowserTab(chord(accelerator), true), accelerator).toBe(true);
  }
});

test("Aries' other Ctrl chords stay available in browser tabs", () => {
  for (const accelerator of [
    "CmdOrCtrl+O", "CmdOrCtrl+S", "CmdOrCtrl+Shift+S", "CmdOrCtrl+F", "CmdOrCtrl+R",
    "CmdOrCtrl+G", "CmdOrCtrl+E", "CmdOrCtrl+Shift+A", "CmdOrCtrl+Shift+C", "CmdOrCtrl+A",
    "CmdOrCtrl+Shift+E", "CmdOrCtrl+Shift+H", "CmdOrCtrl+Shift+0", "Alt+A", "N",
  ]) {
    expect(chordReservedByBrowserTab(chord(accelerator), true), accelerator).toBe(false);
  }
});

test("the desktop app never treats browser chords as reserved", () => {
  expect(chordReservedByBrowserTab(chord("CmdOrCtrl+N"), false)).toBe(false);
  expect(chordReservedByBrowserTab(chord("CmdOrCtrl+Shift+T"), false)).toBe(false);
});

test("outside a browser tab, availability is unchanged (desktop and Node)", () => {
  // Node has no window: the same answer as the desktop app.
  expect(acceleratorAvailable("CmdOrCtrl+N", false)).toBe(true);
  expect(glyphShortcutAvailable("⌘ W", false)).toBe(true);
  expect(acceleratorAvailable("CmdOrCtrl+N", true)).toBe(true);
});

test("in-page menu accelerators: Windows desktop and non-Apple browsers only", () => {
  expect(usesInPageMenuAccelerators("tauri", false, false)).toBe(true);
  expect(usesInPageMenuAccelerators("tauri", true, true)).toBe(false);
  expect(usesInPageMenuAccelerators("tauri", true, false)).toBe(false);
  expect(usesInPageMenuAccelerators("browser", false, false)).toBe(true);
  // A Mac browser keeps its previous behaviour.
  expect(usesInPageMenuAccelerators("browser", false, true)).toBe(false);
});

test("Alt+Left/Right are recognised as browser history keys", () => {
  const base = { key: "", altKey: false, ctrlKey: false, metaKey: false, shiftKey: false };
  expect(isBrowserHistoryChord({ ...base, key: "ArrowLeft", altKey: true })).toBe(true);
  expect(isBrowserHistoryChord({ ...base, key: "ArrowRight", altKey: true, shiftKey: true })).toBe(true);
  expect(isBrowserHistoryChord({ ...base, key: "ArrowLeft" })).toBe(false);
  expect(isBrowserHistoryChord({ ...base, key: "ArrowLeft", altKey: true, ctrlKey: true })).toBe(false);
  expect(isBrowserHistoryChord({ ...base, key: "ArrowUp", altKey: true })).toBe(false);
});
