// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later
// Request-ordering contract shared by every retained/stitched list
// (Progressions, Transits, Synodic, Eclipses, generic tables).
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../src/lib/table/retained-list-requests.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { createRetainedListRequests } = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);

test('a superseded replacement can neither publish nor clear the newer load', () => {
  const requests = createRetainedListRequests(null);
  const old = requests.replace();
  const next = requests.replace();
  assert.equal(old.signal.aborted, true);
  assert.equal(old.publish('old'), false);
  assert.equal(old.finish(), false);
  old.cancel();
  assert.equal(requests.loading, true);
  assert.equal(next.publish('new'), true);
  assert.equal(requests.accepted(), 'new');
  assert.equal(next.finish(), true);
  assert.equal(requests.busy, false);
});

test('accepted data is extension authority synchronously, before React paints', () => {
  const requests = createRetainedListRequests({ range: [12, 14] });
  assert.equal(requests.extend(), null, 'cached seed is not authority until a load is accepted');
  const replacement = requests.replace();
  assert.equal(requests.extend(), null, 'no extension while a replacement is in flight');
  replacement.publish({ range: [40, 42] });
  replacement.finish();
  const extension = requests.extend();
  assert.ok(extension);
  assert.deepEqual(requests.accepted().range, [40, 42]);
});

test('a replacement aborts the running extension and lets the new list extend again', () => {
  const requests = createRetainedListRequests(null);
  const first = requests.replace();
  first.publish('a');
  first.finish();
  const extension = requests.extend();
  assert.equal(requests.extend(), null, 'one extension at a time');
  const second = requests.replace();
  assert.equal(extension.signal.aborted, true);
  assert.equal(extension.publish('a+'), false);
  assert.equal(extension.finish(), false);
  second.publish('b');
  second.finish();
  assert.equal(requests.extending, false);
  assert.ok(requests.extend(), 'a stale extension cannot block the replacement from growing');
});

test('unmount cancels every request and no late write survives', () => {
  const requests = createRetainedListRequests(null);
  const load = requests.replace();
  load.publish('a');
  load.finish();
  const extension = requests.extend();
  requests.cancel();
  assert.equal(extension.signal.aborted, true);
  assert.equal(extension.publish('late'), false);
  assert.equal(requests.accepted(), 'a');
});

test('cancelling an extension leaves the accepted list usable', () => {
  const requests = createRetainedListRequests(null);
  const load = requests.replace();
  load.publish('a');
  load.finish();
  requests.extend().cancel();
  assert.equal(requests.busy, false);
  assert.ok(requests.extend());
});

test('reset for a new owner drops work and reseeds accepted data', () => {
  const requests = createRetainedListRequests('chart-a');
  const load = requests.replace();
  requests.reset('chart-b');
  assert.equal(load.signal.aborted, true);
  assert.equal(load.publish('chart-a rows'), false);
  assert.equal(requests.accepted(), 'chart-b');
});

test('subscribers hear the idle edge after an aborted extension is replaced by unchanged rows', () => {
  const requests = createRetainedListRequests(null);
  const edges = [];
  requests.subscribe(() => edges.push(requests.busy ? 'busy' : 'idle'));
  const load = requests.replace();
  load.publish('rows');
  load.finish();
  requests.extend();
  const tick = requests.replace();
  tick.publish('rows');
  tick.finish();
  assert.deepEqual(edges, ['idle', 'busy', 'idle']);
});
