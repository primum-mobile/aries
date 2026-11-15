// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../src/components/workshell/transit-search-view.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('search.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = [
  'searchRangeQueryKey', 'searchActiveRangeStream', 'mergeSearchRangeCoverage',
  'searchCoverageProofs', 'searchProofCoversQuery', 'rememberSearchQueryCoverage', 'retainSearchQueryCoverage',
  'retainedSearchSourceForm', 'retainedSearchSourceCoversForm', 'isIdSubset',
  'retainedSearchDeltaPlan', 'unionIds', 'differenceIds', 'uniqueIds', 'canRunSearch', 'searchDatesValid', 'previousIsoDate',
  'projectTransitSearchRows', 'searchRowMatchesMotion', 'stringValue', 'numberValue',
  'searchSeedRange', 'isIsoDate', 'addIsoDays', 'isoDate', 'nextIsoDate',
  'mergeSearchStreamRows', 'normalizeSearchStreamRows', 'searchStreamRowKey', 'compareSearchStreamRows',
];
const javascript = ts.transpileModule(ast.statements.filter((node) =>
  ts.isFunctionDeclaration(node) && names.includes(node.name?.text),
).map((node) => node.getText(ast)).join('\n'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
const helpers = new Function('SEARCH_RETAINED_LUNATION_ORB', 'SEARCH_LUNAR_TECHNIQUES', 'SEARCH_NON_ASPECT_TECHNIQUES',
  `${javascript}; return {${names.join(',')}};`)(30, new Set(['lunations', 'eclipses']), new Set(['heliacal_phases']));
const broadForm = {
  fromDate: '1990-01-15', toDate: '2088-01-15', techniques: ['mundane_weather'],
  promittorIds: ['planet:sun', 'planet:mercury', 'planet:jupiter', 'planet:saturn', 'planet:neptune'],
  significatorIds: ['planet:sun', 'planet:mercury', 'planet:jupiter', 'planet:saturn', 'planet:neptune'],
  aspects: ['conjunction'], includeSignChanges: false, promittorMotion: '', significatorMotion: '',
  moonPhase: '', lunationOrb: 30, partFilter: '',
};
const pairForm = { ...broadForm, promittorIds: ['planet:jupiter', 'planet:saturn'], significatorIds: ['planet:saturn', 'planet:jupiter'] };
const base = () => ({
  queryKey: helpers.searchRangeQueryKey(broadForm), queryForm: broadForm,
  rangeFrom: broadForm.fromDate, rangeTo: broadForm.toDate,
  coverageFrom: broadForm.fromDate, coverageTo: '1990-03-30', exhaustedNext: false,
});

test('a sparse pair scans its own remaining range and does not certify other pairs', () => {
  const source = base();
  const pair = helpers.searchActiveRangeStream(source, pairForm);
  assert.deepEqual(pair.queryForm.promittorIds, pairForm.promittorIds);
  const extended = helpers.mergeSearchRangeCoverage(source, pair, '2088-01-15');
  assert.equal(extended.coverageTo, '1990-03-30');
  assert.equal(helpers.searchActiveRangeStream(extended, pairForm).exhaustedNext, true);
  assert.equal(helpers.searchActiveRangeStream(extended, broadForm).exhaustedNext, false);
  const otherPair = { ...pairForm, promittorIds: ['planet:neptune'] };
  assert.equal(helpers.searchActiveRangeStream(extended, otherPair).coverageTo, '1990-03-30');
  assert.equal(helpers.searchActiveRangeStream(extended, { ...pairForm, toDate: '2090-01-01' }).exhaustedNext, false);
  const reordered = { ...pairForm, promittorIds: [...pairForm.promittorIds].reverse(), significatorIds: [...pairForm.significatorIds].reverse() };
  assert.equal(helpers.searchActiveRangeStream(extended, reordered).exhaustedNext, true);
  const gap = { ...base(), coverageFrom: '1980-01-01', coverageTo: '1981-01-01' };
  assert.equal(helpers.searchActiveRangeStream(gap, pairForm), null);
});

test('Lunations includes eclipses regardless of which technique fetched them', () => {
  const lunarForm = { ...broadForm, promittorIds: [], significatorIds: ['planet:sun'] };
  const ordinary = { ...row('2024-03-10', 'planet:moon', 'planet:sun', 1), technique: 'lunations' };
  for (const fetchedTechnique of ['lunations', 'eclipses']) {
    const solar = { ...row('2024-04-08', 'planet:sun', 'planet:sun', 3), technique: fetchedTechnique,
      metadata: { eclipse: true, eclipse_kind: 'solar', lunation_contact_orb: 1 } };
    const lunar = { ...row('2024-03-25', 'planet:moon', 'planet:sun', 2), technique: fetchedTechnique,
      metadata: { eclipse: true, eclipse_kind: 'lunar', lunation_contact_orb: 2 } };
    const source = [ordinary, lunar, solar];
    const selected = (techniques, lunationOrb = 30) => helpers.projectTransitSearchRows(source, { ...lunarForm, techniques, lunationOrb });
    assert.deepEqual(selected(['lunations']), source);
    assert.deepEqual(selected(['eclipses']), [lunar, solar]);
    assert.deepEqual(selected(['lunations', 'eclipses']), source);
    assert.deepEqual(selected([]), []);
    assert.deepEqual(selected(['eclipses'], 1), [solar], 'contact orb still narrows eclipse rows');
  }
});

test('separate lunar query deltas retain each eclipse contact once in either merge order', () => {
  const ordinary = { ...row('2024-03-10', 'planet:moon', 'planet:sun', 1), technique: 'lunations' };
  const contact = { ...row('2024-04-08', 'planet:sun', 'planet:sun', 2),
    metadata: { eclipse: true, eclipse_kind: 'solar' } };
  const lunation = { ...contact, technique: 'lunations' };
  const eclipse = { ...contact, technique: 'eclipses' };
  for (const [first, second] of [[lunation, eclipse], [eclipse, lunation]]) {
    const merged = helpers.mergeSearchStreamRows([ordinary, first], [second]);
    assert.equal(merged.length, 2);
    for (const techniques of [['lunations'], ['eclipses'], ['lunations', 'eclipses']]) {
      const visible = helpers.projectTransitSearchRows(merged, { ...broadForm, techniques, significatorIds: ['planet:sun'] });
      assert.equal(visible.length, techniques.includes('lunations') ? 2 : 1);
    }
    const otherContact = { ...eclipse, significatorId: 'planet:jupiter' };
    assert.equal(helpers.mergeSearchStreamRows(merged, [otherContact]).length, 3);
  }
});

test('retained Lunations coverage serves Eclipses immediately; the reverse needs more data', () => {
  const lunarForm = { ...broadForm, techniques: ['lunations'] };
  const eclipseForm = { ...broadForm, techniques: ['eclipses'] };
  assert.equal(helpers.retainedSearchSourceCoversForm(lunarForm, eclipseForm), true);
  assert.equal(helpers.retainedSearchSourceCoversForm(lunarForm, { ...eclipseForm, techniques: ['lunations', 'eclipses'] }), true);
  assert.equal(helpers.retainedSearchSourceCoversForm(eclipseForm, lunarForm), false);
  assert.equal(helpers.retainedSearchSourceCoversForm(lunarForm, { ...eclipseForm, toDate: '2090-01-01' }), false);
  const covered = helpers.retainedSearchDeltaPlan(lunarForm, eclipseForm);
  assert.deepEqual(covered.deltaForms, [], 'enabling Eclipses does not refetch known lunations');
  const expanded = helpers.retainedSearchDeltaPlan(eclipseForm, lunarForm);
  assert.deepEqual(expanded.deltaForms.map((form) => form.techniques), [['lunations']]);
});

const harnessSource = await readFile(new URL('../src/components/workshell/stitched-list-harness.ts', import.meta.url), 'utf8');
const harnessAst = ts.createSourceFile('harness.ts', harnessSource, ts.ScriptTarget.Latest, true);
const edgeFunction = harnessAst.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'useEdgeExtend');
const edgeJs = ts.transpileModule(edgeFunction.getText(harnessAst).replace(/^export /, ''), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
function checkEdge(options) {
  const calls = [];
  const frames = [];
  const scroller = { scrollTop: 0, scrollHeight: 100, clientHeight: 400, dataset: {}, addEventListener() {}, removeEventListener() {} };
  const React = { useRef: (current) => ({ current }), useLayoutEffect: (run) => run(), useEffect: (run) => run() };
  const hook = new Function('React', 'requestAnimationFrame', 'cancelAnimationFrame', `${edgeJs}; return useEdgeExtend;`)(
    React, (run) => { frames.push(run); return frames.length; }, () => {},
  );
  hook({ scrollerRef: { current: scroller }, rowCount: 0, thresholdPx: 60,
    canExtendBackward: false, canExtendForward: true, onExtend: (direction) => calls.push(direction), ...options });
  for (const run of frames) run();
  return calls;
}
test('Search fills empty and short viewports without a scroll event, and stops at exhaustion', () => {
  assert.deepEqual(checkEdge({ fillViewport: true }), ['next']);
  assert.deepEqual(checkEdge({ fillViewport: true, rowCount: 5 }), ['next']);
  assert.deepEqual(checkEdge({ fillViewport: true, canExtendForward: false }), []);
  assert.deepEqual(checkEdge({ fillViewport: false }), []);
});

let extendCallback;
function findExtend(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'extendRange') extendCallback = node.initializer.arguments[0];
  ts.forEachChild(node, findExtend);
}
findExtend(ast);
const extendJs = ts.transpileModule(`const extend = ${extendCallback.getText(ast)};`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
const settle = () => new Promise((resolve) => setImmediate(resolve));
function row(eventDate, promittorId, significatorId, eventJd) {
  return { eventDate, eventTime: '00:00:00', eventJd, technique: 'mundane_weather', aspect: 'conjunction',
    promittorId, significatorId, notes: '', metadata: {}, promittorMarker: '', significatorMarker: '',
    promDisplay: { speed_lon: 1 }, sigDisplay: { speed_lon: 1 } };
}
function extensionHarness(follow) {
  const requests = [];
  const cancellations = [];
  const sourceRow = row('1990-03-01', 'planet:sun', 'planet:mercury', 1);
  const ref = (current) => ({ current });
  const env = {
    ...helpers, datesReady: true, React: { startTransition: (run) => run() }, form: pairForm, formRef: ref(pairForm),
    rangeExtendInFlightRef: ref(false), rangeStreamRef: ref(base()),
    rangeExtendControllerRef: ref(null), searchRequestSeqRef: ref(0), currentSearchSessionRef: ref(null),
    rowsRef: ref([sourceRow]), catalogRef: ref(null), searchScrollerRef: ref(null), searchLoading: false,
    searchRowHeight: 28, SEARCH_EDGE_MIN_ROWS: 48,
    setSearchProgress() {}, preserveSearchViewportRef: ref(() => {}),
    searchViewportRowCount: () => 12, buildRequest: (form) => form,
    setSearchLoading() {}, setError() {}, setRows() {}, setRangeStream() {}, setTimeDisplay() {}, setEdgeCheckNonce() {},
    setSummary: (value) => { env.summary = typeof value === 'function' ? value(env.summary) : value; }, t: () => '{count} results',
    startSearchRequest: async (request) => { requests.push(request); return { sessionId: 'test-session' }; },
    cancelTransitSearch: async (id) => { cancellations.push(id); },
    followTransitSearchProgress: (initial, signal, apply) => follow(initial, signal, apply, env),
  };
  const extend = new Function(...Object.keys(env), `${extendJs}; return extend;`)(...Object.values(env));
  return { env, requests, cancellations, sourceRow, extend };
}
test('mounted Search continuation returns the rare pair while preserving broad cached rows', async () => {
  const dates = ['2000-05-28', '2020-12-21', '2040-10-31', '2060-04-07', '2080-03-15'];
  const app = extensionHarness(async (_initial, _signal, apply) => {
    apply({ rows: dates.map((date, i) => row(date, 'planet:jupiter', 'planet:saturn', i + 2)),
      cursor: { coverageTo: '2088-01-15', exhaustedNext: true } });
  });
  assert.deepEqual(helpers.projectTransitSearchRows(app.env.rowsRef.current, pairForm), []);
  app.extend('next');
  await settle();
  assert.equal(app.requests.length, 1);
  assert.deepEqual(app.requests[0].promittorIds, pairForm.promittorIds);
  assert.equal(app.requests[0].fromDate, '1990-03-31');
  assert.equal(app.requests[0].cursorRangeTo, '2088-01-15');
  assert.equal(app.env.rowsRef.current.length, 6);
  assert.equal(app.env.rowsRef.current[0].promittorId, app.sourceRow.promittorId);
  assert.deepEqual(helpers.projectTransitSearchRows(app.env.rowsRef.current, pairForm).map((r) => r.eventDate), dates);
  assert.equal(app.env.summary, '5 results');
  assert.equal(helpers.searchActiveRangeStream(app.env.rangeStreamRef.current, pairForm).exhaustedNext, true);
  assert.equal(app.env.rangeStreamRef.current.coverageTo, '1990-03-30');
  app.extend('next');
  assert.equal(app.requests.length, 1, 'completed sparse coverage must not be searched again');
});

test('late sparse results cannot change rows or coverage after another filter is selected', async () => {
  const app = extensionHarness(async (_initial, _signal, apply, env) => {
    env.formRef.current = broadForm;
    apply({ rows: [row('2000-05-28', 'planet:jupiter', 'planet:saturn', 2)], cursor: { coverageTo: '2088-01-15' } });
  });
  app.extend('next');
  await settle();
  assert.equal(app.env.rowsRef.current.length, 1);
  assert.equal(app.env.rangeStreamRef.current.coverageTo, '1990-03-30');
  assert.deepEqual(app.cancellations, ['test-session']);
});
