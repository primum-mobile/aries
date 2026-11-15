// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useEffect } from "react";

// WKWebView does not consistently supply Select All when the native menu's
// Cmd+A accelerator is left available for the chart's Astrocartography command.
// Own this gesture at the window boundary, including raw/number inputs and
// fields rendered in portals or retained companion windows.
export function TextEditingShortcuts() {
  useEffect(() => {
    const selectAll = (event: KeyboardEvent) => {
      if (
        event.isComposing ||
        !(event.metaKey || event.ctrlKey) ||
        event.altKey || event.shiftKey ||
        event.key.toLowerCase() !== "a"
      ) return;

      const target = event.target;
      if (target instanceof HTMLInputElement) {
        // Native date/time pickers have segmented editors, rather than a text
        // selection API, and must keep their own keyboard behavior.
        if (target.disabled || !/^(text|search|tel|url|email|password|number)$/.test(target.type)) return;
        target.select();
      } else if (target instanceof HTMLTextAreaElement) {
        if (target.disabled) return;
        target.select();
      } else if (target instanceof HTMLElement && target.isContentEditable) {
        // Let the editing engine select the focused editing host, preserving
        // rich-text selection and its native undo/delete behavior.
        if (!target.ownerDocument.execCommand("selectAll")) return;
      } else {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener("keydown", selectAll, true);
    return () => window.removeEventListener("keydown", selectAll, true);
  }, []);

  return null;
}
