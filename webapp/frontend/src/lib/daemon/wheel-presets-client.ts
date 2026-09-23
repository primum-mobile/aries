// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later
import { daemonBaseUrl, daemonFetch, type OptionsDisplay } from './client';
import type { WheelComposition } from '../chart/wheel-composition';
import type { WheelTypographyProfile } from '../chart/wheel-render-style';
import type { StyleLabTokenValue } from '../style-lab/client';

export type WheelGeometryOverrides = Record<string, StyleLabTokenValue>;
export type WheelPreset = {
  id: string;
  name: string;
  layout: WheelTypographyProfile;
  factory: boolean;
  overrides: WheelGeometryOverrides;
  composition: WheelComposition;
};
export type WheelPresetDraft = {
  sourcePresetId: string;
  overrides: WheelGeometryOverrides;
  composition: WheelComposition;
  dirty: boolean;
};
export type WheelPresetsState = {
  schemaVersion: 1;
  revision: number;
  /** Damaged persisted data is preserved; the editor offers a read-only fallback. */
  loadError?: string | null;
  /** Canonical fields affected by ring edits; avoids reloading all Settings. */
  display?: Pick<OptionsDisplay, 'theme' | 'houses' | 'showterms' | 'showdecans'>;
  presets: WheelPreset[];
  /** Current theme's private geometry remains selectable after leaving it. */
  activePresets?: Partial<Record<WheelTypographyProfile, WheelPreset>>;
  selected: Partial<Record<WheelTypographyProfile, string>>;
  drafts: Partial<Record<WheelTypographyProfile, WheelPresetDraft>>;
};
export type WheelPresetMutation = {
  action: 'select' | 'patch' | 'save' | 'revert' | 'restore-factory' | 'delete';
  layout: WheelTypographyProfile;
  baseRevision: number;
  presetId?: string;
  activateLayout?: boolean;
  name?: string;
  overrides?: Record<string, StyleLabTokenValue | null>;
  composition?: WheelComposition;
};

export class WheelPresetApiError extends Error {
  constructor(readonly status: number, readonly current?: WheelPresetsState) {
    super(`Wheel preset request failed (${status})`);
  }
}

async function readResult(response: Response): Promise<WheelPresetsState> {
  const result = await response.json();
  if (!response.ok) throw new WheelPresetApiError(response.status, result.current ?? result.detail?.current);
  if (result.loadError) throw new WheelPresetApiError(503, result);
  return result as WheelPresetsState;
}

export async function fetchWheelPresets(signal?: AbortSignal): Promise<WheelPresetsState> {
  return readResult(await daemonFetch(`${daemonBaseUrl()}/api/options/wheel-presets`, {
    cache: 'no-store', signal,
  }));
}

export async function mutateWheelPreset(mutation: WheelPresetMutation): Promise<WheelPresetsState> {
  return readResult(await daemonFetch(`${daemonBaseUrl()}/api/options/wheel-presets`, {
    method: 'POST', cache: 'no-store',
    headers: {'Content-Type': 'application/json'}, body: JSON.stringify(mutation),
  }));
}
