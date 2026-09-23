// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
const require = createRequire(import.meta.url);
function harness() {
  const calls = [];
  const mod = { exports: {} };
  const code = ts.transpileModule(readFileSync(new URL('../src/stores/event-notes-store.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const request = (kind, args) => new Promise((resolve, reject) => calls.push({ kind, args, resolve, reject }));
  new Function('require', 'module', 'exports', code)(id => id === '@/lib/daemon/client'
    ? { fetchNotes: (...args) => request('read', args), saveNotes: (...args) => request('write', args) }
    : require(id), mod, mod.exports);
  return { store: mod.exports.useEventNotesStore, key: mod.exports.eventNoteKey, calls };
}
const a = { recordId: 'chart-a', eventId: 'event', name: 'Journey' };
const tick = () => new Promise(resolve => setImmediate(resolve));
async function loaded(h, target = a) {
  const pending = h.store.getState().load(target);
  h.calls.at(-1).resolve({ content: 'Original', revision: 'r1' });
  await pending;
}

test('warm previews reuse notes, and identical event IDs on different charts stay separate', async () => {
  const h = harness(); await loaded(h);
  await h.store.getState().load(a);
  assert.equal(h.calls.length, 1);
  const b = { ...a, recordId: 'chart-b' };
  const pending = h.store.getState().load(b);
  h.calls.at(-1).resolve({ content: 'Other chart note', revision: 'b1' }); await pending;
  assert.equal(h.store.getState().notes[h.key(a)].text, 'Original');
  assert.equal(h.store.getState().notes[h.key(b)].text, 'Other chart note');
});

test('serialized autosaves retain edits made while saving and advance the revision', async () => {
  const h = harness(); await loaded(h);
  h.store.getState().edit(a, 'First draft');
  const saved = h.store.getState().flush(h.key(a)); await tick();
  h.store.getState().edit(a, 'Latest draft');
  assert.equal(h.calls[1].args[1], 'First draft');
  assert.equal(h.calls[1].args[2].revision, 'r1');
  h.calls[1].resolve({ revision: 'r2' }); await tick();
  assert.equal(h.calls[2].args[1], 'Latest draft');
  assert.deepEqual(h.calls[2].args[2], { recordId: a.recordId, eventId: a.eventId, revision: 'r2' });
  h.calls[2].resolve({ revision: 'r3' }); await saved;
  assert.equal(h.store.getState().notes[h.key(a)].saved, 'Latest draft');
});

test('a refresh racing with typing cannot overwrite the draft or its base revision', async () => {
  const h = harness(); await loaded(h);
  const refreshing = h.store.getState().load(a, undefined, true);
  h.store.getState().edit(a, 'Typed during refresh');
  h.calls[1].resolve({ content: 'External update', revision: 'r2' }); await refreshing;
  const note = h.store.getState().notes[h.key(a)];
  assert.equal(note.text, 'Typed during refresh'); assert.equal(note.revision, 'r1');
  const saved = h.store.getState().flush(h.key(a)); await tick();
  h.calls[2].reject(Object.assign(new Error('conflict'), { name: 'NoteConflict' })); await saved;
  assert.equal(h.store.getState().notes[h.key(a)].error, 'notes.externalConflict');
  assert.equal(h.store.getState().notes[h.key(a)].text, 'Typed during refresh');
});

test('read concurrency is bounded and a virtual row leaving the viewport cancels its queued read', async () => {
  const h = harness();
  const controllers = Array.from({ length: 5 }, () => new AbortController());
  const pending = controllers.map((ctrl, index) => h.store.getState().load({ ...a, eventId: `e${index}` }, ctrl.signal));
  assert.equal(h.calls.length, 4);
  controllers[4].abort();
  h.calls.slice(0, 4).forEach(call => call.resolve({ content: '', revision: 'r1' }));
  await Promise.all(pending);
  assert.equal(h.calls.length, 4);
});

test('failed saves retain drafts for a later flush even after the row disappears', async () => {
  const h = harness(); await loaded(h);
  h.store.getState().edit(a, 'Preserve this');
  const first = h.store.getState().flushAll(); await tick();
  h.calls[1].reject(new Error('offline')); await first;
  assert.equal(h.store.getState().notes[h.key(a)].text, 'Preserve this');
  const retry = h.store.getState().flushAll(); await tick();
  assert.equal(h.calls[2].args[2].recordId, a.recordId);
  h.calls[2].resolve({ revision: 'r2' }); await retry;
  assert.equal(h.store.getState().notes[h.key(a)].error, null);
});

test('remounting a row after an aborted read starts a fresh request', async () => {
  const h = harness(); const controller = new AbortController();
  const old = h.store.getState().load(a, controller.signal);
  controller.abort();
  const fresh = h.store.getState().load(a);
  h.calls[0].resolve({ content: 'Aborted', revision: 'old' });
  await old; await tick();
  assert.equal(h.calls.length, 2);
  h.calls[1].resolve({ content: 'Current', revision: 'new' }); await fresh;
  assert.equal(h.store.getState().notes[h.key(a)].text, 'Current');
});
