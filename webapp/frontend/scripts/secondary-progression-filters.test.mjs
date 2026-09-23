// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../src/lib/secondary-progression-filters.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { secondaryActingPointMatches: matches } = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
const sunToAsc = { promPlanet: 0, promAngleId: null, sigPlanet: null };
const asteroid = { promPlanet: 10433, promAngleId: null };
const asc = { promPlanet: null, promAngleId: 'angle:asc' };
const mc = { promPlanet: null, promAngleId: 'angle:mc' };

test('all, none, and individual actor toggles include angles', () => {
  const rows = [sunToAsc, asteroid, asc, mc];
  assert.deepEqual(rows.filter(row => matches(row, null, null)), rows);
  assert.deepEqual(rows.filter(row => matches(row, new Set(), new Set())), []);
  assert.deepEqual(rows.filter(row => matches(row, new Set(), new Set(['angle:asc']))), [asc]);
  assert.deepEqual(rows.filter(row => matches(row, null, new Set(['angle:mc']))), [sunToAsc, asteroid, mc]);
  assert.deepEqual(rows.filter(row => matches(row, new Set([10433]), new Set())), [asteroid]);
});

test('turning off acting angles keeps planet-to-angle receiving contacts', () => {
  assert.equal(matches(sunToAsc, new Set([0]), new Set()), true);
  assert.equal(matches(sunToAsc, new Set(), null), false);
});

test('repeated selection changes never mutate retained source rows', () => {
  const rows = Object.freeze([Object.freeze(sunToAsc), Object.freeze(asc), Object.freeze(mc)]);
  for (let i = 0; i < 20; i += 1) {
    assert.equal(rows.filter(row => matches(row, null, new Set())).length, 1);
    assert.equal(rows.filter(row => matches(row, null, null)).length, 3);
  }
});
