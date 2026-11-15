// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
import { create } from 'zustand';

const transpile = source => ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022,
} }).outputText;
const load = code => import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const projection = await load(transpile(await readFile(new URL('../src/lib/chart/house-visibility.ts', import.meta.url), 'utf8')));
const { withHouseVisibility, snapshotHouseVisibility } = projection;
const frame = (available = true) => ({
  document: { documentId: 'active', displayDatetime: '2026-09-27T12:00:00' },
  primaryChart: { planets: [{ longitude: 12 }], houses: { system: 'P', cusps: [1, 2] }, aspects: [],
    options: { houseLinesAvailable: available, showHouses: true, wheelComposition: { schemaVersion: 1,
      projection: 'zodiac', rings: [{ instanceId: 'houses', archetypeId: 'houses', enabled: true }] } } },
  overlayRenderMode: 'full',
});

test('house projection preserves all chart math, time, overlays and non-house rings', () => {
  const original = frame();
  original.overlay = { rows: ['retained'] };
  const hidden = withHouseVisibility(original, false);
  assert.equal(hidden.primaryChart.options.showHouses, false);
  assert.equal(hidden.primaryChart.options.wheelComposition.rings[0].enabled, false);
  assert.equal(hidden.primaryChart.planets, original.primaryChart.planets);
  assert.equal(hidden.primaryChart.houses, original.primaryChart.houses);
  assert.equal(hidden.primaryChart.aspects, original.primaryChart.aspects);
  assert.equal(hidden.document, original.document);
  assert.equal(hidden.overlay, original.overlay);
  assert.equal(original.primaryChart.options.showHouses, true);
  assert.equal(withHouseVisibility(hidden, false), hidden);
  assert.equal(snapshotHouseVisibility(withHouseVisibility(hidden, true)), true);
});

test('the daemon capability and every visible ring/split peer receive the same display flag', () => {
  const original = frame();
  original.comparisonChart = frame(false).primaryChart;
  original.rings = [original.primaryChart, frame().primaryChart, frame().primaryChart];
  original.sideBySideSnapshots = { right: frame() };
  const hidden = withHouseVisibility(original, false);
  const visible = withHouseVisibility(hidden, true);
  assert.equal(visible.comparisonChart.options.showHouses, false);
  assert.ok(visible.rings.every(chart => chart.options.showHouses));
  assert.equal(hidden.sideBySideSnapshots.right.primaryChart.options.showHouses, false);
});

// Exercise the production store mutations with real Zustand and a hermetic
// snapshot cache; no daemon, browser, user options or disk persistence.
let visibility = null;
const cache = new Map();
const helpers = { create, ...projection,
  retainedHouseVisibility: () => visibility,
  setRetainedHouseVisibility: value => {
    visibility = value;
    if (value !== null) for (const [id, snapshot] of cache) cache.set(id, withHouseVisibility(snapshot, value));
  },
  getDocumentSnapshot: id => cache.get(id),
  rememberDocumentSnapshot: (id, snapshot) => {
    const projected = visibility === null ? snapshot : withHouseVisibility(snapshot, visibility);
    cache.set(id, projected); return projected;
  },
  // The store's module-level step-burst settle hook; no burst runs here.
  subscribeStepBurst: () => () => {},
};
let source = transpile(await readFile(new URL('../src/stores/daemon-workspace-store.ts', import.meta.url), 'utf8'));
source = source.replace(/^import[\s\S]*?from ["'][^"']+["'];\s*/gm, '');
source = source.slice(0, source.indexOf('// Subscription manager'));
const factory = new Function(...Object.keys(helpers), source.replace('export const useDaemonWorkspaceStore', 'const useDaemonWorkspaceStore') + '\nreturn useDaemonWorkspaceStore;');
const store = factory(...Object.values(helpers));
function reset() {
  visibility = null; cache.clear();
  store.setState({ activeDocumentId: 'active', steppedSnapshot: null, commandSnapshot: null,
    pendingHouseToggles: 0, confirmedHouseVisibility: null, houseVisibilityRevision: -1 });
}

test('rapid H paints immediately, old receipts cannot reverse a pending toggle, confirmation does not repaint', () => {
  reset(); const snapshot = frame();
  store.getState().previewHouseToggle(snapshot);
  assert.equal(store.getState().commandSnapshot.snapshot.primaryChart.options.showHouses, false);
  store.getState().previewHouseToggle(snapshot);
  const presented = store.getState().commandSnapshot;
  assert.equal(presented.snapshot.primaryChart.options.showHouses, true);
  store.getState()._confirmHouseVisibility(false, 1);
  store.getState().finishHouseToggle({ houses: false, wheelPresetRevision: 1 });
  assert.equal(store.getState().commandSnapshot, presented);
  store.getState().finishHouseToggle({ houses: true, wheelPresetRevision: 2 });
  assert.equal(store.getState().commandSnapshot, presented);
  store.getState()._confirmHouseVisibility(false, 1);
  assert.equal(store.getState().commandSnapshot, presented);
});

test('failed save rolls back to confirmed visibility; an incoming step cannot restore stale house flags', () => {
  reset(); const snapshot = frame();
  store.getState().previewHouseToggle(snapshot);
  store.getState().pushSteppedSnapshot('active', frame());
  assert.equal(store.getState().steppedSnapshot.snapshot.primaryChart.options.showHouses, false);
  store.getState().finishHouseToggle();
  assert.equal(store.getState().steppedSnapshot.snapshot.primaryChart.options.showHouses, true);
});
