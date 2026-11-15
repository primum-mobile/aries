// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later
import { expect, test } from '@playwright/test';
import { applyWheelTheme, checkedStyleLabSaveContext, synchronizeWheelTheme } from '../src/lib/daemon/wheel-theme-transition';
import { waitForWheelPresetWrites } from '../src/lib/daemon/wheel-preset-sync';
import { useChartStyleEditorStore } from '../src/stores/chart-style-editor-store';
import type { StyleLabDraft } from '../src/lib/style-lab/client';
import type { WheelPresetsState } from '../src/lib/daemon/wheel-presets-client';
import factory from '../src/lib/chart/wheel-factory-v1.json';
import type { WheelTypographyProfile } from '../src/lib/chart/wheel-render-style';

const originalFetch = globalThis.fetch;
const scale = 'authoring.wheel.anglo.canvas.chart.scale';
const color = 'app.color.background';
const profiles: WheelTypographyProfile[] = ['classic', 'compact', 'anglo', 'houses', 'cusps'];
const draft = (source: string, value: number[]): StyleLabDraft => ({id: source.toLowerCase(), profileId: source.toLowerCase(),
  name: source, scope: 'combined', sourceThemeName: source, revision: 1, overrides: {[color]: value}, authoringOverrides: {}});
function wheels(source: string, revision: number, value: number): WheelPresetsState {
  return {schemaVersion: 1, revision, context: {sourceThemeName: source, revision},
    selected: Object.fromEntries(profiles.map(profile => [profile, `working.${profile}`])),
    presets: [], display: {theme: 2, houses: true, showterms: false, showdecans: false},
    drafts: Object.fromEntries(profiles.map(profile => [profile, {sourcePresetId: `working.${profile}`,
      overrides: profile === 'anglo' ? {[scale]: value} : {}, composition: structuredClone(factory.layouts[profile].composition), dirty: false}]))};
}
const sources = ['A', 'B', 'C'].map(name => ({name, label: name, mode: 'light', appTokens: {}, chartPalette: {}, appAuthoring: {}}));
const response = (value: unknown) => new Response(JSON.stringify(value));
test.beforeEach(() => {
  const state = useChartStyleEditorStore.getState();
  state.clearWheelGeometryContext();
  state.acceptWheelPresets(wheels('A', 1, .8), 'anglo', {clearHistory: true});
  state.acceptRemoteDraft(draft('A', [1, 2, 3]), {clearHistory: true});
  useChartStyleEditorStore.setState({active: true, geometryTransition: false, liveAppThemePreview: true});
});
test.afterEach(async () => { await waitForWheelPresetWrites(); globalThis.fetch = originalFetch; });

test('theme selection parks A appearance and publishes B appearance with all five B wheels', async () => {
  useChartStyleEditorStore.getState().setOverride(color, [4, 5, 6]);
  const requests: string[] = [];
  globalThis.fetch = async (url, init) => {
    const path = String(url).replace(/^https?:\/\/[^/]+/, '');
    requests.push(`${init?.method ?? 'GET'} ${path}`);
    if (path.endsWith('/drafts/a')) {
      if (init?.method === 'PATCH') {
        expect(JSON.parse(String(init.body)).overrides[color]).toEqual([4, 5, 6]);
        return response({...draft('A', [4, 5, 6]), revision: 2});
      }
      return response(draft('A', [1, 2, 3]));
    }
    if (path.endsWith('/options/theme')) return response({display: {theme: 2}, themeState: {}});
    if (path.endsWith('/options/wheel-presets')) return response(wheels('B', 2, .9));
    if (path.endsWith('/theme-sources')) return response({sources});
    if (path.endsWith('/style-lab/drafts')) return response(draft(JSON.parse(String(init?.body)).sourceThemeName, [7, 8, 9]));
    throw new Error(path);
  };
  await applyWheelTheme('B');
  expect(requests.indexOf('PATCH /api/style-lab/drafts/a')).toBeLessThan(requests.indexOf('POST /api/options/theme'));
  const state = useChartStyleEditorStore.getState();
  expect(state.remoteSourceThemeName).toBe('B');
  expect(state.semanticOverrides[color]).toEqual([7, 8, 9]);
  expect(state.geometryOverrides[scale]).toBe(.9);
  expect(Object.keys(state.wheelGeometryReceipts).sort()).toEqual([...profiles].sort());
  expect(state.liveAppThemePreview).toBe(false);
  expect(state.geometryTransition).toBe(false);
});

test('theme selection survives a daemon that dropped the unmodified source draft', async () => {
  useChartStyleEditorStore.getState().setOverride(color, [4, 5, 6]);
  const requests: string[] = [];
  globalThis.fetch = async (url, init) => {
    const path = String(url).replace(/^https?:\/\/[^/]+/, '');
    requests.push(`${init?.method ?? 'GET'} ${path}`);
    if (path.endsWith('/drafts/a')) {
      return new Response(JSON.stringify({detail: 'unknown style draft: a'}), {status: 404});
    }
    if (path.endsWith('/drafts/a2') && init?.method === 'PATCH') {
      expect(JSON.parse(String(init.body)).overrides[color]).toEqual([4, 5, 6]);
      return response({...draft('A', [4, 5, 6]), id: 'a2', revision: 2});
    }
    if (path.endsWith('/options/theme')) return response({display: {theme: 2}, themeState: {}});
    if (path.endsWith('/options/wheel-presets')) return response(wheels('B', 2, .9));
    if (path.endsWith('/theme-sources')) return response({sources});
    if (path.endsWith('/style-lab/drafts')) {
      const source = JSON.parse(String(init?.body)).sourceThemeName;
      return response(source === 'A' ? {...draft('A', [1, 2, 3]), id: 'a2'} : draft(source, [7, 8, 9]));
    }
    throw new Error(path);
  };
  await applyWheelTheme('B');
  expect(requests.indexOf('PATCH /api/style-lab/drafts/a2')).toBeLessThan(requests.indexOf('POST /api/options/theme'));
  const state = useChartStyleEditorStore.getState();
  expect(state.remoteSourceThemeName).toBe('B');
  expect(state.semanticOverrides[color]).toEqual([7, 8, 9]);
});

test('another windows selection discards old geometry and a stale source notification follows the actual source', async () => {
  useChartStyleEditorStore.getState().setOverride(scale, .6);
  globalThis.fetch = async (url, init) => {
    const path = String(url);
    if (path.endsWith('/drafts/a')) return response(draft('A', [1, 2, 3]));
    if (path.endsWith('/options/wheel-presets')) {
      expect(init?.method).not.toBe('POST');
      return response(wheels('C', 4, .95));
    }
    if (path.endsWith('/theme-sources')) return response({sources});
    if (path.endsWith('/style-lab/drafts')) {
      expect(JSON.parse(String(init?.body)).sourceThemeName).toBe('C');
      return response(draft('C', [9, 8, 7]));
    }
    throw new Error(path);
  };
  await synchronizeWheelTheme('B');
  expect(useChartStyleEditorStore.getState().remoteSourceThemeName).toBe('C');
  expect(useChartStyleEditorStore.getState().geometryOverrides[scale]).toBe(.95);
});

test('save binds explicit source and receipt and rejects an unrelated ambient theme', async () => {
  globalThis.fetch = async () => response(wheels('A', 7, .8));
  expect(await checkedStyleLabSaveContext('conflict')).toEqual({draftId: 'a', sourceThemeName: 'A', expectedWheelRevision: 7});
  globalThis.fetch = async () => response(wheels('B', 8, .9));
  await expect(checkedStyleLabSaveContext('conflict')).rejects.toThrow('conflict');
  expect(useChartStyleEditorStore.getState().remoteSourceThemeName).toBe('A');
});

test('rapid theme selections stay serialized and keep the final complete context', async () => {
  let release!: () => void, started!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const firstStarted = new Promise<void>(resolve => { started = resolve; });
  const applied: string[] = [];
  let source = 'A';
  globalThis.fetch = async (url, init) => {
    const path = String(url);
    if (/\/drafts\/[abc]$/.test(path)) return response(draft(path.slice(-1).toUpperCase(), [1, 2, 3]));
    if (path.endsWith('/options/theme')) {
      const selected = JSON.parse(String(init?.body)).name;
      if (selected === 'B') { started(); await held; }
      source = selected;
      applied.push(source);
      return response({display: {theme: 2}, themeState: {}});
    }
    if (path.endsWith('/options/wheel-presets')) return response(wheels(source, applied.length + 1, source === 'B' ? .9 : .95));
    if (path.endsWith('/theme-sources')) return response({sources});
    if (path.endsWith('/style-lab/drafts')) return response(draft(JSON.parse(String(init?.body)).sourceThemeName, [1, 2, 3]));
    throw new Error(path);
  };
  const first = applyWheelTheme('B');
  await firstStarted;
  const second = applyWheelTheme('C');
  expect(useChartStyleEditorStore.getState().geometryTransition).toBe(true);
  release();
  await Promise.all([first, second]);
  expect(applied).toEqual(['B', 'C']);
  const state = useChartStyleEditorStore.getState();
  expect(state.remoteSourceThemeName).toBe('C');
  expect(state.wheelPresetState?.context?.sourceThemeName).toBe('C');
  expect(state.geometryOverrides[scale]).toBe(.95);
  expect(state.geometryTransition).toBe(false);
});

test('a slow parked draft read cannot overwrite a newly accepted source', async () => {
  let release!: () => void, started!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const readStarted = new Promise<void>(resolve => { started = resolve; });
  globalThis.fetch = async (url) => {
    expect(String(url)).toContain('/drafts/a');
    started();
    await held;
    return response(draft('A', [1, 2, 3]));
  };
  const transition = applyWheelTheme('B');
  await readStarted;
  useChartStyleEditorStore.getState().acceptRemoteDraft(draft('C', [9, 8, 7]), {clearHistory: true});
  release();
  await expect(transition).rejects.toThrow();
  expect(useChartStyleEditorStore.getState().remoteSourceThemeName).toBe('C');
  expect(useChartStyleEditorStore.getState().semanticOverrides[color]).toEqual([9, 8, 7]);
});
