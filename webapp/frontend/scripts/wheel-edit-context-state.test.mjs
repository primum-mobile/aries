// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const src = resolve(dirname(fileURLToPath(import.meta.url)), '../src');
function harness(wheelPresetApi) {
  const modules = new Map();
  if (wheelPresetApi) modules.set(resolve(src, 'lib/daemon/wheel-presets-client.ts'), {exports: wheelPresetApi});
  function load(path) {
    if (modules.has(path)) return modules.get(path).exports;
    if (path.endsWith('.json')) return JSON.parse(readFileSync(path, 'utf8'));
    const compiledModule = {exports: {}};
    modules.set(path, compiledModule);
    const compiled = ts.transpileModule(readFileSync(path, 'utf8'), {
      compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true},
    }).outputText;
    const localRequire = id => {
      if (id === '@/lib/daemon/client') return {};
      if (!id.startsWith('@/') && !id.startsWith('.')) return require(id);
      const target = id.startsWith('@/') ? resolve(src, id.slice(2)) : resolve(dirname(path), id);
      return load(target.endsWith('.json') ? target : `${target}.ts`);
    };
    new Function('require', 'module', 'exports', compiled)(localRequire, compiledModule, compiledModule.exports);
    return compiledModule.exports;
  }
  return {store: load(resolve(src, 'stores/chart-style-editor-store.ts')).useChartStyleEditorStore, load};
}

const scale = 'authoring.wheel.anglo.canvas.chart.scale';
const radius = 'authoring.wheel.anglo.rings.innerBoundary.radius';
const priority = 'authoring.wheel.anglo.canvas.chart.radiusPriority';
const composition = {schemaVersion: 1, projection: 'zodiac', customized: false, rings: []};
const presets = (revision, value = 0.7) => ({schemaVersion: 1, revision,
  selected: {anglo: 'working.anglo'}, presets: [],
  drafts: {anglo: {sourcePresetId: 'working.anglo', overrides: {[scale]: value}, composition, dirty: false}}});

test('catalog metadata cannot advance the acknowledged wheel context', () => {
  const {store} = harness();
  store.getState().acceptWheelPresets(presets(4), 'anglo');
  const receipt = store.getState().wheelGeometryReceipts.anglo;
  store.getState().acceptWheelPresets(presets(6, 0.9), 'anglo', {metadataOnly: true});
  assert.equal(store.getState().wheelPresetState.revision, 6);
  assert.equal(store.getState().wheelGeometryReceipts.anglo, receipt);
  assert.equal(store.getState().geometryOverrides[scale], 0.7);
  // A real geometry acknowledgement remains usable despite a newer unrelated
  // metadata refresh arriving first. It must not downgrade the catalog.
  store.getState().acceptWheelPresets(presets(5, 0.8), 'anglo', {acknowledgeGeometry: true});
  assert.equal(store.getState().wheelPresetState.revision, 6);
  assert.equal(store.getState().wheelGeometryReceipts.anglo.revision, 5);
  assert.equal(store.getState().geometryOverrides[scale], 0.8);
  store.getState().acceptWheelPresets(presets(4), 'anglo', {acknowledgeGeometry: true});
  assert.equal(store.getState().geometryOverrides[scale], 0.8, 'older geometry replies cannot replace a receipt');
});

test('geometry receipts carry explicit source provenance even for the same factory identity', () => {
  const {store} = harness();
  const first = {...presets(4), context: {sourceThemeName: 'Theme A', revision: 4}};
  first.selected.anglo = first.drafts.anglo.sourcePresetId = 'factory.anglo';
  store.getState().acceptWheelPresets(first, 'anglo');
  assert.equal(store.getState().wheelGeometryReceipts.anglo.sourceThemeName, 'Theme A');
  const next = {...presets(5, 0.9), context: {sourceThemeName: 'Theme B', revision: 5}};
  next.selected.anglo = next.drafts.anglo.sourcePresetId = 'factory.anglo';
  store.getState().acceptWheelPresets(next, 'anglo', {metadataOnly: true});
  store.getState().markWheelGeometrySynced(first, 'anglo', first.drafts.anglo.overrides);
  assert.equal(store.getState().wheelPresetState.context.sourceThemeName, 'Theme B');
  assert.equal(store.getState().wheelGeometryReceipts.anglo.sourceThemeName, 'Theme A',
    'late old-source writes cannot produce new receipts');
  store.getState().acceptWheelPresets(next, 'anglo');
  assert.equal(store.getState().wheelGeometryReceipts.anglo.sourceThemeName, 'Theme B');
});

test('off-layout acknowledgements do not replace the active local dimensions', () => {
  const {store} = harness();
  store.getState().acceptWheelPresets(presets(4), 'anglo');
  const other = {...presets(5), selected: {classic: 'user.classic'}, drafts: {
    classic: {sourcePresetId: 'user.classic', overrides: {}, composition, dirty: false},
  }};
  store.getState().acceptWheelPresets(other, 'classic', {metadataOnly: true, acknowledgeGeometry: true});
  assert.equal(store.getState().geometryProfile, 'anglo');
  assert.equal(store.getState().geometryOverrides[scale], 0.7);
  assert.equal(store.getState().wheelGeometryReceipts.classic.presetId, 'user.classic');
  store.setState({pendingWheelCompositions: {anglo: composition}});
  store.getState().clearWheelGeometryContext();
  assert.deepEqual(store.getState().wheelGeometryReceipts, {});
  assert.deepEqual(store.getState().pendingWheelCompositions, {});
});

test('late geometry replies cannot cross a newer selection or theme source', () => {
  for (const sourceChanged of [false, true]) {
    const {store} = harness();
    const original = {...presets(4), context: {sourceThemeName: 'A', revision: 4}};
    store.getState().acceptWheelPresets(original, 'anglo');
    const newer = {...presets(6, 0.9), context: {sourceThemeName: sourceChanged ? 'B' : 'A', revision: 6},
      selected: {anglo: sourceChanged ? 'working.anglo' : 'user.new'}};
    store.getState().acceptWheelPresets(newer, 'anglo', {metadataOnly: true});
    const late = {...presets(5, 0.8), context: {sourceThemeName: 'A', revision: 5}};
    store.getState().acceptWheelPresets(late, 'anglo', {acknowledgeGeometry: true});
    store.getState().markWheelGeometrySynced(late, 'anglo', {[scale]: 0.8});
    assert.equal(store.getState().wheelGeometryReceipts.anglo.revision, 4);
    assert.equal(store.getState().geometryOverrides[scale], 0.7);
    assert.equal(store.getState().syncedGeometryOverrides[scale], 0.7);
    assert.equal(store.getState().wheelPresetState.revision, 6);
  }
});

test('composition writer retains the newest optimistic topology through coalesced receipts', async () => {
  const calls = [];
  class WheelPresetApiError extends Error {}
  const {store, load} = harness({WheelPresetApiError,
    mutateWheelPreset: mutation => new Promise(resolve => calls.push({mutation, resolve}))});
  const api = load(resolve(src, 'lib/chart/wheel-composition.ts'));
  const original = api.WHEEL_FACTORY_SETTINGS.layouts.anglo.composition;
  const first = api.moveWheelRing(original, 'anglo-cuspRuler', 'anglo-zodiac');
  const second = api.moveWheelRing(first, 'anglo-degree', 'anglo-zodiac');
  const basePreset = {id: 'working.anglo', layout: 'anglo', name: 'working', factory: false,
    composition: original, overrides: {[scale]: 0.7}};
  const receipt = (revision, structure) => ({...presets(revision), activePresets: {anglo: basePreset},
    drafts: {anglo: {...presets(revision).drafts.anglo, composition: structure}}});
  store.getState().acceptWheelPresets(receipt(4, original), 'anglo');
  store.getState().setOverride(scale, 0.8);
  const writer = load(resolve(src, 'lib/daemon/wheel-preset-sync.ts')).createWheelCompositionWriter('anglo', () => {});
  const finished = writer(first);
  writer(second);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].mutation.composition, second, 'queued order coalesces before the write begins');
  const third = api.moveWheelRing(second, 'anglo-terms', 'anglo-zodiac');
  writer(third);
  calls[0].resolve(receipt(5, second));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.length, 2);
  assert.equal(store.getState().pendingWheelCompositions.anglo, third);
  assert.equal(store.getState().geometryOverrides[scale], 0.8, 'local dimensions survive a structure receipt');
  calls[1].resolve(receipt(6, third));
  await finished;
  assert.equal(store.getState().pendingWheelCompositions.anglo, undefined);
  assert.equal(store.getState().wheelGeometryReceipts.anglo.composition, third);
  assert.equal(store.getState().geometryOverrides[scale], 0.8);
});

test('radius edit priority is sparse, undoable, and restored at a gesture origin', () => {
  const {store} = harness();
  store.getState().acceptWheelPresets(presets(4), 'anglo');
  store.getState().beginGesture('canvas');
  store.getState().setOverride(radius, 300);
  assert.equal(store.getState().geometryOverrides[priority], 'innerBoundaryRing');
  store.getState().restoreGestureProperty(radius, 'other');
  assert.equal(store.getState().geometryOverrides[radius], 300, 'foreign surfaces cannot restore a gesture');
  store.getState().restoreGestureProperty(radius, 'canvas');
  assert.equal(Object.hasOwn(store.getState().geometryOverrides, radius), false);
  assert.equal(Object.hasOwn(store.getState().geometryOverrides, priority), false);
  assert.equal(store.getState().gestureOwner, 'canvas', 'the same pointer can continue after returning to origin');
  store.getState().endGesture('canvas');
  assert.equal(store.getState().undoStack.length, 0);
  store.getState().beginGesture('numeric');
  store.getState().setOverride(radius, 310);
  store.getState().endGesture('numeric');
  store.getState().undo();
  assert.equal(Object.hasOwn(store.getState().geometryOverrides, radius), false);
  assert.equal(Object.hasOwn(store.getState().geometryOverrides, priority), false);
  store.getState().redo();
  assert.equal(store.getState().geometryOverrides[radius], 310);
  assert.equal(store.getState().geometryOverrides[priority], 'innerBoundaryRing');
  store.getState().resetProperty(radius);
  assert.equal(Object.hasOwn(store.getState().geometryOverrides, priority), false,
    'resetting the last edited radius removes its solve intent');
  store.getState().undo();
  assert.equal(store.getState().geometryOverrides[priority], 'innerBoundaryRing');
  const before = store.getState();
  store.getState().setOverride(radius, 310);
  assert.equal(store.getState(), before, 'an unchanged authored radius cannot add a new intent');
});

test('outer degree boundary identity survives receipts and restores sparse gesture intent', () => {
  const {store} = harness();
  const radiusId = 'authoring.wheel.anglo.rings.outerDegree.radius';
  const bindingId = 'authoring.wheel.anglo.canvas.chart.outerDegreeBinding';
  store.getState().acceptWheelPresets(presets(4), 'anglo');
  store.getState().beginGesture('canvas');
  store.getState().setOverride(radiusId, 310, 'cuspLabels');
  assert.equal(store.getState().geometryOverrides[bindingId], 'cuspLabels');
  store.getState().restoreGestureProperty(radiusId, 'canvas');
  assert.equal(Object.hasOwn(store.getState().geometryOverrides, radiusId), false);
  assert.equal(Object.hasOwn(store.getState().geometryOverrides, bindingId), false);
  assert.equal(Object.hasOwn(store.getState().geometryOverrides, priority), false);
  store.getState().setOverride(radiusId, 315, 'degree');
  store.getState().endGesture('canvas');
  const authored = JSON.parse(JSON.stringify(store.getState().geometryOverrides));
  const reply = presets(5);
  reply.drafts.anglo.overrides = authored;
  store.getState().acceptWheelPresets(reply, 'anglo', {preserveLocalChanges: true});
  assert.equal(store.getState().wheelGeometryReceipts.anglo.overrides[bindingId], 'degree');
  assert.equal(store.getState().syncedGeometryOverrides[bindingId], 'degree');
  assert.equal(store.getState().geometryOverrides[priority], 'outerDegreeRing');
  store.getState().undo();
  assert.equal(Object.hasOwn(store.getState().geometryOverrides, radiusId), false);
  assert.equal(Object.hasOwn(store.getState().geometryOverrides, bindingId), false);
  store.getState().redo();
  assert.equal(store.getState().geometryOverrides[bindingId], 'degree');
});

test('grouped and pasted outer-degree radii retain the scene-declared boundary', () => {
  const {store} = harness();
  const radiusId = 'authoring.wheel.anglo.rings.outerDegree.radius';
  const bindingId = 'authoring.wheel.anglo.canvas.chart.outerDegreeBinding';
  store.getState().acceptWheelPresets(presets(4), 'anglo');
  store.setState({sceneElements: [{classId: 'rings.outerDegree', tokenBindings: [
    {property: 'radius', radiusTarget: 'cuspLabels'},
  ]}]});
  store.getState().beginGesture('family');
  store.getState().setFamilyOverrides({[radiusId]: 310}, radiusId);
  store.getState().endGesture('family');
  assert.equal(store.getState().geometryOverrides[bindingId], 'cuspLabels');
  store.getState().undo();
  assert.equal(Object.hasOwn(store.getState().geometryOverrides, bindingId), false);
  store.getState().applyOverrides({[radiusId]: 315});
  assert.equal(store.getState().geometryOverrides[bindingId], 'cuspLabels');
  store.getState().setOverride(radiusId, 320, 'degree');
  assert.equal(store.getState().geometryOverrides[bindingId], 'degree', 'an explicit drag target takes precedence');
  store.getState().applyOverrides({[radiusId]: 325, [bindingId]: 'degree'});
  assert.equal(store.getState().geometryOverrides[bindingId], 'degree', 'explicit pasted intent takes precedence');
  store.setState({sceneElements: []});
  store.getState().setFamilyOverrides({[radiusId]: 330}, radiusId);
  assert.equal(store.getState().geometryOverrides[bindingId], 'degree', 'unknown scene target preserves known intent');
});
