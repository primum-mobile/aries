// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

// Run the mounted callbacks and their real helpers, replacing only React's
// scheduling and the daemon transport. This observes rows/coverage/scrolling
// without duplicating the Search state machine in the test.
const source = await readFile(new URL('../src/components/workshell/transit-search-view.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('search.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const transpile = (code) => ts.transpileModule(code, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
}).outputText;
const declarations = ast.statements.filter((node) => ts.isFunctionDeclaration(node)
  || (ts.isVariableStatement(node) && node.declarationList.declarations.every((item) => /^[A-Z0-9_]+$/.test(item.name.getText(ast)))));
const helperNames = declarations.filter(ts.isFunctionDeclaration).map((node) => node.name.text);
const constantNames = declarations.filter(ts.isVariableStatement).flatMap((node) =>
  node.declarationList.declarations.map((item) => item.name.getText(ast)));
const eventListBodyViewportHeight = (scroller, fallback = 0) => scroller?.clientHeight ?? fallback;
const helpers = new Function('eventListBodyViewportHeight', `${transpile(declarations.map((node) =>
  node.getText(ast).replace(/^export /, '')).join('\n'))}; return {${[...helperNames, ...constantNames].join(',')}};`)(
  eventListBodyViewportHeight,
);
const en = JSON.parse(await readFile(new URL('../src/locales/en.json', import.meta.url), 'utf8'));
function callback(name, env) {
  let expression;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name) {
      expression = node.initializer?.arguments?.[0];
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(expression, `${name} must be the mounted callback`);
  return new Function(...Object.keys(env), `${transpile(`const run = ${expression.getText(ast)};`)} return run;`)(...Object.values(env));
}
function layoutEffectContaining(fragment, env) {
  let expression;
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === 'React.useLayoutEffect'
      && node.arguments[0]?.getText(ast).includes(fragment)) expression = node.arguments[0];
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(expression, 'the mounted viewport restoration effect must exist');
  return new Function(...Object.keys(env), `${transpile(`const run = ${expression.getText(ast)};`)} return run;`)(...Object.values(env));
}
const ref = (current) => ({ current });
const settle = () => new Promise((resolve) => setImmediate(resolve));
const baseForm = {
  fromDate: '2024-01-01', toDate: '2024-12-31', techniques: ['mundane_weather'],
  promittorIds: ['planet:jupiter', 'planet:saturn'], significatorIds: ['planet:jupiter', 'planet:saturn'],
  aspects: ['conjunction'], includeSignChanges: false, promittorMotion: '', significatorMotion: '',
  moonPhase: '', lunationOrb: 15, partFilter: '', limit: 500,
};
function row(eventDate, eventJd, overrides = {}) {
  return { eventDate, eventTime: '00:00:00', eventJd, technique: 'mundane_weather', aspect: 'conjunction',
    promittorId: 'planet:jupiter', significatorId: 'planet:saturn', notes: '', metadata: {},
    promittorMarker: '', significatorMarker: '', promDisplay: { speed_lon: 1 }, sigDisplay: { speed_lon: 1 }, ...overrides };
}
function stream(form, coverageTo = form.toDate) {
  const queryForm = helpers.retainedSearchSourceForm(form);
  return { queryForm, queryKey: helpers.searchRangeQueryKey(queryForm), rangeFrom: form.fromDate, rangeTo: form.toDate,
    coverageFrom: form.fromDate, coverageTo, exhaustedNext: coverageTo >= form.toDate };
}
function searchHarness({ form = baseForm, rows = [], rangeStream = null, queueTransitions = false } = {}) {
  const requests = [];
  const jobs = [];
  const cancelled = [];
  const transitions = [];
  let queued = null;
  const state = { rows, rangeStream, summary: en['search.noResults'], timeDisplay: null,
    selectedRowKeys: new Set(rows.map((value) => value.key)), loading: false, progress: null, error: null, edgeNonce: 0 };
  const setter = (key) => (value) => {
    if (queued) queued.push([key, value]);
    else state[key] = typeof value === 'function' ? value(state[key]) : value;
  };
  const scroller = { scrollTop: 420, clientHeight: 300, events: [], querySelector: () => null,
    dispatchEvent(event) { this.events.push(event.type); } };
  const env = {
    ...helpers, React: { startTransition(run) {
      if (!queueTransitions) return run();
      queued = [];
      run();
      transitions.push(queued);
      queued = null;
    } },
    contextMode: false, significatorId: null, chartRole: null, customPointsKey: '', optionsSeq: 0,
    form, formRef: ref(form), datesReady: true, searchLoading: false, searchRowHeight: 28,
    searchRequestSeqRef: ref(0), lastAutoRequestKeyRef: ref(''), currentSearchSessionRef: ref(null),
    searchControllerRef: ref(null), rangeExtendControllerRef: ref(null), rangeExtendInFlightRef: ref(false),
    rowsRef: ref(rows), rangeStreamRef: ref(rangeStream), catalogRef: ref(null), searchScrollerRef: ref(scroller),
    preserveSearchViewportRef: ref(() => {}),
    objectFilterAnchorRef: ref(null), searchRowHeightRef: ref(28), eventListBodyViewportHeight,
    SEARCH_INITIAL_MIN_ROWS: 96, SEARCH_EDGE_MIN_ROWS: 48, SEARCH_VIRTUAL_SCROLL_SYNC_EVENT: 'aries:search-virtual-scroll-sync',
    setRows: setter('rows'), setRangeStream: setter('rangeStream'), setSummary: setter('summary'),
    setTimeDisplay: setter('timeDisplay'), setSelectedRowKeys: setter('selectedRowKeys'), setError: setter('error'),
    setSearchProgress: setter('progress'),
    setEdgeCheckNonce: setter('edgeNonce'), setSearchLoading: setter('loading'), t: (key) => en[key] ?? key,
    buildRequest: (value) => ({ ...value }), saveSettings() {}, requestAnimationFrame: (run) => run(),
    cancelTransitSearch: async (id) => { cancelled.push(id); },
    startSearchRequest: async (request, signal) => {
      requests.push(request);
      const job = { request, signal, id: `job-${jobs.length + 1}` };
      jobs.push(job);
      return { sessionId: job.id, rows: [], complete: false, phase: 'starting' };
    },
    followTransitSearchProgress: (initial, signal, apply) => {
      const job = jobs.find((value) => value.id === initial.sessionId);
      job.apply = apply;
      return new Promise((resolve, reject) => {
        job.resolve = resolve;
        job.reject = reject;
        signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
        apply(initial);
      });
    },
  };
  env.synchronizeSearchForm = callback('synchronizeSearchForm', env);
  env.executeSearch = (...args) => callback('executeSearch', env)(...args);
  env.extendRetainedSearchUniverse = (...args) => callback('extendRetainedSearchUniverse', env)(...args);
  // A retained refresh binds the current render's form, as React does.
  const refresh = (nextForm) => { env.form = nextForm; env.synchronizeSearchForm(nextForm); return callback('refreshRetainedSearch', env)(nextForm); };
  const publish = (job, rows, coverageTo, { complete = false, satisfied = false, ...extra } = {}) => {
    const result = { sessionId: job.id, phase: complete ? 'complete' : 'searching', rows,
      complete, summary: `${rows.length} results`, cursor: {
        rangeFrom: job.request.cursorRangeFrom ?? job.request.fromDate,
        rangeTo: job.request.cursorRangeTo ?? job.request.toDate,
        coverageFrom: job.request.cursorAnchorDate ?? job.request.fromDate, coverageTo,
        exhaustedNext: complete && coverageTo >= (job.request.cursorRangeTo ?? job.request.toDate),
        exhausted: false, satisfied,
      }, ...extra };
    job.apply(result);
    if (complete) job.resolve(result);
    return result;
  };
  const flush = (index) => {
    for (const [key, value] of transitions[index] ?? []) state[key] = typeof value === 'function' ? value(state[key]) : value;
  };
  return { env, state, requests, jobs, cancelled, scroller, transitions, refresh, publish, flush, execute: env.executeSearch };
}

test('cold Search paints its first certified rows before row-budget satisfaction or full completion', async () => {
  const app = searchHarness();
  app.execute(baseForm);
  await settle();
  const first = row('2024-01-02', 1);
  app.publish(app.jobs[0], [first], '2024-01-02');
  assert.deepEqual(app.state.rows.map((value) => value.eventDate), ['2024-01-02']);
  assert.equal(app.state.loading, true);
  assert.equal(helpers.searchActiveRangeStream(app.state.rangeStream, baseForm).coverageTo, '2024-01-02');
  assert.equal(helpers.searchActiveRangeStream(app.state.rangeStream, baseForm).exhaustedNext, false);
  const second = row('2024-01-03', 2);
  app.publish(app.jobs[0], [first, second], baseForm.toDate, { complete: true });
  await settle();
  assert.equal(app.state.rows.length, 2);
  assert.equal(app.state.loading, false);
});

test('warm Search retains its coherent rows until the replacement is ready, then publishes later batches', async () => {
  const retained = helpers.normalizeSearchStreamRows([row('2024-06-01', 10)]);
  const app = searchHarness({ rows: retained, rangeStream: stream(baseForm) });
  app.execute(baseForm);
  await settle();
  const first = row('2024-01-02', 1);
  app.publish(app.jobs[0], [first], '2024-01-02');
  assert.deepEqual(app.state.rows, retained);
  assert.equal(app.scroller.scrollTop, 420);
  app.publish(app.jobs[0], [first], '2024-01-03', { satisfied: true });
  assert.deepEqual(app.state.rows.map((value) => value.eventDate), ['2024-01-02', '2024-06-01']);
  assert.equal(app.scroller.scrollTop, 420, 'a populated replacement preserves its viewport');
  assert.ok(app.state.selectedRowKeys.has(retained[0].key), 'a retained row keeps its selection and action identity');
  app.publish(app.jobs[0], [first, row('2024-01-04', 2)], '2024-01-04');
  assert.equal(app.state.rows.length, 3);
  assert.equal(app.state.loading, true);
  app.publish(app.jobs[0], app.state.rows, baseForm.toDate, { complete: true });
  await settle();
});

test('an old queued publication and finalizer cannot overwrite a restored valid date intent', async () => {
  const app = searchHarness({ queueTransitions: true });
  app.execute(baseForm);
  await settle();
  app.publish(app.jobs[0], [row('2024-01-02', 1)], '2024-01-02');
  assert.equal(app.transitions.length, 1);
  app.env.synchronizeSearchForm(null);
  app.env.synchronizeSearchForm(baseForm);
  app.execute(baseForm);
  await settle();
  const latestRows = [row('2024-02-01', 2)];
  app.publish(app.jobs[1], latestRows, baseForm.toDate, { complete: true });
  await settle();
  app.flush(1);
  const latestAcceptedRows = app.state.rows;
  app.flush(0);
  assert.equal(app.state.rows, latestAcceptedRows, 'an older queued setter cannot replace the newest accepted rows');
  assert.ok(app.state.rows.some((value) => value.eventDate === '2024-02-01'));
  assert.equal(helpers.searchActiveRangeStream(app.state.rangeStream, baseForm).exhaustedNext, true);
  app.jobs[0].apply({ rows: [row('2024-03-01', 3)], complete: true, cursor: { coverageTo: '2124-01-01' } });
  assert.equal(app.transitions.length, 2, 'late cancelled chunks schedule no UI update');
  assert.equal(app.state.loading, false);
});

test('active-year facet population keeps century rows cached and certifies only its scanned query', async () => {
  const centuryForm = { ...baseForm, fromDate: '1988-01-01', toDate: '2088-12-31' };
  const retained = helpers.normalizeSearchStreamRows([
    row('1988-06-01', 1), row('2024-06-01', 2), row('2088-06-01', 3),
  ]);
  const app = searchHarness({ form: centuryForm, rows: retained, rangeStream: stream(centuryForm) });
  app.refresh(baseForm);
  await settle();
  assert.equal(app.requests.length, 0, 'a covered year is an immediate retained projection');
  const expanded = { ...baseForm, promittorIds: [...baseForm.promittorIds, 'planet:uranus'],
    significatorIds: [...baseForm.significatorIds, 'planet:uranus'], aspects: ['conjunction', 'opposition'] };
  app.refresh(expanded);
  await settle();
  assert.equal(app.requests.length, 1);
  const request = app.requests[0];
  assert.equal(request.cursorRangeFrom, expanded.fromDate);
  assert.equal(request.cursorRangeTo, expanded.toDate);
  assert.ok(request.fromDate >= expanded.fromDate && request.toDate <= expanded.toDate);
  const added = row('2024-06-02', 4, { aspect: 'opposition', promittorId: 'planet:uranus' });
  app.publish(app.jobs[0], [added], '2024-06-02', { satisfied: true });
  assert.ok(app.env.rowsRef.current.some((value) => value.eventDate === '1988-06-01'));
  assert.ok(app.env.rowsRef.current.some((value) => value.eventDate === '2088-06-01'));
  const active = helpers.searchActiveRangeStream(app.env.rangeStreamRef.current, expanded);
  assert.equal(active.coverageTo, '2024-06-02');
  assert.equal(active.exhaustedNext, false);
  const unsearchedCentury = { ...expanded, fromDate: centuryForm.fromDate, toDate: centuryForm.toDate };
  assert.equal(helpers.searchActiveRangeStream(app.env.rangeStreamRef.current, unsearchedCentury), null);
  app.publish(app.jobs[0], [added], expanded.toDate, { complete: true });
  await settle();
  app.refresh(centuryForm);
  await settle();
  assert.equal(app.requests.length, 1, 'returning to the original cache needs no calculation');
  assert.deepEqual(helpers.projectTransitSearchRows(app.state.rows, centuryForm).map((value) => value.eventDate),
    retained.map((value) => value.eventDate));
  assert.equal(helpers.searchActiveRangeStream(app.env.rangeStreamRef.current, centuryForm).exhaustedNext, true);
  const key = added.key ?? helpers.searchStreamRowKey(added);
  const sorted = helpers.sortTransitSearchRows(helpers.projectTransitSearchRows(app.state.rows, expanded), { column: 'date', ascending: false });
  assert.equal(sorted[0].key, key, 'new rows retain canonical identity through sorting and actions');
});

test('cancelled and truncated payloads cannot publish rows or false completion coverage', async () => {
  const app = searchHarness();
  app.execute(baseForm);
  await settle();
  for (const flags of [{ cancelled: true }, { truncated: true }]) {
    app.publish(app.jobs[0], [row('2024-01-02', 1)], baseForm.toDate, { satisfied: true, ...flags });
    assert.deepEqual(app.state.rows, []);
    assert.equal(app.state.progress, null);
    assert.equal(app.env.rangeStreamRef.current.coverageTo, '');
    assert.equal(app.env.rangeStreamRef.current.exhaustedNext, false);
  }
  app.publish(app.jobs[0], [row('2024-01-03', 2)], '2024-01-03');
  assert.equal(app.state.rows.length, 1, 'a later valid batch can still recover');
  app.publish(app.jobs[0], app.state.rows, baseForm.toDate, { complete: true });
  await settle();
});

test('continuation publishes certified batches while preserving viewport and resident row actions', async () => {
  const retained = helpers.normalizeSearchStreamRows([row('2024-01-02', 1)]);
  const app = searchHarness({ rows: retained, rangeStream: stream(baseForm, '2024-01-05') });
  callback('extendRange', app.env)('next');
  await settle();
  assert.equal(app.requests[0].fromDate, '2024-01-06');
  const next = row('2024-01-08', 2);
  app.publish(app.jobs[0], [next], '2024-01-08');
  assert.deepEqual(app.state.rows.map((value) => value.eventDate), ['2024-01-02', '2024-01-08']);
  assert.equal(app.state.loading, true);
  assert.equal(app.scroller.scrollTop, 420);
  assert.ok(app.state.selectedRowKeys.has(retained[0].key));
  assert.equal(helpers.searchActiveRangeStream(app.env.rangeStreamRef.current, baseForm).coverageTo, '2024-01-08');
  app.publish(app.jobs[0], [next], baseForm.toDate, { complete: true });
  await settle();
  assert.equal(app.state.loading, false);
  assert.equal(helpers.searchActiveRangeStream(app.env.rangeStreamRef.current, baseForm).exhaustedNext, true);
});

test('rapid aspect then technique changes keep proofs independent and ignore late batches from the earlier group', async () => {
  const retained = helpers.normalizeSearchStreamRows([row('2024-01-02', 1)]);
  const app = searchHarness({ rows: retained, rangeStream: stream(baseForm) });
  const aspects = { ...baseForm, aspects: ['conjunction', 'opposition'] };
  app.refresh(aspects);
  await settle();
  const opposition = row('2024-02-01', 2, { aspect: 'opposition' });
  app.publish(app.jobs[0], [opposition], '2024-02-01', { satisfied: true });
  const techniques = { ...baseForm, techniques: ['mundane_weather', 'lunations'] };
  app.refresh(techniques);
  await settle();
  assert.ok(app.jobs[0].signal.aborted, 'a newer group intent actually cancels its predecessor');
  assert.equal(app.requests.length, 2);
  assert.deepEqual(app.requests[1].techniques, techniques.techniques);
  const beforeLate = app.env.rangeStreamRef.current;
  app.publish(app.jobs[0], [opposition, row('2024-11-01', 5, { aspect: 'opposition' })], aspects.toDate);
  assert.equal(app.env.rangeStreamRef.current, beforeLate);
  assert.equal(helpers.searchActiveRangeStream(beforeLate, aspects).coverageTo, '2024-02-01');
  assert.equal(helpers.searchActiveRangeStream(beforeLate, techniques), null);
  const lunar = row('2024-03-10', 3, { technique: 'lunations', promittorId: 'planet:moon', metadata: { lunation_contact_orb: 2 } });
  app.publish(app.jobs[1], [lunar], techniques.toDate, { complete: true });
  await settle();
  assert.deepEqual(helpers.projectTransitSearchRows(app.state.rows, techniques).map((value) => value.eventDate),
    ['2024-01-02', '2024-03-10']);
  assert.equal(helpers.searchActiveRangeStream(app.env.rangeStreamRef.current, aspects).exhaustedNext, false,
    'a completed different technique does not finish the abandoned aspect query');
});

test('coverage proofs join adjacent scans but never bridge unsearched date islands or certify other aspects', () => {
  const january = stream({ ...baseForm, fromDate: '2024-01-01', toDate: '2024-01-10' });
  const march = stream({ ...baseForm, fromDate: '2024-03-01', toDate: '2024-03-10' });
  const islands = helpers.mergeSearchRangeCoverage(january, march, march.coverageTo);
  assert.equal(helpers.searchActiveRangeStream(islands, baseForm).coverageTo, '2024-01-10');
  assert.equal(helpers.searchActiveRangeStream(islands, { ...baseForm, fromDate: '2024-02-01' }), null);
  const activeMarch = helpers.searchActiveRangeStream(islands, { ...baseForm, fromDate: '2024-03-01' });
  assert.equal(activeMarch.coverageTo, '2024-03-10');
  const bridge = stream({ ...baseForm, fromDate: '2024-01-11', toDate: '2024-02-29' });
  const joined = helpers.mergeSearchRangeCoverage(islands, bridge, bridge.coverageTo);
  assert.equal(helpers.searchActiveRangeStream(joined, baseForm).coverageTo, '2024-03-10');
  assert.equal(helpers.searchActiveRangeStream(joined, { ...baseForm, aspects: ['opposition'] }), null);
});

test('cached later rows stay outside the active certified prefix so a short viewport still requests missing dates', async () => {
  assert.equal(typeof helpers.projectCoveredSearchRows, 'function');
  const retained = helpers.normalizeSearchStreamRows([
    row('2024-01-02', 1), ...Array.from({ length: 20 }, (_, index) => row(`2024-06-${String(index + 1).padStart(2, '0')}`, index + 100)),
  ]);
  const january = stream(baseForm, '2024-01-05');
  const app = searchHarness({ rows: retained, rangeStream: january });
  const visible = helpers.projectCoveredSearchRows(retained, baseForm, january);
  assert.deepEqual(visible.map((value) => value.eventDate), ['2024-01-02']);
  assert.equal(app.env.rowsRef.current.length, 21, 'later results remain in the row cache');
  const harnessSource = await readFile(new URL('../src/components/workshell/stitched-list-harness.ts', import.meta.url), 'utf8');
  const harnessAst = ts.createSourceFile('harness.ts', harnessSource, ts.ScriptTarget.Latest, true);
  const edge = harnessAst.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'useEdgeExtend');
  const frames = [];
  const React = { useRef: ref, useLayoutEffect: (run) => run(), useEffect: (run) => run() };
  const useEdgeExtend = new Function('React', 'requestAnimationFrame', 'cancelAnimationFrame',
    `${transpile(edge.getText(harnessAst).replace(/^export /, ''))}; return useEdgeExtend;`)(
    React, (run) => { frames.push(run); return frames.length; }, () => {},
  );
  Object.assign(app.scroller, { scrollTop: 0, scrollHeight: visible.length * 28, dataset: {},
    addEventListener() {}, removeEventListener() {} });
  useEdgeExtend({ scrollerRef: app.env.searchScrollerRef, rowCount: visible.length, thresholdPx: 60,
    canExtendBackward: false, canExtendForward: true, fillViewport: true,
    onExtend: callback('extendRange', app.env) });
  for (const run of frames) run();
  await settle();
  assert.equal(app.requests.length, 1);
  assert.equal(app.requests[0].fromDate, '2024-01-06', 'certified gaps are demanded before cached June rows');
  app.publish(app.jobs[0], [], baseForm.toDate, { complete: true });
  await settle();
});

test('a warm July viewport survives early January batches until the expanded query covers its anchor', async () => {
  assert.equal(typeof helpers.projectCoveredSearchRows, 'function');
  const dates = Array.from({ length: 366 }, (_, index) => helpers.addIsoDays(baseForm.fromDate, index));
  const retained = helpers.normalizeSearchStreamRows(dates.map((date, index) => row(date, index + 1)));
  const app = searchHarness({ rows: retained, rangeStream: stream(baseForm) });
  const visible = () => helpers.sortTransitSearchRows(
    helpers.projectCoveredSearchRows(app.state.rows, app.env.form, app.state.rangeStream), null,
  );
  const capture = () => callback('prepareObjectFilterChange', { ...app.env, sortedRows: visible() })();
  app.env.preserveSearchViewportRef.current = capture;
  app.scroller.clientHeight = 280;
  app.scroller.scrollTop = 182 * 28 + 7; // July 1 in the leap year, with a partial row at the top.
  capture();
  const anchor = app.env.objectFilterAnchorRef.current;
  assert.equal(retained[182].eventDate, '2024-07-01');
  const expanded = { ...baseForm, aspects: ['conjunction', 'opposition'] };
  app.refresh(expanded);
  await settle();
  const january = row('2024-01-15', 15.5, { aspect: 'opposition' });
  app.publish(app.jobs[0], [...retained.slice(0, 31), january], '2024-01-31', { complete: true, satisfied: true });
  await settle();
  assert.ok(app.state.rows === retained, 'the January prefix cannot replace or clamp a July viewport');
  assert.equal(app.scroller.scrollTop, 182 * 28 + 7);
  assert.equal(app.requests.length, 2, 'the preparation continues until it reaches the retained viewport');
  assert.equal(app.requests[1].fromDate, '2024-02-01', 'warm preparation advances beyond its completed prefix');
  const beforeLate = {
    rows: app.env.rowsRef.current, paintedRows: app.state.rows,
    stream: app.env.rangeStreamRef.current, progress: app.state.progress,
    session: app.env.currentSearchSessionRef.current,
  };
  assert.equal(beforeLate.session, app.jobs[1].id);
  app.jobs[0].apply({
    sessionId: app.jobs[0].id, phase: 'complete', complete: true, summary: '999 results',
    rows: [row('2024-11-01', 306.5, { aspect: 'opposition' })],
    cursor: { rangeFrom: baseForm.fromDate, rangeTo: baseForm.toDate,
      coverageFrom: baseForm.fromDate, coverageTo: baseForm.toDate,
      satisfied: true, exhaustedNext: true, exhausted: true },
  });
  assert.ok(app.env.rowsRef.current === beforeLate.rows, 'an earlier session in the same generation cannot add rows');
  assert.ok(app.state.rows === beforeLate.paintedRows, 'an earlier session cannot replace the retained paint');
  assert.ok(app.env.rangeStreamRef.current === beforeLate.stream, 'an earlier session cannot certify newer coverage');
  assert.ok(app.state.progress === beforeLate.progress, 'an earlier session cannot overwrite current progress');
  assert.equal(app.env.currentSearchSessionRef.current, beforeLate.session);
  const june = row('2024-06-15', 167.5, { aspect: 'opposition' });
  app.publish(app.jobs[1], [...retained.slice(31, 205), june], '2024-07-23', { complete: true, satisfied: true });
  await settle();
  const replacement = visible();
  assert.ok(replacement.length > 192, 'the accepted prefix includes the anchor and surrounding viewport');
  layoutEffectContaining('const anchor = objectFilterAnchorRef.current;', { ...app.env, sortedRows: replacement })();
  const index = replacement.findIndex((value) => value.key === anchor.rowKey);
  assert.equal(app.scroller.scrollTop, index * 28 + 7, 'insertions preserve the exact retained event and within-row offset');
  assert.ok(app.state.selectedRowKeys.has(anchor.rowKey));
  assert.equal(app.state.loading, false);
  assert.equal(helpers.searchActiveRangeStream(app.state.rangeStream, expanded).coverageTo, '2024-07-23');
});
