// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later
import { expect, test } from '@playwright/test';
import { activateWheelStyle, createWheelCompositionWriter, enqueueWheelPresetWrite, flushWheelGeometry, waitForWheelPresetWrites } from '../src/lib/daemon/wheel-preset-sync';
import type { WheelPresetsState, WheelPresetMutation } from '../src/lib/daemon/wheel-presets-client';
import type { WheelComposition } from '../src/lib/chart/wheel-composition';
import factory from '../src/lib/chart/wheel-factory-v1.json';
import { wheelStyleChoices, wheelStyleForCommand, wheelStyleMenuChecks, userWheelStyleMenuEntries } from '../src/lib/chart/wheel-style-menu';
import type { OptionsPayload } from '../src/lib/daemon/client';
import { useChartStyleEditorStore } from '../src/stores/chart-style-editor-store';

const recipe = factory.layouts.anglo.composition as WheelComposition;
const initial: WheelPresetsState = {schemaVersion: 1, revision: 1, selected: {anglo: 'factory.anglo'},
  presets: [{id: 'factory.anglo', layout: 'anglo', name: 'Anglo', factory: true, overrides: {}, composition: recipe}],
  drafts: {anglo: {sourcePresetId: 'factory.anglo', overrides: {}, composition: recipe, dirty: false}}};
const originalFetch = globalThis.fetch;
test.afterEach(async () => { await waitForWheelPresetWrites(); globalThis.fetch = originalFetch; });
test.beforeEach(() => {
  useChartStyleEditorStore.setState({wheelPresetState: structuredClone(initial), geometryProfile: 'anglo',
    geometryOverrides: {}, syncedGeometryOverrides: {}, semanticOverrides: {}, gestureStart: null, pendingWheelCompositions: {}, themeWheelBaseline: null});
});

function reply(mutation: WheelPresetMutation) {
  const state = structuredClone(useChartStyleEditorStore.getState().wheelPresetState!);
  expect(mutation.baseRevision).toBe(state.revision);
  state.revision++;
  if (mutation.composition) state.drafts.anglo!.composition = mutation.composition;
  return new Response(JSON.stringify(state), {status: 200});
}

test('rapid ring edits echo immediately, coalesce pending writes, and finish before save', async () => {
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let started!: () => void;
  const firstStarted = new Promise<void>(resolve => { started = resolve; });
  const sent: WheelPresetMutation[] = [];
  const visible: (WheelComposition | null)[] = [];
  globalThis.fetch = async (_url, init) => {
    const mutation = JSON.parse(String(init?.body)) as WheelPresetMutation;
    sent.push(mutation);
    if (sent.length === 1) { started(); await held; }
    return reply(mutation);
  };
  const write = createWheelCompositionWriter('anglo', composition => visible.push(composition));
  const first = write({...recipe, rings: recipe.rings.map(ring => ({...ring, enabled: ring.archetypeId !== 'terms'}))});
  expect(visible).toHaveLength(1); // Before any daemon response.
  expect(useChartStyleEditorStore.getState().pendingWheelCompositions.anglo).toEqual(visible[0]);
  await firstStarted;
  const samples: number[] = [];
  let latest = recipe;
  for (let index = 0; index < 20; index++) {
    latest = {...recipe, rings: recipe.rings.map(ring => ({...ring,
      enabled: ring.archetypeId === 'hub' || (ring.archetypeId === 'terms' ? index % 2 === 0 : index % 3 === 0)}))};
    const start = performance.now();
    void write(latest);
    expect(visible.at(-1)).toBe(latest);
    samples.push(performance.now() - start);
  }
  const drain = flushWheelGeometry(); // Theme save uses this same boundary.
  let saved: WheelComposition | undefined;
  const save = enqueueWheelPresetWrite(async () => { saved = useChartStyleEditorStore.getState().wheelPresetState!.drafts.anglo!.composition; });
  release();
  await Promise.all([first, drain, save]);
  expect(sent).toHaveLength(2);
  expect(sent.map(value => value.baseRevision)).toEqual([1, 2]);
  expect(saved).toEqual(latest);
  expect(visible.at(-1)).toBeNull();
  expect(useChartStyleEditorStore.getState().pendingWheelCompositions).toEqual({});
  expect(Math.max(...samples)).toBeLessThan(50);
  console.log(JSON.stringify({scenario: 'ring-intent-echo-unit', edits: 21, requests: sent.length,
    rows: recipe.rings.length, payloadBytes: sent.reduce((sum, value) => sum + Buffer.byteLength(JSON.stringify(value)), 0),
    echoMaxMs: Math.max(...samples)}));
});

test('a failed ring write clears its preview and allows a subsequent retry', async () => {
  const visible: (WheelComposition | null)[] = [];
  const write = createWheelCompositionWriter('anglo', value => visible.push(value));
  globalThis.fetch = async () => new Response('{}', {status: 503});
  await expect(write(recipe)).rejects.toThrow();
  expect(visible.at(-1)).toBeNull();
  expect(useChartStyleEditorStore.getState().wheelPresetState!.revision).toBe(1);
  globalThis.fetch = async (_url, init) => reply(JSON.parse(String(init?.body)));
  await write(recipe);
  expect(useChartStyleEditorStore.getState().wheelPresetState!.revision).toBe(2);
});

test('ring acknowledgements keep appearance references and subscribers quiet', () => {
  const store = useChartStyleEditorStore.getState();
  store.acceptWheelPresets(structuredClone(initial), 'anglo');
  const before = useChartStyleEditorStore.getState();
  let appearanceChanges = 0;
  const unsubscribe = useChartStyleEditorStore.subscribe((state, previous) => {
    if (state.semanticOverrides !== previous.semanticOverrides) appearanceChanges++;
  });
  for (let index = 0; index < 20; index++) {
    const state = structuredClone(initial);
    state.revision += index + 1;
    state.drafts.anglo!.composition = {...recipe, rings: recipe.rings.map(ring =>
      ({...ring, enabled: ring.archetypeId === 'hub' || index % 2 === 0}))};
    store.acceptWheelPresets(state, 'anglo', {preserveLocalChanges: true});
  }
  unsubscribe();
  expect(appearanceChanges).toBe(0);
  expect(useChartStyleEditorStore.getState().semanticOverrides).toBe(before.semanticOverrides);
  expect(useChartStyleEditorStore.getState().resolvedOverrides).toBe(before.resolvedOverrides);
  expect(useChartStyleEditorStore.getState().revision).toBe(before.revision);
});


test('Options menu includes only original and explicit saved styles and checks the selected identity', () => {
  const originals = ['classic', 'compact', 'anglo', 'houses', 'cusps'].map(layout =>
    ({id: `factory.${layout}`, name: layout, layout, factory: true}));
  const options = {catalog: {themeLayouts: [], wheelStyles: [...originals,
    {id: 'user.saved', name: 'My geometry', layout: 'anglo', factory: false},
    {id: 'working.anglo', name: 'Private', layout: 'anglo', factory: false},
    {id: 'migrated.theme.anglo', name: 'Old theme', layout: 'anglo', factory: false},
  ]}, display: {theme: 2, wheel_preset_id: 'user.saved'}} as unknown as OptionsPayload;
  expect(wheelStyleChoices(options)).toHaveLength(6);
  expect(userWheelStyleMenuEntries(options)).toEqual([{id: 'quick.options.wheel-preset:user.saved', label: 'My geometry', checked: true}]);
  expect(wheelStyleForCommand('quick.options.wheel-preset:user.saved', options)?.layout).toBe('anglo');
  expect(wheelStyleForCommand('quick.options.layout:4', options)?.id).toBe('factory.cusps');
  expect(wheelStyleForCommand('quick.options.wheel-preset:working.anglo', options)).toBeUndefined();
  expect(wheelStyleMenuChecks(options).filter(item => item.checked).map(item => item.id)).toEqual(['quick.options.wheel-preset:user.saved']);
});

test('Options style selection uses current daemon revision and activates its layout', async () => {
  const requests: unknown[] = [];
  const canonical = structuredClone(initial);
  canonical.revision = 20;
  globalThis.fetch = async (_url, init) => {
    requests.push(init?.method ?? 'GET');
    if (init?.method !== 'POST') return new Response(JSON.stringify(canonical));
    const mutation = JSON.parse(String(init.body));
    expect(mutation).toEqual({action: 'select', presetId: 'user.saved', layout: 'anglo', activateLayout: true, baseRevision: 20});
    const selected = {...canonical, revision: 21, selected: {anglo: 'user.saved'},
      drafts: {anglo: {...canonical.drafts.anglo!, overrides: {'authoring.wheel.anglo.canvas.chart.scale': 0.8}}}};
    return new Response(JSON.stringify(selected));
  };
  await activateWheelStyle('user.saved', 'anglo');
  expect(requests).toEqual(['GET', 'POST']);
  expect(useChartStyleEditorStore.getState().wheelPresetState?.selected.anglo).toBe('user.saved');
  expect(useChartStyleEditorStore.getState().geometryOverrides).toEqual({'authoring.wheel.anglo.canvas.chart.scale': 0.8});
});

test('returning through the wheel layout menu resumes the theme geometry', async () => {
  const canonical = structuredClone(initial);
  canonical.selected.anglo = 'working.anglo';
  canonical.revision = 20;
  globalThis.fetch = async (_url, init) => {
    if (init?.method !== 'POST') return new Response(JSON.stringify(canonical));
    const mutation = JSON.parse(String(init.body));
    expect(mutation.presetId).toBe('factory.anglo');
    expect(mutation.activateLayout).toBe(true);
    return new Response(JSON.stringify({...canonical, revision: 21}));
  };
  await activateWheelStyle('factory.anglo', 'anglo');
  expect(useChartStyleEditorStore.getState().wheelPresetState?.selected.anglo).toBe('working.anglo');
});

test('quick Anglo selection does not substitute a parked named preset', async () => {
  const canonical = structuredClone(initial);
  canonical.selected.anglo = 'user.nice';
  globalThis.fetch = async (_url, init) => {
    if (init?.method !== 'POST') return new Response(JSON.stringify(canonical));
    const mutation = JSON.parse(String(init.body));
    expect(mutation.presetId).toBe('factory.anglo');
    expect(mutation.activateLayout).toBe(true);
    return new Response(JSON.stringify({...canonical, revision: 2, selected: {anglo: 'working.anglo'}}));
  };
  await activateWheelStyle('factory.anglo', 'anglo');
  expect(useChartStyleEditorStore.getState().wheelPresetState?.selected.anglo).toBe('working.anglo');
});
