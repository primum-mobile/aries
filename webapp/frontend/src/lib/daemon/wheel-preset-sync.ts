// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later
import type { WheelTypographyProfile } from '../chart/wheel-render-style';
import type { WheelComposition } from '../chart/wheel-composition';
import { useChartStyleEditorStore, type ChartStyleSemanticOverrides } from '../../stores/chart-style-editor-store';
import { fetchWheelPresets, mutateWheelPreset } from './wheel-presets-client';

// One write lane survives panel closes and orders edits before save/theme actions.
let writes: Promise<unknown> = Promise.resolve();
export function enqueueWheelPresetWrite<T>(write: () => Promise<T>): Promise<T> {
  const request = writes.then(write, write);
  writes = request;
  return request;
}

export async function waitForWheelPresetWrites() {
  let current;
  do { current = writes; await current.catch(() => undefined); } while (current !== writes);
}

export function flushWheelGeometry() {
  return enqueueWheelPresetWrite(async () => {
    const state = useChartStyleEditorStore.getState();
    if (!state.geometryProfile || !state.wheelPresetState || state.gestureStart) return;
    const sent = {...state.geometryOverrides};
    const overrides: Record<string, ChartStyleSemanticOverrides[string] | null> = {};
    for (const key of new Set([...Object.keys(sent), ...Object.keys(state.syncedGeometryOverrides)])) {
      if (JSON.stringify(sent[key]) !== JSON.stringify(state.syncedGeometryOverrides[key])) {
        overrides[key] = sent[key] ?? null;
      }
    }
    if (!Object.keys(overrides).length) return;
    const layout = state.geometryProfile;
    const result = await mutateWheelPreset({action: 'patch', layout, overrides,
      baseRevision: state.wheelPresetState.revision});
    useChartStyleEditorStore.getState().markWheelGeometrySynced(result, layout, sent);
  });
}

/** Echo ring edits immediately; while a request is pending retain only the
 * newest complete composition. Save/theme actions queue after the entire drain. */
export function createWheelCompositionWriter(profile: WheelTypographyProfile,
  preview: (composition: WheelComposition | null) => void) {
  let latest: WheelComposition | null = null;
  let running: Promise<void> | null = null;
  return (composition: WheelComposition): Promise<void> => {
    latest = composition;
    preview(composition);
    useChartStyleEditorStore.setState(state => ({pendingWheelCompositions: {...state.pendingWheelCompositions, [profile]: composition}}));
    if (running) return running;
    running = enqueueWheelPresetWrite(async () => {
      let sent: WheelComposition | null = null;
      try {
        while (latest) {
          sent = latest;
          latest = null;
          const state = useChartStyleEditorStore.getState();
          if (!state.wheelPresetState) throw new Error('Wheel presets are not loaded');
          const result = await mutateWheelPreset({action: 'patch', layout: profile,
            composition: sent, baseRevision: state.wheelPresetState.revision});
          const current = useChartStyleEditorStore.getState();
          current.acceptWheelPresets(result, profile, {preserveLocalChanges: true,
            metadataOnly: current.geometryProfile !== profile});
        }
      } finally {
        const last = latest ?? sent;
        useChartStyleEditorStore.setState(state => {
          if (state.pendingWheelCompositions[profile] !== last) return state;
          const pendingWheelCompositions = {...state.pendingWheelCompositions};
          delete pendingWheelCompositions[profile];
          return {pendingWheelCompositions};
        });
        latest = null;
        running = null;
        preview(null);
      }
    });
    return running;
  };
}


/** Options menu selection uses the same revisioned owner as the editor. Fetch
 * the current revision after draining local edits: Settings is another window. */
export async function activateWheelStyle(presetId: string, layout: WheelTypographyProfile) {
  await flushWheelGeometry();
  return enqueueWheelPresetWrite(async () => {
    const current = await fetchWheelPresets();
    // The daemon resolves built-in layouts to their theme modifications.
    // Forward the chosen identity; a parked named preset is a separate choice.
    const result = await mutateWheelPreset({action: 'select', presetId, layout,
      activateLayout: true, baseRevision: current.revision});
    const editor = useChartStyleEditorStore.getState();
    editor.acceptWheelPresets(result, editor.geometryProfile ?? layout,
      {clearHistory: true, metadataOnly: editor.geometryProfile == null});
    return result;
  });
}
