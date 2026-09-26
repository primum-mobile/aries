// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../src/components/workshell/aspect-list-export.tsx', import.meta.url), 'utf8');
const js = ts.transpileModule(source, {compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React,
}}).outputText;

function load() {
  const api = {exports: {}};
  const dependencies = {
    react: {
      useState: (initial) => [initial, () => {}],
      useCallback: (fn) => fn,
      createElement: (type, props, ...children) => ({type, props, children}),
    },
    '@/lib/i18n/i18n': {useT: () => (key, args) => key === 'aspectList.empty' ? `Empty ${args.orb}` : key},
    '@/lib/list-tokens': {LIST_PANE_CLASSES: {}},
    './table-pdf-export': {buildAdHocTableExportDocument: async (document) => document},
    './text-export-actions': {TextExportActions: 'ExportActions'},
  };
  new Function('require', 'exports', js)((id) => {
    assert.ok(id in dependencies, id);
    return dependencies[id];
  }, api.exports);
  return api.exports;
}

const endpoint = (name, glyph, motionMarker = '') => ({
  name, glyph, glyphFont: 'morinus', displaySegments: [], motionMarker,
});
const row = (id) => ({
  id, left: endpoint(id === 'second' ? 'Moon' : 'Saturn', 'G', 'R'), right: endpoint('Sun', 'A'),
  aspect: {name: 'Conjunction', glyph: 'M', glyphFont: 'morinus', exportSymbolText: '☌'},
  orbFormatted: '1° 20′', phase: 'applying',
});

test('export uses semantic text, the canonical aspect symbol, and full exact time', () => {
  const cells = load().aspectListExportCells(row('one'), {
    status: 'ready', exactDate: '2026-09-26', exactTime: '12:34:56',
  }, 'app.', 'n/a');
  assert.equal(cells[0].exportText, 'Saturn R Conjunction Sun');
  assert.equal(cells[0].exportSymbolText, 'Saturn R ☌ Sun');
  assert.equal(cells[0].runs[0].glyph, true);
  assert.equal(cells[1].text, '1° 20′ app.');
  assert.equal(cells[3].text, '12:34:56');
});

test('export keeps the supplied displayed row order and excludes other rows', async () => {
  const {AspectListExport} = load();
  const rows = [row('second'), row('first')];
  const view = AspectListExport({rows, perfectionByRow: new Map(),
    retainedPerfectionByRow: new Map(), modeLabel: 'Primary', sourceName: 'Example',
    maxOrb: 5, disabled: false});
  const document = await view.children[0].props.buildDocument();
  assert.equal(document.rows.length, 2);
  assert.equal(document.rows[0][0].exportText, 'Moon R Conjunction Sun');
  assert.equal(document.rows[1][0].exportText, 'Saturn R Conjunction Sun');
  assert.equal(document.rows[0][2].text, 'aspectList.notApplicable');
  assert.equal(document.title, 'aspectList.title · Primary');
  assert.equal(document.sourceName, 'Example');
});
