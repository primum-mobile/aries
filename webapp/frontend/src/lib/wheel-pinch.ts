// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import { usesAppleShortcuts } from "@/lib/shortcut-display";

// Chromium (WebView2 on Windows, Chrome) reports a precision-touchpad pinch
// as a wheel event with ctrlKey set and deltaY = -100 · ln(scale). Ctrl plus
// a mouse wheel looks the same with deltaY ±100 per notch, so one event never
// moves the camera by more than this many delta units (≈ ×1.5).
const PINCH_DELTA_MAX = 40;

type PinchWheelEvent = Pick<WheelEvent, "ctrlKey" | "deltaY" | "deltaMode">;

/** The zoom factor (> 1 zooms in) a Ctrl + wheel pinch asks for, or null
 * when the event is an ordinary wheel. Apple platforms keep their own wheel
 * handling: WebKit reports pinch as gesture events, not Ctrl + wheel. */
export function wheelPinchScale(
  event: PinchWheelEvent,
  apple = usesAppleShortcuts(),
): number | null {
  if (apple || !event.ctrlKey || event.deltaMode !== 0) return null;
  const delta = Math.max(-PINCH_DELTA_MAX, Math.min(PINCH_DELTA_MAX, event.deltaY));
  return Math.exp(-delta / 100);
}
