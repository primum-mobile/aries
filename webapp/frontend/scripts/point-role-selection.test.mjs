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
const {setPointRoleIds, togglePointRoleIds} = await load('../src/lib/point-role-selection.ts');
const {resolveSecondaryPointRoles, sameRoleIds, secondaryDefaultPointRoles, secondaryPointRolesMatch} = await load('../src/lib/secondary-progression-filters.ts');
const points = [
  {id: 'planet:sun', from: true, to: true, defaultFrom: true, defaultTo: true, planetId: 0, groupId: 'planet'},
  {id: 'planet:moon', from: true, to: true, defaultFrom: true, defaultTo: true, planetId: 1, groupId: 'planet'},
  {id: 'asteroid:75100', from: true, to: true, defaultFrom: false, defaultTo: false, planetId: 75100, groupId: 'asteroid'},
  {id: 'angle:asc', from: true, to: true, defaultFrom: true, defaultTo: true, planetId: null, groupId: 'angle'},
  {id: 'angle:ic', from: false, to: true, defaultFrom: false, defaultTo: true, planetId: null, groupId: 'angle'},
  {id: 'point:lof', from: false, to: true, defaultFrom: false, defaultTo: true, planetId: null, groupId: 'fortune'},
  {id: 'house-cusp:2', from: false, to: true, defaultFrom: false, defaultTo: false, planetId: null, groupId: 'house_cusp'},
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

test('progression defaults come from the daemon flags and legacy choices resolve against the complete catalog', () => {
  const defaults = resolveSecondaryPointRoles(points, null);
  assert.deepEqual(defaults, secondaryDefaultPointRoles(points));
  assert.deepEqual(defaults.fromIds, ['planet:sun', 'planet:moon', 'angle:asc']);
  assert.deepEqual(defaults.toIds, ['planet:sun', 'planet:moon', 'angle:asc', 'angle:ic', 'point:lof']);
  // Reset (pointRoles null) returns to the same defaults.
  assert.deepEqual(resolveSecondaryPointRoles(points, {pointRoles: null, planetIds: null, angleIds: null}), defaults);
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

test('Transit keeps its side switch while progressions show both roles with one shared chooser', async () => {
  const transit = await readFile(new URL('../src/components/workshell/transit-list-view.tsx', import.meta.url), 'utf8');
  const progression = await readFile(new URL('../src/components/workshell/directions-view.tsx', import.meta.url), 'utf8');
  assert.ok(transit.includes('onSideChange={(pointFilterSide) => setTransitListPreferences(documentId, { pointFilterSide })}'));
  assert.ok(!progression.includes('pointFilterSide'), 'progressions have no exposed-side mode');
  assert.ok(progression.includes('(["from", "to"] as const).map((side: PointRoleSide)'));
  assert.ok(progression.includes('onReset={resetSecondaryFilters}'));
  const chooser = await readFile(new URL('../src/components/workshell/role-point-chooser.tsx', import.meta.url), 'utf8');
  assert.ok(chooser.includes('disabled={!item[side]}'));
  const drawer = await readFile(new URL('../src/components/workshell/transit-list-filter-drawer.tsx', import.meta.url), 'utf8');
  assert.ok(drawer.includes('renderChoices={() => <RolePointChooser items={items} side={side}'));
});

test('point drawers offer Deselect all and Default, never Select all', async () => {
  const filters = await readFile(new URL('../src/components/workshell/point-aspect-filters.tsx', import.meta.url), 'utf8');
  assert.ok(filters.includes('t("listFilters.default")'));
  assert.ok(!filters.includes('listFilters.selectAll'));
  const drawer = await readFile(new URL('../src/components/workshell/transit-list-filter-drawer.tsx', import.meta.url), 'utf8');
  assert.ok(drawer.includes('onDefaultSection={onDefault}'));
});

test('default comparison ignores order and ids the side cannot take', () => {
  const available = new Set(['planet:sun', 'planet:moon']);
  assert.ok(sameRoleIds(['planet:moon', 'planet:sun', 'gone:x'], ['planet:sun', 'planet:moon'], available));
  assert.ok(!sameRoleIds(['planet:sun'], ['planet:sun', 'planet:moon'], available));
});

test('progression fetch chunks follow the daemon chunk size', async () => {
  const progression = await readFile(new URL('../src/components/workshell/directions-view.tsx', import.meta.url), 'utf8');
  assert.ok(progression.includes('secondaryChunkYears(current.meta, method),\n        Math.max(current.coverage.end - current.coverage.start, 0.01),'), 'adjacent fetches double coverage up to the daemon chunk');
  assert.ok(progression.includes('const half = secondaryChunkYears(store.meta, method) * 2;'), 'neighbourhood prefetch uses the daemon chunk');
  assert.equal((progression.match(/SECONDARY_STITCH_CHUNK_YEARS\[method\]/g) ?? []).length, 1, 'the fixed table only seeds the first request');
});
