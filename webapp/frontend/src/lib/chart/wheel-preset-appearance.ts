// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later
import { isWheelGeometryKey } from './wheel-geometry-ownership';
import type { WheelTypographyProfile } from './wheel-render-style';
import { WHEEL_FACTORY_SETTINGS } from "./wheel-composition";

export type WheelPresetAppearance = Readonly<Record<string, unknown>>;

export function wheelPresetPresentationAppearance(profile: WheelTypographyProfile, presentation: unknown): WheelPresetAppearance {
  return profile === 'anglo' && presentation === 'theorem'
    ? WHEEL_FACTORY_SETTINGS.presentations.theorem.appearance : {};
}

/** Freeze Base class edits into this design, without copying another wheel or
 * the app/theme palette. Public renderer tokens use their catalog CSS names. */
export function wheelPresetAppearanceForLayout(
  values: WheelPresetAppearance, profile: WheelTypographyProfile,
  metadata: Readonly<Record<string, {cssVar: string}>> = {},
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const cssTokens = new Set(Object.entries(metadata).filter(([id]) => id.startsWith('renderer.wheel.')
    && !isWheelGeometryKey(id)).map(([, token]) => token.cssVar));
  for (const [id, value] of Object.entries(values)) {
    if (isWheelGeometryKey(id)) continue;
    if (id.startsWith('authoring.wheel.base.')) result[id.replace('.base.', `.${profile}.`)] = value;
    else if (cssTokens.has(id)) result[id] = value;
    else if (id.startsWith('renderer.wheel.') && metadata[id]) result[metadata[id].cssVar] = value;
  }
  for (const [id, value] of Object.entries(values)) {
    if (isWheelGeometryKey(id)) continue;
    if (id.startsWith(`authoring.wheel.${profile}.`)
      || (profile === 'cusps' && id.startsWith('authoring.wheel.vintage.'))) result[id] = value;
  }
  return result;
}

/** Theme/draft values that changed after this design was loaded are live edits,
 * not inherited theme values that should mask the design's saved paint. */
export function wheelPresetAppearanceDelta(current: WheelPresetAppearance, baseline: WheelPresetAppearance,
  resolved: WheelPresetAppearance = current) {
  return Object.fromEntries([...new Set([...Object.keys(current), ...Object.keys(baseline)])]
    .filter(key => JSON.stringify(current[key]) !== JSON.stringify(baseline[key]))
    .map(key => [key, current[key] == null ? null : resolved[key] ?? current[key]]));
}

export function mergeWheelPresetAppearance(saved: WheelPresetAppearance, edits: WheelPresetAppearance = {}) {
  const result = {...saved};
  for (const [id, value] of Object.entries(edits)) {
    if (value == null) delete result[id];
    else result[id] = value;
  }
  return result;
}

export function wheelPresetCssValue(value: unknown): string | undefined {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value) && (value.length === 3 || value.length === 4)) {
    return `rgb(${value.slice(0, 3).join(' ')}${value.length === 4 ? ` / ${value[3]}` : ''})`;
  }
}
