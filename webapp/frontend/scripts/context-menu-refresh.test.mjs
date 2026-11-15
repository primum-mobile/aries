// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../src/lib/context-menu-refresh.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022,
} }).outputText;
const { createContextMenuRefresh } = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
function harness() {
  const requests = [];
  const commits = [];
  const gate = createContextMenuRefresh(() => new Promise((resolve, reject) => {
    requests.push({ resolve, reject });
  }), payload => commits.push(payload));
  return { gate, requests, commits };
}

test('an old open-menu response cannot reverse an acknowledged asteroid toggle', async () => {
  const { gate, requests, commits } = harness();
  const opening = gate.refresh();
  const oldResult = assert.rejects(opening, { name: 'AbortError' });
  const changed = gate.refresh();
  requests[1].resolve({ checked: true });
  await changed;
  requests[0].resolve({ checked: false });
  await oldResult;
  assert.deepEqual(commits, [{ checked: true }]);
});

test('closed or replaced menu contexts reject late responses even if transport ignores abort', async () => {
  const { gate, requests, commits } = harness();
  const controller = new AbortController();
  const aborted = assert.rejects(gate.refresh(controller.signal), { name: 'AbortError' });
  controller.abort();
  requests[0].resolve({ checked: false });
  await aborted;
  const replaced = assert.rejects(gate.refresh(), { name: 'AbortError' });
  gate.dispose();
  requests[1].resolve({ checked: true });
  await replaced;
  await assert.rejects(gate.refresh(), { name: 'AbortError' });
  assert.equal(requests.length, 2);
  assert.deepEqual(commits, []);
});

test('late errors cannot clear newer rows and current failures preserve retained rows', async () => {
  const { gate, requests, commits } = harness();
  const old = assert.rejects(gate.refresh(), { name: 'AbortError' });
  const current = gate.refresh();
  requests[1].resolve({ checked: true });
  await current;
  requests[0].reject(new Error('old transport failure'));
  await old;
  const failed = assert.rejects(gate.refresh(), /current transport failure/);
  requests[2].reject(new Error('current transport failure'));
  await failed;
  assert.deepEqual(commits, [{ checked: true }]);
});

test('effect setup/cleanup replay restores the retained menu gate', async () => {
  const { gate, requests, commits } = harness();
  gate.activate();
  const old = assert.rejects(gate.refresh(), { name: 'AbortError' });
  gate.dispose();
  gate.activate();
  const current = gate.refresh();
  requests[0].resolve({ checked: false });
  await old;
  requests[1].resolve({ checked: true });
  await current;
  assert.deepEqual(commits, [{ checked: true }]);
});
