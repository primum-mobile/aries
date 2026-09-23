import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('../src/components/workshell/home-client.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('home-client.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = new Set(['quickCommandValue', 'nativeQuickOptionPatch']);
const functions = ast.statements.filter((node) => ts.isFunctionDeclaration(node) && names.has(node.name?.text));
assert.equal(functions.length, 2);
const js = ts.transpileModule(functions.map((node) => node.getText(ast)).join('\n'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
const patch = new Function(`${js}; return nativeQuickOptionPatch;`)();
const opts = { quickCharts: { progressed_angle_method: 4, solar_arc_angle_method: 3, solar_arc_angle_mode: 'zodiacal' } };

test('progression methods never change Solar Arc mode or remembered choice', () => {
  for (let method = 0; method < 5; method++) {
    assert.deepEqual(patch(`quick.options.progressed-angle:${method}`, opts), { quickCharts: { progressed_angle_method: method } });
  }
  assert.equal(patch('quick.options.progressed-angle:zodiacal', opts), null);
});

test('Solar Arc method and mode commands update independent fields', () => {
  assert.deepEqual(patch('quick.options.solar-arc-angle:1', opts), { quickCharts: { solar_arc_angle_method: 1 } });
  for (const mode of ['zodiacal', 'progressed']) {
    assert.deepEqual(patch(`quick.options.solar-arc-mode:${mode}`, opts), { quickCharts: { solar_arc_angle_mode: mode } });
  }
});
