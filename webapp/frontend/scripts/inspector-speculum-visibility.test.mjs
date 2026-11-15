import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
const source = await readFile(new URL('../src/components/workshell/inspector-panel.tsx', import.meta.url), 'utf8');
const start = source.indexOf('function inspectorSpeculumRows(');
const code = ts.transpileModule(source.slice(start, source.indexOf('\nfunction InspectorSpeculum(', start)), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const { rows } = await import(`data:text/javascript;base64,${Buffer.from(`const SE_MOON=1; const tableCellText=c=>c?.text??''; const speculumBodyGlyphCell=c=>c; ${code}; export const rows=inspectorSpeculumRows;`).toString('base64')}`);
const columns = ['body', 'lon'].map(id => ({ id }));
const row = (id, planet) => ({ id, cells: [{ text: id, planet }, { text: '12°' }] });
const payload = { sections: [
  { id: 'ascmc', columns, rows: [row('asc'), row('mc')] },
  { id: 'planets', columns, rows: [row('planet:0', 0), row('planet:7', 7), row('planet:15', 15), row('planet:10001', 10001), row('fortune'), row('vertex')] },
] };
// The component passes the wheel's visible body ids and Fortune/Vertex flags
// (see the source wiring test below); the projection itself needs no chart.
const visible = (ids, showFortune = true, showVertex = true) => [new Set(ids), showFortune, showVertex];
test('visible bodies filter retained source and restore optional bodies', () => {
  const before = structuredClone(payload);
  assert.deepEqual(rows(payload, ...visible([0, 10001])).map(r => r.id), ['ascmc:asc', 'ascmc:mc', 'planets:planet:0', 'planets:planet:10001', 'planets:fortune', 'planets:vertex']);
  assert.equal(rows(payload, ...visible([0, 7, 15, 10001])).length, 8);
  assert.deepEqual(payload, before);
});
test('Fortune and Vertex follow presence and flags in full and live payloads', () => {
  assert.deepEqual(rows(payload, ...visible([], false, false)).map(r => r.id), ['ascmc:asc', 'ascmc:mc']);
  assert.equal(rows({ speculumInspector: payload }, ...visible([], false, false)).length, 2);
  // Presence and the wheel's show flags both gate the optional rows.
  assert.match(source, /const showFortune = Boolean\(chart\.primaryChart\.fortune\) && chart\.primaryChart\.options\.showLoF !== false;/);
  assert.match(source, /const showVertex = Boolean\(chart\.primaryChart\.vertex\) && chart\.primaryChart\.options\.showVertex !== false;/);
  assert.match(source, /const bodyVisibilityKey = chart\.primaryChart\.planets\.map\(\(planet\) => planet\.seId\)\.join\(","\);/);
});
