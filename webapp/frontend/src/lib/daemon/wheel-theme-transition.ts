// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later
import { useChartStyleEditorStore, equalChartStyleOverrides } from '../../stores/chart-style-editor-store';
import { wheelAppearanceOverrides } from '../chart/wheel-geometry-ownership';
import type { WheelTypographyProfile } from '../chart/wheel-render-style';
import { applyThemePreset, type OptionsPayload } from './client';
import { fetchWheelPresets, WheelPresetApiError, type WheelPresetsState } from './wheel-presets-client';
import { enqueueWheelPresetWrite, flushWheelGeometry } from './wheel-preset-sync';
import { createStyleLabDraftFromTheme, fetchStyleLabThemeSources,
  patchCurrentStyleLabDraft, waitForStyleDraftWrites, type StyleLabTokenValue } from '../style-lab/client';
import { StyleLabApiError } from '../style-lab/client';
import { fetchBoundStyleDraft } from '../style-lab/prepare-save';
import type { StyleLabThemeSource } from '../style-lab/client';

const profiles: WheelTypographyProfile[] = ['classic', 'compact', 'anglo', 'houses', 'cusps'];
let transitions = 0;

/** A full theme recall authorizes every returned layout, including retained
 * charts outside the editor's current geometry profile. */
export function acceptWheelThemePresets(presets: WheelPresetsState,
  profile?: WheelTypographyProfile | null) {
  const current = useChartStyleEditorStore.getState();
  const primary = profile ?? profiles[presets.display?.theme ?? 0];
  current.clearWheelGeometryContext();
  current.acceptWheelPresets(presets, primary, {clearHistory: true});
  for (const other of profiles) if (other !== primary && presets.drafts[other]) {
    useChartStyleEditorStore.getState().acceptWheelPresets(presets, other,
      {metadataOnly: true, acknowledgeGeometry: true});
  }
}

export async function flushStyleLabAppearance() {
  await waitForStyleDraftWrites();
  const state = useChartStyleEditorStore.getState();
  if (!state.remoteDraftId) return;
  const remote = await fetchBoundStyleDraft(state.remoteDraftId);
  if (!remote || useChartStyleEditorStore.getState().remoteDraftId !== state.remoteDraftId) throw new WheelPresetApiError(409);
  state.acceptRemoteDraft(remote, {preserveLocalChanges: true});
  const current = useChartStyleEditorStore.getState();
  const desired = wheelAppearanceOverrides(current.semanticOverrides);
  if (equalChartStyleOverrides(desired, current.syncedOverrides)) return;
  const overrides: Record<string, StyleLabTokenValue | null> = {};
  for (const id of new Set([...Object.keys(desired), ...Object.keys(current.syncedOverrides)])) {
    if (JSON.stringify(desired[id]) !== JSON.stringify(current.syncedOverrides[id])) overrides[id] = desired[id] ?? null;
  }
  const patched = await patchCurrentStyleLabDraft({draftId: remote.id,
    baseRevision: remote.revision, overrides}, remote.etag);
  const after = useChartStyleEditorStore.getState();
  if (after.remoteDraftId !== remote.id) throw new WheelPresetApiError(409);
  after.markSynced(patched, desired);
}

async function acceptThemeContext(sourceThemeName: string, presets: WheelPresetsState,
  sources: readonly StyleLabThemeSource[]) {
  if (presets.context?.sourceThemeName !== sourceThemeName) throw new WheelPresetApiError(409, presets);
  const current = useChartStyleEditorStore.getState();
  const draft = current.remoteDraftId || current.active ? await createStyleLabDraftFromTheme(sourceThemeName) : null;
  // Another native window can select a theme while the source draft is loading.
  // Re-read before publishing the coherent local context, without replaying a selection.
  if (draft) {
    presets = await fetchWheelPresets();
    if (presets.context?.sourceThemeName !== sourceThemeName) throw new WheelPresetApiError(409, presets);
  }
  acceptWheelThemePresets(presets, current.geometryProfile);
  if (draft) {
    const source = sources.find(item => item.name === sourceThemeName);
    useChartStyleEditorStore.getState().acceptRemoteDraft(draft, {clearHistory: true});
    if (source) useChartStyleEditorStore.getState().setStyleLabBaseTheme({sourceThemeName: source.name,
      mode: source.mode, appTokens: source.appTokens, chartPalette: source.chartPalette,
      chartData: source.chartData, appAuthoring: source.appAuthoring});
  }
  useChartStyleEditorStore.getState().setLiveAppThemePreview(false);
}

/** Reconcile a theme chosen by another native window without replaying its
 * selection or publishing the preceding theme's dimensions into the new wheel. */
export async function synchronizeWheelTheme(sourceThemeName: string) {
  transitions++;
  useChartStyleEditorStore.setState({geometryTransition: true});
  try {
    await enqueueWheelPresetWrite(async () => {
      await flushStyleLabAppearance();
      const [presets, sources] = await Promise.all([fetchWheelPresets(), fetchStyleLabThemeSources()]);
      await acceptThemeContext(presets.context?.sourceThemeName ?? sourceThemeName, presets, sources);
    });
  } finally {
    transitions--;
    useChartStyleEditorStore.setState({geometryTransition: transitions > 0});
  }
}

export async function checkedStyleLabSaveContext(conflictMessage: string) {
  const state = useChartStyleEditorStore.getState();
  const presets = await fetchWheelPresets();
  if (!state.remoteDraftId || !state.remoteSourceThemeName
    || presets.context?.sourceThemeName !== state.remoteSourceThemeName
    || useChartStyleEditorStore.getState().remoteDraftId !== state.remoteDraftId) {
    throw new StyleLabApiError(conflictMessage, 409);
  }
  return {draftId: state.remoteDraftId, sourceThemeName: state.remoteSourceThemeName,
    expectedWheelRevision: presets.context.revision};
}

/** Every theme selector parks appearance by source and replaces the whole wheel
 * context through the existing write lane. It never leaves A's draft over B's wheel. */
export async function applyWheelTheme(sourceThemeName: string,
  beforeTransition?: () => Promise<void>): Promise<OptionsPayload> {
  await beforeTransition?.();
  const editor = useChartStyleEditorStore.getState();
  if (editor.gestureOwner) editor.cancelGesture(editor.gestureOwner);
  transitions++;
  useChartStyleEditorStore.setState({geometryTransition: true});
  try {
    await flushWheelGeometry();
    return await enqueueWheelPresetWrite(async () => {
      await flushStyleLabAppearance();
      const options = await applyThemePreset(sourceThemeName);
      const [presets, sources] = await Promise.all([fetchWheelPresets(), fetchStyleLabThemeSources()]);
      await acceptThemeContext(sourceThemeName, presets, sources);
      return options;
    });
  } finally {
    transitions--;
    useChartStyleEditorStore.setState({geometryTransition: transitions > 0});
  }
}
