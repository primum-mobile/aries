// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

function queuedWriter() {
  const path = new URL('../src/components/workshell/directions-view.tsx', import.meta.url);
  const source = ts.createSourceFile('directions-view.tsx', readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const names = new Set(['hasPatchKeys', 'mergeOptionsPatch', 'useQueuedPrimaryDirectionSettingsPatch', 'primaryDirectionsPreviewOptionsPatch']);
  const code = source.statements.filter(node => ts.isFunctionDeclaration(node) && names.has(node.name?.text)).map(node => node.getText(source)).join('\n');
  const calls = [];
  const effects = [];
  const timers = new Map();
  let timerId = 0;
  let settings = {};
  const context = vm.createContext({
    React: { useRef: current => ({current}), useCallback: callback => callback, useEffect: callback => effects.push(callback) },
    window: {
      setTimeout: callback => { timers.set(++timerId, callback); return timerId; },
      clearTimeout: id => timers.delete(id),
    },
    PRIMARY_SETTINGS_PATCH_DEBOUNCE_MS: 100,
    patchOptions: patch => new Promise((resolve, reject) => calls.push({patch, resolve, reject})),
  });
  vm.runInContext(ts.transpileModule(code, {compilerOptions: {target: ts.ScriptTarget.ES2022}}).outputText, context);
  const write = context.useQueuedPrimaryDirectionSettingsPatch({
    setSettings: next => { settings = typeof next === 'function' ? next(settings) : next; },
    setSettingsMeanNode: () => {},
  });
  const cleanups = effects.map(effect => effect());
  return {write, calls, cleanups, settings: () => settings, preview: context.primaryDirectionsPreviewOptionsPatch};
}

const settle = () => new Promise(resolve => setImmediate(resolve));
const reply = fields => ({primaryDirections: fields, planetsPoints: {meannode: true}});

test('save follows preceding edits and is a barrier against later edits', async () => {
  const writer = queuedWriter();
  writer.write({pdkeydeg: 2});
  writer.write({pdkeymin: 30});
  const saved = writer.write({}, {primaryDirectionPreset: {action: 'save', name: 'Test', baseRevision: 0}});
  writer.write({pdkeydeg: 3});
  assert.equal(writer.calls.length, 1);
  assert.equal(writer.calls[0].patch.primaryDirections.pdkeydeg, 2);
  assert.equal(writer.calls[0].patch.primaryDirections.pdkeymin, 30);
  writer.calls[0].resolve(reply({pdkeydeg: 2, pdkeymin: 30}));
  await settle();
  assert.equal(writer.calls.length, 2);
  assert.equal(writer.calls[1].patch.primaryDirectionPreset.action, 'save');
  assert.equal(writer.calls[1].patch.primaryDirections, undefined);
  writer.calls[1].resolve(reply({pdkeydeg: 2, pdkeymin: 30}));
  assert.equal(await saved, true);
  await settle();
  assert.equal(writer.calls.length, 3);
  assert.equal(writer.calls[2].patch.primaryDirections.pdkeydeg, 3);
  writer.calls[2].resolve(reply({pdkeydeg: 3}));
  await settle();
  assert.equal(writer.settings().pdkeydeg, 3);
});

test('failed saves report failure and subsequent actions still run', async () => {
  const writer = queuedWriter();
  const first = writer.write({}, {primaryDirectionPreset: {action: 'save', name: 'Test', baseRevision: 0}});
  writer.calls[0].reject(new Error('write failed'));
  assert.equal(await first, false);
  await settle();
  const retry = writer.write({}, {primaryDirectionPreset: {action: 'save', name: 'Test', baseRevision: 0}});
  writer.calls[1].resolve(reply({}));
  assert.equal(await retry, true);
});

test('closing the pane preserves an already-issued pending edit', async () => {
  const writer = queuedWriter();
  writer.write({pdkeydeg: 4});
  writer.cleanups.forEach(cleanup => cleanup?.());
  assert.equal(writer.calls[0].patch.primaryDirections.pdkeydeg, 4);
  writer.calls[0].resolve(reply({pdkeydeg: 4}));
  await settle();
});


test('preset catalog and dirty state do not change the direction query', () => {
  const {preview} = queuedWriter();
  const settings = {primarydir: 4, pdaspects: [true, false]};
  const before = JSON.stringify(preview(settings, true));
  const after = JSON.stringify(preview({...settings, userPresets: {
    revision: 2, selectedId: 'saved', dirty: true, presets: [{id: 'saved', name: 'My preset'}],
  }}, true));
  assert.equal(before, after);
});
