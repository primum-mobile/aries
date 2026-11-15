// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { readFile } from 'node:fs/promises';

const parse = name => ts.createSourceFile(name, readFileSync(new URL(
  `../src/components/workshell/${name}`, import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const source = parse('synodic-cycle-list-view.tsx');
const harnessSource = parse('stitched-list-harness.ts');
const transpile = code => ts.transpileModule(code, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
function callback(fragment, callName, env) {
  let found;
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(source) === callName
      && node.arguments[0]?.getText(source).includes(fragment)) found = node.arguments[0];
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(found, `mounted callback for ${fragment}`);
  return new Function(...Object.keys(env),
    `${transpile(`const run = ${found.getText(source)};`)}\nreturn run;`)(...Object.values(env));
}
const helperNames = ['monthSpanFromPayload', 'monthIndexForDate', 'clampMonthIndex',
  'monthSpanAnchorIso', 'dateFromMonthIndex', 'pad2', 'monthSpanContainsSpan',
  'synodicSeedWindowForFocus', 'synodicSeedWindowForMonth', 'monthSpanRange', 'isoDate',
  'stitchedSynodicStoreCoversSpan', 'activeSynodicFilterKeys', 'supportsSynodicFilterGroup',
  'synodicStitchRowKey', 'synodicRowFilterKey', 'hasActiveSynodicSources'];
const stitchNames = ['stitchRows', 'visiblePrependedRowCount'];
const declarations = (tree, names) => tree.statements.filter(node =>
  ts.isFunctionDeclaration(node) && names.includes(node.name?.text))
  .map(node => node.getText(tree).replace(/^export /, '')).join('\n');
const helperEnv = { SYNODIC_MIN_MONTH_INDEX: 12, SYNODIC_MAX_MONTH_INDEX: 119999, SPAN_EPSILON: 0.01 };
const helpers = new Function(...Object.keys(helperEnv), `${transpile(
  declarations(source, helperNames) + declarations(harnessSource, stitchNames))}
  return {${[...helperNames, ...stitchNames].join(',')}};`)(...Object.values(helperEnv));
const coordinatorJs = transpile(await readFile(new URL('../src/lib/table/retained-list-requests.ts', import.meta.url), 'utf8'));
const { createRetainedListRequests } = new Function('exports', `${coordinatorJs}\nreturn exports;`)({});
const ref = current => ({current});
// Accept a payload through the coordinator, as a finished replacement would.
const accept = (list, value) => { const r = list.replace(); r.publish(value); r.finish(); return value; };
const settle = () => new Promise(resolve => setImmediate(resolve));
const resident = (start, end = start + 1) => ({rows: [], coverage: {start, end},
  islandNonce: 0, optionsSeq: 0, filterKeys: [], exhaustedPrevious: false, exhaustedNext: false});
const payload = (fromDate, toDate) => ({rows: [], summary: '', truncated: false,
  meta: {fromDate, toDate, planetItems: [], lunarItems: [], activeIngressPlanetIds: [],
    activeSynodicPlanetIds: [], activeLunarCycleIds: []},
  cursor: {exhaustedPrevious: false, exhaustedNext: false}});
function harness({cached = null} = {}) {
  const requests = [], commits = [], errors = [], islandChanges = [];
  const env = {
    ...helperEnv, ...helpers, AbortController, queueMicrotask,
    React: {startTransition: run => run()},
    SYNODIC_STITCHED_CACHE: 'synodic', SYNODIC_SEED_MONTHS: 1, SYNODIC_STITCH_CHUNK_MONTHS: 1,
    requests: createRetainedListRequests(resident(24324, 24325)),
    scrollPlanRef: ref(null), pendingMonthJumpRef: ref(null), pendingReplacementFocusRef: ref(null),
    filterAnchorRef: ref(null),
    rowsRef: ref([]), scrollerRef: ref(null), rowHeightRef: ref(37),
    visibleMonthIndexRef: ref(24321), requestFocusDatetimeRef: ref('2026-10-01T12:00:00'),
    activeIngressPlanetIdsRef: ref([]), activeSynodicPlanetIdsRef: ref([]), activeLunarCycleIdsRef: ref([]),
    stitchKeyRef: ref('world'), stitchKey: 'world', activeFilterKey: '', optionsSeq: 0,
    island: {nonce: 1, bypassCache: false},
    documentId: 'doc', includeTemporal: false,
    synodicFocusCursorRowBudget: () => 8, synodicCursorRowBudget: () => 8,
    viewportSynodicFocusIso: () => '2030-01-14T12:00:00',
    getCachedListPayload: () => cached, rememberSynodicStitchStore: () => {},
    temporalCoverageBounds: () => null, mergeTemporalCoverageBounds: () => null,
    // Defer React commits: request authority must not wait for a render/effect.
    setStore: next => commits.push(next), setLoading: () => {}, setError: () => {},
    setRequestFocusDatetime: () => {}, setVisibleMonthIndex: () => {},
    setIsland: update => islandChanges.push(update(env.island)),
    setEdgeCheckNonce: () => {}, t: key => key,
    console: {error: (...args) => errors.push(args)},
    fetchSynodicChunk: params => new Promise(resolve => requests.push({params, resolve})),
  };
  env.ensureSourceWindowForFocus = callback('const desired = synodicSeedWindowForFocus', 'React.useCallback', env);
  return {env, requests, commits, errors, islandChanges,
    jump: delta => callback('const nextMonth = clampMonthIndex', 'React.useCallback', env)(delta),
    load: () => callback('const retainedStore', 'React.useEffect', env)(),
    extend: direction => callback('let span: SynodicSpan;', 'React.useCallback', env)(direction)};
}

test('Mercury-only filter after a resident calendar jump seeds the requested month', () => {
  const h = harness();
  // The jump stays within stitched coverage, so it changes focus without
  // opening a new island. The initial request seeded October 2026.
  accept(h.env.requests, { ...resident(24321, 24361), filterKey: 'all' });
  h.env.visibleMonthIndexRef.current = 2030 * 12 - 1;
  h.jump(1);
  assert.equal(h.islandChanges.length, 0);
  h.env.activeFilterKey = '2|2|';
  h.env.activeIngressPlanetIdsRef.current = [2];
  h.env.activeSynodicPlanetIdsRef.current = [2];
  h.load();
  const { span, cursorAnchorDate, ingressPlanetIds, synodicPlanetIds, lunarCycleIds } =
    h.requests[0].params;
  assert.deepEqual(helpers.monthSpanRange(span), {fromDate: '2030-01-01', toDate: '2030-01-31'});
  assert.equal(cursorAnchorDate, '2030-01-01');
  assert.deepEqual([ingressPlanetIds, synodicPlanetIds, lunarCycleIds], [[2], [2], []]);
});

test('options refresh and subsequent filter both seed around the viewport', async () => {
  const h = harness();
  h.env.optionsSeq = 1;
  h.load();
  const expectedSpan = {start: 2030 * 12, end: 2030 * 12 + 1};
  assert.deepEqual(h.requests[0].params.span, expectedSpan);
  assert.equal(h.requests[0].params.cursorAnchorDate, '2030-01-14');
  h.requests[0].resolve(payload('2030-01-01', '2030-01-31'));
  await settle();

  h.env.activeFilterKey = '2|2|';
  h.env.filterAnchorRef.current = '2030-01-19T06:15:00';
  h.load();
  assert.deepEqual(h.requests[1].params.span, expectedSpan);
  assert.equal(h.requests[1].params.cursorAnchorDate, '2030-01-19');
  assert.equal(h.commits.length, 1, 'the previous rows stay mounted until the new filter wins');
});

test('cursor seed dates preserve the civil month and four-digit year', () => {
  for (const [focus, fromDate, toDate] of [
    ['2030-01-01T00:30:00+14:00', '2030-01-01', '2030-01-31'],
    ['0096-02-29T12:00:00', '0096-02-01', '0096-02-29'],
  ]) {
    const span = helpers.synodicSeedWindowForFocus(focus, 1);
    assert.deepEqual(helpers.monthSpanRange(span), {fromDate, toDate});
  }
});

test('fresh replacement publishes its range before extension is released', async () => {
  const h = harness();
  h.load();
  h.requests[0].resolve(payload('2026-10-01', '2026-10-31'));
  await settle();
  h.extend('next');
  assert.deepEqual(h.requests[1].params.span, {start: 24322, end: 24323});
});

test('cached replacement publishes its range before extension is released', async () => {
  const h = harness({cached: resident(24321)});
  h.load();
  h.extend('next'); // Cache publication is still queued; old rows are not request authority.
  assert.equal(h.requests.length, 0);
  await settle();
  h.extend('next');
  assert.deepEqual(h.requests[0].params.span, {start: 24322, end: 24323});
});

test('consecutive extensions use accepted coverage before React commits', async () => {
  const h = harness();
  accept(h.env.requests, resident(24321));
  h.extend('next');
  h.requests[0].resolve(payload('2026-11-01', '2026-11-30'));
  await settle();
  h.extend('next');
  assert.deepEqual(h.requests[1].params.span, {start: 24323, end: 24324});
  assert.deepEqual(h.errors, []);
});

test('backward extension anchors inside the month before accepted coverage', () => {
  const h = harness();
  accept(h.env.requests, resident(2030 * 12));
  h.extend('previous');
  const {span, cursorAnchorDate} = h.requests[0].params;
  assert.deepEqual(helpers.monthSpanRange(span), {fromDate: '2029-12-01', toDate: '2029-12-31'});
  assert.equal(cursorAnchorDate, '2029-12-01');
});

test('late extension cannot stitch into a replacement island in the same request world', async () => {
  const h = harness();
  accept(h.env.requests, resident(24320));
  h.extend('next');
  const replacement = accept(h.env.requests, resident(24321));
  h.requests[0].resolve(payload('2027-02-01', '2027-02-28'));
  await settle();
  assert.deepEqual(h.errors, []);
  assert.equal(h.commits.length, 0);
  assert.equal(h.env.requests.accepted(), replacement);
});

test('aborted extension and old finalizer cannot publish or clear a newer request', async () => {
  const h = harness();
  accept(h.env.requests, resident(24320));
  h.extend('next');
  h.requests[0].params.signal.throwIfAborted();
  const replacement = accept(h.env.requests, resident(24321));
  assert.equal(h.requests[0].params.signal.aborted, true);
  h.extend('next');
  assert.equal(h.env.requests.extending, true);
  h.requests[0].resolve(payload('2027-02-01', '2027-02-28'));
  await settle();
  assert.equal(h.commits.length, 0);
  assert.equal(h.env.requests.extending, true, 'old finalizer cannot release the newer extension');
  assert.equal(h.env.requests.accepted(), replacement);
  assert.deepEqual(h.errors, []);
});
