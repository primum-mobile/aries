// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../src/components/workshell/home-client.tsx', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('home-client.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let effect;
function visit(node) {
  if (ts.isCallExpression(node) && node.expression.getText(parsed) === 'useEffect'
      && node.arguments[0]?.getText(parsed).includes('fetchSidebarListPreferences(')) effect = node;
  ts.forEachChild(node, visit);
}
visit(parsed);
assert.ok(effect, 'the mounted shell must hydrate saved list preferences');
const js = ts.transpileModule(effect.getText(parsed), {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
const renderEffect = new Function('useEffect', 'daemonConnection', 'sidebarListPreferencesHydrated',
  'fetchSidebarListPreferences', 'hydrateSidebarListPreferences', 'console', js);

function harness(fetchPreferences) {
  let previousDeps;
  let cleanup;
  let hydrated = false;
  const received = [];
  const hydrate = (payload) => { hydrated = true; received.push(payload); };
  const useEffect = (run, deps) => {
    if (previousDeps && deps.every((value, index) => Object.is(value, previousDeps[index]))) return;
    cleanup?.();
    previousDeps = deps;
    cleanup = run();
  };
  return {
    received,
    render(connection) {
      renderEffect(useEffect, connection, hydrated, fetchPreferences, hydrate, {warn() {}});
    },
  };
}
const settle = () => new Promise((resolve) => setImmediate(resolve));

test('slow daemon startup does not strand Transit waiting for saved preferences', async () => {
  const saved = {transitList: {selectedPointIds: ['asteroid:75100'], selectedAspectIds: []}};
  let available = false;
  let requests = 0;
  const app = harness(async () => {
    requests += 1;
    if (!available) throw new TypeError('Load failed');
    return saved;
  });
  app.render('connecting');
  await settle();
  assert.equal(requests, 0);
  available = true;
  app.render('open');
  await settle();
  assert.deepEqual(app.received, [saved]);
  app.render('open');
  app.render('closed');
  app.render('open');
  assert.equal(requests, 1, 'hydrated preferences survive reconnects without extra requests');
});

test('failed preference load retries after reconnect without inventing defaults', async () => {
  let requests = 0;
  const saved = {transitList: {selectedPointIds: []}};
  const app = harness(async () => {
    if (++requests === 1) throw new TypeError('Load failed');
    return saved;
  });
  app.render('open');
  await settle();
  assert.deepEqual(app.received, []);
  app.render('closed');
  app.render('open');
  await settle();
  assert.deepEqual(app.received, [saved]);
});

test('an aborted connection cannot hydrate a late stale response', async () => {
  let finish;
  let signal;
  const app = harness((requestSignal) => {
    signal = requestSignal;
    return new Promise((resolve) => { finish = resolve; });
  });
  app.render('open');
  app.render('closed');
  assert.equal(signal.aborted, true);
  finish({transitList: {selectedPointIds: ['planet:sun']}});
  await settle();
  assert.deepEqual(app.received, []);
});
