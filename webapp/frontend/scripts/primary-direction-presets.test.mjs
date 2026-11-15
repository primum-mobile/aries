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
  const names = new Set([
    'hasPatchKeys', 'mergeOptionsPatch', 'useQueuedPrimaryDirectionSettingsPatch', 'primaryDirectionsPreviewOptionsPatch',
    'primaryDirectionGlobals', 'withPatchedGlobals',
  ]);
  const code = source.statements.filter(node => ts.isFunctionDeclaration(node) && names.has(node.name?.text)).map(node => node.getText(source)).join('\n');
  const calls = [];
  const reads = [];
  const hooks = [];
  let hookIndex = 0;
  let effects = [];
  const timers = new Map();
  let timerId = 0;
  let settings = {};
  // React state starts empty; the first options read or write reply fills it.
  let globals = null;
  const sameDeps = (left, right) => left && right && left.length === right.length && left.every((value, index) => Object.is(value, right[index]));
  const context = vm.createContext({
    AbortController,
    React: {
      useRef: current => hooks[hookIndex++] ??= {current},
      useCallback: (callback, deps) => {
        const index = hookIndex++;
        if (!sameDeps(hooks[index]?.deps, deps)) hooks[index] = {callback, deps};
        return hooks[index].callback;
      },
      useEffect: (callback, deps) => {
        const index = hookIndex++;
        if (!sameDeps(hooks[index]?.deps, deps)) effects.push(() => {
          hooks[index]?.cleanup?.();
          hooks[index] = {deps, cleanup: callback()};
        });
      },
    },
    window: {
      setTimeout: callback => { timers.set(++timerId, callback); return timerId; },
      clearTimeout: id => timers.delete(id),
    },
    PRIMARY_SETTINGS_PATCH_DEBOUNCE_MS: 100,
    patchOptions: patch => new Promise((resolve, reject) => calls.push({patch, resolve, reject})),
    fetchOptions: signal => new Promise((resolve, reject) => reads.push({signal, resolve, reject})),
  });
  vm.runInContext(ts.transpileModule(code, {compilerOptions: {target: ts.ScriptTarget.ES2022}}).outputText, context);
  const inputs = {
    setSettings: next => { settings = typeof next === 'function' ? next(settings) : next; },
    setSettingsGlobals: next => { globals = typeof next === 'function' ? next(globals) : next; },
    onLoaded: () => {},
  };
  const render = (optionsSeq = 0) => {
    hookIndex = 0;
    effects = [];
    const write = context.useQueuedPrimaryDirectionSettingsPatch({...inputs, optionsSeq});
    effects.forEach(effect => effect());
    return write;
  };
  const write = render();
  return {
    write, calls, reads, render,
    cleanups: [() => hooks.forEach(hook => hook?.cleanup?.())],
    flush: () => { const pending = [...timers.values()]; timers.clear(); pending.forEach(callback => callback()); },
    settings: () => settings, globals: () => globals,
    preview: context.primaryDirectionsPreviewOptionsPatch,
  };
}

const settle = () => new Promise(resolve => setImmediate(resolve));
const reply = (fields, globals = {meannode: true, topocentric: false}) => ({
  primaryDirections: fields,
  planetsPoints: {meannode: globals.meannode},
  display: {topocentric: globals.topocentric},
});

function enginePresets() {
  const path = new URL('../src/components/workshell/primdir-settings.tsx', import.meta.url);
  const source = ts.createSourceFile('primdir-settings.tsx', readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  // The preset block runs from the shipped chart globals through
  // presetResolvedPatch, the last preset helper before the UI components.
  const start = source.statements.find(node => ts.isVariableStatement(node)
    && node.declarationList.declarations.some(declaration => declaration.name.getText(source) === 'PRESET_GLOBALS'));
  const resolver = source.statements.findIndex(node => ts.isFunctionDeclaration(node) && node.name?.text === 'presetResolvedPatch');
  assert.ok(start && resolver >= 0, 'preset block markers');
  const code = source.text.slice(start.getStart(source), source.statements[resolver].getEnd());
  const context = vm.createContext({});
  vm.runInContext(ts.transpileModule(code, {compilerOptions: {target: ts.ScriptTarget.ES2022}}).outputText, context);
  return {
    presets: vm.runInContext('PRIMARY_DIRECTION_PRESETS', context),
    globals: vm.runInContext('PRESET_GLOBALS', context),
    resolve: context.presetResolvedPatch,
    patch: context.presetPatch,
    active: context.activePrimaryDirectionPreset,
    globalsPatch: context.globalsPatch,
  };
}

test('engine presets preserve complete chooser state through optimistic edits and resets', async () => {
  const {presets, resolve, globals, active, globalsPatch} = enginePresets();
  for (const preset of presets) {
    const writer = queuedWriter();
    const original = {
      pdfixstarssel: [false, true, true],
      pdFixStarCatalog: [
        {code: 'alVir', ordinal: 0},
        {code: 'alCMa', ordinal: 1},
        {code: 'alLeo', ordinal: 2},
      ],
      pdpromarabicpartnames: ['Fortune'], pdsigarabicpartnames: ['Spirit'],
      pdpromasteroidnumbers: [1], pdsigasteroidnumbers: [4],
    };
    writer.reads[0].resolve(reply(original));
    await settle();
    const patch = resolve(preset, original);
    assert.ok(Object.values(patch).every(value => value !== undefined), preset.id);
    const initial = {...original, ...patch};
    // The chooser writes the preset fields and the chart globals it directs.
    writer.write(patch, globalsPatch(globals));
    assert.deepEqual({...writer.globals()}, {...globals}, `${preset.id} globals`);
    assert.equal(active(writer.settings(), writer.globals())?.id, preset.id, `${preset.id} selected`);
    assert.equal(active(writer.settings(), {...globals, meannode: !globals.meannode}), null, `${preset.id} node`);
    assert.equal(active(writer.settings(), {...globals, topocentric: !globals.topocentric}), null, `${preset.id} parallax`);
    const expected = preset.id === 'morin' ? [true, false, true] : original.pdfixstarssel;
    assert.deepEqual(Array.from(writer.settings().pdfixstarssel), expected, preset.id);
    if (preset.id !== 'morin') assert.equal(Object.hasOwn(patch, 'pdfixstarssel'), false);
    for (const key of ['pdpromarabicpartnames', 'pdsigarabicpartnames', 'pdpromasteroidnumbers', 'pdsigasteroidnumbers']) {
      assert.deepEqual(writer.settings()[key], original[key], key);
    }
    writer.flush();
    writer.write({pdfixstarssel: [false, false, false]});
    writer.calls[0].resolve(reply(initial));
    await settle();
    assert.deepEqual(writer.settings().pdfixstarssel, [false, false, false]);
    writer.write({pdfixstarssel: initial.pdfixstarssel});
    assert.deepEqual(Array.from(writer.settings().pdfixstarssel), expected, `${preset.id} reset`);
    writer.calls[1].resolve(reply({...initial, pdfixstarssel: [false, false, false]}));
    await settle();
    assert.deepEqual(Array.from(writer.settings().pdfixstarssel), expected);
    writer.calls[2].resolve(reply(initial));
    await settle();
    assert.deepEqual(Array.from(writer.settings().pdfixstarssel), expected);
    writer.cleanups.forEach(cleanup => cleanup());
  }
});

test('every shipped preset chooses its school\'s converse', () => {
  const {presets} = enginePresets();
  // Morin and Ptolemy carry the significator to the promissor (AG 22;
  // Tetrabiblos III.10); Marr and Estadella keep the significator's pole.
  const expected = {morin: 1, ptolemy: 1, topocentric: 0};
  assert.deepEqual(Object.fromEntries(presets.map(preset => [preset.id, preset.patch.pdconverse])), expected);
});

test('explicit preset vectors are copied without mutating the source selection', () => {
  const {patch} = enginePresets();
  const selected = [true, false];
  const result = patch({pdfixstarssel: selected});
  assert.deepEqual(Array.from(result.pdfixstarssel), selected);
  result.pdfixstarssel[0] = false;
  assert.deepEqual(selected, [true, false]);
});

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
  await settle();
  writer.reads[1].resolve(reply({}));
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
  const before = JSON.stringify(preview(settings));
  const after = JSON.stringify(preview({...settings, userPresets: {
    revision: 2, selectedId: 'saved', dirty: true, presets: [{id: 'saved', name: 'My preset'}],
  }}));
  assert.equal(before, after);
});

test('a stale options read cannot roll back a newer toggle or its list preview', async () => {
  const writer = queuedWriter();
  writer.reads[0].resolve(reply({pdantiscia: false}));
  await settle();
  writer.render(1);
  writer.write({pdantiscia: true});
  assert.equal(writer.settings().pdantiscia, true);
  assert.equal(writer.preview(writer.settings()).primaryDirections.pdantiscia, true);
  writer.reads[1].resolve(reply({pdantiscia: false}));
  await settle();
  assert.equal(writer.settings().pdantiscia, true);
});

test('option echoes during queued or in-flight writes do not reload stale settings', async () => {
  const writer = queuedWriter();
  writer.write({pdantiscia: true});
  writer.render(1);
  assert.equal(writer.reads.length, 1);
  writer.flush();
  writer.render(2);
  assert.equal(writer.reads.length, 1);
  writer.calls[0].resolve(reply({pdantiscia: true}));
  await settle();
  writer.render(3);
  assert.equal(writer.reads.length, 2);
});

test('write acknowledgements preserve every newer queued setting, including the chart globals', async () => {
  const writer = queuedWriter();
  writer.write({pdantiscia: true});
  writer.flush();
  writer.write({pdantiscia: false}, {planetsPoints: {meannode: false}, display: {topocentric: true}});
  assert.equal(writer.calls[0].patch.planetsPoints, undefined);
  writer.calls[0].resolve(reply({pdantiscia: true}));
  await settle();
  assert.equal(writer.settings().pdantiscia, false);
  assert.deepEqual({...writer.globals()}, {meannode: false, topocentric: true});
  // The node and Moon parallax reach the list through the daemon's options
  // context, never through the list preview.
  const preview = writer.preview(writer.settings());
  assert.equal(preview.planetsPoints, undefined);
  assert.equal(preview.display, undefined);
  assert.equal(writer.calls[1].patch.planetsPoints.meannode, false);
  assert.equal(writer.calls[1].patch.display.topocentric, true);
  writer.calls[1].resolve(reply({pdantiscia: false}, {meannode: false, topocentric: true}));
  await settle();
  assert.equal(writer.settings().pdantiscia, false);
  assert.deepEqual({...writer.globals()}, {meannode: false, topocentric: true});
});

test('an options read started before a completed write cannot overwrite its acknowledgement', async () => {
  const writer = queuedWriter();
  writer.write({sigangles: [false, true, true, true]}, {planetsPoints: {meannode: false}});
  writer.flush();
  writer.calls[0].resolve(reply({sigangles: [false, true, true, true]}, {meannode: false, topocentric: false}));
  await settle();
  writer.reads[0].resolve(reply({sigangles: [true, true, true, true]}));
  await settle();
  assert.equal(writer.settings().sigangles[0], false);
  assert.equal(writer.globals().meannode, false);
});
