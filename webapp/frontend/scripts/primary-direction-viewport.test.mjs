// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = ts.createSourceFile('directions-view.tsx', readFileSync(new URL(
  '../src/components/workshell/directions-view.tsx', import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const transpile = code => ts.transpileModule(code, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
const names = ['parseDateMs', 'nearestDateIndex', 'scrollAnchorRowIndex',
  'capturePrimaryTimeViewport', 'restorePrimaryTimeViewport',
  'primaryDirectionContactKey', 'capturePrimaryRectificationViewport',
  'restorePrimaryRectificationViewport', 'createRectificationFocusHold',
  'startRectificationFocusHold', 'settleRectificationFocusHold',
  'releaseRectificationFocusHold', 'extendRectificationFocusHold', 'rectificationFocusHeld'];
const helpers = new Function('PRIMARY_FOCUS_ANCHOR', 'RECTIFICATION_FOCUS_ECHO_MS',
  'dispatchVirtualScrollSync', `${transpile(source.statements.filter(node => ts.isFunctionDeclaration(node)
    && names.includes(node.name?.text)).map(node => node.getText(source)).join('\n'))}
  return {${names.join(',')}};`)(0.25, 2000, scroller => scroller.syncs++);
const panel = source.statements.find(node => ts.isFunctionDeclaration(node)
  && node.name?.text === 'PrimaryDirectionsPanel');
function effect(fragment, env, layout = false) {
  let callback;
  function visit(node) {
    if (ts.isCallExpression(node)
      && node.expression.getText(source) === `React.${layout ? 'useLayoutEffect' : 'useEffect'}`
      && node.arguments[0]?.getText(source).includes(fragment)) callback = node.arguments[0];
    ts.forEachChild(node, visit);
  }
  visit(panel);
  assert.ok(callback, `mounted effect for ${fragment}`);
  return new Function(...Object.keys(env), `${transpile(`const run = ${callback.getText(source)};`)}
    return run;`)(...Object.values(env));
}
const ref = current => ({ current });
const settle = () => new Promise(resolve => setImmediate(resolve));
const rows = (count, every = 1) => Array.from({length: count}, (_, index) => ({
  date: new Date(Date.UTC(2000, 0, 1) + index * every * 86400000).toISOString(),
  signature: [index, -1, 0, 0, 0, true, false, 0, index, index, 0, 0, null, null, 0, 'zodiacal', 'direction'],
}));
const payload = directions => ({directions, meta: {}});
function harness({ resident = payload(rows(120)), cached = null, navigationKey = 'radix', mode = 'radix' } = {}) {
  const requests = [];
  const state = {payload: resident, loading: false, error: null};
  const scroller = {scrollTop: 1715, clientHeight: 370, syncs: 0};
  const request = (name, params, signal) => new Promise(resolve => requests.push({params, signal, resolve}));
  const env = {
    ...helpers, AbortController, queueMicrotask,
    React: {startTransition: run => run()},
    primaryRequestReady: true, requestSeqRef: ref(0),
    previousRequestRef: ref({navigationKey: 'radix', cacheKey: 'old-settings', radixRefreshSeq: 0}),
    navigationKey, payloadCacheKey: 'new-settings', settingsViewportRef: ref(null),
    rectificationViewportRef: ref(null), scrollerRef: ref(scroller),
    rectificationFocusHoldRef: ref(helpers.createRectificationFocusHold()),
    payloadRef: ref(resident), rowHeightRef: ref(37), focusDatetimeRef: ref('2000-01-01'),
    getCachedListPayload: () => cached, rememberListPayload: () => {},
    PRIMARY_DIRECTIONS_CACHE: 'directions:primary', PRIMARY_FIRST_PAINT_YEARS: 6,
    setPayload: data => {state.payload = data;},
    setLoading: value => {state.loading = value;}, setError: value => {state.error = value;},
    mode, direction: 0, sourceName: 'chart', documentId: 'doc', source: undefined,
    ageWindow: null, ageSeek: 'exact', customSignificator: null, optionsPreview: {},
    includeTemporal: false, payloadReferenceDatetime: null, year: null,
    radixRefreshSeq: 0,
    fetchDirections: request, fetchAnnualDirections: request,
  };
  return {
    env, requests, state, scroller,
    run: () => effect('const captureSettingsViewport', env)(),
    restore: () => effect('restorePrimaryTimeViewport', {
      ...env, active: true, rows: state.payload.directions,
    }, true)(),
    restoreRectification: () => effect('restorePrimaryRectificationViewport', {
      ...env, active: true, rows: state.payload.directions, rowHeight: 37,
    }, true)(),
  };
}

test('settings retain rows while computing, then restore time when row density changes', async () => {
  for (const mode of ['radix', 'sr', 'lr']) {
    const h = harness({mode});
    h.run();
    await settle();
    assert.equal(h.requests.length, 1);
    assert.equal(h.requests[0].params.focusSpanYears, undefined);
    assert.equal(h.state.payload, h.env.payloadRef.current);
    // Scrolling during calculation remains authoritative when the replacement arrives.
    h.scroller.scrollTop += 370;
    const before = helpers.capturePrimaryTimeViewport(h.scroller, h.state.payload.directions, 37, '2000-01-01');
    h.requests[0].resolve(payload(rows(240, 0.5)));
    await settle();
    h.restore();
    const after = helpers.capturePrimaryTimeViewport(h.scroller, h.state.payload.directions, 37, '2000-01-01');
    assert.equal(after.timeMs, before.timeMs, mode);
    assert.equal(after.rowOffset, before.rowOffset, mode);
    assert.equal(h.scroller.syncs, 1);
    assert.equal(h.env.settingsViewportRef.current, null);
  }
});

test('cached replacement retains time rather than the numeric row index', async () => {
  const h = harness({cached: payload(rows(80, 2))});
  const before = helpers.capturePrimaryTimeViewport(h.scroller, h.state.payload.directions, 37, '2000-01-01');
  h.run();
  await settle();
  h.restore();
  const after = helpers.capturePrimaryTimeViewport(h.scroller, h.state.payload.directions, 37, '2000-01-01');
  assert.equal(after.timeMs, before.timeMs);
  assert.equal(after.rowOffset, before.rowOffset);
});

test('rapid settings edits reject an older response', async () => {
  const h = harness();
  const cancel = h.run();
  await settle();
  cancel();
  h.env.payloadCacheKey = 'latest-settings';
  h.run();
  await settle();
  h.requests[0].resolve(payload(rows(60, 2)));
  await settle();
  assert.equal(h.state.payload, h.env.payloadRef.current);
  h.requests[1].resolve(payload(rows(240, 0.5)));
  await settle();
  assert.ok(h.env.settingsViewportRef.current);
  h.restore();
  assert.equal(h.env.settingsViewportRef.current, null);
});

test('cold loading still paints the focus slice before the full list', async () => {
  const h = harness({resident: null});
  h.run();
  await settle();
  assert.equal(h.requests[0].params.focusSpanYears, 6);
  const slice = payload(rows(20));
  h.requests[0].resolve(slice);
  await settle();
  assert.equal(h.state.payload, slice);
  assert.equal(h.requests.length, 2);
  h.requests[1].resolve(payload(rows(120)));
  await settle();
  assert.equal(h.state.payload.directions.length, 120);
});

test('calendar navigation and rectification retain their own anchoring contracts', async () => {
  for (const kind of ['navigation', 'rectification']) {
    const h = harness({navigationKey: kind === 'navigation' ? 'annual' : 'radix'});
    if (kind === 'rectification') h.env.rectificationViewportRef.current = {scrollTop: 1715, rowHeight: 37};
    h.run();
    await settle();
    h.requests[0].resolve(payload(rows(240, 0.5)));
    await settle();
    assert.equal(h.env.settingsViewportRef.current, null, kind);
  }
});

test('rectification keeps the lines in view still while a moving contact travels through them', async () => {
  for (const mode of ['radix', 'sr', 'lr']) {
    const h = harness({mode});
    const before = helpers.capturePrimaryRectificationViewport(h.scroller, h.state.payload.directions, 37);
    h.env.rectificationViewportRef.current = before;
    h.run();
    await settle();
    // A cursor/chrome commit must not consume the anchor against old rows.
    h.restoreRectification();
    assert.equal(h.env.rectificationViewportRef.current, before);
    // The middle contact (an angle direction, say) moves by months; the rest stay.
    const resident = h.state.payload.directions;
    const middle = Math.round((1715 + 370 / 2 - 37 / 2) / 37);
    const moved = {...resident[middle], date: resident[100].date, signature: [...resident[middle].signature]};
    moved.signature[8] += 0.25;
    moved.signature[9] += 10;
    const replacement = [...resident.slice(0, middle), ...resident.slice(middle + 1, 101), moved,
      ...resident.slice(101)];
    h.requests[0].resolve(payload(replacement));
    await settle();
    h.restoreRectification();
    assert.equal(h.scroller.scrollTop, 1715, mode);
    assert.equal(h.env.rectificationViewportRef.current, null);
    assert.equal(h.env.settingsViewportRef.current, null);
    assert.equal(h.scroller.syncs, 1);
  }
});

test('rectification holds the contact in view that moved least', () => {
  const h = harness();
  const before = helpers.capturePrimaryRectificationViewport(h.scroller, h.state.payload.directions, 37);
  h.env.rectificationViewportRef.current = before;
  // Every row moves; row 55 moves least, and lands at index 80: it keeps its screen line.
  const shifted = h.state.payload.directions.map((row, index) => ({
    ...row,
    date: new Date(Date.parse(row.date) + (index === 55 ? 1 : 30) * 86400000).toISOString(),
  }));
  [shifted[55], shifted[80]] = [shifted[80], shifted[55]];
  h.state.payload = payload(shifted);
  const held = before.contacts.find(contact =>
    contact.contactKey === helpers.primaryDirectionContactKey(shifted[80]));
  h.restoreRectification();
  assert.notEqual(h.scroller.scrollTop, 1715);
  assert.equal(80 - h.scroller.scrollTop / 37, held.rowOffset);
});

test('rectification contact identity distinguishes dynamic points, branches and provenance', () => {
  const row = rows(1)[0];
  for (const slot of [0, 1, 2, 3, 4, 5, 6, 7, 10, 11, 12, 13, 14, 15, 16]) {
    const other = {...row, signature: [...row.signature]};
    other.signature[slot] = 'different';
    assert.notEqual(helpers.primaryDirectionContactKey(other), helpers.primaryDirectionContactKey(row), slot);
  }
});

test('rectification falls back to surrounding time when the contact leaves the range', () => {
  const h = harness();
  const before = helpers.capturePrimaryRectificationViewport(h.scroller, h.state.payload.directions, 37);
  h.env.rectificationViewportRef.current = before;
  h.state.payload = payload(rows(240, 0.5).map(row => ({...row, signature: [-999]})));
  const nearest = helpers.nearestDateIndex(h.state.payload.directions, before.timeMs, row => row.date);
  h.restoreRectification();
  assert.equal(nearest - h.scroller.scrollTop / 37, before.rowOffset);
});

test('rectification waits for available rows and a visible viewport before restoring', () => {
  const h = harness();
  h.env.rectificationViewportRef.current = helpers.capturePrimaryRectificationViewport(
    h.scroller, h.state.payload.directions, 37);
  h.state.payload = payload([]);
  h.restoreRectification();
  assert.ok(h.env.rectificationViewportRef.current);
  h.state.payload = payload(rows(120));
  h.scroller.clientHeight = 0;
  h.restoreRectification();
  assert.ok(h.env.rectificationViewportRef.current);
  h.scroller.clientHeight = 370;
  h.restoreRectification();
  assert.equal(h.env.rectificationViewportRef.current, null);
});

test('settings suppress focus scrolling while a real chart step follows live', () => {
  const h = harness();
  h.env.settingsViewportRef.current = helpers.capturePrimaryTimeViewport(
    h.scroller, h.state.payload.directions, 37, '2000-01-01');
  let follows = 0;
  const follow = effect('scheduleFocusedDirectionScroll', {...h.env, active: true,
    focusIndex: 0, rows: h.state.payload.directions, PRIMARY_FOCUS_ANCHOR: 0.25,
    scheduleFocusedDirectionScroll: () => {follows++;},
  }, true);
  follow();
  assert.equal(follows, 0);
  h.env.focusDatetimeRef.current = '2000-01-02';
  follow();
  assert.equal(follows, 1);
  assert.equal(h.env.settingsViewportRef.current, null);
});

test('empty results retain the anchor until rows are available again', () => {
  const h = harness();
  h.env.settingsViewportRef.current = helpers.capturePrimaryTimeViewport(
    h.scroller, h.state.payload.directions, 37, '2000-01-01');
  h.state.payload = payload([]);
  h.restore();
  assert.ok(h.env.settingsViewportRef.current);
  h.state.payload = payload(rows(120));
  h.restore();
  assert.equal(h.env.settingsViewportRef.current, null);
});

test('repeated rectification steps absorb the radix focus echo instead of jumping to the focus', () => {
  const h = harness();
  let follows = 0;
  const follow = () => effect('scheduleFocusedDirectionScroll', {...h.env, active: true,
    focusIndex: 0, rows: h.state.payload.directions, PRIMARY_FOCUS_ANCHOR: 0.25,
    scheduleFocusedDirectionScroll: () => {follows++;},
  }, true)();
  const hold = h.env.rectificationFocusHoldRef.current;
  for (let step = 1; step <= 3; step++) {
    helpers.startRectificationFocusHold(hold);
    h.env.rectificationViewportRef.current = helpers.capturePrimaryRectificationViewport(
      h.scroller, h.state.payload.directions, 37);
    // Replacement rows restore and consume the contact anchor first.
    h.state.payload = payload(rows(120));
    h.restoreRectification();
    assert.equal(h.env.rectificationViewportRef.current, null);
    if (step === 2) {
      // The echo may also overtake the step's settle.
      h.env.focusDatetimeRef.current = `2000-01-01T00:0${step}:00`;
      follow();
      helpers.settleRectificationFocusHold(hold, h.env.focusDatetimeRef.current);
      // A later row refresh inside the window keeps the retained viewport.
      follow();
    } else {
      helpers.settleRectificationFocusHold(hold, h.env.focusDatetimeRef.current);
      h.env.focusDatetimeRef.current = `2000-01-01T00:0${step}:00`;
      follow();
    }
  }
  assert.equal(follows, 0);
  // Real navigation after the echo window follows the focus again.
  hold.until = 0;
  h.env.focusDatetimeRef.current = '2000-02-01';
  follow();
  assert.equal(follows, 1);
});

test('the rectification focus hold absorbs one echo, then expires', () => {
  const hold = helpers.createRectificationFocusHold();
  assert.equal(helpers.rectificationFocusHeld(hold, 'a', 0), false);
  helpers.startRectificationFocusHold(hold);
  assert.equal(helpers.rectificationFocusHeld(hold, 'b', 0), true);
  helpers.settleRectificationFocusHold(hold, 'a', 0);
  assert.equal(helpers.rectificationFocusHeld(hold, 'a', 100), true);
  assert.equal(helpers.rectificationFocusHeld(hold, 'b', 100), true);
  assert.equal(helpers.rectificationFocusHeld(hold, 'c', 100), false);
  helpers.settleRectificationFocusHold(hold, 'a', 0);
  assert.equal(helpers.rectificationFocusHeld(hold, 'a', 2000), false);
});

test('a slow replacement list keeps the focus hold open from when its rows land', () => {
  const hold = helpers.createRectificationFocusHold();
  helpers.startRectificationFocusHold(hold);
  helpers.settleRectificationFocusHold(hold, 'a', 0);
  helpers.extendRectificationFocusHold(hold, 2500);
  assert.equal(helpers.rectificationFocusHeld(hold, 'b', 3000), true);
  assert.equal(helpers.rectificationFocusHeld(hold, 'c', 3100), false);
  const absorbed = helpers.createRectificationFocusHold();
  helpers.settleRectificationFocusHold(absorbed, 'a', 0);
  helpers.releaseRectificationFocusHold(absorbed);
  helpers.extendRectificationFocusHold(absorbed, 2500);
  assert.equal(helpers.rectificationFocusHeld(absorbed, 'b', 3000), false);
});

test('a radix echo after the step holds the contacts in view, not the time', async () => {
  const h = harness();
  h.env.previousRequestRef.current = {navigationKey: 'radix', cacheKey: 'old-settings', radixRefreshSeq: -1};
  h.run();
  await settle();
  const resident = h.state.payload.directions;
  const middle = Math.round((1715 + 370 / 2 - 37 / 2) / 37);
  const moved = {...resident[middle], date: resident[100].date};
  h.requests[0].resolve(payload([...resident.slice(0, middle), ...resident.slice(middle + 1, 101), moved,
    ...resident.slice(101)]));
  await settle();
  assert.ok(h.env.rectificationViewportRef.current);
  assert.equal(h.env.settingsViewportRef.current, null);
  h.restoreRectification();
  assert.equal(h.scroller.scrollTop, 1715);
  assert.equal(h.env.rectificationViewportRef.current, null);
});
