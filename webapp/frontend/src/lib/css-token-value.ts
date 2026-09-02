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

const CSS_CUSTOM_PROPERTY_ALIAS = /^var\(\s*(--[A-Za-z0-9_-]+)\s*(?:,\s*(.+))?\)$/;

/** Resolve an exact custom-property alias chain without flattening other CSS. */
export function resolveCssCustomPropertyValue(
  name: `--${string}`,
  read: (token: `--${string}`) => string,
): string | null {
  const seen = new Set<string>();
  let current = name;
  let fallback: string | null = null;
  while (!seen.has(current)) {
    seen.add(current);
    const value = read(current as `--${string}`).trim();
    if (!value) return fallback;
    const alias = CSS_CUSTOM_PROPERTY_ALIAS.exec(value);
    if (!alias) return value;
    current = alias[1] as `--${string}`;
    fallback = alias[2]?.trim() || fallback;
  }
  return fallback;
}

/**
 * The colour a token actually resolves to on the live document, or null when it
 * is unset. Use it to read what is painted right now, as against what an
 * editor's own state believes: a token can be carried by the applied stylesheet
 * without appearing in any override map.
 */
export function readRootCssColorToken(name: `--${string}`): string | null {
  if (typeof document === "undefined" || typeof window === "undefined") {
    return null;
  }
  const computed = window.getComputedStyle(document.documentElement);
  return resolveCssCustomPropertyValue(
    name,
    (token) => computed.getPropertyValue(token),
  );
}
