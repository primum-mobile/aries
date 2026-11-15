// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later
import { expect, test } from '@playwright/test';
import { activateWheelStyle, createWheelCompositionWriter, enqueueWheelPresetWrite, flushWheelGeometry, waitForWheelPresetWrites } from '../src/lib/daemon/wheel-preset-sync';
import type { WheelPresetsState, WheelPresetMutation } from '../src/lib/daemon/wheel-presets-client';
import { moveWheelRing, type WheelComposition } from '../src/lib/chart/wheel-composition';
import factory from '../src/lib/chart/wheel-factory-v1.json';
import { wheelStyleChoices, wheelStyleForCommand, wheelStyleMenuChecks, userWheelStyleMenuEntries } from '../src/lib/chart/wheel-style-menu';
import type { OptionsPayload } from '../src/lib/daemon/client';
import { useChartStyleEditorStore } from '../src/stores/chart-style-editor-store';

const recipe = factory.layouts.anglo.composition as WheelComposition;
const initial: WheelPresetsState = {schemaVersion: 1, revision: 1, selected: {anglo: 'factory.anglo'},
  presets: [{id: 'factory.anglo', layout: 'anglo', name: 'Anglo', factory: true, overrides: {}, composition: recipe}],
  drafts: {anglo: {sourcePresetId: 'factory.anglo', overrides: {}, composition: structuredClone(recipe), dirty: false}}};
const originalFetch = globalThis.fetch;
test.afterEach(async () => { await waitForWheelPresetWrites(); globalThis.fetch = originalFetch; });
test.beforeEach(() => {
  useChartStyleEditorStore.setState({wheelPresetState: structuredClone(initial), geometryProfile: 'anglo',
    geometryOverrides: {}, syncedGeometryOverrides: {}, wheelGeometryReceipts: {}, semanticOverrides: {},
    gestureStart: null, gestureOwner: null, sceneElements: [], pendingWheelCompositions: {}, themeWheelBaseline: null});
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

test('a Signs reorder survives a stale revision without overwriting concurrent width or visibility edits', async () => {
  const canonical = structuredClone(initial);
  const width = 'authoring.wheel.anglo.canvas.ring.anglo-terms.bandWidth';
  canonical.revision = 2;
  canonical.drafts.anglo!.overrides[width] = 24;
  canonical.drafts.anglo!.composition = {...recipe, rings: recipe.rings.map(ring =>
    ring.archetypeId === 'houses' ? {...ring, enabled: false} : ring)};
  const moved = moveWheelRing(recipe, 'anglo-zodiac', 'anglo-degree')!;
  const requests: WheelPresetMutation[] = [];
  globalThis.fetch = async (_url, init) => {
    const mutation = JSON.parse(String(init?.body)) as WheelPresetMutation;
    requests.push(mutation);
    if (mutation.baseRevision !== canonical.revision)
      return new Response(JSON.stringify({detail: {current: canonical}}), {status: 409});
    canonical.revision++;
    canonical.drafts.anglo!.composition = mutation.composition!;
    return new Response(JSON.stringify(canonical));
  };
  await createWheelCompositionWriter('anglo', () => undefined)(moved);
  expect(requests.map(request => request.baseRevision)).toEqual([1, 2]);
  expect(canonical.drafts.anglo!.composition.rings.map(ring => ring.instanceId)).toEqual(moved.rings.map(ring => ring.instanceId));
  expect(canonical.drafts.anglo!.composition.rings.find(ring => ring.archetypeId === 'houses')!.enabled).toBe(false);
  expect(useChartStyleEditorStore.getState().geometryOverrides[width]).toBe(24);
  expect(useChartStyleEditorStore.getState().pendingWheelCompositions).toEqual({});
});

test('a concurrent reorder remains a real conflict until explicitly reconciled', async () => {
  const canonical = structuredClone(initial);
  canonical.revision = 2;
  canonical.drafts.anglo!.composition = moveWheelRing(recipe, 'anglo-zodiac', 'anglo-degree')!;
  const remote = canonical.drafts.anglo!.composition.rings;
  const moved = moveWheelRing(recipe, 'anglo-terms', 'anglo-decans')!;
  let requests = 0;
  globalThis.fetch = async () => {
    requests++;
    return new Response(JSON.stringify({detail: {current: canonical}}), {status: 409});
  };
  await expect(createWheelCompositionWriter('anglo', () => undefined)(moved)).rejects.toThrow();
  expect(requests).toBe(1);
  expect(useChartStyleEditorStore.getState().wheelPresetState?.revision).toBe(1);
  expect(canonical.drafts.anglo!.composition.rings).toEqual(remote);
});

test('geometry flush preserves a concurrent ring reorder and untouched geometry keys', async () => {
  const width = 'authoring.wheel.anglo.canvas.ring.anglo-terms.bandWidth';
  const otherWidth = 'authoring.wheel.anglo.canvas.ring.anglo-decans.bandWidth';
  useChartStyleEditorStore.getState().setOverride(width, 18);
  const canonical = structuredClone(initial);
  canonical.revision = 2;
  canonical.drafts.anglo!.overrides[otherWidth] = 22;
  canonical.drafts.anglo!.composition = moveWheelRing(recipe, 'anglo-zodiac', 'anglo-degree')!;
  const order = canonical.drafts.anglo!.composition.rings;
  globalThis.fetch = async (_url, init) => {
    const mutation = JSON.parse(String(init?.body)) as WheelPresetMutation;
    if (mutation.baseRevision !== canonical.revision)
      return new Response(JSON.stringify({detail: {current: canonical}}), {status: 409});
    expect(mutation.composition).toBeUndefined();
    canonical.revision++;
    Object.assign(canonical.drafts.anglo!.overrides, mutation.overrides);
    return new Response(JSON.stringify(canonical));
  };
  await flushWheelGeometry();
  expect(useChartStyleEditorStore.getState().geometryOverrides).toEqual({[width]: 18, [otherWidth]: 22});
  expect(useChartStyleEditorStore.getState().syncedGeometryOverrides).toEqual({[width]: 18, [otherWidth]: 22});
  expect(useChartStyleEditorStore.getState().wheelPresetState?.drafts.anglo!.composition.rings).toEqual(order);
});

test('coalesced drags retain concurrent visibility through conflict recovery and save', async () => {
  const canonical = structuredClone(initial);
  canonical.revision = 2;
  canonical.drafts.anglo!.composition = {...recipe, rings: recipe.rings.map(ring =>
    ring.archetypeId === 'houses' ? {...ring, enabled: false} : ring)};
  let release!: () => void, started!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const firstStarted = new Promise<void>(resolve => { started = resolve; });
  const requests: WheelPresetMutation[] = [];
  globalThis.fetch = async (_url, init) => {
    const mutation = JSON.parse(String(init?.body)) as WheelPresetMutation;
    requests.push(mutation);
    if (requests.length === 1) { started(); await held; }
    if (mutation.baseRevision !== canonical.revision)
      return new Response(JSON.stringify({detail: {current: canonical}}), {status: 409});
    canonical.revision++;
    canonical.drafts.anglo!.composition = mutation.composition!;
    return new Response(JSON.stringify(canonical));
  };
  const write = createWheelCompositionWriter('anglo', () => undefined);
  const first = moveWheelRing(recipe, 'anglo-zodiac', 'anglo-degree')!;
  const draining = write(first);
  await firstStarted;
  const latest = moveWheelRing(first, 'anglo-terms', 'anglo-decans')!;
  void write(latest);
  let saved: WheelComposition | undefined;
  const save = enqueueWheelPresetWrite(async () => {
    saved = useChartStyleEditorStore.getState().wheelPresetState!.drafts.anglo!.composition;
  });
  release();
  await Promise.all([draining, save]);
  expect(requests.map(request => request.baseRevision)).toEqual([1, 2, 3]);
  expect(saved!.rings.map(ring => ring.instanceId)).toEqual(latest.rings.map(ring => ring.instanceId));
  expect(saved!.rings.find(ring => ring.archetypeId === 'houses')!.enabled).toBe(false);
});

test('overlapping geometry edits stay conflicted and keep the unsent local value', async () => {
  const width = 'authoring.wheel.anglo.canvas.ring.anglo-terms.bandWidth';
  useChartStyleEditorStore.getState().setOverride(width, 18);
  const canonical = structuredClone(initial);
  canonical.revision = 2;
  canonical.drafts.anglo!.overrides[width] = 24;
  let requests = 0;
  globalThis.fetch = async () => {
    requests++;
    return new Response(JSON.stringify({detail: {current: canonical}}), {status: 409});
  };
  await expect(flushWheelGeometry()).rejects.toThrow();
  expect(requests).toBe(1);
  expect(useChartStyleEditorStore.getState().geometryOverrides[width]).toBe(18);
  expect(useChartStyleEditorStore.getState().wheelPresetState?.revision).toBe(1);
  await expect(flushWheelGeometry()).rejects.toThrow();
  expect(requests).toBe(2);
  expect(canonical.drafts.anglo!.overrides[width]).toBe(24);
});

test('a theme recall cannot redirect a drag even when working preset identity stays the same', async () => {
  const base = structuredClone(initial);
  base.selected.anglo = 'working.anglo';
  base.drafts.anglo!.sourcePresetId = 'working.anglo';
  base.activePresets = {anglo: {...base.presets[0], id: 'working.anglo', factory: false}};
  useChartStyleEditorStore.setState({wheelPresetState: base});
  const canonical = structuredClone(base);
  canonical.revision++;
  canonical.activePresets!.anglo!.overrides['authoring.wheel.anglo.canvas.chart.scale'] = 0.8;
  let requests = 0;
  globalThis.fetch = async () => {
    requests++;
    return new Response(JSON.stringify({detail: {current: canonical}}), {status: 409});
  };
  await expect(createWheelCompositionWriter('anglo', () => undefined)(
    moveWheelRing(recipe, 'anglo-zodiac', 'anglo-degree')!)).rejects.toThrow();
  expect(requests).toBe(1);
  expect(useChartStyleEditorStore.getState().wheelPresetState?.revision).toBe(1);
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
      drafts: {anglo: {...canonical.drafts.anglo!, sourcePresetId: 'user.saved',
        overrides: {'authoring.wheel.anglo.canvas.chart.scale': 0.8}}}};
    return new Response(JSON.stringify(selected));
  };
  await activateWheelStyle('user.saved', 'anglo');
  expect(requests).toEqual(['GET', 'POST']);
  expect(useChartStyleEditorStore.getState().wheelPresetState?.selected.anglo).toBe('user.saved');
  expect(useChartStyleEditorStore.getState().geometryOverrides).toEqual({'authoring.wheel.anglo.canvas.chart.scale': 0.8});
  expect(useChartStyleEditorStore.getState().wheelGeometryReceipts.anglo?.presetId).toBe('user.saved');
});

test('returning through the wheel layout menu resumes the theme geometry', async () => {
  const canonical = structuredClone(initial);
  canonical.selected.anglo = 'working.anglo';
  canonical.drafts.anglo!.sourcePresetId = 'working.anglo';
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
  canonical.drafts.anglo!.sourcePresetId = 'user.nice';
  globalThis.fetch = async (_url, init) => {
    if (init?.method !== 'POST') return new Response(JSON.stringify(canonical));
    const mutation = JSON.parse(String(init.body));
    expect(mutation.presetId).toBe('factory.anglo');
    expect(mutation.activateLayout).toBe(true);
    return new Response(JSON.stringify({...canonical, revision: 2, selected: {anglo: 'working.anglo'},
      drafts: {anglo: {...canonical.drafts.anglo!, sourcePresetId: 'working.anglo'}}}));
  };
  await activateWheelStyle('factory.anglo', 'anglo');
  expect(useChartStyleEditorStore.getState().wheelPresetState?.selected.anglo).toBe('working.anglo');
  expect(useChartStyleEditorStore.getState().wheelGeometryReceipts.anglo?.presetId).toBe('working.anglo');
});
