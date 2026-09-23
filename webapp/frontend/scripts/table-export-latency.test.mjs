// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../src/components/workshell/table-pdf-export.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, {compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
}}).outputText;
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return {promise, resolve};
};
const document = {title: 'March', fileStem: 'transits-2026-03', text: 'full report', pdf: {rows: []}};
const labels = {title: 'Export', pdfFiles: 'PDF', textFiles: 'Text'};

function load(dialog, events) {
  const api = {exports: {}};
  const deps = {
    '@/lib/daemon/client': {
      exportTablePdf: async (payload) => events.push(['pdf', payload]),
      exportTextFile: async (payload) => events.push(['txt', payload]),
    },
    '@/lib/shell-host': {resolveShellHost: () => ({capabilities: {nativeFileDialogs: true},
      selectSavePath: (request) => { events.push(['dialog', request]); return dialog.promise; },
    })},
    '@/lib/theme/table-print-palette': {}, './text-export': {}, './table-text-export': {},
  };
  new Function('require', 'exports', js)((id) => {
    assert.ok(id in deps, id);
    return deps[id];
  }, api.exports);
  return api.exports;
}

for (const kind of ['pdf', 'txt']) {
  test(`${kind}: native dialog opens before report preparation; one write uses the captured report`, async () => {
    const events = [], dialog = deferred(), report = deferred();
    const api = load(dialog, events);
    const pending = api.exportPreparedTableDocument(() => {
      events.push(['prepare']); return report.promise;
    }, kind, labels, document.fileStem);
    assert.equal(events.length, 1);
    assert.equal(events[0][0], 'dialog');
    assert.equal(events[0][1].defaultPath, `${document.fileStem}.${kind}`);
    dialog.resolve(`/tmp/report.${kind}`);
    await Promise.resolve();
    assert.equal(events[1][0], 'prepare');
    assert.equal(events.length, 2);
    report.resolve(document);
    assert.equal(await pending, true);
    assert.equal(events[2][0], kind);
    assert.equal(events[2][1].path, `/tmp/report.${kind}`);
  });
}

test('cancelled dialog never writes a prepared report', async () => {
  const events = [], dialog = deferred();
  const pending = load(dialog, events).exportPreparedTableDocument(() => document, 'pdf', labels, document.fileStem);
  dialog.resolve(null);
  assert.equal(await pending, false);
  assert.equal(events.length, 1);
});

test('failed preparation never writes a file', async () => {
  const events = [], dialog = deferred();
  const pending = load(dialog, events).exportPreparedTableDocument(() => Promise.reject(new Error('failed')), 'pdf', labels, document.fileStem);
  dialog.resolve('/tmp/report.pdf');
  await assert.rejects(pending, /failed/);
  assert.equal(events.length, 1);
});
