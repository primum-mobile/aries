// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later
import type { OptionsPayload } from '../daemon/client';
import type { WheelPreset } from '../daemon/wheel-presets-client';
import type { WheelTypographyProfile } from './wheel-render-style';

type WheelStyle = Pick<WheelPreset, 'id' | 'name' | 'layout' | 'factory'>;
type WheelStyleOptions = Pick<OptionsPayload, 'catalog' | 'display'>;
const profiles: WheelTypographyProfile[] = ['classic', 'compact', 'anglo', 'houses', 'cusps'];

/** Theme working copies keep their underlying presentation in every selector. */
export function wheelStyleDisplayId(id: string, layout: WheelTypographyProfile,
  overrides: Readonly<Record<string, unknown>>): string {
  if (!id.startsWith('working.')) return id;
  if (layout === 'cusps' && overrides['wheel.presentation'] === 'vintage-magazine') return 'factory.vintage-magazine';
  if (layout === 'anglo' && overrides['wheel.presentation'] === 'theorem') return 'factory.theorem';
  return layout === 'compact' && overrides['wheel.presentation'] === 'traditional-morinus'
    ? 'factory.traditional-morinus' : `factory.${layout}`;
}

export function wheelStyleChoices(options: WheelStyleOptions): WheelStyle[] {
  const styles = options.catalog.wheelStyles;
  return styles?.length ? styles.filter(style => style.id.startsWith('user.')
    || (style.factory && style.id.startsWith('factory.'))) : profiles.map((layout, index) => ({
    id: `factory.${layout}`, layout, factory: true,
    name: options.catalog.themeLayouts.find(item => item.value === index)?.label ?? layout,
  }));
}
export function wheelStyleCommand(style: WheelStyle): string {
  return style.id === `factory.${style.layout}` ? `quick.options.layout:${profiles.indexOf(style.layout)}`
    : `quick.options.wheel-preset:${style.id}`;
}
export function wheelStyleForCommand(command: string, options: WheelStyleOptions): WheelStyle | undefined {
  return wheelStyleChoices(options).find(style => wheelStyleCommand(style) === command);
}
export function wheelStyleMenuChecks(options: WheelStyleOptions) {
  const selected = options.display.wheel_preset_style_id ?? options.display.wheel_preset_id ?? `factory.${profiles[options.display.theme]}`;
  return wheelStyleChoices(options).map(style => ({id: wheelStyleCommand(style), checked: style.id === selected
    || (style.id === `factory.${style.layout}` && selected.startsWith('working.') && style.layout === profiles[options.display.theme])}));
}
export function userWheelStyleMenuEntries(options: WheelStyleOptions) {
  return wheelStyleChoices(options).filter(style => style.id !== `factory.${style.layout}`).map(style => ({
    id: wheelStyleCommand(style), label: style.name,
    checked: style.id === (options.display.wheel_preset_style_id ?? options.display.wheel_preset_id),
  }));
}
