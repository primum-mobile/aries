// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import * as React from "react";

import { resolveShellHost } from "@/lib/shell-host";

/**
 * The single touch-layout query of the browser build: phone widths, plus any
 * touch-first device (coarse primary pointer) up to large-tablet widths, so
 * phones in landscape and iPads in either orientation (iPad Pro 13" landscape
 * is 1376 px) get the large wheel, the bottom navigation and full-screen views
 * instead of the desktop sidebar and right pane. A desktop browser with a
 * mouse keeps the desktop layout from 768 px; Tauri windows never use it.
 */
export const MOBILE_LAYOUT_QUERY =
  "(max-width: 767px), (pointer: coarse) and (max-width: 1400px)";
export const MOBILE_LAYOUT_ATTR = "data-aries-mobile";

function subscribe(onChange: () => void): () => void {
  const query = window.matchMedia(MOBILE_LAYOUT_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function snapshot(): boolean {
  return resolveShellHost().kind === "browser" &&
    window.matchMedia(MOBILE_LAYOUT_QUERY).matches;
}

function serverSnapshot(): boolean {
  return false;
}

/** The touch layout's current value outside React (event handlers, effects). */
export function mobileLayoutMatches(): boolean {
  return snapshot();
}

/** True only for the browser build on a phone or touch-tablet viewport. */
export function useMobileLayout(): boolean {
  return React.useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}
