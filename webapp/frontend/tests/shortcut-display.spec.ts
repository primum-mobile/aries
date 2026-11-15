// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import { expect, test } from "@playwright/test";

import { collectShortcutRows } from "../src/components/workshell/help-dialog";
import type { NativeMenuNode } from "../src/lib/daemon/client";
import { FALLBACK_WORKSPACE_MANIFEST } from "../src/lib/daemon/fallback-workspace-manifest";
import {
  acceleratorAvailable,
  chordMatchesEvent,
  glyphShortcutAvailable,
  isAltGraphEvent,
  matchesCaretShortcut,
  menuAcceleratorLabel,
  parseAcceleratorChord,
  primaryModifierHeld,
} from "../src/lib/shortcut-display";
import {
  manifestShortcutBindings,
  matchManifestShortcut,
} from "../src/shortcuts/manifest-shortcuts";
import { collectMenuAccelerators } from "../src/shortcuts/menu-accelerators";
import { wheelPinchScale } from "../src/lib/wheel-pinch";

const english = { control: "Ctrl", alt: "Alt", shift: "Shift" };
const german = { control: "Strg", alt: "Alt", shift: "Umschalt" };

function keyEvent(overrides: Partial<KeyboardEvent> & { altGraph?: boolean }) {
  const { altGraph = false, ...rest } = overrides;
  return {
    key: "",
    code: "",
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    getModifierState: (modifier: string) => modifier === "AltGraph" && altGraph,
    ...rest,
  };
}

// Windows reports AltGr as Ctrl+Alt plus the AltGraph modifier state.
function altGrEvent(key: string, code: string) {
  return keyEvent({ key, code, ctrlKey: true, altKey: true, altGraph: true });
}

test("the caret shortcut accepts a shifted symbol and the German dead key", () => {
  expect(matchesCaretShortcut(keyEvent({ key: "^", code: "Digit6", shiftKey: true }))).toBe(true);
  expect(matchesCaretShortcut(keyEvent({ key: "Dead", code: "Backquote" }))).toBe(true);
  expect(matchesCaretShortcut(keyEvent({ key: "Dead", code: "IntlBackslash" }))).toBe(true);
  expect(matchesCaretShortcut(keyEvent({ key: "Dead", code: "Equal" }))).toBe(false);
  expect(matchesCaretShortcut(keyEvent({ key: "Dead", code: "Backquote", shiftKey: true }))).toBe(false);
  expect(matchesCaretShortcut(keyEvent({ key: "^", ctrlKey: true }))).toBe(false);
});

test("menu accelerators keep macOS glyph order on Apple platforms", () => {
  expect(menuAcceleratorLabel("CmdOrCtrl+Shift+C")).toBe("⇧⌘C");
  expect(menuAcceleratorLabel("CmdOrCtrl+Alt+A", true, english)).toBe("⌥⌘A");
  expect(menuAcceleratorLabel("CmdOrCtrl++")).toBe("⌘+");
  expect(menuAcceleratorLabel("Hyper+K")).toBe("Hyper+K");
});

test("menu accelerators use localized modifier names on Windows and Linux", () => {
  expect(menuAcceleratorLabel("CmdOrCtrl+Shift+C", false, english)).toBe("Ctrl+Shift+C");
  expect(menuAcceleratorLabel("CmdOrCtrl+Shift+S", false, german)).toBe("Strg+Umschalt+S");
  expect(menuAcceleratorLabel("CmdOrCtrl+O", false, english)).toBe("Ctrl+O");
  expect(menuAcceleratorLabel("Alt+A", false, english)).toBe("Alt+A");
  expect(parseAcceleratorChord("CmdOrCtrl++")?.key).toBe("+");
});

test("Windows and Linux drop chords their keyboards reserve", () => {
  // Ctrl+Y is Redo; Ctrl+Alt is AltGr on international layouts.
  expect(acceleratorAvailable("CmdOrCtrl+Y", false)).toBe(false);
  expect(acceleratorAvailable("CmdOrCtrl+Alt+A", false)).toBe(false);
  expect(glyphShortcutAvailable("⌘ Y", false)).toBe(false);
  expect(glyphShortcutAvailable("⌘ ⌥ A", false)).toBe(false);
  // Everything else, and every chord on Apple platforms, stays.
  expect(acceleratorAvailable("CmdOrCtrl+Y", true)).toBe(true);
  expect(acceleratorAvailable("CmdOrCtrl+Alt+A", true)).toBe(true);
  expect(acceleratorAvailable("CmdOrCtrl+Shift+Y", false)).toBe(true);
  expect(glyphShortcutAvailable("⌥ A", false)).toBe(true);
  expect(glyphShortcutAvailable("⌥ + ← / →", false)).toBe(true);
  expect(glyphShortcutAvailable("⇧ ⇧", false)).toBe(true);
});

test("Help omits reserved chords off Apple platforms only", () => {
  const tf = (_key: string, fallback: string) => fallback;
  const appleKeys = collectShortcutRows(FALLBACK_WORKSPACE_MANIFEST, tf, true).map((row) => row.keys);
  const windowsKeys = collectShortcutRows(FALLBACK_WORKSPACE_MANIFEST, tf, false).map((row) => row.keys);
  expect(appleKeys).toContain("⌘ Y");
  expect(appleKeys).toContain("⌘ ⌥ A");
  expect(windowsKeys).not.toContain("⌘ Y");
  expect(windowsKeys).not.toContain("⌘ ⌥ A");
  expect(windowsKeys).toContain("⌥ A");
  expect(windowsKeys).toContain("⌘ S");
});

test("chords match Ctrl on Windows and Command on Apple, by key position on non-Latin layouts", () => {
  const save = parseAcceleratorChord("CmdOrCtrl+S")!;
  expect(chordMatchesEvent(save, keyEvent({ key: "s", code: "KeyS", ctrlKey: true }), false)).toBe(true);
  expect(chordMatchesEvent(save, keyEvent({ key: "s", code: "KeyS", metaKey: true }), true)).toBe(true);
  expect(chordMatchesEvent(save, keyEvent({ key: "s", code: "KeyS", ctrlKey: true }), true)).toBe(false);
  expect(chordMatchesEvent(save, keyEvent({ key: "S", code: "KeyS", ctrlKey: true, shiftKey: true }), false)).toBe(false);
  // Russian layout: Ctrl+S types "ы" but is still the S key.
  expect(chordMatchesEvent(save, keyEvent({ key: "ы", code: "KeyS", ctrlKey: true }), false)).toBe(true);
  const saveAs = parseAcceleratorChord("CmdOrCtrl+Shift+S")!;
  expect(chordMatchesEvent(saveAs, keyEvent({ key: "S", code: "KeyS", ctrlKey: true, shiftKey: true }), false)).toBe(true);
});

test("in-page menu accelerators skip reserved chords off Apple platforms", () => {
  const menus: NativeMenuNode[] = [{
    type: "submenu",
    id: "menu.file",
    label: "File",
    children: [
      { type: "item", id: "new", label: "New", accelerator: "CmdOrCtrl+N" },
      { type: "item", id: "synastry", label: "Synastry", accelerator: "CmdOrCtrl+Y" },
      { type: "separator" },
      {
        type: "submenu",
        id: "menu.charts",
        label: "Charts",
        children: [
          { type: "item", id: "ascensional-transits", label: "Ascensional Transits", accelerator: "CmdOrCtrl+Alt+A" },
          { type: "item", id: "profections", label: "Profections" },
        ],
      },
    ],
  }];
  expect(collectMenuAccelerators(menus, false).map((entry) => entry.id)).toEqual(["new"]);
  expect(collectMenuAccelerators(menus, true).map((entry) => entry.id)).toEqual([
    "new",
    "synastry",
    "ascensional-transits",
  ]);
});

test("a listener added during window capture runs after page handlers in the same dispatch", async ({ page }) => {
  // useInPageMenuAccelerators relies on this DOM ordering to let page
  // handlers (Ctrl+R, Ctrl+G, manifest shortcuts) claim a chord first.
  await page.setContent("<!doctype html><html><body><input id='field'></body></html>");
  const order = await page.evaluate(() => {
    const seen: string[] = [];
    window.addEventListener("keydown", (event) => {
      seen.push(`page:${event.key}`);
      if (event.key === "r") event.preventDefault();
    });
    window.addEventListener("keydown", (event) => {
      window.addEventListener("keydown", function finish(bubbled) {
        if (bubbled !== event) return;
        window.removeEventListener("keydown", finish);
        seen.push(`menu:${event.key}:${event.defaultPrevented ? "skip" : "run"}`);
      });
    }, true);
    for (const key of ["r", "s"]) {
      document.getElementById("field")!.dispatchEvent(
        new KeyboardEvent("keydown", { key, ctrlKey: true, bubbles: true, cancelable: true }),
      );
    }
    return seen;
  });
  expect(order).toEqual(["page:r", "menu:r:skip", "page:s", "menu:s:run"]);
});

test("AltGr typing never matches a chord off Apple platforms", () => {
  expect(isAltGraphEvent(altGrEvent("@", "KeyQ"))).toBe(true);
  expect(isAltGraphEvent({ key: "AltGraph" })).toBe(true);
  expect(isAltGraphEvent(keyEvent({ key: "a", code: "KeyA", ctrlKey: true, altKey: true }))).toBe(false);
  expect(isAltGraphEvent({ key: "a" })).toBe(false);

  // A Ctrl+Alt chord is only offered on Apple platforms; even there, an
  // AltGr-reporting event off Apple can never stand in for it.
  const ascensional = parseAcceleratorChord("CmdOrCtrl+Alt+A")!;
  expect(chordMatchesEvent(ascensional, altGrEvent("ą", "KeyA"), false)).toBe(false);
  // Apple keeps its own semantics: Option is not AltGr there.
  expect(chordMatchesEvent(ascensional, keyEvent({ key: "å", code: "KeyA", metaKey: true, altKey: true, altGraph: true }), true)).toBe(true);
  // Ctrl+E still matches a real Ctrl press on Windows.
  const data = parseAcceleratorChord("CmdOrCtrl+E")!;
  expect(chordMatchesEvent(data, keyEvent({ key: "e", code: "KeyE", ctrlKey: true }), false)).toBe(true);
  expect(chordMatchesEvent(data, altGrEvent("€", "KeyE"), false)).toBe(false);
});

test("manifest shortcuts on Windows: Ctrl is primary, AltGr characters never dispatch", () => {
  const bindings = manifestShortcutBindings(FALLBACK_WORKSPACE_MANIFEST, false);
  const commandFor = (event: ReturnType<typeof keyEvent>) => matchManifestShortcut(bindings, event, false)?.commandId ?? null;
  expect(commandFor(keyEvent({ key: "e", code: "KeyE", ctrlKey: true }))).toBe("menu.data");
  expect(commandFor(keyEvent({ key: "f", code: "KeyF", ctrlKey: true }))).toBe("transit-search");
  expect(commandFor(keyEvent({ key: "a", code: "KeyA", altKey: true }))).toBe("ascensional-view");
  // German AltGr+E types the euro sign; Polish AltGr+A types "ą".
  expect(commandFor(altGrEvent("€", "KeyE"))).toBeNull();
  expect(commandFor(altGrEvent("ą", "KeyA"))).toBeNull();
  // Reserved chords stay unbound: Ctrl+Y is Redo.
  expect(commandFor(keyEvent({ key: "y", code: "KeyY", ctrlKey: true }))).toBeNull();
  expect(bindings.some(({ row }) => row.keys === "⌘ ⌥ A")).toBe(false);
  // The Windows key (Meta) belongs to the OS: Win+E opens Explorer, not Data.
  expect(commandFor(keyEvent({ key: "e", code: "KeyE", metaKey: true }))).toBeNull();
  expect(commandFor(keyEvent({ key: "e", code: "KeyE", metaKey: true, ctrlKey: true }))).toBeNull();
  expect(commandFor(keyEvent({ key: "t", code: "KeyT", metaKey: true }))).toBeNull();
  // Apple keeps every chord, and ⌘ or Control both stand for ⌘ as before.
  const apple = manifestShortcutBindings(FALLBACK_WORKSPACE_MANIFEST, true);
  expect(matchManifestShortcut(apple, keyEvent({ key: "y", code: "KeyY", metaKey: true }))?.commandId).toBe("synastry");
  expect(matchManifestShortcut(apple, keyEvent({ key: "e", code: "KeyE", metaKey: true }), true)?.commandId).toBe("menu.data");
  expect(matchManifestShortcut(apple, keyEvent({ key: "e", code: "KeyE", ctrlKey: true }), true)?.commandId).toBe("menu.data");
  expect(matchManifestShortcut(apple, keyEvent({ key: "a", code: "KeyA", metaKey: true, altKey: true }), true)?.commandId).toBe("ascensional-transits");
});

test("click modifiers follow the platform primary key", () => {
  expect(primaryModifierHeld({ metaKey: true, ctrlKey: false }, true)).toBe(true);
  expect(primaryModifierHeld({ metaKey: false, ctrlKey: true }, true)).toBe(false);
  expect(primaryModifierHeld({ metaKey: false, ctrlKey: true }, false)).toBe(true);
  expect(primaryModifierHeld({ metaKey: true, ctrlKey: false }, false)).toBe(false);
});

test("a Ctrl + wheel touchpad pinch zooms by the pinch scale off Apple only", () => {
  const pinch = (deltaY: number, ctrlKey = true, deltaMode = 0) => ({ deltaY, ctrlKey, deltaMode });
  // Chromium: deltaY = -100 · ln(scale).
  expect(wheelPinchScale(pinch(-100 * Math.log(1.2)), false)).toBeCloseTo(1.2, 6);
  expect(wheelPinchScale(pinch(-100 * Math.log(0.9)), false)).toBeCloseTo(0.9, 6);
  // Ctrl + a mouse-wheel notch is capped.
  expect(wheelPinchScale(pinch(-120), false)).toBeCloseTo(Math.exp(0.4), 6);
  // Ordinary wheels, line-mode wheels and Apple platforms keep their handling.
  expect(wheelPinchScale(pinch(-10, false), false)).toBeNull();
  expect(wheelPinchScale(pinch(-3, true, 1), false)).toBeNull();
  expect(wheelPinchScale(pinch(-10), true)).toBeNull();
});
