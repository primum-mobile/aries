// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

async function loadFit() {
  const source = await readFile(new URL('../src/components/workshell/content-fit-panel.ts', import.meta.url), 'utf8');
  // The pure line math only; React and the panel library stay out of the node test.
  const start = source.indexOf('const LINE_OVERLAP_TOLERANCE_PX');
  const end = source.indexOf('function lineBoundaries(');
  const body = source.slice(start, source.indexOf('\n', start) + 1) + source.slice(source.indexOf('export function controlLineBoundaries'), end);
  const js = ts.transpileModule(body, {compilerOptions: {module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022}}).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
}

test('drawer sash stops sit between whole control lines and end at the content height', async () => {
  const {controlLineBoundaries} = await loadFit();
  // Heading row (label + bulk actions), two wrapped pill rows, aspect bar; 8 px padding below.
  const boxes = [
    {top: 8, bottom: 30}, {top: 9, bottom: 29},
    {top: 38, bottom: 62}, {top: 38, bottom: 62}, {top: 39, bottom: 61},
    {top: 67, bottom: 91},
    {top: 103, bottom: 125},
  ];
  assert.deepEqual(controlLineBoundaries(boxes, 133), [34, 65, 97, 129, 133]);
});

test('a single line drawer has one stop at its full height', async () => {
  const {controlLineBoundaries} = await loadFit();
  assert.deepEqual(controlLineBoundaries([{top: 6, bottom: 30}], 36), [33, 36]);
  assert.deepEqual(controlLineBoundaries([], 36), [36]);
});

test('a text caption between pill rows is its own line, never cut by a stop', async () => {
  const {controlLineBoundaries} = await loadFit();
  // Pill row, section caption text, pill row; adjacent boxes touching edge to edge stay separate lines.
  const boxes = [{top: 4, bottom: 28}, {top: 36, bottom: 50}, {top: 50, bottom: 74}];
  const bounds = controlLineBoundaries(boxes, 80);
  assert.deepEqual(bounds, [32, 50, 77, 80]);
  for (const bound of bounds) assert.ok(!boxes.some((box) => box.top < bound && box.bottom > bound));
});

test('a drawer opens to all its content and keeps a chosen line across reflows', async () => {
  const {contentFitTarget} = await loadFit();
  // Unchosen: the whole content, or the last whole line that leaves the results room.
  assert.equal(contentFitTarget([34, 65, 97, 129, 133], null), 133);
  assert.equal(contentFitTarget([34, 65, 97], null), 97);
  // Chosen: the nearest line after the content or window changes.
  assert.equal(contentFitTarget([34, 65, 97, 129, 133], 70), 65);
  assert.equal(contentFitTarget([30, 58, 90], 65), 58);
});
