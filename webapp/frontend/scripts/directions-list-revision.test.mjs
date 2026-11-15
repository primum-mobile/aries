// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
import { create } from 'zustand';

// Switching the right pane to another list (e.g. Transit) unmounts the
// Directions view. Its stitched-progressions cache outlives the mount, so the
// radix identity in that cache key must outlive it too: a per-mount counter
// restarted at 0 and re-keyed a remounted list onto rows cached before an edit.
const transpile = source => ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022,
} }).outputText;
let source = transpile(await readFile(new URL('../src/stores/daemon-workspace-store.ts', import.meta.url), 'utf8'));
source = source.replace(/^import[\s\S]*?from ["'][^"']+["'];\s*/gm, '');
source = source.slice(0, source.indexOf('// Subscription manager'));
// The shared step-burst envelope, driven by the tests below.
const burst = { active: false, listeners: new Set(), echo: () => false };
const setBurst = (active) => {
  burst.active = active;
  for (const listener of burst.listeners) listener();
};
const store = new Function('create', 'isSettledStepEcho', 'isStepBurstActive', 'subscribeStepBurst',
  source.replace('export const useDaemonWorkspaceStore', 'const useDaemonWorkspaceStore') + '\nreturn useDaemonWorkspaceStore;',
)(create, (...args) => burst.echo(...args), () => burst.active, (listener) => {
  burst.listeners.add(listener);
  return () => burst.listeners.delete(listener);
});

const directionsSource = await readFile(new URL('../src/components/workshell/directions-view.tsx', import.meta.url), 'utf8');

/** The radix seq a freshly mounted Directions view keys its caches with. */
function mountSeq(documentId, cursorDocumentId = documentId) {
  const revisions = store.getState().listDataRevisionByDocument;
  return Math.max(revisions[documentId] ?? 0, revisions[cursorDocumentId] ?? 0);
}
const session = change => store.getState()._applySessionChange({ docId: null, rebuiltChildIds: [], ...change });

test('an edit made while the progressions list is unmounted re-keys it on return', () => {
  session({ docId: 'radix', changeReason: 'edit' });
  const before = mountSeq('radix');
  // Switch to the Transit list: the Directions view unmounts. Edit the radix.
  session({ docId: 'radix', changeReason: 'edit' });
  const after = mountSeq('radix');
  assert.notEqual(after, before, 'remount must not reuse the pre-edit cache key');
  // A rebuilt derived/cursor chart counts too.
  session({ docId: 'other', changeReason: 'edit', rebuiltChildIds: ['cursor-child'] });
  assert.notEqual(mountSeq('radix', 'cursor-child'), after);
});

test('a warm reopen with nothing semantic changed keeps the cached key', () => {
  session({ docId: 'warm', changeReason: 'edit' });
  const before = mountSeq('warm');
  session({ docId: 'warm', changeReason: 'step' });
  session({ docId: 'warm', changeReason: 'display-overlay', rebuiltChildIds: ['warm'] });
  session({ docId: 'warm', changeReason: 'options', rebuiltChildIds: ['warm'], listDataChanged: false });
  session({ docId: 'unrelated', changeReason: 'edit' });
  assert.equal(mountSeq('warm'), before);
});

test('the revision uses the same seq live lists receive from lastSessionChange', () => {
  session({ docId: 'live', changeReason: 'edit' });
  assert.equal(store.getState().listDataRevisionByDocument.live, store.getState().lastSessionChange.seq);
});

test('the Directions radix hook seeds from the durable revision, not a per-mount zero', () => {
  const hook = directionsSource.slice(
    directionsSource.indexOf('function useDirectionsRadixRefreshSeq('),
    directionsSource.indexOf('/** Saved Directions glyph colouring'),
  );
  assert.match(hook, /useRadixListRevision\(\[documentId, cursorDocumentId\]\)/);
  // A mounted list follows the durable revision, so a later event cannot hide an edit.
  assert.match(hook, /gateRef\.current\.observe\(durableSeq\)/);
  assert.match(hook, /useState\(\(\) => \(\{ idsKey, seq: durableSeq \}\)\)/);
  assert.doesNotMatch(hook, /useState\(0\)/);
  // Rectification refreshes use tokens that can never equal a daemon seq.
  assert.match(hook, /directionsRectificationToken -= 1/);
  assert.doesNotMatch(directionsSource, /localRectificationSeq/);
});

test('a remounted progressions list restores its scroll only for an unchanged focus', () => {
  assert.match(
    directionsSource,
    /cachedViewState\?\.viewportFocusDatetime === \(focusDatetime \?\? null\)\s*\? cachedViewState\?\.viewport \?\? null\s*: null/,
  );
  assert.match(directionsSource, /viewportFocusDatetime: focusDatetimeRef\.current/);
});

// A rectification commit refreshes the list under a local token and holds its
// daemon echo back; any other revision of that window must still apply.
const gateSource = transpile(await readFile(new URL('../src/components/workshell/radix-revision-gate.ts', import.meta.url), 'utf8'));
const { createRadixRevisionGate } = await import(`data:text/javascript;base64,${Buffer.from(gateSource).toString('base64')}`);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function gateHarness() {
  const state = { inFlight: false, until: 0, applied: [] };
  const gate = createRadixRevisionGate({
    suppressedForMs: () => state.inFlight ? Infinity : Math.max(0, state.until - Date.now()),
    apply: seq => state.applied.push(seq),
  });
  const commit = () => {
    state.inFlight = false;
    state.until = Date.now() + 30;
    gate.expectEcho();
  };
  return { state, gate, commit };
}

test('a revision arriving inside the rectification window is applied afterwards', async () => {
  const { state, gate, commit } = gateHarness();
  state.inFlight = true;
  commit();
  gate.observe(11); // the commit's own echo
  gate.observe(12); // a real edit inside the window
  assert.deepEqual(state.applied, [], 'held back while the window runs');
  await wait(60);
  assert.deepEqual(state.applied, [12], 'the newest revision applies once the window has passed');
  gate.dispose();
});

test('the echo of a rectification commit alone does not refresh the list twice', async () => {
  const { state, gate, commit } = gateHarness();
  state.inFlight = true;
  gate.observe(21); // the echo can overtake the commit response
  commit();
  await wait(60);
  assert.deepEqual(state.applied, []);
  // Outside any window a revision applies at once.
  gate.observe(22);
  assert.deepEqual(state.applied, [22]);
  gate.dispose();
});

test('a revision held by a step that settles without a commit still applies', async () => {
  const { state, gate } = gateHarness();
  state.inFlight = true;
  gate.observe(31);
  await wait(20);
  assert.deepEqual(state.applied, []);
  state.inFlight = false;
  await wait(150);
  assert.deepEqual(state.applied, [31]);
  gate.dispose();
});

test('an echo landing just after the window is still the commit echo', async () => {
  const { state, gate, commit } = gateHarness();
  state.inFlight = true;
  commit();
  await wait(60);
  // The daemon answers the list request first, so the echo misses the window.
  gate.observe(41);
  assert.deepEqual(state.applied, [], 'the late echo is absorbed');
  gate.observe(42);
  assert.deepEqual(state.applied, [42], 'the next revision is a real edit');
  gate.dispose();
});

test('a late echo of one step does not cost the next step its own echo', async () => {
  const { state, gate, commit } = gateHarness();
  state.inFlight = true;
  commit();
  await wait(60);
  state.inFlight = true; // the next step starts before the first echo lands
  gate.observe(51); // first step's late echo
  commit();
  gate.observe(52); // second step's echo
  await wait(60);
  assert.deepEqual(state.applied, []);
  gate.dispose();
});

const radixSeq = (id) => store.getState().radixListDataRevisionByDocument[id] ?? 0;

test('a step that replaced the radix is a radix-list revision; a cursor step is not', () => {
  session({ docId: 'stepper', changeReason: 'edit' });
  const before = radixSeq('stepper');
  assert.equal(before, mountSeq('stepper'), 'edits reach both revisions');
  session({ docId: 'stepper', changeReason: 'step' });
  session({ docId: 'stepper', changeReason: 'step', rebuiltChildIds: ['derived-child'] });
  assert.equal(radixSeq('stepper'), before, 'cursor and derived-chart steps keep every list');
  assert.equal(radixSeq('derived-child'), 0);
  const durable = mountSeq('stepper');
  session({ docId: 'stepper', changeReason: 'step', listDataChanged: true });
  assert.notEqual(radixSeq('stepper'), before, 'a radix step reloads radix-derived lists');
  assert.equal(mountSeq('stepper'), durable, 'lists that never read the radix (Synodic) keep their rows');
});

test('a burst of radix steps changes the revision subscribers see exactly once', () => {
  session({ docId: 'burst', changeReason: 'edit' });
  const seen = [];
  let lastRadix = radixSeq('burst');
  let lastDurable = mountSeq('burst');
  const unsubscribe = store.subscribe((state) => {
    const radix = state.radixListDataRevisionByDocument.burst ?? 0;
    const durable = state.listDataRevisionByDocument.burst ?? 0;
    if (radix !== lastRadix) seen.push(['radix', radix]);
    if (durable !== lastDurable) seen.push(['durable', durable]);
    lastRadix = radix;
    lastDurable = durable;
  });
  setBurst(true);
  for (let i = 0; i < 12; i += 1) {
    session({ docId: 'burst', changeReason: 'step', listDataChanged: true, displayDatetime: `t${i}` });
  }
  assert.deepEqual(seen, [], 'no subscriber hears a revision change during the burst');
  setBurst(false);
  assert.equal(seen.length, 1, 'the completion edge publishes one revision');
  assert.equal(seen[0][0], 'radix');
  // The daemon's trailing echo of the final step carries nothing new.
  burst.echo = (docId, displayDatetime) => docId === 'burst' && displayDatetime === 't11';
  session({ docId: 'burst', changeReason: 'step', listDataChanged: true, displayDatetime: 't11' });
  burst.echo = () => false;
  assert.equal(seen.length, 1, 'no second refresh for the trailing echo');
  // Ordinary cursor steps, in a burst or not, change nothing.
  setBurst(true);
  session({ docId: 'burst', changeReason: 'step', displayDatetime: 'c1' });
  setBurst(false);
  session({ docId: 'burst', changeReason: 'step', displayDatetime: 'c2' });
  assert.equal(seen.length, 1);
  // A non-step edit outside a burst propagates at once.
  session({ docId: 'burst', changeReason: 'edit' });
  assert.equal(seen.filter(([kind]) => kind === 'radix').length, 2);
  unsubscribe();
});

const optionsEvent = (change) => store.getState()._applyOptionsChange({
  refreshedDocumentIds: [], schemaVersion: 1, themeVersion: 1, styleRevision: 1, paletteHash: 'p', styleHash: 's',
  ...change,
});

test('the secondary progression key follows options events, house switches included', () => {
  optionsEvent({ secondaryProgressionsDataKey: 'o1' });
  assert.equal(store.getState().secondaryProgressionsDataKey, 'o1');
  // An options change that leaves the key as it is: the list sees no change.
  optionsEvent({ secondaryProgressionsDataKey: 'o1', listDataDomain: 'primaryDirections' });
  assert.equal(store.getState().secondaryProgressionsDataKey, 'o1');
  // Radix cusps are progression targets: a house-system switch moves the key.
  optionsEvent({ secondaryProgressionsDataKey: 'o2', listDataDomain: 'houses' });
  assert.equal(store.getState().secondaryProgressionsDataKey, 'o2');
  // An event without the key (older daemon) keeps the last known one.
  optionsEvent({});
  assert.equal(store.getState().secondaryProgressionsDataKey, 'o2');
});

test('the progressions list keys on the daemon dataKey, not on options or radix counters', () => {
  const panel = directionsSource.slice(
    directionsSource.indexOf('function SecondaryDirectionsPanel('),
    directionsSource.indexOf('// Grow coverage by one adjacent chunk.'),
  );
  assert.match(panel, /state\.secondaryProgressionsDataKey/);
  assert.doesNotMatch(panel, /useDirectionsOptionsSeq|useHouseFreeListOptionsRevision|useDebouncedValue/);
  assert.doesNotMatch(panel, /listCacheKey\(\{[^}]*radixRefreshSeq/);
  assert.match(panel, /fetchSecondaryDirectionsDataKey\(/);
});

test('the Primary list stays mounted behind Secondary and follows every revision there', () => {
  // Kept mounted once visited, so a switch back shows its retained rows.
  assert.match(directionsSource, /<TabsContent\s+value="primary"\s+keepMounted/);
  assert.match(directionsSource, /visitedTabs\.has\("primary"\) && visitedSurfaces\.has\("directions"\)/);
  // One radix revision for both tabs, from the view: a step or a rectification
  // in either tab reaches the other while it is behind.
  assert.match(directionsSource, /useDirectionsRadixRefreshSeq\(\s*documentId,/);
  assert.equal((directionsSource.match(/radixRefreshSeq=\{directionRadixRefreshSeq\}/g) ?? []).length, 3);
  const panel = directionsSource.slice(
    directionsSource.indexOf('function PrimaryDirectionsPanel('),
    directionsSource.indexOf('const onPrimarySettingsLoaded'),
  );
  // Its rows key on the radix revision and the options context, and the load
  // effect never waits for the tab: it reloads behind the sibling.
  const cacheKey = /const payloadCacheKey = React\.useMemo\([\s\S]*?\);/.exec(panel)[0];
  assert.match(cacheKey, /radixRefreshSeq/);
  assert.match(cacheKey, /optionsContextKey/);
  const loadDeps = /\}, \[sourceName, source, documentId, direction, mode[^\]]*\]\);/.exec(panel)[0];
  assert.doesNotMatch(loadDeps, /\bactive\b/);
  assert.match(loadDeps, /radixRefreshSeq/);
  // The radix revision it reads is the store's radix-list revision, which
  // carries edits as well as settled radix steps.
  assert.match(directionsSource, /useRadixListRevision\(\[documentId, cursorDocumentId\]\)/);
});

test('a radix edit and a settled radix step both reach the radix-list revision', () => {
  session({ docId: 'tabs', changeReason: 'edit' });
  const edited = radixSeq('tabs');
  assert.ok(edited > 0);
  setBurst(true);
  session({ docId: 'tabs', changeReason: 'step', listDataChanged: true, displayDatetime: 'x1' });
  assert.equal(radixSeq('tabs'), edited, 'held during the burst');
  setBurst(false);
  assert.ok(radixSeq('tabs') > edited, 'lands once on the completion edge');
});
