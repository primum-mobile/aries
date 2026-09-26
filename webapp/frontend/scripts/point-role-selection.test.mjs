// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

async function load(path) {
  const source = await readFile(new URL(path, import.meta.url), 'utf8');
  const js = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022}}).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
}
const {pointRoleSelectAllIds, setPointRoleIds, togglePointRoleIds} = await load('../src/lib/point-role-selection.ts');
const {resolveSecondaryPointRoles, secondaryPointRolesMatch} = await load('../src/lib/secondary-progression-filters.ts');
const points = [
  {id: 'planet:sun', from: true, to: true, planetId: 0, groupId: 'planet'},
  {id: 'planet:moon', from: true, to: true, planetId: 1, groupId: 'planet'},
  {id: 'asteroid:75100', from: true, to: true, planetId: 75100, groupId: 'asteroid'},
  {id: 'angle:asc', from: true, to: true, planetId: null, groupId: 'angle'},
  {id: 'point:lof', from: false, to: true, planetId: null, groupId: 'fortune'},
];

test('the same object pill edits two independent selections without altering its other side', () => {
  const initial = Object.freeze({fromIds: Object.freeze(['planet:sun']), toIds: Object.freeze(['planet:moon'])});
  const from = togglePointRoleIds(initial, 'from', ['asteroid:75100']);
  assert.deepEqual(from.fromIds, ['asteroid:75100', 'planet:sun']);
  assert.equal(from.toIds, initial.toIds);
  const to = togglePointRoleIds(from, 'to', ['asteroid:75100']);
  assert.equal(to.fromIds, from.fromIds);
  assert.deepEqual(to.toIds, ['asteroid:75100', 'planet:moon']);
  const clearedFrom = togglePointRoleIds(to, 'from', ['asteroid:75100']);
  assert.deepEqual(clearedFrom.fromIds, ['planet:sun']);
  assert.deepEqual(clearedFrom.toIds, to.toIds);
});

test('bulk edits only affect the exposed side and preserve unavailable choices', () => {
  const initial = {fromIds: ['asteroid:absent', 'planet:sun'], toIds: ['planet:moon']};
  const ids = points.filter(p => p.from).map(p => p.id);
  const all = setPointRoleIds(initial, 'from', ids, true);
  assert.equal(all.toIds, initial.toIds);
  assert.deepEqual(setPointRoleIds(all, 'from', ids, false), {fromIds: ['asteroid:absent'], toIds: ['planet:moon']});
});

test('All skips Moon, Arabic Parts, fixed stars, and asteroids while preserving explicit choices', () => {
  const allPoints = [...points,
    {id: 'part:spirit', groupId: 'part', from: false, to: true},
    {id: 'fixedstar:regulus', groupId: 'fixed_star', from: false, to: true},
  ];
  const explicitIds = ['planet:moon', 'part:spirit', 'fixedstar:regulus', 'asteroid:75100'];
  for (const side of ['from', 'to']) {
    const key = side === 'from' ? 'fromIds' : 'toIds';
    const ids = pointRoleSelectAllIds(allPoints, side);
    assert.ok(explicitIds.every(id => !ids.includes(id)));
    assert.ok(ids.includes('planet:sun'));
    assert.ok(ids.includes('angle:asc'), 'progressed angles remain selectable actors and targets');
    assert.equal(ids.includes('point:lof'), side === 'to', 'Fortune remains a separate receiving point');
    const empty = {fromIds: [], toIds: []};
    const all = setPointRoleIds(empty, side, ids, true);
    assert.ok(explicitIds.every(id => !all[key].includes(id)));
    const explicit = togglePointRoleIds(empty, side, explicitIds);
    assert.ok(explicitIds.every(id => setPointRoleIds(explicit, side, ids, true)[key].includes(id)));
  }
});

test('progression defaults and legacy choices resolve against the complete catalog', () => {
  const defaults = resolveSecondaryPointRoles(points, null);
  assert.deepEqual(defaults.fromIds, ['planet:sun', 'planet:moon', 'angle:asc']);
  assert.deepEqual(defaults.toIds, ['planet:sun', 'planet:moon', 'angle:asc', 'point:lof']);
  const explicit = resolveSecondaryPointRoles(points, {planetIds: [75100], angleIds: []});
  assert.deepEqual(explicit.fromIds, ['asteroid:75100']);
  assert.deepEqual(explicit.toIds, defaults.toIds);
  assert.deepEqual(resolveSecondaryPointRoles(points, {planetIds: [], angleIds: []}).fromIds, []);
});

test('both endpoint selections filter rows regardless of which side is exposed', () => {
  const pointRoles = {fromIds: ['planet:sun'], toIds: ['asteroid:75100']};
  const rows = Object.freeze([
    Object.freeze({promObjectId: 'planet:sun', sigObjectId: 'asteroid:75100'}),
    Object.freeze({promObjectId: 'asteroid:75100', sigObjectId: 'planet:sun'}),
    Object.freeze({promObjectId: 'planet:sun', sigObjectId: 'planet:moon'}),
    Object.freeze({promObjectId: 'planet:sun', sigObjectId: null}),
  ]);
  for (const pointFilterSide of ['from', 'to', 'from']) {
    const selection = resolveSecondaryPointRoles(points, {pointRoles, pointFilterSide});
    assert.equal(selection, pointRoles);
    assert.deepEqual(rows.filter(row => secondaryPointRolesMatch(row, new Set(selection.fromIds), new Set(selection.toIds))), [rows[0], rows[3]]);
  }
  // An empty receiving set removes contacts, while stations/ingresses keep their acting filter.
  assert.deepEqual(rows.filter(row => secondaryPointRolesMatch(row, new Set(['planet:sun']), new Set())), [rows[3]]);
  assert.deepEqual(rows.filter(row => secondaryPointRolesMatch(row, new Set(), new Set(['asteroid:75100']))), []);
});

test('the global side switch persists only editor state in both mounted lists', async () => {
  const transit = await readFile(new URL('../src/components/workshell/transit-list-view.tsx', import.meta.url), 'utf8');
  const progression = await readFile(new URL('../src/components/workshell/directions-view.tsx', import.meta.url), 'utf8');
  assert.ok(transit.includes('onSideChange={(pointFilterSide) => setTransitListPreferences(documentId, { pointFilterSide })}'));
  assert.ok(progression.includes('onChange: (pointFilterSide) => persistSecondaryPreferences(documentId, { pointFilterSide })'));
  const drawer = await readFile(new URL('../src/components/workshell/transit-list-filter-drawer.tsx', import.meta.url), 'utf8');
  assert.ok(drawer.includes('disabled={!item[side]}'));
  assert.ok(progression.includes('houseCuspItems.filter((cusp) => cusp[pointFilterSide]).map((cusp) => cusp.id)'));
  assert.ok(progression.includes('disabled={ids.length === 0}'));
});
