// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

async function load(path, deps = {}) {
  const source = await readFile(new URL(path, import.meta.url), 'utf8');
  const js = ts.transpileModule(source, {compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  }}).outputText;
  const api = {exports: {}};
  new Function('require', 'exports', js)((id) => {
    assert.ok(id in deps, id); return deps[id];
  }, api.exports);
  return api.exports;
}
const palette = await load('../src/lib/theme/table-print-palette.ts');
const filenames = await load('../src/components/workshell/text-export.ts', {
  '@/lib/daemon/client': {}, '@/lib/shell-host': {},
});
const pdf = await load('../src/components/workshell/table-pdf-export.ts', {
  '@/lib/daemon/client': {}, '@/lib/shell-host': {},
  '@/lib/theme/table-print-palette': palette,
  './text-export': filenames,
  './table-text-export': {
    adHocTableToConfiguredAlignedText: async () => 'semantic text',
    tableToConfiguredAlignedText: async () => 'semantic text',
  },
});

test('report filenames carry the chart holder and retain the report date', async () => {
  assert.equal(filenames.chartExportFileStem('Jane / Doe', 'transits-2026-09'), 'Jane _ Doe transits-2026-09');
  assert.equal(filenames.chartExportFileStem('Jane Doe', 'Jane Doe Transits'), 'Jane Doe Transits');
  const document = await pdf.buildAdHocTableExportDocument({
    title: 'Transits', sourceName: 'Jane Doe', fileStem: 'transits-2026-09',
    columns: [], rows: [],
  });
  assert.equal(document.fileStem, 'Jane Doe transits-2026-09');
  const table = await pdf.buildTableExportDocument({
    tableId: 'profections_table', title: 'Profections', sourceName: 'Jane Doe',
    columns: [], rows: [],
  }, []);
  assert.equal(table.fileStem, 'Jane Doe Profections');
});

test('every standard print color has at least 4.5:1 contrast on white', () => {
  for (const [role, hex] of Object.entries(palette.TABLE_PRINT_COLORS)) {
    const rgb = hex.slice(1).match(/../g).map((value) => parseInt(value, 16) / 255)
      .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    const contrast = 1.05 / (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2] + 0.05);
    assert.ok(contrast >= 4.5, `${role}: ${contrast}`);
  }
  for (const role of [undefined, '--morinus-peregrin', '--morinus-signs', '--morinus-text-bright', '--unknown']) {
    assert.equal(palette.tablePrintColor(role), '#000000');
  }
});

test('table rows, runs, headers and explicit direction PDF rows ignore theme literals', async () => {
  const build = (color) => pdf.buildAdHocTableExportDocument({
    title: 'Transits', fileStem: 'transits',
    columns: [{label: 'A', colorRole: '--morinus-body-sun', colorHex: color}],
    rows: [[{glyph: 'G', colorRole: '--morinus-dignity-domicil', color,
      runs: [{text: 'G', glyph: true, colorRole: '--morinus-dignity-exil', color}]}]],
  });
  const pale = await build('#ffffee'), dark = await build('#112233');
  assert.deepEqual(pale.pdf, dark.pdf);
  assert.equal(pale.pdf.rows[0].cells[0].color, '#288246');
  assert.equal(pale.pdf.rows[0].cells[0].runs[0].color, '#c83232');
  const explicit = await pdf.buildAdHocTableExportDocument({
    title: 'Directions', fileStem: 'directions', columns: [], rows: [],
    pdfRows: [{kind: 'group', level: 2, cells: [{glyph: 'M', color: '#ffffff', colorRole: '--morinus-aspect-conjunction'}, {text: 'Date', color: '#ff0000'}]}],
  });
  assert.equal(explicit.pdf.rows[0].kind, 'group');
  assert.equal(explicit.pdf.rows[0].level, 2);
  assert.deepEqual(explicit.pdf.rows[0].cells.map((cell) => cell.color), ['#9c0082', '#000000']);
});

test('matrix, strip and section exports use the same semantic print palette', async () => {
  const body = {color: '#ffffff', colorRole: '--morinus-body-mars'};
  const make = (extra) => pdf.buildTableExportDocument({title: 'Table', tableId: 'table', columns: [], rows: [], ...extra}, []);
  const matrix = await make({capabilities: {matrix: true}, matrix: {
    planets: [body], ascmc: [body], houses: [body], rows: [body], cols: [body], cells: {a: body},
  }});
  for (const field of ['planets', 'ascmc', 'houses', 'rows', 'cols']) assert.equal(matrix.pdf.matrix[field][0].color, '#b22222');
  assert.equal(matrix.pdf.matrix.cells.a.color, '#b22222');
  const strip = await make({capabilities: {strip: true}, strip: {signs: [{bodies: [{...body, colorHex: '#ffff00'}]}]}});
  assert.equal(strip.pdf.strip.signs[0].bodies[0].colorHex, '#b22222');
  const sections = await make({capabilities: {sections: true}, sections: [{columns: [], rows: [{cells: [body]}]}]});
  assert.equal(sections.pdf.sections[0].rows[0].cells[0].color, '#b22222');
});
