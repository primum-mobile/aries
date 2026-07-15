// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

const SPOTLIGHT_SHORTCUT_COOLDOWN_MS = 350;

let spotlightCooldownUntil = 0;

function nowMs(): number {
  if (typeof performance !== "undefined") return performance.now();
  return Date.now();
}

export function noteSpotlightDismissed(): void {
  spotlightCooldownUntil = nowMs() + SPOTLIGHT_SHORTCUT_COOLDOWN_MS;
}

export function spotlightShortcutCoolingDown(): boolean {
  return nowMs() < spotlightCooldownUntil;
}
