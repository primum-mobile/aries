// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later
import type { WheelTypographyProfile } from '../chart/wheel-render-style';
import type { WheelComposition } from '../chart/wheel-composition';
import { useChartStyleEditorStore, type ChartStyleSemanticOverrides } from '../../stores/chart-style-editor-store';
import { fetchWheelPresets, mutateWheelPreset, WheelPresetApiError, type WheelPresetsState } from './wheel-presets-client';
import { rebaseWheelPresetPatch, type WheelPresetPatch } from './wheel-preset-rebase';

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

async function patchWheelPreset(layout: WheelTypographyProfile, baseline: WheelPresetsState,
  patch: WheelPresetPatch): Promise<WheelPresetsState> {
  let current = useChartStyleEditorStore.getState().wheelPresetState ?? baseline;
  for (let attempt = 0; attempt < 3; attempt++) {
    const rebased = rebaseWheelPresetPatch(layout, baseline, current, patch);
    if (!rebased) throw new WheelPresetApiError(409, current);
    try {
      return await mutateWheelPreset({action: 'patch', layout, ...rebased, baseRevision: current.revision});
    } catch (error) {
      if (!(error instanceof WheelPresetApiError) || error.status !== 409 || !error.current) throw error;
      current = error.current;
      // Keep the gesture's baseline until it succeeds. Publishing a rejected
      // revision would make a later flush treat conflicting values as its base.
      if (attempt === 2) throw error;
    }
  }
  throw new WheelPresetApiError(409, current);
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
    const result = await patchWheelPreset(layout, state.wheelPresetState, {overrides});
    const current = useChartStyleEditorStore.getState();
    current.acceptWheelPresets(result, layout, {preserveLocalChanges: true,
      metadataOnly: current.geometryProfile !== layout, acknowledgeGeometry: true});
  });
}

/** Echo ring edits immediately; while a request is pending retain only the
 * newest complete composition. Save/theme actions queue after the entire drain. */
export function createWheelCompositionWriter(profile: WheelTypographyProfile,
  preview: (composition: WheelComposition | null) => void) {
  let latest: WheelComposition | null = null;
  let running: Promise<void> | null = null;
  let baseline: WheelPresetsState | null = null;
  return (composition: WheelComposition): Promise<void> => {
    if (!running) {
      const state = useChartStyleEditorStore.getState();
      baseline = state.wheelPresetState;
      // The authoring intent names this layout's canonical draft. Retain its
      // dimensions together with the optimistic order even if its editor is closed.
      if (baseline) state.acceptWheelPresets(baseline, profile,
        {metadataOnly: true, acknowledgeGeometry: true});
    }
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
          if (!baseline) throw new Error('Wheel presets are not loaded');
          const result = await patchWheelPreset(profile, baseline, {composition: sent});
          const current = useChartStyleEditorStore.getState();
          current.acceptWheelPresets(result, profile, {preserveLocalChanges: true,
            metadataOnly: current.geometryProfile !== profile, acknowledgeGeometry: true});
          // The next coalesced intent was authored against this local preview.
          // Keep remote visibility changes distinct from the user's next edit.
          baseline = {...result, drafts: {...result.drafts,
            [profile]: {...result.drafts[profile]!, composition: sent}}};
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
        baseline = null;
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
      {clearHistory: true, metadataOnly: editor.geometryProfile == null,
        acknowledgeGeometry: editor.geometryProfile == null || editor.geometryProfile === layout});
    if (editor.geometryProfile && editor.geometryProfile !== layout) {
      editor.acceptWheelPresets(result, layout, {metadataOnly: true, acknowledgeGeometry: true});
    }
    return result;
  });
}
