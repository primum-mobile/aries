// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later
import { compatibleRingOrder, type WheelComposition } from '../chart/wheel-composition';
import type { WheelTypographyProfile } from '../chart/wheel-render-style';
import { equalChartStyleOverrides } from '../../stores/chart-style-editor-store';
import type { WheelPresetMutation, WheelPresetsState } from './wheel-presets-client';

export type WheelPresetPatch = Pick<WheelPresetMutation, 'overrides' | 'composition'>;

function sameStructure(left: WheelComposition, right: WheelComposition): boolean {
  return left.projection === right.projection && left.rings.length === right.rings.length
    && left.rings.every((ring, index) => {
      const other = right.rings[index];
      return ring.instanceId === other.instanceId && ring.archetypeId === other.archetypeId
        && ring.chartRole === other.chartRole;
    });
}

/** The catalog revision spans windows and layouts. Reapply only the fields the
 * gesture changed; another selection or an overlapping edit remains a conflict. */
export function rebaseWheelPresetPatch(layout: WheelTypographyProfile, baseline: WheelPresetsState,
  current: WheelPresetsState, patch: WheelPresetPatch): WheelPresetPatch | null {
  if (baseline === current) return patch;
  const before = baseline.drafts[layout], after = current.drafts[layout];
  if (!before || !after || baseline.selected[layout] !== current.selected[layout]
    || before.sourcePresetId !== after.sourcePresetId) return null;
  // A theme recall can replace working.<layout> without changing its identity.
  const oldSource = baseline.activePresets?.[layout]
    ?? baseline.presets.find(preset => preset.id === baseline.selected[layout]);
  const newSource = current.activePresets?.[layout]
    ?? current.presets.find(preset => preset.id === current.selected[layout]);
  if (!oldSource || !newSource || !equalChartStyleOverrides(oldSource.overrides, newSource.overrides)
    || !sameStructure(oldSource.composition, newSource.composition)
    || oldSource.composition.rings.some((ring, index) => ring.enabled !== newSource.composition.rings[index].enabled)) return null;
  for (const [key, value] of Object.entries(patch.overrides ?? {})) {
    const remote = after.overrides[key];
    if (JSON.stringify(remote) !== JSON.stringify(before.overrides[key])
      && JSON.stringify(remote) !== JSON.stringify(value ?? undefined)) return null;
  }
  if (!patch.composition) return patch;
  const desired = patch.composition;
  const localStructureChanged = !sameStructure(before.composition, desired);
  if (localStructureChanged && !sameStructure(before.composition, after.composition)
    && !sameStructure(desired, after.composition)) return null;
  const oldRings = new Map(before.composition.rings.map(ring => [ring.instanceId, ring]));
  const remoteRings = new Map(after.composition.rings.map(ring => [ring.instanceId, ring]));
  const localRings = new Map(desired.rings.map(ring => [ring.instanceId, ring]));
  for (const ring of desired.rings) {
    const old = oldRings.get(ring.instanceId), remote = remoteRings.get(ring.instanceId);
    if (old && ring.enabled !== old.enabled && (!remote || remote.archetypeId !== ring.archetypeId)) return null;
  }
  const composition = {
    ...(localStructureChanged ? desired : after.composition),
    rings: (localStructureChanged ? desired : after.composition).rings.map(ring => {
      const old = oldRings.get(ring.instanceId), local = localRings.get(ring.instanceId);
      const enabled = local && (!old || local.enabled !== old.enabled)
        ? local.enabled : remoteRings.get(ring.instanceId)?.enabled ?? ring.enabled;
      return {...ring, enabled};
    }),
  };
  return compatibleRingOrder(composition) ? {...patch, composition} : null;
}
