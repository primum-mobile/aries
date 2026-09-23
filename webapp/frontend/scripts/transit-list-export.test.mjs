// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../src/components/workshell/transit-list-export.tsx', import.meta.url), 'utf8');
const js = ts.transpileModule(source, {compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React,
}}).outputText;
const row = {
  promittorLabel: 'Saturn', promittorGlyph: 'G', promittorGlyphFont: 'morinus',
  promittorSegments: [], promittorMarker: '', promDisplay: {motion_marker: 'R'},
  significatorLabel: 'Sun', significatorGlyph: 'A', significatorGlyphFont: 'morinus',
  significatorSegments: [], significatorMarker: '', sigDisplay: {},
  aspectLabel: 'Conjunction', aspectGlyph: 'M', metadata: {aspect_export_symbol_text: '☌'},
  displayDate: '2026-03-01', displayTime: '23:59:59', displayDatetime: '2026-03-01T23:59:59', technique: 'converse_transits',
};

function load(result = {}) {
  let requested;
  let cleanup;
  const api = {exports: {}};
  const react = {
    useState: (initial) => [initial, () => {}],
    useRef: (current) => ({current}),
    useEffect: (fn) => { cleanup = fn(); },
    useCallback: (fn) => fn,
    createElement: (type, props, ...children) => ({type, props, children}),
  };
  const dependencies = {
    react,
    '@/lib/daemon/client': {
      startTransitMonthExport: async (request) => { requested = request; return {sessionId: 'export'}; },
      followTransitSearchProgress: async () => ({
        complete: true, rows: [row], timeDisplay: {zoneId: 'Europe/Vienna', offsetsMinutes: [60, 120]},
        ...result,
      }),
      cancelTransitSearch: async () => ({}),
    },
    '@/lib/i18n/i18n': {useT: () => (key) => key},
    '@/lib/list-tokens': {LIST_PANE_CLASSES: {}},
    './table-pdf-export': {buildAdHocTableExportDocument: async (document) => document},
    './text-export-actions': {TextExportActions: 'ExportActions'},
  };
  new Function('require', 'exports', js)((id) => {
    assert.ok(id in dependencies, id);
    return dependencies[id];
  }, api.exports);
  return {...api.exports, requested: () => requested, cleanup: () => cleanup?.()};
}

test('export cells preserve full time, motion, direction and semantic TXT labels', () => {
  const cells = load().transitExportCells(row);
  assert.equal(cells[0].exportText, 'Saturn R');
  assert.deepEqual(cells[0].runs.map((run) => [run.text, Boolean(run.glyph)]), [['G', true], [' R', false]]);
  assert.equal(cells[1].exportText, 'Conjunction');
  assert.equal(cells[1].exportSymbolText, '☌');
  assert.equal(cells[4].text, '23:59:59');
  assert.equal(cells[5].text, 'C');
  const derived = load().transitExportCells({...row,
    significatorLabel: 'Sun/Moon midpoint',
    significatorSegments: [{text: 'A', kind: 'planet'}, {text: '/', kind: 'text'}, {text: 'B', kind: 'planet'}],
  });
  assert.equal(derived[2].exportText, 'Sun/Moon midpoint');
  assert.deepEqual(derived[2].runs.map((run) => Boolean(run.glyph)), [true, false, true]);
});

test('export uses the supplied calendar month and all completed rows, with zone metadata', async () => {
  const api = load({rows: Array.from({length: 621}, () => row)});
  const request = {documentId: 'radix', year: 2026, month: 3, direction: 'both',
    promittorIds: ['planet:saturn'], significatorIds: ['planet:sun'], aspects: ['conjunction']};
  const view = api.TransitListExport({request, monthLabel: 'March 2026', sourceName: 'Example', disabled: false});
  const output = await view.children[0].props.buildDocument();
  assert.deepEqual(api.requested(), request);
  assert.equal(output.rows.length, 621);
  assert.equal(output.fileStem, 'transits-2026-03');
  assert.equal(output.sourceName, 'Example');
  assert.ok(output.title.includes('March 2026'));
  assert.equal(output.headerLines[0], 'Europe/Vienna · UTC+01:00 / UTC+02:00');
});

test('partial, cancelled, and failed jobs never produce a document', async () => {
  for (const result of [{truncated: true}, {cancelled: true}, {error: 'failed'}, {complete: false}]) {
    const api = load(result);
    const view = api.TransitListExport({request: {documentId: 'radix'}, monthLabel: 'March 2026', disabled: false});
    await assert.rejects(view.children[0].props.buildDocument());
  }
});

test('closing the pane during startup cancels export before creating a file', async () => {
  const api = load();
  const view = api.TransitListExport({request: {documentId: 'radix'}, monthLabel: 'March 2026', disabled: false});
  const pending = view.children[0].props.buildDocument();
  api.cleanup();
  await assert.rejects(pending, {name: 'AbortError'});
});

test('complete resident month exports without starting Search; surrounding rows stay out', async () => {
  const api = load();
  const coverage = {from: '2026-03-01T00:00:00', to: '2026-04-01T00:00:00',
    timeDisplay: {offsetsMinutes: [0]}};
  const bufferedRows = [row, {...row, displayDatetime: '2026-04-01T00:00:00'}];
  const view = api.TransitListExport({request: {year: 2026, month: 3},
    monthLabel: 'March 2026', disabled: false, coverage, bufferedRows});
  const document = await view.children[0].props.buildDocument();
  assert.equal(api.requested(), undefined);
  assert.equal(document.rows.length, 1);
});

test('partial civil coverage and ambiguous DST metadata require the full month job', () => {
  const api = load();
  const coverage = {from: '2026-03-01T00:00:00', to: '2026-04-01T00:00:00', timeDisplay: {offsetsMinutes: [0]}};
  for (const changes of [
    {from: '2026-03-01T01:00:00'}, {to: '2026-03-31T23:00:00'},
    {timeDisplay: {offsetsMinutes: [60, 120]}},
  ]) assert.equal(api.bufferedTransitMonth({year: 2026, month: 3}, [row], {...coverage, ...changes}), undefined);
  assert.equal(api.bufferedTransitMonth({year: 2026, month: 3}, [row]), undefined);
  assert.deepEqual(api.bufferedTransitMonth({year: 2026, month: 3}, [], coverage).rows, []);
});

test('buffer stitching never certifies a gap or missing coverage', () => {
  const api = load();
  const a = {from: '2026-03-01T00:00:00', to: '2026-04-01T00:00:00', timeDisplay: {offsetsMinutes: [0]}};
  const b = {...a, from: a.to, to: '2026-05-01T00:00:00'};
  assert.deepEqual(api.mergeTransitExportCoverage(a, b), {...a, to: b.to});
  assert.equal(api.mergeTransitExportCoverage(a, {...b, from: '2026-04-02T00:00:00'}), undefined);
  assert.equal(api.mergeTransitExportCoverage(a), undefined);
  for (const flags of [{truncated: true}, {cancelled: true}, {error: 'failed'}]) {
    assert.equal(api.transitExportCoverage({cursor: {displayCoverageFrom: a.from, displayCoverageTo: a.to}, ...flags}), undefined);
  }
});

test('warm 979-row month selection stays within the immediate-action budget', (t) => {
  const api = load();
  const rows = Array.from({length: 979}, () => row);
  const coverage = {from: '2026-03-01T00:00:00', to: '2026-04-01T00:00:00', timeDisplay: {offsetsMinutes: [0]}};
  const samples = [];
  for (let index = 0; index < 11; index++) {
    const start = performance.now();
    const result = api.bufferedTransitMonth({year: 2026, month: 3}, rows, coverage);
    const cells = result.rows.map(api.transitExportCells);
    if (index) samples.push(performance.now() - start);
    assert.equal(cells.length, 979);
  }
  samples.sort((a, b) => a - b);
  const max = samples.at(-1);
  t.diagnostic(JSON.stringify({rows: 979, samples: samples.length, apiRequests: 0,
    transferBytes: 0, p50Ms: samples[5], p95Ms: max, maxMs: max}));
  assert.ok(max < 100, `resident month preparation took ${max} ms`);
});
