// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useEffect } from "react";

import { isBrowserHistoryChord, runsInBrowserTab } from "@/lib/browser-reserved-shortcuts";
import { usesAppleShortcuts } from "@/lib/shortcut-display";

/**
 * Browser tabs on Windows and Linux: Alt+Left/Right (minute stepping) must
 * never fall through to the browser's Back/Forward, which would leave Aries
 * when focus sits in a field or dialog and the stepping handler stands aside.
 * The desktop app and Apple browsers (Back is Cmd+[ there) are untouched.
 */
export function useBrowserHistoryKeyGuard(): void {
  useEffect(() => {
    if (!runsInBrowserTab() || usesAppleShortcuts()) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (isBrowserHistoryChord(event)) event.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
