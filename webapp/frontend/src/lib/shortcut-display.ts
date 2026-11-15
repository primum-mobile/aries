// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

// One keyboard-shortcut vocabulary for every surface (Help, sidebar hints,
// in-page menus, step hints, aria-keyshortcuts, page dispatch). The daemon
// publishes shortcuts in two notations: glyph chords ("⌘ ⇧ S", "⌥ + ← / →")
// and Tauri accelerators ("CmdOrCtrl+Shift+S"). Apple platforms keep the glyph
// spelling; Windows and Linux show localized modifier names joined with "+"
// ("Ctrl+Shift+S", "Strg+Umschalt+S"), and drop chords their keyboards reserve.

import * as React from "react";

import { chordReservedByBrowserTab } from "@/lib/browser-reserved-shortcuts";
import { useT } from "@/lib/i18n/i18n";
import { resolveNativeShellPlatform } from "@/lib/shell-host";

export type ShortcutModifierLabels = {
  control: string;
  alt: string;
  shift: string;
};

/** A parsed chord. `command` is the platform primary modifier (⌘ on Apple,
 * Ctrl elsewhere); `control` is a literal Control (⌃) chord. */
export type ShortcutChord = {
  command: boolean;
  control: boolean;
  alt: boolean;
  shift: boolean;
  key: string;
};

type NavigatorPlatform = Pick<Navigator, "platform" | "userAgent"> & {
  userAgentData?: { platform?: string };
};

export function isAppleShortcutPlatform(
  candidate?: NavigatorPlatform | null,
): boolean {
  const current = candidate ?? (
    typeof navigator === "undefined" ? null : navigator as NavigatorPlatform
  );
  if (!current) return true;
  const platform = current.userAgentData?.platform
    || current.platform
    || current.userAgent;
  return /mac|iphone|ipad|ipod/i.test(platform);
}

/** The native shell's OS when Aries runs in Tauri, otherwise the browser's. */
export function usesAppleShortcuts(): boolean {
  const native = resolveNativeShellPlatform();
  if (native === "macos") return true;
  if (native === "windows" || native === "linux") return false;
  return isAppleShortcutPlatform();
}

const subscribeToStaticPlatform = () => () => {};

export function useAppleShortcuts(): boolean {
  return React.useSyncExternalStore(
    subscribeToStaticPlatform,
    usesAppleShortcuts,
    () => true,
  );
}

export function useShortcutModifierLabels(): ShortcutModifierLabels {
  const t = useT();
  return React.useMemo(() => ({
    control: t("help.key.control"),
    alt: t("help.key.alt"),
    shift: t("help.key.shift"),
  }), [t]);
}

const GLYPH_MODIFIERS: Record<string, keyof Omit<ShortcutChord, "key">> = {
  "⌘": "command",
  "⌃": "control",
  "⌥": "alt",
  "⇧": "shift",
};

const ACCELERATOR_MODIFIERS: Record<string, keyof Omit<ShortcutChord, "key">> = {
  cmdorctrl: "command",
  ctrlorcmd: "command",
  cmd: "command",
  command: "command",
  meta: "command",
  super: "command",
  ctrl: "control",
  control: "control",
  alt: "alt",
  option: "alt",
  opt: "alt",
  shift: "shift",
};

function emptyChord(key: string): ShortcutChord {
  return { command: false, control: false, alt: false, shift: false, key };
}

/** Parse one glyph chord ("⌘ ⇧ S", "⌥ A"); null when it is not a modifier chord. */
export function parseGlyphChord(keys: string): ShortcutChord | null {
  const tokens = keys.trim().replace(/\s*\+\s*/g, " ").split(/\s+/).filter(Boolean);
  const chord = emptyChord("");
  while (tokens.length > 1 && GLYPH_MODIFIERS[tokens[0]]) {
    chord[GLYPH_MODIFIERS[tokens.shift()!]] = true;
  }
  if (tokens.length !== 1) return null;
  chord.key = tokens[0];
  return chord;
}

/** Parse a Tauri accelerator ("CmdOrCtrl+Shift+S", "CmdOrCtrl++"). */
export function parseAcceleratorChord(accelerator: string): ShortcutChord | null {
  const text = accelerator.trim();
  // "CmdOrCtrl++" binds the "+" key itself.
  const keyStart = text.endsWith("++") ? text.length - 1 : text.lastIndexOf("+") + 1;
  const key = text.slice(keyStart).trim();
  if (!key) return null;
  const modifierText = text.slice(0, Math.max(0, keyStart - 1));
  const chord = emptyChord(key);
  for (const part of modifierText ? modifierText.split("+") : []) {
    const modifier = ACCELERATOR_MODIFIERS[part.trim().toLowerCase()];
    if (!modifier) return null;
    chord[modifier] = true;
  }
  return chord;
}

/** Ctrl+Alt is AltGr on international layouts (it types characters such as
 * @ and €), and Ctrl+Y is Redo. In a browser tab, Ctrl+N/T/W and friends
 * belong to the browser (browser-reserved-shortcuts.ts). Off Apple platforms
 * these chords are not offered: not bound, not listed, not hinted. */
export function chordReservedOffApple(chord: ShortcutChord): boolean {
  const ctrl = chord.command || chord.control;
  if (!ctrl) return false;
  if (chord.alt) return true;
  if (chordReservedByBrowserTab(chord)) return true;
  return !chord.shift && chord.key.toLowerCase() === "y";
}

export function chordAvailable(chord: ShortcutChord | null, apple: boolean): boolean {
  return apple || chord == null || !chordReservedOffApple(chord);
}

/** Glyph-notation keys ("⌘ Y") the current platform can offer. */
export function glyphShortcutAvailable(keys: string, apple: boolean): boolean {
  return chordAvailable(parseGlyphChord(keys), apple);
}

/** Accelerator-notation keys ("CmdOrCtrl+Y") the current platform can offer. */
export function acceleratorAvailable(accelerator: string, apple: boolean): boolean {
  return chordAvailable(parseAcceleratorChord(accelerator), apple);
}

const KEY_GLYPHS: Record<string, string> = {
  plus: "+",
  minus: "-",
  comma: ",",
  period: ".",
  space: "Space",
  esc: "Esc",
  escape: "Esc",
  left: "←",
  right: "→",
  up: "↑",
  down: "↓",
  arrowleft: "←",
  arrowright: "→",
  arrowup: "↑",
  arrowdown: "↓",
  backspace: "⌫",
  delete: "⌦",
  enter: "↩",
  return: "↩",
  tab: "⇥",
};

export function displayKeyName(key: string): string {
  return KEY_GLYPHS[key.toLowerCase()] ?? (key.length === 1 ? key.toUpperCase() : key);
}

/** Windows/Linux spelling of a chord: "Ctrl+Shift+S". */
export function formatChordOffApple(chord: ShortcutChord, labels: ShortcutModifierLabels): string {
  const parts: string[] = [];
  if (chord.command || chord.control) parts.push(labels.control);
  if (chord.alt) parts.push(labels.alt);
  if (chord.shift) parts.push(labels.shift);
  parts.push(displayKeyName(chord.key));
  return parts.join("+");
}

/** Apple menu spelling of a chord: modifiers in macOS order, then the key ("⇧⌘S"). */
export function formatChordApple(chord: ShortcutChord): string {
  return [
    chord.control ? "⌃" : "",
    chord.alt ? "⌥" : "",
    chord.shift ? "⇧" : "",
    chord.command ? "⌘" : "",
  ].join("") + displayKeyName(chord.key);
}

/** Display form of a daemon menu accelerator for menus rendered in the page. */
export function menuAcceleratorLabel(
  accelerator: string,
  apple = true,
  labels?: ShortcutModifierLabels,
): string {
  const chord = parseAcceleratorChord(accelerator);
  if (!chord) return accelerator;
  return apple || !labels ? formatChordApple(chord) : formatChordOffApple(chord, labels);
}

/** Display form of glyph-notation keys (Help table, step hints). Apple keeps
 * the canonical glyphs; elsewhere the leading modifiers become names. */
export function formatShortcutKeys(
  keys: string,
  applePlatform: boolean,
  labels: ShortcutModifierLabels,
): string {
  if (applePlatform) return keys;

  const modifierNames: Record<string, string> = {
    "⌘": labels.control,
    "⌃": labels.control,
    "⌥": labels.alt,
    "⇧": labels.shift,
  };
  const repeatedModifier = keys.trim().match(/^([⌘⌃⌥⇧])\s+\1$/);
  if (repeatedModifier) {
    const label = modifierNames[repeatedModifier[1]];
    return `${label} ${label}`;
  }

  const tokens = keys.trim().replace(/\s*\+\s*/g, " ").split(/\s+/);
  const modifiers: string[] = [];
  while (tokens.length > 0 && modifierNames[tokens[0]]) {
    modifiers.push(modifierNames[tokens.shift()!]);
  }
  if (modifiers.length === 0) return keys;
  return [...modifiers, tokens.join(" ")].filter(Boolean).join("+");
}

const NAMED_EVENT_KEYS: Record<string, string> = {
  plus: "+",
  minus: "-",
  comma: ",",
  period: ".",
  space: " ",
  esc: "Escape",
  escape: "Escape",
  enter: "Enter",
  return: "Enter",
  tab: "Tab",
  backspace: "Backspace",
  delete: "Delete",
  left: "ArrowLeft",
  right: "ArrowRight",
  up: "ArrowUp",
  down: "ArrowDown",
};

type ChordEvent = Pick<
  KeyboardEvent,
  "key" | "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey"
> & Partial<Pick<KeyboardEvent, "getModifierState">>;

/** AltGr typing a character (@ { [ € on German, ą ł on Polish layouts).
 * Windows reports AltGr as Ctrl+Alt, so without this check the keystroke
 * would look like a Ctrl+Alt chord. */
export function isAltGraphEvent(
  event: Partial<Pick<KeyboardEvent, "key" | "getModifierState">>,
): boolean {
  if (event.key === "AltGraph") return true;
  try {
    return event.getModifierState?.("AltGraph") === true;
  } catch {
    return false;
  }
}

/** The platform primary modifier for clicks and keys: ⌘ on Apple, Ctrl elsewhere. */
export function primaryModifierHeld(
  event: Pick<KeyboardEvent | MouseEvent, "metaKey" | "ctrlKey">,
  apple = usesAppleShortcuts(),
): boolean {
  return apple ? event.metaKey : event.ctrlKey;
}

export function matchesCaretShortcut(event: Partial<ChordEvent>): boolean {
  if (event.metaKey || event.ctrlKey || event.altKey) return false;
  // Shift can produce a literal caret. The dedicated German key can report
  // "Dead" at the Backquote or IntlBackslash position, depending on the OS.
  return event.key === "^" || (
    event.key === "Dead" && !event.shiftKey &&
    (event.code === "Backquote" || event.code === "IntlBackslash")
  );
}

function chordKeyMatches(key: string, event: ChordEvent): boolean {
  const expected = key.toLowerCase();
  if (/^[a-z]$/.test(expected)) {
    if (event.key.toLowerCase() === expected) return true;
    // Non-Latin layouts report the typed letter; native accelerators bind the
    // key position, so fall back to the physical key there.
    return !/^[\x20-\x7e]$/.test(event.key) && event.code === `Key${expected.toUpperCase()}`;
  }
  if (/^[0-9]$/.test(expected)) {
    return event.code === `Digit${expected}` || event.key === expected;
  }
  if (/^f\d{1,2}$/.test(expected)) return event.key.toLowerCase() === expected;
  return event.key === (NAMED_EVENT_KEYS[expected] ?? key);
}

/** Exact match of a keyboard event against a chord; `command` follows the
 * platform (⌘ on Apple, Ctrl elsewhere). Off Apple platforms an AltGr
 * keystroke types a character and never matches a chord. */
export function chordMatchesEvent(
  chord: ShortcutChord,
  event: ChordEvent,
  apple: boolean,
): boolean {
  if (!apple && isAltGraphEvent(event)) return false;
  const wantsMeta = apple && chord.command;
  const wantsCtrl = chord.control || (!apple && chord.command);
  return event.metaKey === wantsMeta
    && event.ctrlKey === wantsCtrl
    && event.altKey === chord.alt
    && event.shiftKey === chord.shift
    && chordKeyMatches(chord.key, event);
}
