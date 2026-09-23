// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later
import type { OptionsPayload } from '../daemon/client';
import type { WheelPreset } from '../daemon/wheel-presets-client';
import type { WheelTypographyProfile } from './wheel-render-style';

type WheelStyle = Pick<WheelPreset, 'id' | 'name' | 'layout' | 'factory'>;
type WheelStyleOptions = Pick<OptionsPayload, 'catalog' | 'display'>;
const profiles: WheelTypographyProfile[] = ['classic', 'compact', 'anglo', 'houses', 'cusps'];

export function wheelStyleChoices(options: WheelStyleOptions): WheelStyle[] {
  const styles = options.catalog.wheelStyles;
  return styles?.length ? styles.filter(style => style.id.startsWith('user.')
    || style.id === `factory.${style.layout}`) : profiles.map((layout, index) => ({
    id: `factory.${layout}`, layout, factory: true,
    name: options.catalog.themeLayouts.find(item => item.value === index)?.label ?? layout,
  }));
}
export function wheelStyleCommand(style: WheelStyle): string {
  return style.factory ? `quick.options.layout:${profiles.indexOf(style.layout)}`
    : `quick.options.wheel-preset:${style.id}`;
}
export function wheelStyleForCommand(command: string, options: WheelStyleOptions): WheelStyle | undefined {
  return wheelStyleChoices(options).find(style => wheelStyleCommand(style) === command);
}
export function wheelStyleMenuChecks(options: WheelStyleOptions) {
  const selected = options.display.wheel_preset_id ?? `factory.${profiles[options.display.theme]}`;
  return wheelStyleChoices(options).map(style => ({id: wheelStyleCommand(style), checked: style.id === selected
    || (style.factory && selected.startsWith('working.') && style.layout === profiles[options.display.theme])}));
}
export function userWheelStyleMenuEntries(options: WheelStyleOptions) {
  return wheelStyleChoices(options).filter(style => style.id.startsWith('user.')).map(style => ({
    id: wheelStyleCommand(style), label: style.name, checked: style.id === options.display.wheel_preset_id,
  }));
}
