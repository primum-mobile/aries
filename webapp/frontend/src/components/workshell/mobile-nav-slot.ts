// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import * as React from "react";

// The centre of the phone's bottom navigation bar. The chart pane's stepping
// controls render into it (a portal), so the phone has one bar instead of a
// stepping rail stacked above the navigation, and the wheel keeps that height.

let slot: HTMLElement | null = null;
const listeners = new Set<() => void>();

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

function snapshot(): HTMLElement | null {
  return slot;
}

function serverSnapshot(): HTMLElement | null {
  return null;
}

/** Ref callback for the navigation bar's centre slot element. */
export function setMobileNavSlot(element: HTMLElement | null): void {
  if (slot === element) return;
  slot = element;
  listeners.forEach((listener) => listener());
}

/** The mounted slot element, or null when no phone navigation is shown. */
export function useMobileNavSlot(): HTMLElement | null {
  return React.useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}
