// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const viewSource = await readFile(new URL('../src/components/workshell/transit-search-view.tsx', import.meta.url), 'utf8');
const clientSource = await readFile(new URL('../src/lib/daemon/client.ts', import.meta.url), 'utf8');
const parse = (source) => ts.createSourceFile('source.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const view = parse(viewSource);
const client = parse(clientSource);
const js = (source) => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const bind = (source, env, result) => new Function(...Object.keys(env), `${js(source)}; return ${result};`)(...Object.values(env));
function callback(name, env) {
  let expression;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(view) === name) expression = node.initializer.arguments[0];
    ts.forEachChild(node, visit);
  }
  visit(view);
  assert.ok(expression, `${name} must be the mounted Search callback`);
  return bind(`const callback = ${expression.getText(view)};`, env, 'callback');
}
function functions(ast, names, env) {
  const source = ast.statements.filter((node) => ts.isFunctionDeclaration(node) && names.includes(node.name?.text))
    .map((node) => node.getText(ast).replace(/^export /, '')).join('\n');
  return bind(source, env, `{${names.join(',')}}`);
}
const semantic = functions(view, ['searchSemanticQuery'], {});
const ref = (current) => ({ current });
const settle = () => new Promise((resolve) => setImmediate(resolve));
const form = {
  techniques: ['lunations', 'eclipses'], fromDate: '2024-01-01', toDate: '2124-01-01',
  promittorIds: [], significatorIds: ['planet:sun'], aspects: ['conjunction'],
  promittorMotion: '', significatorMotion: '', moonPhase: '', lunationOrb: 3, includeSignChanges: false, limit: 500,
};
function intentHarness() {
  const cancellations = [];
  const env = {
    ...semantic, lastAutoRequestKeyRef: ref("old-query"), formRef: ref(form), searchRequestSeqRef: ref(1), currentSearchSessionRef: ref('old-session'),
    searchControllerRef: ref(new AbortController()), rangeExtendControllerRef: ref(new AbortController()),
    rangeExtendInFlightRef: ref(true), setEdgeCheckNonce() {},
    setSearchProgress() {},
    setSearchLoading: (loading) => { env.loading = loading; },
    cancelTransitSearch: async (id) => { cancellations.push(id); },
  };
  return { env, cancellations, synchronize: callback('synchronizeSearchForm', env) };
}

test('narrowing to retained Lunations interrupts initial and continuation jobs before debounce', () => {
  const app = intentHarness();
  const initial = app.env.searchControllerRef.current;
  const continuation = app.env.rangeExtendControllerRef.current;
  const next = { ...form, techniques: ['lunations'] };
  app.synchronize(next);
  assert.equal(initial.signal.aborted, true);
  assert.equal(continuation.signal.aborted, true);
  assert.deepEqual(app.cancellations, ['old-session']);
  assert.equal(app.env.searchRequestSeqRef.current, 2);
  assert.equal(app.env.rangeExtendInFlightRef.current, false);
  assert.equal(app.env.loading, false);
  // Immediate refresh accepts the intent before starting its replacement;
  // the subsequent layout effect must not cancel that new producer.
  const replacement = new AbortController();
  app.env.searchControllerRef.current = replacement;
  app.env.currentSearchSessionRef.current = 'new-session';
  app.synchronize(next);
  assert.equal(replacement.signal.aborted, false);
  assert.equal(app.env.currentSearchSessionRef.current, 'new-session');
});

test('invalid combinations also cancel; presentation-only part filtering preserves the job', () => {
  const app = intentHarness();
  const initial = app.env.searchControllerRef.current;
  app.synchronize({ ...form, partFilter: 'Fortune' });
  assert.equal(initial.signal.aborted, false);
  app.synchronize({ ...form, techniques: [] });
  assert.equal(initial.signal.aborted, true);
  assert.deepEqual(app.cancellations, ['old-session']);
});

test('a retained refresh with no query delta still accepts and cancels the previous intent', () => {
  const app = intentHarness();
  const refresh = callback('refreshRetainedSearch', {
    synchronizeSearchForm: app.synchronize,
    rangeStreamRef: ref({ queryForm: form, coverageFrom: form.fromDate, coverageTo: '2024-04-30' }),
    retainedSearchNeedsRangeReplacement: () => false,
    retainedSearchDeltaPlan: () => ({ deltaForms: [], rangeForms: [], universeForm: form }),
    searchActiveRangeStream: (stream) => stream,
    saveSettings() {}, setRows() {}, setSummary() {}, rowsRef: ref([]), projectTransitSearchRows: () => [],
    searchRangeQueryKey: () => 'retained', setRangeStream() {}, t: () => '{count}',
  });
  refresh({ ...form, techniques: ['lunations'] });
  assert.deepEqual(app.cancellations, ['old-session']);
  assert.equal(app.env.loading, false);
});

test('an older retained replacement finalizer cannot clear the newer session or loading state', async () => {
  let finish;
  const cancellations = [];
  const env = {
    ...semantic, React: { startTransition: (run) => run() },
    contextMode: false, significatorId: null, chartRole: null, customPointsKey: '', optionsSeq: 0,
    formRef: ref(form), lastAutoRequestKeyRef: ref(''), searchScrollerRef: ref(null),
    objectFilterAnchorRef: ref(null), searchRowHeightRef: ref(28),
    rangeStreamRef: ref({ coverageFrom: '2024-01-01', coverageTo: '2024-04-30' }),
    searchRequestSeqRef: ref(0), currentSearchSessionRef: ref(null), searchControllerRef: ref(null),
    rangeExtendControllerRef: ref(null), rangeExtendInFlightRef: ref(false), rowsRef: ref([]), catalogRef: ref(null),
    setSearchLoading: (loading) => { env.loading = loading; }, setError() {}, saveSettings() {}, setSearchProgress() {},
    setRows() {}, setRangeStream() {}, setSelectedRowKeys() {}, setSummary() {}, setTimeDisplay() {},
    buildAutoRequestKey: () => 'retained', searchRangeQueryKey: () => 'retained',
    projectTransitSearchRows: (rows) => rows, projectCoveredSearchRows: (rows) => rows,
    searchSeedRange: (fromDate, toDate) => ({ fromDate, toDate }), buildRequest: (value) => value,
    SEARCH_INITIAL_MIN_ROWS: 48,
    startSearchRequest: async () => ({ sessionId: 'old-delta' }),
    followTransitSearchProgress: () => new Promise((resolve) => { finish = resolve; }),
    cancelTransitSearch: async (id) => { cancellations.push(id); },
  };
  // Facet changes now share the same actual replacement producer as cold
  // Search, instead of having a separate end-only delta finalizer.
  const execute = callback('executeSearch', env);
  execute(form, { persistSettings: false, displayForm: form });
  await settle();
  assert.equal(env.currentSearchSessionRef.current, 'old-delta');
  env.searchControllerRef.current.abort();
  env.searchControllerRef.current = new AbortController();
  env.currentSearchSessionRef.current = 'replacement';
  env.searchRequestSeqRef.current += 1;
  finish({ cursor: { coverageTo: '2024-04-30', exhaustedNext: true } });
  await settle();
  assert.equal(env.currentSearchSessionRef.current, 'replacement');
  assert.equal(env.loading, true);
});

test('a late initial-start acknowledgement cannot displace or finish the replacement search', async () => {
  let acknowledgeOld;
  let finishNew;
  let requestCount = 0;
  const cancelled = [];
  const state = { rows: ['retained'], rangeStream: null, summary: '', timeDisplay: null };
  const setter = (key) => (value) => { state[key] = typeof value === 'function' ? value(state[key]) : value; };
  const env = {
    ...semantic, React: { startTransition: (run) => run() },
    contextMode: false, significatorId: null, chartRole: null, customPointsKey: '', optionsSeq: 0,
    formRef: ref(form), searchRequestSeqRef: ref(0), lastAutoRequestKeyRef: ref(''),
    currentSearchSessionRef: ref(null), searchControllerRef: ref(null), rangeExtendControllerRef: ref(null),
    rangeExtendInFlightRef: ref(false), rowsRef: ref([]), rangeStreamRef: ref(null), catalogRef: ref(null), searchScrollerRef: ref(null),
    objectFilterAnchorRef: ref(null), searchRowHeightRef: ref(28),
    buildAutoRequestKey: () => 'query', searchRangeQueryKey: (value) => JSON.stringify(value),
    searchSeedRange: (fromDate, toDate) => ({ fromDate, toDate }), buildRequest: (value) => value,
    SEARCH_INITIAL_MIN_ROWS: 48, normalizeSearchStreamRows: (rows) => rows,
    EMPTY_SEARCH_ROWS: [], mergeSearchStreamRows: (_retained, incoming) => incoming,
    retainSearchQueryCoverage: (_retained, incoming) => incoming, preserveSearchViewportRef: ref(() => {}), setSearchProgress() {},
    searchActiveRangeStream: (stream) => stream,
    searchCursorPayloadReadyForSwap: (value) => value.complete || value.cursor?.satisfied,
    setRows: setter('rows'), setRangeStream: setter('rangeStream'), setSummary: setter('summary'),
    setTimeDisplay: setter('timeDisplay'), setSelectedRowKeys() {}, setError() {}, setEdgeCheckNonce() {},
    setSearchLoading: (loading) => { state.loading = loading; },
    requestAnimationFrame: (run) => run(), SEARCH_VIRTUAL_SCROLL_SYNC_EVENT: 'scroll',
    t: () => '{count}', projectTransitSearchRows: (rows) => rows, projectCoveredSearchRows: (rows) => rows,
    cancelTransitSearch: async (id) => { cancelled.push(id); },
    startSearchRequest: () => ++requestCount === 1
      ? new Promise((resolve) => { acknowledgeOld = resolve; })
      : Promise.resolve({ sessionId: 'replacement', complete: false, rows: [] }),
    followTransitSearchProgress: (_initial, _signal, apply) => new Promise((resolve) => {
      finishNew = () => {
        const result = { sessionId: 'replacement', rows: ['lunation-result'], complete: true, summary: '1',
          cursor: { rangeFrom: form.fromDate, rangeTo: form.toDate, coverageFrom: form.fromDate,
            coverageTo: form.toDate, exhaustedNext: true, satisfied: true } };
        apply(result);
        resolve(result);
      };
    }),
  };
  const execute = callback('executeSearch', env);
  const synchronize = callback('synchronizeSearchForm', env);
  execute(form);
  const next = { ...form, techniques: ['lunations'] };
  synchronize(next);
  execute(next);
  await settle();
  assert.deepEqual(state.rows, ['retained'], 'a replacement keeps the coherent cached rows until ready');
  assert.equal(env.currentSearchSessionRef.current, 'replacement');
  acknowledgeOld({ sessionId: 'late-old-start' });
  await settle();
  assert.deepEqual(cancelled, ['late-old-start']);
  assert.equal(env.currentSearchSessionRef.current, 'replacement');
  assert.equal(state.loading, true);
  finishNew();
  await settle();
  assert.deepEqual(state.rows, ['lunation-result']);
  assert.equal(state.loading, false);
  assert.equal(state.rangeStream.exhaustedNext, true);
});

test('aborting while the daemon accepts a start retains the acknowledgement and cancels its job', async () => {
  for (const endpoint of ['startTransitSearch', 'startTransitSearchContext', 'startTransitMonthExport']) {
    let acknowledge;
    const requests = [];
    const cancelled = [];
    const methods = functions(client, ['startCancellableTransitSearch', endpoint], {
      workspacePost: (path, body, signal) => {
        requests.push({ path, body, signal });
        return new Promise((resolve) => { acknowledge = resolve; });
      },
      transitSearchRequestBody: (params) => params, transitSearchContextRequestBody: (params) => params,
      nextTransitSearchOwnerGeneration: () => 123,
      cancelTransitSearch: async (id) => { cancelled.push(id); },
    });
    const controller = new AbortController();
    const pending = methods[endpoint]({ documentId: 'radix' }, controller.signal);
    controller.abort();
    assert.equal(requests.length, 1);
    assert.equal(requests[0].signal, undefined, 'start response must retain the daemon session ID');
    acknowledge({ sessionId: endpoint });
    await assert.rejects(pending, { name: 'AbortError' });
    assert.deepEqual(cancelled, [endpoint]);
    if (endpoint !== 'startTransitMonthExport') assert.equal(requests[0].body.ownerGeneration, 123);
    await assert.rejects(methods[endpoint]({}, controller.signal), { name: 'AbortError' });
    assert.equal(requests.length, 1, 'an already cancelled intent never starts work');
  }
});

test('aborting a progress long poll cancels the daemon immediately and ignores a late payload', async () => {
  let reply;
  const cancelled = [];
  const published = [];
  const { followTransitSearchProgress } = functions(client, ['followTransitSearchProgress'], {
    cancelTransitSearch: async (id) => { cancelled.push(id); },
    fetchTransitSearchProgress: () => new Promise((resolve) => { reply = resolve; }),
  });
  const controller = new AbortController();
  const initial = { sessionId: 'polling-job', revision: 1, complete: false };
  const pending = followTransitSearchProgress(initial, controller.signal, (value) => published.push(value));
  controller.abort();
  assert.deepEqual(cancelled, ['polling-job'], 'daemon cancellation cannot wait for the long poll');
  reply({ ...initial, revision: 2, complete: true });
  await assert.rejects(pending, { name: 'AbortError' });
  assert.deepEqual(published, [initial]);
});

test('completed progress removes its abort listener and an initially aborted follower publishes nothing', async () => {
  const cancelled = [];
  const published = [];
  const { followTransitSearchProgress } = functions(client, ['followTransitSearchProgress'], {
    cancelTransitSearch: async (id) => { cancelled.push(id); },
  });
  const controller = new AbortController();
  const final = { sessionId: 'complete-job', complete: true };
  await followTransitSearchProgress(final, controller.signal, (value) => published.push(value));
  controller.abort();
  assert.deepEqual(cancelled, []);
  await assert.rejects(followTransitSearchProgress(final, controller.signal, () => assert.fail('stale publication')), { name: 'AbortError' });
  assert.deepEqual(cancelled, ['complete-job']);
});

 test('empty/partial date drafts cancel and restoring the identical query invalidates its request key', () => {
  const app = intentHarness();
  app.synchronize(null);
  assert.equal(app.env.lastAutoRequestKeyRef.current, '');
  assert.equal(app.env.formRef.current, null);
  assert.deepEqual(app.cancellations, ['old-session']);
  app.env.lastAutoRequestKeyRef.current = 'stale-key';
  app.synchronize(form);
  assert.equal(app.env.lastAutoRequestKeyRef.current, '');
  assert.deepEqual(app.env.formRef.current, form);
 });

 test('manual dates reject partial, impossible and reversed ranges and recover when restored', () => {
  const { canRunSearch } = functions(view, ['canRunSearch', 'searchDatesValid'], {});
  for (const fromDate of ['', '198', '1988-02-30', '0000-01-01', '9999-99-99', '2125-01-01']) {
    assert.equal(canRunSearch({ ...form, fromDate }), false, fromDate);
    assert.equal(canRunSearch(form), true);
  }
  assert.equal(canRunSearch({ ...form, fromDate: '2000-02-29' }), true);
  assert.equal(canRunSearch({ ...form, fromDate: '1900-02-29' }), false);
 });

 test('the actual date editor suspends transient drafts and restores the same valid intent on blur', async () => {
  const dateSource = await readFile(new URL('../src/lib/date-display.ts', import.meta.url), 'utf8');
  const dates = functions(parse(dateSource), ['parseDateDisplayInput', 'validDateToIso', 'daysInMonth', 'isLeapYear'], {});
  const app = intentHarness();
  let draft;
  const commit = callback('commitInput', {
    ...dates, convention: 'current', value: form.fromDate, formattedValue: form.fromDate,
    formatValue: (value) => value, setDraft: (value) => { draft = value; },
    onChange: () => assert.fail('invalid drafts cannot become persisted query dates'),
    onValidityChange: (valid) => app.synchronize(valid ? form : null),
  });
  for (const value of ['', '202', '2024-', '2024-02-30']) {
    assert.equal(commit(value, false), false);
    assert.equal(app.env.formRef.current, null);
  }
  assert.equal(commit('', true), false);
  assert.equal(draft, form.fromDate);
  assert.deepEqual(app.env.formRef.current, form);
  assert.equal(app.env.lastAutoRequestKeyRef.current, '');
 });

test('a retained projection publishes accepted rows even if the old React transition never committed', () => {
  const app = intentHarness();
  const acceptedRows = ['accepted-before-transition'];
  const stream = { queryForm: form, coverageFrom: form.fromDate, coverageTo: '2024-04-30' };
  let visibleRows = ['previous-paint'];
  let visibleStream;
  const refresh = callback('refreshRetainedSearch', {
    synchronizeSearchForm: app.synchronize, rangeStreamRef: ref(stream),
    retainedSearchNeedsRangeReplacement: () => false,
    retainedSearchDeltaPlan: () => ({ deltaForms: [], rangeForms: [], universeForm: form }),
    searchActiveRangeStream: (stream) => stream,
    saveSettings() {}, setSummary() {}, rowsRef: ref(acceptedRows),
    projectTransitSearchRows: (rows) => rows, searchRangeQueryKey: () => 'retained',
    setRows: (rows) => { visibleRows = rows; }, setRangeStream: (value) => { visibleStream = value; },
    t: () => '{count}',
  });
  refresh({ ...form, techniques: ['lunations'] });
  assert.deepEqual(visibleRows, acceptedRows);
  assert.equal(visibleStream, stream);
});
