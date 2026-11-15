// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later
import Color from 'colorjs.io';
import { mergeWheelPresetAppearance, wheelPresetAppearanceForLayout, wheelPresetPresentationAppearance, type WheelPresetAppearance } from '../chart/wheel-preset-appearance';
import type { WheelTypographyProfile } from '../chart/wheel-render-style';
import type { StyleLabTokenValue } from './client';

/** Capture only this wheel's authored paint. Resolved palette references may
 * be CSS colours; persistence uses the same RGB(A) values as the class editor. */
export function captureWheelPresetAppearance(values: WheelPresetAppearance,
  profile: WheelTypographyProfile,
  metadata: Readonly<Record<string, {cssVar: string; type: string}>>,
  saved: WheelPresetAppearance = {}, edits: WheelPresetAppearance = {},
  authoredValues: WheelPresetAppearance = values,
  presentation?: unknown,
): Record<string, StyleLabTokenValue> {
  const appearance = mergeWheelPresetAppearance({
    ...wheelPresetAppearanceForLayout(values, profile, metadata),
    ...wheelPresetAppearanceForLayout(wheelPresetPresentationAppearance(profile, presentation), profile), ...saved,
  }, edits);
  const authored = wheelPresetAppearanceForLayout(authoredValues, profile, metadata);
  for (const [key, value] of Object.entries(authored)) {
    if (typeof value === 'string' && /^\{[^{}]+\}$/.test(value)
      && (!Object.hasOwn(saved, key) || Object.hasOwn(edits, key))) appearance[key] = value;
  }
  const colorTokens = new Set(Object.values(metadata).filter(token => token.type === 'color').map(token => token.cssVar));
  return Object.fromEntries(Object.entries(appearance).map(([key, value]) => {
    if (typeof value === 'string' && !/^\{[^{}]+\}$/.test(value)
      && (colorTokens.has(key) || /\.(?:color|\w*Color)$/.test(key))) {
      const color = new Color(value).to('srgb').toGamut();
      const rgb = color.coords.map(channel => Math.max(0, Math.min(255, Math.round(Number(channel ?? 0) * 255))));
      value = color.alpha < 1 ? [...rgb, color.alpha] : rgb;
    }
    return [key, value as StyleLabTokenValue];
  }));
}
