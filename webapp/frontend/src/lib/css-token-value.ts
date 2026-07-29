// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

export function readRootCssPixelToken(
  name: `--${string}`,
  fallback: number,
): number {
  if (typeof document === "undefined" || typeof window === "undefined") {
    return fallback;
  }
  const value = Number.parseFloat(
    window
      .getComputedStyle(document.documentElement)
      .getPropertyValue(name),
  );
  return Number.isFinite(value) ? value : fallback;
}

export function rootCssPixelOffset(
  name: `--${string}`,
  fallback: number,
): () => number {
  return () => readRootCssPixelToken(name, fallback);
}
