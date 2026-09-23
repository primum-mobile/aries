// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../src/lib/transit-list-filters.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { resolveTransitListFilters, transitListFilterKey, toggleTransitListIds, transitPointRoleIds, resolveTransitPointIds } = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
const catalog = {
  promittorIds: ['planet:sun', 'planet:moon', 'planet:chiron', 'asteroid:10433', 'planet:desc_node'],
  significatorIds: ['planet:sun', 'planet:moon', 'planet:chiron', 'asteroid:10433', 'planet:desc_node', 'planet:venus', 'angle:asc', 'angle:mc', 'point:lof', 'point:syzygy', 'point:eclipse', 'fixstar:regulus', 'part:000', 'custom:one'],
  aspects: [{id: 'conjunction'}, {id: 'square'}, {id: 'quincunx'}],
  presets: {
    promittors: {standard: ['planet:sun']},
    significators: {standard: ['planet:sun', 'planet:moon', 'planet:venus', 'angle:asc']},
    aspects: {major: ['conjunction', 'square']},
  },
};
catalog.objects = [...new Set([...catalog.promittorIds, ...catalog.significatorIds])].map((id) => ({
  id,
  transitRoles: {
    promittor: catalog.promittorIds.includes(id) ? 'supported' : 'unsupported(fixed_target)',
    significator: catalog.significatorIds.includes(id) ? 'supported' : 'unsupported(unavailable)',
  },
}));
// Search also uses stars as actors for other techniques, such as heliacal phases.
catalog.promittorIds.push('fixstar:regulus');

test('standard remains the initial preset while all supported transit roles are selectable', () => {
  assert.deepEqual(resolveTransitListFilters(catalog, {}).promittorIds, ['planet:moon', 'planet:sun']);
  const all = resolveTransitListFilters(catalog, {
    selectedPointIds: catalog.objects.map(({id}) => id),
    selectedAspectIds: catalog.aspects.map(({id}) => id),
  });
  assert.deepEqual(all.promittorIds, transitPointRoleIds(catalog, 'promittor').sort());
  assert.deepEqual(all.significatorIds, [...catalog.significatorIds].sort());
  assert.deepEqual(all.aspects, ['conjunction', 'quincunx', 'square']);
});

test('one selected planet still makes transits to other natal points', () => {
  const filters = resolveTransitListFilters(catalog, {selectedPointIds: ['planet:moon']});
  assert.deepEqual(filters.promittorIds, ['planet:moon']);
  for (const target of ['planet:sun', 'planet:venus', 'angle:asc']) {
    assert.ok(filters.significatorIds.includes(target), `missing natal counterpart ${target}`);
  }
});

test('fixed stars stay targets and cannot enter a transit query through saved or all selections', () => {
  assert.ok(catalog.promittorIds.includes('fixstar:regulus'));
  assert.ok(!transitPointRoleIds(catalog, 'promittor').includes('fixstar:regulus'));
  assert.ok(transitPointRoleIds(catalog, 'significator').includes('fixstar:regulus'));
  const result = resolveTransitListFilters(catalog, {
    selectedPointIds: ['fixstar:regulus'],
  });
  assert.deepEqual(result.promittorIds, []);
  assert.deepEqual(result.significatorIds, ['angle:asc', 'fixstar:regulus', 'planet:moon', 'planet:sun', 'planet:venus']);
});

test('selected movers keep the natal counterpart set and add optional fixed targets', () => {
  const filters = resolveTransitListFilters(catalog, {
    selectedPointIds: ['planet:moon', 'planet:chiron', 'part:000', 'fixstar:regulus'],
    selectedAspectIds: ['quincunx'],
  });
  assert.deepEqual(filters, {
    promittorIds: ['planet:chiron', 'planet:moon'],
    significatorIds: ['angle:asc', 'fixstar:regulus', 'part:000', 'planet:chiron', 'planet:moon', 'planet:sun', 'planet:venus'],
    aspects: ['quincunx'], promittorMotion: '', significatorMotion: '',
  });
  assert.deepEqual(resolveTransitPointIds(catalog), ['angle:asc', 'planet:moon', 'planet:sun', 'planet:venus']);
  for (const field of ['selectedPointIds', 'selectedAspectIds']) {
    const changed = resolveTransitListFilters(catalog, {[field]: []});
    assert.notEqual(transitListFilterKey(changed), transitListFilterKey(resolveTransitListFilters(catalog, {})), field);
  }
});

test('retired Direct/Rx preferences cannot hide transits or split the stream cache', () => {
  const preferences = {selectedPointIds: ['planet:moon'], selectedAspectIds: ['square']};
  const expected = resolveTransitListFilters(catalog, preferences);
  for (const motion of ['rx', 'd']) {
    const restored = resolveTransitListFilters(catalog, {
      ...preferences, motion, promittorMotion: motion, significatorMotion: motion,
    });
    assert.deepEqual(restored, expected);
    assert.equal(restored.promittorMotion, '');
    assert.equal(restored.significatorMotion, '');
    assert.equal(transitListFilterKey(restored), transitListFilterKey(expected));
  }
});

test('independent role selections override legacy defaults and side switching keeps one query', () => {
  const pointRoles = {fromIds: ['asteroid:10433'], toIds: ['planet:sun']};
  const preferences = {selectedPointIds: ['planet:moon'], selectedAspectIds: ['square'], pointRoles};
  const from = resolveTransitListFilters(catalog, {...preferences, pointFilterSide: 'from'});
  const to = resolveTransitListFilters(catalog, {...preferences, pointFilterSide: 'to'});
  assert.deepEqual(from.promittorIds, pointRoles.fromIds);
  assert.deepEqual(from.significatorIds, pointRoles.toIds);
  assert.equal(transitListFilterKey(from), transitListFilterKey(to));
  const empty = resolveTransitListFilters(catalog, {...preferences, pointRoles: {fromIds: [], toIds: []}});
  assert.deepEqual(empty.promittorIds, []);
  assert.deepEqual(empty.significatorIds, []);
});

test('Lots and star toggles add targets without narrowing the natal planets or adding movers', () => {
  const movingMoon = {selectedPointIds: ['planet:moon']};
  const base = resolveTransitListFilters(catalog, movingMoon);
  assert.ok(!base.significatorIds.includes('fixstar:regulus'));
  assert.ok(!base.significatorIds.includes('part:000'));
  const withFixedTargets = resolveTransitListFilters(catalog, {
    selectedPointIds: [...movingMoon.selectedPointIds, 'fixstar:regulus', 'part:000'],
  });
  assert.deepEqual(withFixedTargets.promittorIds, base.promittorIds);
  assert.deepEqual(withFixedTargets.significatorIds, [...base.significatorIds, 'fixstar:regulus', 'part:000'].sort());
  assert.notEqual(transitListFilterKey(base), transitListFilterKey(withFixedTargets));
});

test('deselect all never falls back to the standard or an unrelated Search preference', () => {
  const empty = resolveTransitListFilters(catalog, {selectedPointIds: [], selectedAspectIds: []});
  assert.deepEqual(empty.promittorIds, []);
  assert.deepEqual(empty.significatorIds, []);
  assert.deepEqual(empty.aspects, []);
  assert.deepEqual(resolveTransitListFilters(catalog, {selectedPointIds: ['not-available']}).promittorIds, []);
});

test('equivalent selections and drawer changes reuse one query and viewport identity', () => {
  const a = resolveTransitListFilters(catalog, {selectedPointIds: ['planet:moon', 'planet:chiron'], filterDrawerOpen: true});
  const b = resolveTransitListFilters(catalog, {selectedPointIds: ['planet:chiron', 'planet:moon', 'planet:moon'], filterDrawerOpen: false});
  assert.equal(transitListFilterKey(a), transitListFilterKey(b));
});

test('individual and category toggles retain unavailable user choices across catalog changes', () => {
  let selected = ['temporarily-absent', 'planet:moon'];
  selected = toggleTransitListIds(selected, ['planet:moon'], ['planet:chiron']);
  assert.deepEqual(selected, ['planet:chiron', 'planet:moon', 'temporarily-absent']);
  selected = toggleTransitListIds(selected, selected, ['planet:moon', 'planet:chiron']);
  assert.deepEqual(selected, ['temporarily-absent']);
  const restored = resolveTransitListFilters({...catalog, objects: [...catalog.objects, {id: 'temporarily-absent', transitRoles: {promittor: 'supported'}}]}, {selectedPointIds: selected});
  assert.deepEqual(restored.promittorIds, ['temporarily-absent']);
  assert.deepEqual(toggleTransitListIds(null, ['planet:sun'], ['planet:moon']), ['planet:moon', 'planet:sun']);
});

// Transit reference points never become actors through an older saved role set.
test('ASC, MC and Fortune remain receiving points when both roles were saved', () => {
  const ids = ['angle:asc', 'angle:mc', 'point:lof', 'planet:moon'];
  const result = resolveTransitListFilters(catalog, {pointRoles: {fromIds: ids, toIds: ids}});
  assert.deepEqual(result.promittorIds, ['planet:moon']);
  assert.deepEqual(result.significatorIds, [...ids].sort());
});
