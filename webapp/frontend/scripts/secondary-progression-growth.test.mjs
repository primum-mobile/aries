// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later
// Drives the real Progressions load/extend/prefetch callbacks against a fake
// daemon. A focus tick that re-runs the load effect aborts the running
// extension and republishes the identical cached store; React then skips the
// store-keyed effect, so growth must resume from the request owner's idle edge.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const read = (path) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');
const parse = (path) => ts.createSourceFile(path, read(path), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const source = parse('components/workshell/directions-view.tsx');
const harnessSource = parse('components/workshell/stitched-list-harness.ts');
const transpile = (code) => ts.transpileModule(code, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const { createRetainedListRequests } = new Function('exports',
  `${transpile(read('lib/table/retained-list-requests.ts'))}\nreturn exports;`)({});
const declarations = (tree, names) => tree.statements.filter((node) =>
  ts.isFunctionDeclaration(node) && names.includes(node.name?.text))
  .map((node) => node.getText(tree).replace(/^export /, '')).join('\n');
const helperNames = ['secondaryChunkYears', 'authoritativeTemporalCoverage', 'mergeContiguousTemporalCoverage',
  'secondaryStitchRowKey', 'spanFromSecondaryMeta', 'lastSecondaryRowAge', 'spanFromSecondaryPayload',
  'ageRangePageStartForAge', 'secondaryReloadPieces', 'replaceSecondaryRowsInSpan', 'reloadSecondarySpanInPlace',
  'cachedSecondaryStore', 'rememberStitchedSecondaryStore', 'secondaryStitchCacheKey', 'secondaryPiecesVisibleFirst',
  'createSecondaryRetry', 'completeCachedSecondaryStore', 'secondaryStoreComplete'];
// The panel's retained payload cache, shared across mounts like the real module.
const payloadCache = new Map();
const helpers = new Function('SECONDARY_STITCH_CHUNK_YEARS', 'AGE_RANGE_PAGE_SIZE', 'SPAN_EPSILON',
  'SECONDARY_RELOAD_EPSILON', 'SECONDARY_BOUNDARY_TOLERANCE_YEARS', 'SECONDARY_STITCHED_CACHE',
  'SECONDARY_RESIDENT_CACHE', 'SECONDARY_STITCH_CACHE_MAX_ROWS', 'getCachedListPayload', 'rememberListPayload',
  'stitchedStoreCoversFocus',
  `${transpile(declarations(source, helperNames) + declarations(harnessSource, ['stitchRows']))}
  return {${[...helperNames, 'stitchRows'].join(',')}};`)({ secondary: 10, tertiary: 1, minor: 0.5 }, 5, 0.01,
  1e-6, 0.01, 'stitched', 'resident', 25000,
  (namespace, key) => payloadCache.get(`${namespace}|${key}`) ?? null,
  (namespace, key, value) => payloadCache.set(`${namespace}|${key}`, value),
  (cached) => cached != null);

function callback(fragment, callName, env) {
  let found;
  (function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(source) === callName
      && node.arguments[0]?.getText(source).includes(fragment)) found = node;
    ts.forEachChild(node, visit);
  })(source);
  assert.ok(found, `mounted callback for ${fragment}`);
  const run = new Function(...Object.keys(env),
    `${transpile(`const run = ${found.arguments[0].getText(source)};`)}\nreturn run;`)(...Object.values(env));
  return { run, deps: found.arguments[1]?.getText(source) ?? '' };
}

const ref = (current) => ({ current });
const settle = () => new Promise((resolve) => setTimeout(resolve, 2));

/** Mount the panel's load/extend/prefetch callbacks. `seed` is a store a
 * (re)mount starts with, as the panel's useState/useRetainedListRequests do. */
/** The daemon's 409 for a document that now hosts another chart. */
class RadixRetargetError extends Error {}

function mountPanel({
  seed = null, state: sharedState = null, viewAges = null, restoreAnchor = null, targetDataKey = seed?.dataKey ?? null,
  realCache = false,
} = {}) {
  const fetches = [];
  const state = sharedState ?? {
    store: null, revised: false, loadingShown: 0, houseRows: 0, rowCap: Infinity, history: [],
    targets: [], retargets: 0, keyAt: null, retargetAt: null,
  };
  state.store = seed;
  const requests = createRetainedListRequests(seed);
  let storeChanged = false;
  const env = {
    ...helpers, requests, queueMicrotask,
    extendCooldownUntilRef: ref(0), scrollPlanRef: ref(null), worldKeyRef: ref('list'),
    selectedRolesRef: ref({ from: [], to: [] }), selectedAspectIdsRef: ref([]), stationsOnlyRef: ref(false),
    SECONDARY_STITCHED_CACHE: 'secondary', SECONDARY_STATION_FILTER_IDS: [true],
    // Warm cache: the remembered store is the very object already on screen.
    // A new data revision is a new cache key: nothing is remembered under it.
    getCachedListPayload: () => (state.revised ? null : state.store), stitchedStoreCoversFocus: (cached) => cached != null,
    island: { nonce: seed?.islandNonce ?? 1, window: null }, worldKey: 'list', targetDataKey,
    radixIdentityRef: ref(seed?.radixIdentity ?? null), islandLoadInFlightRef: ref(false), keyCheckPendingRef: ref(false),
    setKeyCheckNonce: () => {}, RadixRetargetError,
    setTargetDataKey: (key) => state.targets.push(key),
    restartReload: (key) => { state.targets.push(key); state.restarts = (state.restarts ?? 0) + 1; },
    retargetToLiveChart: () => { state.retargets += 1; },
    dataActiveRef: ref(state.active ?? true), reloadDeferredRef: ref(false), setReloadNonce: () => {},
    // The panel's backoff: scheduled retries are recorded; tests run them.
    reloadRetry: { schedule: (run) => { state.retries = (state.retries ?? 0) + 1; state.retry = run; return true; }, reset: () => { state.resets = (state.resets ?? 0) + 1; } },
    residentWorldRef: ref(seed ? 'list' : null), sourceName: 'Chart', source: undefined,
    loadEffectRanRef: ref(false), restoredViewportRef: ref(restoreAnchor),
    visibleRowsRef: ref(seed?.rows ?? []), scrollerRef: ref(null), rowHeightRef: ref(20),
    effectiveFocusDatetimeRef: ref('2026-10-24T14:51:00'),
    // The viewport's ages; the panel reads them from the scroller.
    secondaryReloadViewAges: (args) => {
      state.viewAgeArgs = args;
      return viewAges;
    },
    documentId: 'doc', method: 'secondary', directionMode: 'direct',
    requestFocusDatetime: '2026-10-24T14:51:00', includeTemporal: false,
    fetchSecondaryDirections: (_name, params) => new Promise((resolve, reject) => {
      const start = params.startAge ?? 37.67;
      const end = params.endAge ?? 39.67;
      fetches.push([start, end]);
      state.identities = [...(state.identities ?? []), params.radixIdentity ?? null];
      state.params = [...(state.params ?? []), params];
      if (state.retargetAt === fetches.length) {
        setTimeout(() => reject(new RadixRetargetError('radix-retarget')), 1);
        return;
      }
      if (state.failing?.(fetches.length, start)) {
        setTimeout(() => reject(new Error('secondary directions failed: 500')), 1);
        return;
      }
      // The daemon's content key; a revision serves another one, and a
      // scripted request may already see a newer one.
      const dataKey = state.keyAt?.[fetches.length] ?? (state.revised ? 'k2' : 'k1');
      let directions = [];
      for (let i = 0; i < state.houseRows; i += 1) {
        directions.push({ date: `h${i}@${start.toFixed(4)}`, age: start, prom: 'p', aspect: 'a', sig: 'cusp', fields: {} });
      }
      for (let age = Math.ceil(start * 4) / 4; age < end; age += 0.25) {
        directions.push({ date: `d${age.toFixed(2)}`, age, prom: 'p', aspect: 'a', sig: dataKey === 'k1' ? 's' : `s-${dataKey}`, fields: {} });
      }
      const truncated = directions.length > state.rowCap;
      if (truncated) directions = directions.slice(0, state.rowCap);
      setTimeout(() => resolve({ directions, dataKey, radixIdentity: 'radix-a',
        meta: { startAge: start, endAge: end, chunkYears: 10, referenceAge: 38.67, truncated } }), 1);
    }),
    setLoading: (on) => { if (on) state.loadingShown += 1; }, setError: () => {}, setAgeRangePageStart: () => {}, setRequestFocusDatetime: () => {},
    setIsland: () => {}, rememberStitchedSecondaryStore: () => {}, parseDateMs: () => 0, localWallclockIso: () => '',
    secondaryPointRolesMatch: () => true, secondaryStationFilterKey: () => false, console,
    // React bails out of a re-render for an identical store.
    setStore: (next) => {
      if (next !== state.store) { state.store = next; storeChanged = true; state.history.push(next); }
    },
  };
  // The panel's own cache functions (the payload cache shared across mounts).
  if (realCache) env.rememberStitchedSecondaryStore = helpers.rememberStitchedSecondaryStore;
  env.extendCoverage = callback('Coverage doubles per fetch', 'React.useCallback', env).run;
  const loadFragment = 'const request = requests.replace();\n    const firstRun';
  const load = callback(loadFragment, 'React.useEffect', env).run;
  // The load effect as React re-runs it with new state (key, nonce).
  const loadWith = (overrides) => callback(loadFragment, 'React.useEffect', { ...env, ...overrides }).run();
  const prefetch = callback('if (requests.busy) return;', 'React.useEffect', env);
  const runPrefetch = () => callback('if (requests.busy) return;', 'React.useEffect', { ...env, store: state.store }).run();
  // The prefetch effect re-runs on a store change, and on the idle edge only
  // when the component declares that dependency.
  let idle = !requests.busy;
  let idleChanged = false;
  requests.subscribe(() => {
    const next = !requests.busy;
    if (next !== idle) { idle = next; idleChanged = true; }
  });
  const usesIdle = /requestsIdle/.test(prefetch.deps);
  return {
    fetches, state, load, loadWith, requests, env,
    async run(ticks, { grow = true } = {}) {
      for (let i = 0; i < ticks; i += 1) {
        await settle();
        if (storeChanged || (usesIdle && idleChanged)) {
          storeChanged = idleChanged = false;
          if (grow) runPrefetch();
        }
      }
    },
  };
}

/** Run until the request owner is idle again (the reload has finished). */
async function untilIdle(panel, limit = 200) {
  for (let i = 0; i < limit && panel.requests.busy; i += 1) await panel.run(1, { grow: false });
  assert.equal(panel.requests.busy, false, 'the reload finished');
}

async function grownPanel() {
  payloadCache.clear();
  const panel = mountPanel();
  const cleanup = panel.load();
  await panel.run(80);
  cleanup();
  const before = panel.state.store;
  assert.ok(before.coverage.end - before.coverage.start > 20, 'the list grew past its first windows');
  return { panel, before };
}

const CHUNK = 10;
const spanOf = ([start, end]) => end - start;

test('progressions keep growing after a focus tick aborts the running extension', async () => {
  const panel = mountPanel();
  let cleanup = panel.load();
  await panel.run(4);
  assert.ok(panel.fetches.length >= 2, 'growth started before the tick');
  cleanup();
  cleanup = panel.load();
  await panel.run(80);
  const { coverage } = panel.state.store;
  assert.ok(coverage.start <= 18.67 + 0.01, `grew back toward birth: ${coverage.start}`);
  assert.ok(coverage.end >= 58.67 - 0.01, `grew forward: ${coverage.end}`);
  cleanup();
});

test('an options change reloads the loaded span in place, in chunks, visible first', async () => {
  const { panel, before } = await grownPanel();
  const fetchesBefore = panel.fetches.length;
  const loadingBefore = panel.state.loadingShown;
  // A house-system change: a new revision of the same list. House-cusp rows differ.
  panel.state.revised = true;
  panel.state.houseRows = 2;
  panel.state.history = [];
  const visible = { first: 47.5, last: 48.5 };
  const reloaded = mountPanel({ seed: before, state: panel.state, viewAges: visible, targetDataKey: 'k2' });
  reloaded.load();
  await untilIdle(reloaded);
  const requestsMade = reloaded.fetches;
  assert.ok(requestsMade.length > 1, 'the span reloads in several requests');
  for (const span of requestsMade) assert.ok(spanOf(span) <= CHUNK + 1e-9, `chunk-sized request: ${span}`);
  const [first] = requestsMade;
  assert.ok(first[0] <= visible.first && first[1] >= visible.last, `the visible ages load first: ${first}`);
  // Outward from the visible chunk: every request touches what is already reloaded.
  let lo = first[0];
  let hi = first[1];
  for (const [start, end] of requestsMade.slice(1)) {
    assert.ok(Math.abs(start - hi) < 1e-9 || Math.abs(end - lo) < 1e-9, `adjacent outward chunk: ${start}-${end}`);
    lo = Math.min(lo, start);
    hi = Math.max(hi, end);
  }
  assert.deepEqual([lo, hi], [before.coverage.start, before.coverage.end], 'exactly the loaded span reloads');
  // Until a chunk lands its resident rows stay on screen.
  const firstSwap = panel.state.history[0];
  assert.ok(firstSwap.rows.some((row) => row.sig === 's-k2' && row.age >= visible.first && row.age <= visible.last));
  assert.ok(firstSwap.rows.filter((row) => row.age < first[0] || row.age >= first[1]).every((row) => before.rows.includes(row)),
    'rows outside the first chunk are the resident ones');
  for (const store of panel.state.history) {
    assert.deepEqual(store.coverage, before.coverage, 'the loaded span never collapses to the first window');
    assert.equal(store.islandNonce, before.islandNonce, 'the viewport is not re-anchored');
  }
  const after = panel.state.store;
  assert.equal(after.meta.referenceAge, before.meta.referenceAge);
  assert.equal(after.dataKey, 'k2', 'the rows name the key they were reloaded under');
  assert.equal(after.rows.length, before.rows.length + 2 * requestsMade.length, 'changed rows are replaced');
  assert.ok(after.rows.filter((row) => row.sig !== 'cusp').every((row) => row.sig === 's-k2'), 'every row is the new revision');
  assert.equal(new Set(after.rows.map(helpers.secondaryStitchRowKey)).size, after.rows.length, 'no row is duplicated');
  assert.equal(panel.state.loadingShown, loadingBefore, 'no loading state over resident rows');
  assert.equal(panel.fetches.length, fetchesBefore, 'the old mount sent nothing more');
});

test('a reload whose chunks hit the row cap keeps the resident coverage', async () => {
  const { panel, before } = await grownPanel();
  panel.state.revised = true;
  // Fewer rows per response than a 10-year chunk holds (40 at 4 rows a year).
  panel.state.rowCap = 15;
  const reloaded = mountPanel({ seed: before, state: panel.state, viewAges: { first: 40, last: 40 }, targetDataKey: 'k2' });
  reloaded.load();
  await untilIdle(reloaded, 600);
  const after = panel.state.store;
  assert.deepEqual(after.coverage, before.coverage, 'coverage never shrinks below what was resident');
  assert.equal(after.coverageAuthoritative, true, 'every cut piece had its remainder read');
  assert.deepEqual(after.stalePieces, []);
  assert.ok(reloaded.fetches.some(([start], index) => index > 0 && start > reloaded.fetches[index - 1][0]
    && start < reloaded.fetches[index - 1][1]), 'a truncated chunk re-requests its remainder');
  assert.equal(after.rows.length, before.rows.length, 'every resident row is still there');
  assert.ok(after.rows.every((row) => row.sig === 's-k2'), 'every row was re-read');
});

test('a newer revision supersedes a reload in progress', async () => {
  const { panel, before } = await grownPanel();
  panel.state.revised = true;
  const reloaded = mountPanel({ seed: before, state: panel.state, viewAges: { first: 40, last: 40 }, targetDataKey: 'k2' });
  let cleanup = reloaded.load();
  await reloaded.run(2, { grow: false });
  const partial = panel.state.store;
  assert.ok(reloaded.requests.busy, 'still reloading');
  cleanup();
  cleanup = reloaded.load();
  await untilIdle(reloaded);
  assert.deepEqual(panel.state.store.coverage, before.coverage);
  assert.equal(panel.state.store.rows.length, partial.rows.length);
  cleanup();
});

test('a remount after a data change shows the last rows and reloads them in place', async () => {
  const { panel, before } = await grownPanel();
  // The panel remembers its rows under the revision and as the list's latest.
  payloadCache.clear();
  helpers.rememberStitchedSecondaryStore('list', before);
  // Another pane was showing while the options changed: a new revision key.
  const seed = helpers.cachedSecondaryStore('list', 'k2', '2026-10-24T14:51:00');
  assert.equal(seed, before, 'the remount seeds from the same list whatever its revision');
  assert.equal(helpers.cachedSecondaryStore('other', 'k2', '2026-10-24T14:51:00'), null);
  assert.equal(helpers.cachedSecondaryStore('list', 'k1', '2026-10-24T14:51:00'), before, 'exact key hit');
  panel.state.revised = true;
  panel.state.history = [];
  const loadingBefore = panel.state.loadingShown;
  const anchor = { scrollTop: 400, rowHeight: 20 };
  // The key check resolved the daemon's new key for this list.
  const remounted = mountPanel({ seed, state: panel.state, restoreAnchor: anchor, viewAges: { first: 30, last: 31 }, targetDataKey: 'k2' });
  remounted.load();
  assert.equal(panel.state.viewAgeArgs.restoreAnchor, anchor, 'the reload starts where the viewport is restored');
  assert.equal(panel.state.viewAgeArgs.measureScroller, false);
  await untilIdle(remounted);
  assert.equal(panel.state.loadingShown, loadingBefore, 'no loading state over the remounted rows');
  const [first] = remounted.fetches;
  assert.ok(first[0] <= 30 && first[1] >= 31, `the restored viewport reloads first: ${first}`);
  assert.ok(panel.state.history.every((store) => store.coverage.start === before.coverage.start
    && store.coverage.end === before.coverage.end && store.islandNonce === before.islandNonce),
    'no collapse to a first window and no re-anchoring');
  assert.ok(panel.state.store.rows.every((row) => row.sig === 's-k2'));
});

// Stations only (and other display filters) can leave too few rows to scroll,
// so no edge is ever reached. The filtered list must keep growing on its own
// until the viewport fills, keep following the viewer while scrolling, and
// stop once the viewer holds still.
const constantValue = (name) => {
  const match = new RegExp(`const ${name}(?::[^=]+)? = ([^;]+);`).exec(source.getText());
  assert.ok(match, name);
  return new Function(`return (${transpile(`(${match[1]})`).trim().replace(/;$/, '')});`)();
};
const FILL_YEARS = constantValue('SECONDARY_FILTERED_FILL_YEARS');
const fillHelpers = new Function('SECONDARY_FILTERED_REACH_EPSILON', 'SECONDARY_FILTERED_FILL_YEARS',
  `${transpile(declarations(source, ['secondaryVisibleAgeSpan', 'secondaryFilteredExtendDirection']))}
  return { secondaryVisibleAgeSpan, secondaryFilteredExtendDirection };`)(constantValue('SECONDARY_FILTERED_REACH_EPSILON'), FILL_YEARS);
function edgeCall() {
  let call;
  (function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(source) === 'useEdgeExtend'
      && node.arguments[0]?.getText(source).includes('extendFilteredCoverage')) call = node;
    ts.forEachChild(node, visit);
  })(source);
  assert.ok(call, 'progressions edge watcher');
  const props = Object.fromEntries(call.arguments[0].properties
    .filter((prop) => ts.isPropertyAssignment(prop))
    .map((prop) => [prop.name.getText(source), prop.initializer.getText(source)]));
  const names = ['canExtendBackward', 'canExtendForward', 'onExtend', 'fillViewport'];
  return new Function('store', 'filteredRows', 'extendCoverage', 'extendFilteredCoverage',
    `${transpile(`return { ${names.map((name) => `${name}: ${props[name]}`).join(', ')} };`)}`);
}
const edgeFunction = harnessSource.statements.find((node) =>
  ts.isFunctionDeclaration(node) && node.name?.text === 'useEdgeExtend');
const edgeJs = transpile(edgeFunction.getText(harnessSource).replace(/^export /, ''));
function runEdgeCheck(options) {
  const frames = [];
  const React = { useRef: (current) => ({ current }), useLayoutEffect: (run) => run(), useEffect: (run) => run() };
  const hook = new Function('React', 'requestAnimationFrame', 'cancelAnimationFrame', 'recordChartPerf', 'perfNow',
    `${edgeJs}; return useEdgeExtend;`)(React, (run) => { frames.push(run); return frames.length; }, () => {}, () => {}, () => 0);
  hook(options);
  for (const run of frames) run();
}

test('an unfilled viewport grows backward first, then forward', () => {
  const calls = [];
  const scroller = { scrollTop: 0, scrollHeight: 100, clientHeight: 400, dataset: {}, addEventListener() {}, removeEventListener() {} };
  const base = { scrollerRef: { current: scroller }, rowCount: 3, thresholdPx: 60, onExtend: (d) => calls.push(d) };
  runEdgeCheck({ ...base, canExtendBackward: true, canExtendForward: true, fillViewport: true });
  runEdgeCheck({ ...base, canExtendBackward: false, canExtendForward: true, fillViewport: true });
  runEdgeCheck({ ...base, canExtendBackward: true, canExtendForward: true, fillViewport: false });
  runEdgeCheck({ ...base, rowCount: 0, canExtendBackward: true, canExtendForward: true, fillViewport: true });
  assert.deepEqual(calls, ['previous', 'next', 'previous']);
});

test('a short list grows toward the edge the viewer is nearer', () => {
  const calls = [];
  const at = (scrollTop) => ({ scrollTop, scrollHeight: 820, clientHeight: 400, dataset: {}, addEventListener() {}, removeEventListener() {} });
  const base = { rowCount: 41, thresholdPx: 600, canExtendBackward: true, canExtendForward: true, onExtend: (d) => calls.push(d) };
  runEdgeCheck({ ...base, scrollerRef: { current: at(420) } });
  runEdgeCheck({ ...base, scrollerRef: { current: at(0) } });
  runEdgeCheck({ ...base, scrollerRef: { current: at(300) }, canExtendForward: false });
  assert.deepEqual(calls, ['next', 'previous', 'previous']);
});

test('the filtered reach is fixed in years, whatever the fetch chunk', () => {
  const { secondaryFilteredExtendDirection: pick } = fillHelpers;
  // An unfilled viewport loads past the per-method reach, up to the lifetime fill bound.
  const unfilled = { overflow: false, firstVisibleAge: null, lastVisibleAge: null, center: 40, reachYears: 10 };
  assert.equal(pick('previous', { ...unfilled, coverage: { start: 25, end: 55 } }), 'previous');
  // Backward exhausted at birth: an unfilled viewport turns to the other side.
  assert.equal(pick('previous', { ...unfilled, coverage: { start: 0, end: 55 } }), 'next');
  assert.equal(pick('next', { ...unfilled, coverage: { start: 0, end: 40 + FILL_YEARS } }), null);
  // A scrollable list follows the visible rows past the centre's reach.
  const scrolled = { overflow: true, firstVisibleAge: 48, lastVisibleAge: 49, center: 40, reachYears: 10 };
  assert.equal(pick('next', { ...scrolled, coverage: { start: 30, end: 55 } }), 'next');
  assert.equal(pick('next', { ...scrolled, coverage: { start: 30, end: 59 } }), null);
  // A side at its reach hands over to the other (a short list is near both
  // edges), and both stay bounded.
  assert.equal(pick('previous', { ...scrolled, coverage: { start: 30, end: 55 } }), 'next');
  assert.equal(pick('previous', { ...scrolled, coverage: { start: 30, end: 59 } }), null);
});

async function stationPanel({ method, chunkYears, stationEveryYears }) {
  const fetches = [];
  const state = { store: null };
  const requests = createRetainedListRequests(null);
  let storeChanged = false;
  const isStation = (row) => row.isStation === true;
  const env = {
    ...helpers, ...fillHelpers, requests, queueMicrotask,
    extendCooldownUntilRef: ref(0), scrollPlanRef: ref(null),
    selectedRolesRef: ref({ from: [], to: [] }), selectedAspectIdsRef: ref([]), stationsOnlyRef: ref(true),
    SECONDARY_STITCHED_CACHE: 'secondary', SECONDARY_STATION_FILTER_IDS: [true],
    SECONDARY_FILTERED_REACH_YEARS: constantValue('SECONDARY_FILTERED_REACH_YEARS'),
    getCachedListPayload: () => null, stitchedStoreCoversFocus: () => false,
    island: { nonce: 1, window: null }, worldKey: 'list', residentWorldRef: ref(null), sourceName: 'Chart', source: undefined,
    targetDataKey: null, setTargetDataKey: () => {}, retargetToLiveChart: () => {}, RadixRetargetError,
    restartReload: () => {}, dataActiveRef: ref(true), reloadDeferredRef: ref(false), setReloadNonce: () => {},
    reloadRetry: { schedule: () => false, reset: () => {} },
    radixIdentityRef: ref(null), islandLoadInFlightRef: ref(false), keyCheckPendingRef: ref(false), setKeyCheckNonce: () => {},
    worldKeyRef: ref('list'), loadEffectRanRef: ref(false), restoredViewportRef: ref(null),
    effectiveFocusDatetimeRef: ref('2026-10-24T14:51:00'), secondaryReloadViewAges: () => null,
    documentId: 'doc', method, directionMode: 'direct',
    requestFocusDatetime: '2026-10-24T14:51:00', includeTemporal: false,
    fetchSecondaryDirections: (_name, params) => new Promise((resolve) => {
      const start = params.startAge ?? 38.57;
      const end = params.endAge ?? 38.77;
      fetches.push([start, end]);
      const directions = [];
      const step = stationEveryYears / 4;
      for (let k = Math.ceil(start / step); k * step < end; k += 1) {
        const age = k * step;
        directions.push({ date: `d${age.toFixed(4)}`, age, prom: 'p', aspect: 'a', sig: 's', fields: {},
          isStation: k % 4 === 0 && age > 0 });
      }
      setTimeout(() => resolve({ directions, meta: { startAge: start, endAge: end, chunkYears, referenceAge: 38.67, truncated: false } }), 1);
    }),
    setLoading: () => {}, setError: () => {}, setAgeRangePageStart: () => {}, setRequestFocusDatetime: () => {},
    setIsland: () => {}, rememberStitchedSecondaryStore: () => {}, parseDateMs: () => 0, localWallclockIso: () => '',
    secondaryPointRolesMatch: () => true, secondaryStationFilterKey: isStation, console,
    setStore: (next) => { if (next !== state.store) { state.store = next; storeChanged = true; } },
  };
  const rowHeight = 20;
  const scroller = { scrollTop: 0, scrollHeight: 0, clientHeight: 400, dataset: {}, addEventListener() {}, removeEventListener() {} };
  env.scrollerRef = ref(scroller);
  env.rowHeightRef = ref(rowHeight);
  env.visibleRowsRef = ref([]);
  env.extendCoverage = callback('Coverage doubles per fetch', 'React.useCallback', env).run;
  env.extendFilteredCoverage = callback('secondaryFilteredExtendDirection(direction', 'React.useCallback', env).run;
  const load = callback('const request = requests.replace();\n    const firstRun', 'React.useEffect', env).run;
  const flags = edgeCall();
  let follow = null;
  const tick = () => {
    const store = state.store;
    if (!store) return;
    callback('if (requests.busy) return;', 'React.useEffect', { ...env, store }).run();
    const visible = store.rows.filter(isStation);
    env.visibleRowsRef.current = visible;
    scroller.scrollHeight = visible.length * rowHeight;
    // The panel's prepend compensation keeps the same rows under the viewport.
    const plan = env.scrollPlanRef.current;
    if (plan?.kind === 'prepend') {
      env.scrollPlanRef.current = null;
      scroller.scrollTop += plan.count * rowHeight;
    }
    scroller.scrollTop = Math.min(scroller.scrollTop, Math.max(0, scroller.scrollHeight - scroller.clientHeight));
    if (follow === 'bottom') scroller.scrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    runEdgeCheck({ scrollerRef: { current: scroller }, rowCount: visible.length, thresholdPx: rowHeight * 30,
      recheckToken: undefined, ...flags(store, true, env.extendCoverage, env.extendFilteredCoverage) });
  };
  const cleanup = load();
  const run = async (ticks) => {
    for (let i = 0; i < ticks; i += 1) {
      await settle();
      if (storeChanged || !requests.busy) { storeChanged = false; tick(); }
    }
  };
  return { fetches, state, cleanup, run, isStation, scroller, followBottom: () => { follow = 'bottom'; }, hold: () => { follow = null; } };
}

test('stations only fills an unfilled viewport around the focus and stops at the reach', async () => {
  const panel = await stationPanel({ method: 'secondary', chunkYears: 10, stationEveryYears: 9 });
  await panel.run(400);
  const { coverage, rows } = panel.state.store;
  assert.ok(coverage.start <= 0.01, `stations before the focus load back to birth: ${coverage.start}`);
  assert.ok(coverage.end >= 38.67 + FILL_YEARS - 0.01, `stations after the focus load forward: ${coverage.end}`);
  assert.ok(coverage.end <= 38.67 + FILL_YEARS + 10 + 0.01, `growth stops at the fill bound: ${coverage.end}`);
  assert.ok(rows.filter(panel.isStation).some((row) => row.age < 20), 'early stations are present');
  const settled = panel.fetches.length;
  await panel.run(40);
  assert.equal(panel.fetches.length, settled, 'no further fetches once the reach is covered');
  panel.cleanup();
});

for (const [method, chunkYears] of [['tertiary', 1], ['minor', 0.5], ['tertiary', 0.0748]]) {
  test(`${method} stations keep loading while the viewer scrolls (chunk ${chunkYears} y)`, async () => {
    const panel = await stationPanel({ method, chunkYears, stationEveryYears: 0.5 });
    await panel.run(300);
    const reach = constantValue('SECONDARY_FILTERED_REACH_YEARS')[method];
    const first = panel.state.store.coverage;
    assert.ok(panel.scroller.scrollHeight > panel.scroller.clientHeight, 'the stations fill the viewport');
    assert.ok(first.start <= 38.67 - reach / 2, `loaded before the focus: ${first.start}`);
    // Scroll to the end and keep reading: coverage follows past the first reach.
    panel.followBottom();
    await panel.run(600);
    const scrolled = panel.state.store.coverage;
    assert.ok(scrolled.end >= 38.67 + reach * 3, `no stall at the first reach: ${scrolled.end}`);
    // Holding still stops the growth once the reach past the viewport is loaded.
    panel.hold();
    let held = -1;
    for (let round = 0; round < 80 && held !== panel.fetches.length; round += 1) {
      held = panel.fetches.length;
      await panel.run(40);
    }
    assert.equal(panel.fetches.length, held, 'a still viewport stops fetching');
    const { rows, coverage } = panel.state.store;
    const lastVisibleAge = rows.filter(panel.isStation).at(-1).age;
    assert.ok(coverage.end <= lastVisibleAge + reach + chunkYears + 0.01, `bounded past the viewport: ${coverage.end}`);
    panel.cleanup();
  });
}

test('tertiary stations about a year apart fill the panel instead of stopping at the scroll reach', async () => {
  // The reported case: ~1 station a year, 16 rows within ±10 y, a 20-row panel.
  const panel = await stationPanel({ method: 'tertiary', chunkYears: 1, stationEveryYears: 1.25 });
  await panel.run(400);
  const { coverage } = panel.state.store;
  assert.ok(panel.scroller.scrollHeight > panel.scroller.clientHeight, 'the stations fill the panel');
  assert.ok(coverage.start < 38.67 - 10 || coverage.end > 38.67 + 10,
    `loaded past the ±10 y scroll reach: ${coverage.start}-${coverage.end}`);
  let held = -1;
  for (let round = 0; round < 80 && held !== panel.fetches.length; round += 1) {
    held = panel.fetches.length;
    await panel.run(40);
  }
  assert.equal(panel.fetches.length, held, 'a filled, still panel stops fetching');
  panel.cleanup();
});

test('the first open sends exactly one request', async () => {
  const focus = '2026-10-24T14:51:00';
  const islands = [];
  const panel = mountPanel();
  const effectEnv = {
    requests: panel.requests, queueMicrotask, initialMethod: 'secondary', effectiveFocusDatetime: focus,
    seededInitialMethodRef: ref('secondary'), effectiveFocusDatetimeRef: ref(focus),
    // A fresh mount requests the current focus, on the focus island.
    requestFocusDatetimeRef: ref(focus), islandRef: ref({ nonce: 0, window: null }),
    rowDateRangeMs: () => null, dateRangeCoversFocusDate: () => false,
    setMethod: () => {}, setDirectionMode: () => {}, setTodayFocusMs: () => {}, setTargetAgeRange: () => {},
    setTargetAgeSeek: () => {}, setAgeRangePageStart: () => {},
    setRequestFocusDatetime: (update) => islands.push(['focus', typeof update === 'function' ? update(focus) : update]),
    setIsland: (update) => islands.push(['island', update]),
  };
  const methodEffect = callback('seededInitialMethodRef.current === initialMethod', 'React.useEffect', effectEnv).run;
  const focusEffect = callback('requestFocusDatetimeRef.current === effectiveFocusDatetime', 'React.useEffect', effectEnv).run;
  // Mount order: the method and focus effects, then the load effect.
  methodEffect();
  focusEffect();
  panel.load();
  await panel.run(3, { grow: false });
  assert.deepEqual(islands, [], 'neither effect restarts the first request');
  assert.equal(panel.fetches.length, 1, 'exactly one request on open');
  // A later focus move outside the rows still starts its own island.
  const moved = callback('requestFocusDatetimeRef.current === effectiveFocusDatetime', 'React.useEffect',
    { ...effectEnv, effectiveFocusDatetime: '2040-01-01T00:00:00' }).run;
  moved();
  await settle();
  assert.ok(islands.some(([kind]) => kind === 'island'), 'a moved focus still re-seeds');
});

test('rows already under the key the list shows send no request', async () => {
  const { panel, before } = await grownPanel();
  assert.equal(before.dataKey, 'k1');
  assert.equal(before.radixIdentity, 'radix-a');
  const remounted = mountPanel({ seed: before, state: panel.state, targetDataKey: 'k1' });
  remounted.load();
  await remounted.run(3, { grow: false });
  assert.equal(remounted.fetches.length, 0);
  assert.equal(remounted.requests.busy, false, 'the resident rows are accepted as they are');
  assert.equal(panel.state.store, before);
});

test('a chunk built under a newer key restarts the reload instead of mixing rows', async () => {
  const { panel, before } = await grownPanel();
  panel.state.revised = true;
  panel.state.targets = [];
  // The second reload request already sees the next revision.
  panel.state.keyAt = { 2: 'k3' };
  const reloaded = mountPanel({ seed: before, state: panel.state, viewAges: { first: 40, last: 40 }, targetDataKey: 'k2' });
  reloaded.load();
  await reloaded.run(6, { grow: false });
  assert.deepEqual(panel.state.targets, ['k3'], 'the reload hands over to the newer key');
  assert.equal(reloaded.requests.busy, false);
  assert.equal(reloaded.fetches.length, 2, 'no further chunk of the older key');
  const rows = panel.state.store.rows;
  assert.ok(!rows.some((row) => row.sig === 's-k3'), 'no row of the newer key is mixed in');
  const partial = panel.state.store;
  assert.equal(partial.dataKey, 'k2');
  assert.ok(partial.stalePieces.length > 0, 'the unreloaded pieces are named stale, not relabelled');
  for (const row of partial.rows) {
    const stale = partial.stalePieces.some((piece) => row.age >= piece.lower && row.age < piece.upper);
    assert.equal(row.sig === 's-k2', !stale, `row ${row.date} is labelled by the key it was loaded under`);
  }
  panel.state.keyAt = null;
});

test('reload requests carry the radix identity and a 409 re-targets to the live chart', async () => {
  const { panel, before } = await grownPanel();
  panel.state.revised = true;
  panel.state.retargets = 0;
  panel.state.identities = [];
  panel.state.retargetAt = 1;
  const reloaded = mountPanel({ seed: before, state: panel.state, viewAges: { first: 40, last: 40 }, targetDataKey: 'k2' });
  reloaded.load();
  await reloaded.run(4, { grow: false });
  assert.deepEqual(panel.state.identities, ['radix-a']);
  assert.equal(panel.state.retargets, 1, 'the pane re-targets instead of showing an error');
  assert.deepEqual(panel.state.store.rows, before.rows, 'no rows of the other chart are mixed in');
  panel.state.retargetAt = null;
});

// The key check: a data revision asks the daemon for the list's current key
// without rows; only a key other than the one on screen reloads.
function keyWatcher({ resident = null, serverKey = 'k1', retarget = false, islandInFlight = false, active = true, failures = 0 } = {}) {
  const calls = [];
  const state = { target: resident?.dataKey ?? null, retargets: 0, pending: false };
  const requests = createRetainedListRequests(resident);
  const env = {
    requests, keyCheckRef: ref(null), islandLoadInFlightRef: ref(islandInFlight), keyCheckPendingRef: ref(false),
    radixIdentityRef: ref(null), documentId: 'doc', source: undefined, sourceName: 'Chart', RadixRetargetError,
    AbortController, console: { warn: () => {} },
    dataActiveRef: ref(active), keyCheckDeferredRef: ref(false), reloadDeferredRef: ref(false),
    setReloadNonce: () => { state.reloadNudges = (state.reloadNudges ?? 0) + 1; },
    keyCheckRetry: {
      schedule: (run) => { state.keyRetries = (state.keyRetries ?? 0) + 1; state.keyRetry = run; return true; },
      reset: () => { state.keyResets = (state.keyResets ?? 0) + 1; },
    },
    fetchSecondaryDirectionsDataKey: (_name, params) => {
      calls.push(params);
      const failing = calls.length <= failures;
      return new Promise((resolve, reject) => setTimeout(() => (retarget
        ? reject(new RadixRetargetError('radix-retarget'))
        : failing ? reject(new Error('data key failed: 500'))
        : resolve({ dataKey: state.serverKey ?? serverKey, optionsDataKey: 'o', radixIdentity: 'radix-a' })), 1));
    },
    setTargetDataKey: (update) => { state.target = typeof update === 'function' ? update(state.target) : update; state.sets = (state.sets ?? 0) + 1; },
    retargetToLiveChart: () => { state.retargets += 1; },
  };
  const run = (deps) => callback('First knowledge of the options key', 'React.useEffect',
    { ...env, optionsDataKey: 'o1', radixRefreshSeq: 1, keyCheckNonce: 0, ...deps }).run();
  return { calls, state, run, env };
}

test('an options change whose list key is unchanged reloads nothing', async () => {
  const resident = { rows: [], coverage: { start: 30, end: 50 }, islandNonce: 1, meta: {}, dataKey: 'k1', radixIdentity: 'radix-a' };
  const watcher = keyWatcher({ resident, serverKey: 'k1' });
  watcher.run({ optionsDataKey: 'o1' });
  await settle();
  // A different options key that leaves the daemon's dataKey as it is.
  watcher.run({ optionsDataKey: 'o2' });
  await settle();
  assert.equal(watcher.calls.length, 2, 'one cheap key request per real change');
  assert.equal(watcher.calls[0].radixIdentity, 'radix-a', 'the key check names the chart on screen');
  assert.equal(watcher.state.target, 'k1', 'the list keeps showing its rows');
  // Same key ⇒ the load effect finds the resident rows current: no row request.
  const { panel, before } = await grownPanel();
  const remounted = mountPanel({ seed: before, state: panel.state, targetDataKey: watcher.state.target });
  remounted.load();
  await remounted.run(3, { grow: false });
  assert.equal(remounted.fetches.length, 0);
});

test('a changed key reloads, and first knowledge of the options key does not', async () => {
  const resident = { rows: [], coverage: { start: 30, end: 50 }, islandNonce: 1, meta: {}, dataKey: 'k1', radixIdentity: 'radix-a' };
  const watcher = keyWatcher({ resident, serverKey: 'k2' });
  watcher.run({ optionsDataKey: null });
  await settle();
  assert.equal(watcher.state.target, 'k2', 'a remount checks the key of the rows it shows');
  const calls = watcher.calls.length;
  watcher.run({ optionsDataKey: 'o1' });
  await settle();
  assert.equal(watcher.calls.length, calls, 'the options key arriving for the first time is not a change');
  watcher.run({ optionsDataKey: 'o1', radixRefreshSeq: 2 });
  await settle();
  assert.equal(watcher.calls.length, calls + 1, 'a radix revision checks the key');
});

test('a rectification token and its daemon echo reload the list once', async () => {
  const resident = { rows: [], coverage: { start: 30, end: 50 }, islandNonce: 1, meta: {}, dataKey: 'k1', radixIdentity: 'radix-a' };
  const watcher = keyWatcher({ resident, serverKey: 'k2' });
  watcher.run({ radixRefreshSeq: 5 });
  await settle();
  watcher.state.sets = 0;
  const changes = [];
  const set = watcher.env.setTargetDataKey;
  watcher.env.setTargetDataKey = (update) => {
    const before = watcher.state.target;
    set(update);
    if (watcher.state.target !== before) changes.push(watcher.state.target);
  };
  watcher.run({ radixRefreshSeq: -1 }); // the local token
  await settle();
  watcher.run({ radixRefreshSeq: 6 }); // the echo, had it not been held back
  await settle();
  assert.deepEqual(changes, [], 'both resolve the same key: no second reload');
  assert.equal(watcher.state.target, 'k2');
});

test('a key check during a first load waits for it, and a 409 re-targets', async () => {
  const cold = keyWatcher({ resident: null });
  cold.run({});
  assert.equal(cold.calls.length, 0, 'the first open sends only its rows request');
  assert.equal(cold.env.keyCheckPendingRef.current, false);
  cold.run({ radixRefreshSeq: 2 });
  assert.equal(cold.env.keyCheckPendingRef.current, true, 'checked once the rows land');
  const resident = { rows: [], coverage: { start: 30, end: 50 }, islandNonce: 1, meta: {}, dataKey: 'k1', radixIdentity: 'radix-a' };
  const moved = keyWatcher({ resident, retarget: true });
  moved.run({});
  await settle();
  assert.equal(moved.state.retargets, 1);
});

const staleRow = (store, row) => store.stalePieces.some((piece) => row.age >= piece.lower && row.age < piece.upper);

test('a reload piece that fails keeps exact rows, retries with backoff, then completes', async () => {
  const { panel, before } = await grownPanel();
  panel.state.revised = true;
  panel.state.retries = 0;
  // The daemon fails every request after the first one for a while.
  let down = true;
  panel.state.failing = (index) => down && index >= 2;
  const reloaded = mountPanel({ seed: before, state: panel.state, viewAges: { first: 40, last: 40 }, targetDataKey: 'k2' });
  reloaded.load();
  await reloaded.run(10, { grow: false });
  assert.equal(reloaded.fetches.length, 2, 'the chain stops at the failure: no request without progress');
  assert.equal(panel.state.retries, 1, 'one retry is scheduled, with backoff');
  assert.equal(reloaded.requests.busy, false);
  const failed = panel.state.store;
  assert.equal(failed.dataKey, 'k2');
  assert.ok(failed.stalePieces.length > 0);
  for (const row of failed.rows) assert.equal(row.sig === 's-k2', !staleRow(failed, row), 'rows are exact about their key');
  // While still failing, a retry resumes only the stale pieces and stops again.
  reloaded.load();
  await reloaded.run(10, { grow: false });
  assert.equal(reloaded.fetches.length, 3, 'one request per retry while the daemon fails');
  assert.equal(panel.state.retries, 2);
  // The daemon answers again: the next retry completes the reload in place.
  down = false;
  const resumedFrom = reloaded.fetches.length;
  reloaded.load();
  await untilIdle(reloaded);
  const done = panel.state.store;
  assert.deepEqual(done.stalePieces, []);
  assert.deepEqual(done.coverage, before.coverage);
  assert.ok(done.rows.every((row) => row.sig === 's-k2'), 'every row is the new key');
  assert.ok(reloaded.fetches.length - resumedFrom <= failed.stalePieces.length + 1, 'only the stale pieces are re-requested');
  assert.equal(panel.state.retries, 2, 'a complete reload schedules nothing more');
  panel.state.failing = null;
});

test('an extension that meets a newer key restarts the reload once, with the real effect order', async () => {
  const { panel } = await grownPanel();
  const base = panel.state.store;
  panel.state.restarts = 0;
  panel.state.revised = true; // the daemon has moved on to k2
  const mounted = mountPanel({ seed: base, state: panel.state, targetDataKey: 'k1' });
  // restartReload sets the key and bumps the nonce: React re-runs the load
  // effect with the new key, which reloads the span in place.
  let cleanup = mounted.load();
  mounted.env.restartReload = (key) => {
    panel.state.restarts += 1;
    queueMicrotask(() => { cleanup(); cleanup = mounted.loadWith({ targetDataKey: key }); });
  };
  mounted.env.extendCoverage = callback('Coverage doubles per fetch', 'React.useCallback', mounted.env).run;
  await mounted.run(3, { grow: false });
  mounted.env.extendCoverage('next');
  await untilIdle(mounted);
  await mounted.run(1, { grow: false });
  await untilIdle(mounted);
  assert.equal(panel.state.restarts, 1, 'one restart for the newer key');
  const after = panel.state.store;
  assert.equal(after.dataKey, 'k2');
  assert.deepEqual(after.stalePieces, []);
  assert.deepEqual(after.coverage, base.coverage, 'the newer chunk was never stitched onto older rows');
  // Growth resumes under the new key and never meets the mismatch again.
  const sent = mounted.fetches.length;
  mounted.env.extendCoverage('next');
  await untilIdle(mounted);
  assert.equal(mounted.fetches.length, sent + 1);
  assert.equal(panel.state.restarts, 1, 'no second restart: no request without progress');
  assert.ok(panel.state.store.coverage.end > base.coverage.end, 'it grew');
  cleanup();
});

test('stale pieces are re-requested through the real cache, after a failure and after a remount', async () => {
  const { panel, before } = await grownPanel();
  payloadCache.clear();
  panel.state.revised = true;
  panel.state.retries = 0;
  let down = true;
  panel.state.failing = (index) => down && index >= 2;
  const reloaded = mountPanel({ seed: before, state: panel.state, viewAges: { first: 40, last: 40 }, targetDataKey: 'k2', realCache: true });
  reloaded.load();
  await untilIdle(reloaded);
  const failed = panel.state.store;
  assert.ok(failed.stalePieces.length > 0);
  assert.equal(helpers.completeCachedSecondaryStore('list', 'k2'), null, 'a stale store never answers for its key');
  // The retry: the load effect re-runs and must not be served the stale store.
  down = false;
  const sent = reloaded.fetches.length;
  reloaded.loadWith({ targetDataKey: 'k2' });
  await untilIdle(reloaded);
  assert.equal(reloaded.fetches.length - sent, failed.stalePieces.length, 'exactly the stale pieces');
  assert.deepEqual(panel.state.store.stalePieces, []);
  assert.ok(panel.state.store.rows.every((row) => row.sig === 's-k2'));
  assert.equal(helpers.completeCachedSecondaryStore('list', 'k2'), panel.state.store, 'complete: now cached for its key');
  // A remount after a failure: the stale rows seed the screen and are resumed.
  payloadCache.clear();
  panel.state.revised = false;
  const grown = await grownPanel();
  payloadCache.clear();
  grown.panel.state.revised = true;
  let failing = true;
  grown.panel.state.failing = (index) => failing && index >= 2;
  const first = mountPanel({ seed: grown.before, state: grown.panel.state, viewAges: { first: 40, last: 40 }, targetDataKey: 'k2', realCache: true });
  first.load();
  await untilIdle(first);
  const seed = helpers.cachedSecondaryStore('list', 'k2', '2026-10-24T14:51:00');
  assert.ok(seed && seed.stalePieces.length > 0, 'the remount seeds from the stale rows');
  failing = false;
  const remounted = mountPanel({ seed, state: grown.panel.state, viewAges: { first: 40, last: 40 }, targetDataKey: 'k2', realCache: true });
  remounted.load();
  await untilIdle(remounted);
  assert.equal(remounted.fetches.length, seed.stalePieces.length);
  assert.deepEqual(grown.panel.state.store.stalePieces, []);
  assert.ok(grown.panel.state.store.rows.every((row) => row.sig === 's-k2'));
});

test('a truncated piece that makes no progress stays stale and is not re-requested in a loop', async () => {
  const { panel, before } = await grownPanel();
  panel.state.revised = true;
  panel.state.retries = 0;
  // More rows at the very start of the visible piece than one response holds.
  panel.state.houseRows = 4;
  panel.state.rowCap = 3;
  const reloaded = mountPanel({ seed: before, state: panel.state, viewAges: { first: 40, last: 40 }, targetDataKey: 'k2' });
  reloaded.load();
  await untilIdle(reloaded, 400);
  const pieces = reloaded.fetches.length;
  const after = panel.state.store;
  assert.ok(after.stalePieces.length > 0, 'the unread pieces are named stale');
  assert.equal(after.dataKey, 'k2');
  for (const row of after.rows) assert.equal(row.sig === 's-k2' || row.sig === 'cusp', !staleRow(after, row));
  assert.equal(panel.state.retries, 1, 'one backoff retry, not an immediate re-request');
  await reloaded.run(20, { grow: false });
  assert.equal(reloaded.fetches.length, pieces, 'no request until the retry fires');
  // The retry re-requests exactly the stale pieces.
  reloaded.load();
  await untilIdle(reloaded, 400);
  assert.equal(reloaded.fetches.length - pieces, after.stalePieces.length);
  panel.state.houseRows = 0;
  panel.state.rowCap = Infinity;
});

test('a hidden pane sends nothing on a key change and reloads in place once on activation', async () => {
  const { panel, before } = await grownPanel();
  panel.state.revised = true;
  panel.state.active = false;
  const loadingBefore = panel.state.loadingShown;
  const hidden = mountPanel({ seed: before, state: panel.state, viewAges: { first: 40, last: 40 }, targetDataKey: 'k2' });
  hidden.load();
  await hidden.run(5);
  assert.equal(hidden.fetches.length, 0, 'no reload and no growth while hidden');
  assert.equal(hidden.requests.busy, false);
  assert.equal(panel.state.store, before, 'the rows stay as they are');
  // The key check is deferred the same way.
  const resident = { ...before };
  const watcher = keyWatcher({ resident, serverKey: 'k2', active: false });
  watcher.run({ radixRefreshSeq: 9 });
  await settle();
  assert.equal(watcher.calls.length, 0);
  assert.equal(watcher.env.keyCheckDeferredRef.current, true);
  // Activation: one in-place reload, no loading state, same span.
  panel.state.active = true;
  const shown = mountPanel({ seed: before, state: panel.state, viewAges: { first: 40, last: 40 }, targetDataKey: 'k2' });
  shown.load();
  await untilIdle(shown);
  assert.ok(shown.fetches.length > 0);
  assert.deepEqual(panel.state.store.coverage, before.coverage);
  assert.ok(panel.state.store.rows.every((row) => row.sig === 's-k2'));
  assert.equal(panel.state.loadingShown, loadingBefore);
});

test('a failed key check retries with backoff and converges once the daemon answers', async () => {
  const resident = { rows: [], coverage: { start: 30, end: 50 }, islandNonce: 1, meta: {}, dataKey: 'k1', stalePieces: [], radixIdentity: 'radix-a' };
  const watcher = keyWatcher({ resident, serverKey: 'k2', failures: 1 });
  watcher.run({ radixRefreshSeq: 3 });
  await settle();
  assert.equal(watcher.state.target, 'k1', 'the rows on screen stay');
  assert.equal(watcher.state.keyRetries, 1, 'a retry is scheduled');
  // The retry bumps the check nonce.
  watcher.run({ radixRefreshSeq: 3, keyCheckNonce: 1 });
  await settle();
  assert.equal(watcher.state.target, 'k2');
  assert.equal(watcher.state.keyRetries, 1);
  assert.ok(watcher.state.keyResets >= 1, 'success resets the backoff');
});

test('the retry budget is bounded and backs off', async () => {
  const retry = helpers.createSecondaryRetry(3, 2);
  const runs = [];
  const started = Date.now();
  for (let i = 0; i < 6; i += 1) {
    retry.schedule(() => runs.push(Date.now() - started));
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(runs.length, 3, 'at most the budget');
  assert.equal(retry.schedule(() => runs.push(0)), false);
  retry.reset();
  assert.equal(retry.schedule(() => {}), true, 'a success or new key restores it');
  retry.dispose();
});

// ── Tabs of a visible Directions view ───────────────────────────────────────
// The Primary and Secondary tabs stay mounted once visited. The tab behind its
// sibling is not a hidden surface: it keeps its rows current (key check and
// in-place reload), so switching to it shows them on the first frame. Only a
// hidden view (a minimized touch pane) idles and catches up once when shown.
const FOCUS = '2026-10-24T14:51:00';
const viewSource = source.getText();
const panelText = viewSource.slice(
  viewSource.indexOf('function SecondaryDirectionsPanel('),
  viewSource.indexOf('// Retained rows keep their loaded method while a new selection is loading.'),
);

/** The activation effect: one deferred key check or reload when the view shows. */
function activationEffect(env) {
  return callback('The key check decides whether the deferred reload', 'React.useEffect', { queueMicrotask, ...env }).run;
}

/** A scroller the tab viewport helpers can read and move. */
function fakeScroller(clientHeight = 200) {
  const scroller = { clientHeight, scrollTop: 0, scrollHeight: 0, syncs: 0, listeners: new Map(),
    addEventListener: (type, fn) => scroller.listeners.set(type, fn), removeEventListener: (type) => scroller.listeners.delete(type),
    dispatchEvent: () => { scroller.syncs += 1; return true; } };
  return scroller;
}
const viewportHelpers = new Function('SECONDARY_FOCUS_ANCHOR', 'VIRTUAL_SCROLL_SYNC_EVENT', 'requestAnimationFrame', 'cancelAnimationFrame', 'CustomEvent', 'flushSync',
  `${transpile(declarations(source, ['scrollAnchorRowIndex', 'captureSecondaryTabViewport', 'restoreSecondaryTabViewport',
    'scrollFocusedDirectionRow', 'scheduleFocusedDirectionScroll', 'dispatchVirtualScrollSync', 'secondaryStitchRowKey']))}
  return { captureSecondaryTabViewport, restoreSecondaryTabViewport, scheduleFocusedDirectionScroll };`)(
  constantValue('SECONDARY_FOCUS_ANCHOR'), 'sync', (fn) => { viewportFrames.push(fn); return viewportFrames.length; }, () => {},
  class { constructor(type, init) { this.type = type; this.detail = init?.detail; } }, (fn) => fn());
const viewportFrames = [];

/** The focus-anchor layout effect, as React runs it on a tab switch. */
function anchorEffect(env) {
  return callback('Back from the sibling tab', 'React.useLayoutEffect', {
    ...viewportHelpers, SECONDARY_FOCUS_ANCHOR: constantValue('SECONDARY_FOCUS_ANCHOR'), ...env,
  }).run;
}

test('a tab is kept mounted behind its sibling and does data work while the view shows', () => {
  for (const tab of ['primary', 'secondary']) {
    assert.match(viewSource, new RegExp(`<TabsContent\\s+value="${tab}"\\s+keepMounted`), `${tab} tab stays mounted`);
  }
  assert.match(viewSource, /visitedTabs\.has\("secondary"\) \? \(\s*<MemoSecondaryDirectionsPanel/, 'an unvisited tab mounts nothing');
  assert.match(viewSource, /active=\{secondaryActive\}\s*dataActive=\{viewVisible\}/);
  assert.match(viewSource, /const viewVisible = React\.useContext\(RetainedPaneVisibleContext\)/);
  // The tab behind follows only the settled focus: no per-step work in a burst.
  assert.match(viewSource, /secondaryFocusDatetime = \(secondaryActive \? renderedFocusDatetime : settledFocusDatetime\)/);
  assert.match(viewSource, /primaryFocusDatetime = \(primaryActive \? renderedFocusDatetime : settledFocusDatetime\)/);
  // Every data gate reads the view's visibility, never the tab's.
  assert.doesNotMatch(panelText, /[^a]activeRef\.current/);
  assert.ok((panelText.match(/!dataActiveRef\.current/g) ?? []).length >= 4, 'key check, reload, new island, growth');
  // Filters stay client-side: no filter in the list identity or load deps.
  const worldKey = /const worldKey = React\.useMemo\([\s\S]*?\);/.exec(panelText)[0];
  assert.doesNotMatch(worldKey, /stationsOnly|aspect|pointRole|selected/i);
  const workspace = readFileSync(new URL('../src/components/workshell/workspace-content.tsx', import.meta.url), 'utf8');
  assert.match(workspace, /<RetainedPaneVisibleContext value=\{touchPresentation !== "minimized"\}>/);
});

for (const [label, change] of [
  ['(b) a radix step or edit', { radixRefreshSeq: 2 }],
  ['(c) a setting that changes rows', { optionsDataKey: 'o2' }],
]) {
  test(`${label} while Primary shows: Secondary is current when its tab activates`, async () => {
    const { panel, before } = await grownPanel();
    payloadCache.clear();
    // Behind the Primary tab, inside a visible view.
    panel.state.active = true;
    const watcher = keyWatcher({ resident: before, serverKey: 'k2', active: true });
    watcher.run({ optionsDataKey: 'o1', radixRefreshSeq: 1 });
    await settle();
    const checks = watcher.calls.length;
    watcher.run({ optionsDataKey: 'o1', radixRefreshSeq: 1, ...change });
    await settle();
    assert.equal(watcher.calls.length, checks + 1, 'one key check, sent behind the sibling tab');
    assert.equal(watcher.state.target, 'k2');
    panel.state.revised = true;
    panel.state.history = [];
    const behind = mountPanel({ seed: before, state: panel.state, targetDataKey: watcher.state.target, realCache: true });
    behind.load();
    await untilIdle(behind);
    const reloaded = panel.state.store;
    assert.ok(reloaded.rows.every((row) => row.sig === 's-k2'), 'every row reloaded before the switch');
    assert.ok(panel.state.history.every((store) => store.coverage.start === before.coverage.start
      && store.coverage.end === before.coverage.end), 'in place: same span throughout');
    // The switch itself: the view stays visible, so no activation work falls due.
    const sent = behind.fetches.length + watcher.calls.length;
    const nudges = { key: 0, reload: 0 };
    activationEffect({ dataActive: true, keyCheckDeferredRef: watcher.env.keyCheckDeferredRef,
      reloadDeferredRef: behind.env.reloadDeferredRef,
      setKeyCheckNonce: () => { nudges.key += 1; }, setReloadNonce: () => { nudges.reload += 1; } })();
    await settle();
    assert.deepEqual(nudges, { key: 0, reload: 0 }, 'activation sends nothing');
    assert.equal(behind.fetches.length + watcher.calls.length, sent);
    // A later remount of the list shows these rows too, whatever key it asks for.
    assert.equal(helpers.cachedSecondaryStore('list', null, FOCUS), reloaded);
    assert.equal(helpers.completeCachedSecondaryStore('list', 'k2'), reloaded);
  });
}

test('(a) a focus moved out of the rows while Primary shows loads its island before activation', async () => {
  const { panel, before } = await grownPanel();
  const islands = [];
  const moved = '2075-01-01T00:00:00';
  callback('requestFocusDatetimeRef.current === effectiveFocusDatetime', 'React.useEffect', {
    requests: createRetainedListRequests(before), queueMicrotask, effectiveFocusDatetime: moved,
    requestFocusDatetimeRef: ref(FOCUS), islandRef: ref({ nonce: before.islandNonce, window: null }),
    rowDateRangeMs: () => [0, 1], dateRangeCoversFocusDate: () => false,
    setTargetAgeRange: () => {}, setTargetAgeSeek: () => {}, setTodayFocusMs: () => {},
    setRequestFocusDatetime: (update) => islands.push(['focus', typeof update === 'function' ? update(FOCUS) : update]),
    setIsland: (update) => islands.push(['island', update({ nonce: before.islandNonce, window: null })]),
  }).run();
  await settle();
  const island = islands.find(([kind]) => kind === 'island')?.[1];
  assert.deepEqual(island, { nonce: before.islandNonce + 1, window: null }, 'the moved focus starts its island while hidden');
  panel.state.params = [];
  const behind = mountPanel({ seed: before, state: panel.state });
  behind.loadWith({ island, requestFocusDatetime: moved });
  await behind.run(3, { grow: false });
  assert.equal(behind.fetches.length, 1, 'one island request behind the sibling tab');
  assert.equal(panel.state.params[0].referenceDatetime, moved);
  assert.equal(panel.state.store.islandNonce, island.nonce, 'the island is resident before the switch');
});

test('(a)(f) activation re-anchors a moved focus, else returns to the rows left, before paint', () => {
  const rows = Array.from({ length: 200 }, (_, i) => ({ date: `d${i}`, age: i / 4, prom: 'p', aspect: 'a', sig: 's', fields: {} }));
  const scroller = fakeScroller();
  scroller.scrollTop = 1000;
  const signature = { focusSignature: 'ms:1', islandSignature: '3' };
  const kept = viewportHelpers.captureSecondaryTabViewport(scroller, rows, 20, signature);
  assert.ok(kept, 'the viewport is kept while the tab shows');
  // Behind the sibling: rows were prepended by growth and the scroller was hidden.
  const grown = [...Array.from({ length: 40 }, (_, i) => ({ ...rows[0], date: `p${i}` })), ...rows];
  const env = (focusSignature, focusIndex) => ({
    active: true, wasActiveRef: ref(false), rowCountRef: ref(grown.length), scrollPlanRef: ref({ kind: 'prepend', count: 40 }),
    scrollerRef: ref(scroller), tabViewportRef: ref(kept), visibleRowsRef: ref(grown), rowHeightRef: ref(20),
    focusIndexRef: ref(focusIndex), focusSignature, islandSignature: '3',
  });
  viewportFrames.length = 0;
  scroller.scrollTop = 0;
  anchorEffect(env('ms:1', 150))();
  const keptIndex = grown.findIndex((row) => row.date === rows[Math.round((1000 + 200 * 0.25 - 10) / 20)].date);
  assert.equal(scroller.scrollTop, keptIndex * 20 - kept.rowOffset, '(f) the same row at the same place');
  assert.equal(viewportFrames.length, 0, 'synchronously, in the layout effect');
  // (a) the focus moved while the sibling showed: anchor on it, also at once.
  scroller.scrollTop = 0;
  anchorEffect(env('ms:2', 150))();
  assert.equal(scroller.scrollTop, 150 * 20 - 200 * 0.25 + 10);
  assert.equal(viewportFrames.length, 0, 'no frame at the old position');
});

test('(d)(e) a shared control or another chart while Primary shows loads that list before activation', async () => {
  for (const overrides of [
    { worldKey: 'list-temporal', includeTemporal: true },
    { worldKey: 'list-doc2', documentId: 'doc2' },
  ]) {
    const { panel, before } = await grownPanel();
    panel.state.params = [];
    const behind = mountPanel({ seed: before, state: panel.state });
    behind.loadWith({ ...overrides, island: { nonce: before.islandNonce + 1, window: null } });
    await behind.run(3, { grow: false });
    assert.equal(behind.fetches.length, 1, `one request for ${overrides.worldKey}`);
    const params = panel.state.params[0];
    if (overrides.includeTemporal) assert.equal(params.includeTemporal, true);
    if (overrides.documentId) assert.equal(params.documentId, 'doc2');
    assert.notEqual(panel.state.store, before, 'the new list is resident before the switch');
  }
});

test('a hidden view sends nothing (key, reload, island, growth) and catches up once when shown', async () => {
  const { panel, before } = await grownPanel();
  panel.state.active = false;
  const hidden = mountPanel({ seed: before, state: panel.state });
  // A focus island and growth fall due while the view is off screen.
  hidden.loadWith({ island: { nonce: before.islandNonce + 1, window: null }, requestFocusDatetime: '2075-01-01T00:00:00' });
  await hidden.run(3, { grow: false });
  hidden.env.extendCoverage('next');
  await hidden.run(3, { grow: false });
  assert.equal(hidden.fetches.length, 0, 'nothing is sent');
  assert.equal(panel.state.store, before, 'the rows stay');
  assert.equal(hidden.env.reloadDeferredRef.current, true);
  const watcher = keyWatcher({ resident: before, serverKey: 'k2', active: false });
  watcher.run({ radixRefreshSeq: 9 });
  await settle();
  assert.equal(watcher.calls.length, 0);
  // Shown again: exactly one key check is nudged (it then decides the reload).
  const nudges = { key: 0, reload: 0 };
  const activate = activationEffect({ dataActive: true, keyCheckDeferredRef: watcher.env.keyCheckDeferredRef,
    reloadDeferredRef: hidden.env.reloadDeferredRef,
    setKeyCheckNonce: () => { nudges.key += 1; }, setReloadNonce: () => { nudges.reload += 1; } });
  activate();
  await settle();
  assert.deepEqual(nudges, { key: 1, reload: 0 }, 'one key check on activation');
  // That check answers and then resumes the deferred reload, once.
  watcher.env.reloadDeferredRef = hidden.env.reloadDeferredRef;
  watcher.env.dataActiveRef.current = true;
  watcher.run({ radixRefreshSeq: 9, keyCheckNonce: 1 });
  await settle();
  assert.equal(watcher.calls.length, 1);
  assert.equal(watcher.state.reloadNudges, 1, 'the deferred reload resumes after the check');
  assert.equal(hidden.env.reloadDeferredRef.current, false);
  // With no key check pending, the deferred island resumes once.
  const islandOnly = mountPanel({ seed: before, state: { ...panel.state, active: false } });
  islandOnly.loadWith({ island: { nonce: before.islandNonce + 1, window: null } });
  await islandOnly.run(2, { grow: false });
  const resumed = { key: 0, reload: 0 };
  activationEffect({ dataActive: true, keyCheckDeferredRef: ref(false), reloadDeferredRef: islandOnly.env.reloadDeferredRef,
    setKeyCheckNonce: () => { resumed.key += 1; }, setReloadNonce: () => { resumed.reload += 1; } })();
  await settle();
  assert.deepEqual(resumed, { key: 0, reload: 1 });
  const shown = mountPanel({ seed: before, state: { ...panel.state, active: true } });
  shown.loadWith({ island: { nonce: before.islandNonce + 1, window: null } });
  await shown.run(3, { grow: false });
  assert.equal(shown.fetches.length, 1, 'the island loads once, now');
});
