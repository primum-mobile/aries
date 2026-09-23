// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import ownership from "./wheel-geometry-ownership.json";

/** Shared with the daemon: every editable value has exactly one persistence owner. */
export const WHEEL_GEOMETRY_LEGACY_TOKENS: Readonly<Record<string, string>> = Object.freeze(ownership.legacyTokens);
const legacyKeys = new Set([...Object.keys(ownership.legacyTokens), ...Object.values(ownership.legacyTokens)]);
const properties = new Set<string>(ownership.authoringProperties);
const scaleClasses = new Set<string>(ownership.scaleClasses);
const directKey = /^authoring\.wheel\.(base|classic|compact|anglo|houses|cusps)\.(.+)\.([^.]+)$/;

/** Accepts semantic IDs and legacy renderer CSS variables. Paint stays with themes. */
export function isWheelGeometryKey(key: string): boolean {
  if (legacyKeys.has(key)) return true;
  const match = directKey.exec(key);
  return !!match && (properties.has(match[3]) || (match[3] === "scale" && scaleClasses.has(match[2])));
}

export function wheelGeometryOverrides<T>(values: Readonly<Record<string, T>>): Record<string, T> {
  return Object.fromEntries(Object.entries(values).filter(([key]) => isWheelGeometryKey(key)));
}

export function wheelAppearanceOverrides<T>(values: Readonly<Record<string, T>>): Record<string, T> {
  return Object.fromEntries(Object.entries(values).filter(([key]) => !isWheelGeometryKey(key)));
}

/** Materialize inherited Base dimensions into one wheel; unrelated wheels stay intact. */
export function wheelGeometryForLayout<T>(values: Readonly<Record<string, T>>, layout: string): Record<string, T> {
  const geometry = wheelGeometryOverrides(values);
  const result: Record<string, T> = {};
  for (const [key, value] of Object.entries(geometry)) {
    const match = directKey.exec(key);
    if (!match) result[key] = value;
    else if (match[1] === "base") result[key.replace(".base.", `.${layout}.`)] = value;
  }
  for (const [key, value] of Object.entries(geometry)) {
    if (directKey.exec(key)?.[1] === layout) result[key] = value;
  }
  return result;
}
