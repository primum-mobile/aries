// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const source = async path => readFile(new URL(`../src/${path}`, import.meta.url), 'utf8');
const compile = text => ts.transpileModule(text, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
} }).outputText;
const canvas = await source('lib/chart/dashboard-canvas.ts');
const canvasAst = ts.createSourceFile('canvas.ts', canvas, ts.ScriptTarget.ES2022, true);
const projection = canvasAst.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'withDashboardView');
const projectionExports = {};
new Function('exports', compile(projection.getText(canvasAst)))(projectionExports);
const { withDashboardView } = projectionExports;
const home = await source('components/workshell/home-client.tsx');
const homeAst = ts.createSourceFile('home.tsx', home, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
let handler;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(homeAst) === 'toggleTabView') handler = node.initializer;
  ts.forEachChild(node, visit);
}
visit(homeAst);
const storeSource = await source('stores/frame-layout-store.ts');

function harness(ready = true, omitted = false) {
  const saved = new Map();
  globalThis.window = { localStorage: { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value), removeItem: key => saved.delete(key) } };
  const exports = {};
  new Function('require', 'exports', compile(storeSource))(
    name => name === 'zustand' ? { create } : { persist }, exports,
  );
  const store = exports.useFrameLayoutStore;
  const frame = { primaryChart: { planets: [1, 2], houses: {}, aspects: [] }, document: { documentId: 'doc-1' },
    overlayRenderMode: 'full', dashboard: { eligible: true, enabled: ready,
      modules: { moon: true },
      ...(ready && !omitted ? { bodies: [1, 2], moon: { last: 'retained' } } : {}),
      ...(omitted ? { dataOmitted: true } : {}) } };
  const activeChartRef = { current: frame };
  const steppingRef = { current: false };
  let writes = 0, comparisons = 0, finish, finishFetch;
  const fetches = [], pushes = [];
  const toggle = new Function('useCallback', 'activeChartRef', 'useFrameLayoutStore', 'dashboardPreparationRef', 'patchOptions', 'handleOptionsPatched', 'toggleComparisonView',
    'fetchDocumentSnapshot', 'pushSteppedSnapshot', 'steppingRef', 'activeDocRef', 'toggleGraphicEphemerisRadix',
    compile(`const toggle = ${handler.getText(homeAst)};`) + '\nreturn toggle;')(
    fn => fn, activeChartRef, store, { current: null }, () => {
      writes++;
      return new Promise(resolve => { finish = resolve; });
    }, () => {}, () => { comparisons++; },
    docId => {
      fetches.push(docId);
      return new Promise(resolve => { finishFetch = resolve; });
    }, (docId, snapshot) => { pushes.push([docId, snapshot]); }, steppingRef,
    { current: { id: 'doc-1', kind: 'chart' } }, () => {},
  );
  return { store, frame, activeChartRef, steppingRef, toggle, saved, writes: () => writes, comparisons: () => comparisons,
    fetches, pushes, finishFetch: snapshot => finishFetch(snapshot),
    finish: () => finish({}), view: () => withDashboardView(activeChartRef.current, store.getState().dashboardView) };
}

test('rapid warm Tab switches select layouts immediately with unchanged data and zero backend requests', () => {
  const h = harness();
  for (let i = 0; i < 10; i++) {
    h.toggle();
    const view = h.view();
    assert.equal(view.dashboard.enabled, i % 2 === 1);
    assert.equal(view.primaryChart, h.frame.primaryChart);
    assert.equal(view.dashboard.moon, h.frame.dashboard.moon);
    assert.equal(h.writes(), 0);
  }
  assert.equal(JSON.parse(h.saved.get('aries.frame-layout')).state.dashboardView, true);
});

test('a cold load prepares once; rapid local choices win over its late result', async () => {
  const h = harness(false);
  for (let i = 0; i < 4; i++) h.toggle();
  assert.equal(h.store.getState().dashboardView, false);
  assert.equal(h.writes(), 1);
  h.finish();
  await new Promise(resolve => setImmediate(resolve));
  h.activeChartRef.current = { ...h.frame, dashboard: { ...h.frame.dashboard, enabled: true, bodies: [1, 2] } };
  assert.equal(h.view().dashboard.enabled, false);
  h.toggle();
  assert.equal(h.view().dashboard.enabled, true);
  assert.equal(h.writes(), 1);
});

test('a step frame taken while hidden refreshes once when Tab shows the dashboard', async () => {
  const h = harness(true, true);
  h.toggle(); // hide
  assert.deepEqual(h.fetches, []);
  h.toggle(); // show: the step frame carries no module data
  assert.equal(h.view().dashboard.enabled, true);
  assert.deepEqual(h.fetches, ['doc-1']);
  h.toggle(); h.toggle(); // rapid switches reuse the pending refresh
  assert.deepEqual(h.fetches, ['doc-1']);
  const full = { ...h.frame, dashboard: { ...h.frame.dashboard, dataOmitted: undefined, bodies: [1, 2] } };
  h.finishFetch(full);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(h.pushes, [['doc-1', full]]);
  assert.equal(h.writes(), 0);
});

test('the Tab refresh yields to a newer step', async () => {
  const h = harness(true, true);
  h.toggle(); h.toggle();
  h.steppingRef.current = true;
  h.finishFetch({ ...h.frame });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(h.pushes, []);
});

test('comparison charts retain their existing Tab command', () => {
  const h = harness();
  h.frame.dashboard.eligible = false;
  h.toggle();
  assert.equal(h.comparisons(), 1);
  assert.equal(h.store.getState().dashboardView, null);
  assert.equal(h.writes(), 0);
  assert.equal(h.view(), h.frame);
});

test('local view changes invalidate layout even after an overlay-only settle', async () => {
  const source = await readFile(new URL('../src/components/workshell/chart-canvas.tsx', import.meta.url), 'utf8');
  const begin = source.indexOf('    if (paintedChartRef.current?.dashboard?.enabled !== chart.dashboard?.enabled)');
  const end = source.indexOf('\n    }', begin) + '\n    }'.length;
  assert.ok(begin > 0);
  const dirty = { fill: false, geometry: false, dynamic: false, outerLabel: false };
  new Function('paintedChartRef', 'chart', 'dirty', source.slice(begin, end))(
    { current: { dashboard: { enabled: true } } }, { dashboard: { enabled: false } }, dirty,
  );
  assert.deepEqual(dirty, { fill: true, geometry: true, dynamic: true, outerLabel: true });
});
