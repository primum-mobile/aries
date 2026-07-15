// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useEffect, useRef } from "react";

// Keyboard routing scope. "chart" = chart-canvas-local gesture (arrow stepping,
// quick-letter launchers) that must NOT fire while a modal/text input owns
// focus; "any" = a global command key (overlay toggle, Cmd+W) that fires
// regardless of focus — the parity split between desktop _focus_is_chart_canvas
// (morin.py:285-327) and _focus_allows_global_shortcuts (morin.py:330-358).
// The focus decision is made POSITIONALLY below (modal/INPUT/TEXTAREA checks),
// the wx-free twin of those focus gates — there is no separate Zustand scope
// flag to keep in sync (the desktop reads live focus, never a stored mode).
type ShortcutScope = "chart" | "any";

type ShortcutHandler = (event: KeyboardEvent) => void;
type ShortcutOptions = {
  allowAlt?: boolean;
  allowCtrl?: boolean;
  allowMeta?: boolean;
  allowTextInput?: boolean;
  ignoreRepeat?: boolean;
};

function matchesShortcutKey(
  event: KeyboardEvent,
  key: string,
  options: { release?: boolean } = {},
): boolean {
  const expected = key.toLowerCase();
  if (event.key.toLowerCase() === expected) return true;
  // `?` is Shift+/ on US/macOS keyboards. Keydown often reports "?", but keyup
  // can report "/" if Shift is released first; treat the physical slash key as
  // the same shortcut so the repeat guard never gets stuck.
  return expected === "?" && event.code === "Slash" && (options.release || event.shiftKey);
}

export function useShortcut(
  key: string,
  scope: ShortcutScope,
  handler: ShortcutHandler,
  options: ShortcutOptions = {},
): void {
  const keyDownRef = useRef(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((options.ignoreRepeat ?? true) && (event.repeat || keyDownRef.current)) {
        return;
      }
      const target = event.target as HTMLElement | null;
      if (
        target &&
        !options.allowTextInput &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      // Mirror the desktop positive-identification gate
      // (morin._focus_is_chart_canvas): chart-local keys (arrow stepping, etc.)
      // fire only when the chart host owns the keyboard. A modal dialog steals
      // focus out of the chart subtree on the desktop, so it must suppress
      // chart-scoped stepping here too. Radix/shadcn dialogs render in a portal
      // as [role="dialog"] / [role="alertdialog"] with data-state="open";
      // while one is mounted, or the event originates inside one, do not run
      // chart-scoped shortcuts. "any"-scoped global command keys are left
      // through (parity with _focus_allows_global_shortcuts) and the toggle
      // key for an overlay must still close it.
      if (scope !== "any" && typeof document !== "undefined") {
        const openModal = document.querySelector(
          '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]',
        );
        if (openModal) {
          return;
        }
        if (target && target.closest('[role="dialog"], [role="alertdialog"]')) {
          return;
        }
      }
      if (
        (event.metaKey && !options.allowMeta) ||
        (event.ctrlKey && !options.allowCtrl) ||
        (event.altKey && !options.allowAlt)
      ) {
        return;
      }
      if (!matchesShortcutKey(event, key)) {
        return;
      }
      event.preventDefault();
      keyDownRef.current = true;
      handler(event);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (matchesShortcutKey(event, key, { release: true })) {
        keyDownRef.current = false;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [
    key,
    scope,
    handler,
    options.allowAlt,
    options.allowCtrl,
    options.allowMeta,
    options.allowTextInput,
    options.ignoreRepeat,
  ]);
}
