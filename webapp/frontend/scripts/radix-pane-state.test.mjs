// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
import vm from 'node:vm';
import { create } from 'zustand';
import { sameRetainedPaneActivation } from '../src/lib/retained-pane-activation.mjs';

const awaitSource = await readFile(new URL('../src/stores/workspace-store.ts', import.meta.url), 'utf8');
const source = await readFile(new URL('../src/lib/radix-pane-state.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { radixPaneOwner, retainRadixPanes } = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
const docs = [
  { documentId: 'a', parentDocumentId: null },
  { documentId: 'b', parentDocumentId: null },
  { documentId: 'return-a', parentDocumentId: 'a' },
  { documentId: 'transit-a', parentDocumentId: 'return-a' },
];
const empty = { transitListPane: null, transitSearchPane: null, directionsPane: null };
const transit = { ...empty, transitListPane: { documentId: 'a', openSeq: 3 } };
const search = { ...empty, transitSearchPane: { documentId: 'b', significatorId: 'planet:sun' } };

const followSource = await readFile(new URL('../src/lib/list-follow-policy.ts', import.meta.url), 'utf8');
function compileCommonJs(source, dependencies = {}) {
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, { exports, require: (id) => {
    assert.ok(id in dependencies, `unexpected dependency ${id}`);
    return dependencies[id];
  }, setTimeout, clearTimeout, queueMicrotask });
  return exports;
}
const followPolicy = compileCommonJs(followSource);
function workspaceFixture() {
  const daemon = create((set) => ({
    documents: docs, activeDocumentId: 'a', lastSessionChange: null,
    _applyState: (documents, activeDocumentId) => set({ documents, activeDocumentId }),
    _applyOpenedDocument: ({ documents, activeDocumentId }) => set({ documents, activeDocumentId }),
    pushCommandSnapshot: () => {},
  }));
  const { useWorkspaceStore: workspace, RIGHT_PANE_KEYS } = compileCommonJs(awaitSource, {
    zustand: { create },
    '@/stores/daemon-workspace-store': { useDaemonWorkspaceStore: daemon },
    '@/lib/daemon/client': { patchSidebarListPreferences: () => { throw new Error('unexpected preference write'); } },
    '@/lib/list-follow-policy': followPolicy,
    '@/lib/retained-pane-activation.mjs': { sameRetainedPaneActivation },
    '@/lib/radix-pane-state': { radixPaneOwner, retainRadixPanes },
  });
  return { daemon, workspace, RIGHT_PANE_KEYS };
}

test('real workspace actions restore panes atomically on daemon activation and open results', () => {
  const { daemon, workspace } = workspaceFixture();
  workspace.getState().openTransitListPane({ documentId: 'a', sourceName: 'Same name' });
  const aPane = workspace.getState().transitListPane;
  daemon.getState()._applyState(docs, 'b');
  assert.equal(workspace.getState().transitListPane, null);
  workspace.getState().openTransitSearchPane({ documentId: 'b' });
  const bPane = workspace.getState().transitSearchPane;
  workspace.getState().applyWorkspaceOpenResult({ documents: docs, activeDocumentId: 'a' });
  assert.equal(workspace.getState().transitListPane, aPane);
  assert.equal(workspace.getState().transitSearchPane, null);
  daemon.getState()._applyState(docs, 'transit-a');
  assert.equal(workspace.getState().transitListPane, aPane);
  daemon.getState()._applyState(docs, 'b');
  assert.equal(workspace.getState().transitSearchPane, bPane);
  workspace.getState().closeTransitSearchPane();
  daemon.getState()._applyState(docs, 'a');
  daemon.getState()._applyState(docs, 'b');
  assert.equal(workspace.getState().transitSearchPane, null);
});

test('timed row opening a standalone chart still preserves its originating pane', () => {
  const { workspace } = workspaceFixture();
  workspace.getState().openTransitListPane({ documentId: 'a', sourceName: 'A' });
  const pane = workspace.getState().transitListPane;
  workspace.getState().applyTimedChartOpenResult({
    documents: [...docs, { documentId: 'event', parentDocumentId: null }],
    activeDocumentId: 'event', documentId: 'event',
  });
  assert.equal(workspace.getState().transitListPane, pane);
  assert.equal(workspace.getState().timedChartListRowLinkDocumentIds.event, true);
});

test('nested subsidiaries resolve to their parent radix by identity', () => {
  assert.equal(radixPaneOwner(docs, 'transit-a'), 'a');
  assert.equal(radixPaneOwner(docs, 'return-a'), 'a');
  assert.equal(radixPaneOwner(docs, 'b'), 'b');
  assert.equal(radixPaneOwner(docs, 'missing'), null);
  assert.equal(radixPaneOwner([{ documentId: 'a', parentDocumentId: 'a' }], 'a'), null);
});

test('transit list and search restore independently without changing bindings or activation counters', () => {
  const toB = retainRadixPanes(docs, 'a', 'b', transit, {}, empty);
  assert.equal(toB.panes, empty);
  const toA = retainRadixPanes(docs, 'b', 'a', search, toB.retained, empty);
  assert.equal(toA.panes, transit);
  const back = retainRadixPanes(docs, 'a', 'b', toA.panes, toA.retained, empty);
  assert.equal(back.panes, search);
  assert.equal(back.panes.transitSearchPane.documentId, 'b');
});

test('same-parent child navigation keeps the exact active pane', () => {
  const result = retainRadixPanes(docs, 'a', radixPaneOwner(docs, 'transit-a'), transit, {}, empty);
  assert.equal(result.panes, transit);
});

test('explicit close is retained only for its radix', () => {
  const result = retainRadixPanes(docs, 'a', 'b', empty, { a: transit, b: search }, empty);
  assert.equal(result.panes, search);
  assert.equal(retainRadixPanes(docs, 'b', 'a', search, result.retained, empty).panes, empty);
});

test('closing parent or child prunes stale pane owners without affecting other branches', () => {
  const childPane = { ...empty, directionsPane: { documentId: 'return-a' } };
  const rootsOnly = docs.slice(0, 2);
  const result = retainRadixPanes(rootsOnly, 'b', 'a', search, { a: childPane }, empty);
  assert.deepEqual(result.panes, empty);
  assert.equal(result.retained.b, search);
  const closedRoot = retainRadixPanes([docs[1]], 'a', 'b', transit, result.retained, empty);
  assert.equal(closedRoot.panes, search);
  assert.equal(closedRoot.retained.a, undefined);
});

test('every registered pane kind participates in the same branch retention', () => {
  const store = awaitSource;
  const keys = [...store.matchAll(/^  \| "(\w+Pane)"/gm)].map((match) => match[1]);
  assert.ok(keys.length >= 15);
  for (const key of keys) {
    const panes = { [key]: { documentId: 'a' } };
    const blank = { [key]: null };
    const away = retainRadixPanes(docs, 'a', 'b', panes, {}, blank);
    const back = retainRadixPanes(docs, 'b', 'a', blank, away.retained, blank);
    assert.equal(back.panes, panes, key);
  }
});

const commandsSource = await readFile(new URL('../src/components/workshell/workspace-ui-commands.ts', import.meta.url), 'utf8');
test('shared sash close recognizes every registered pane and Notes', () => {
  const { workspace, RIGHT_PANE_KEYS } = workspaceFixture();
  const frame = create((set) => ({
    inspectorOpen: false, notesPaneOpen: false, styleEditorOpen: false,
    setInspectorOpen: (inspectorOpen) => set({ inspectorOpen }),
    setNotesPaneOpen: (notesPaneOpen) => set({ notesPaneOpen }),
    setStyleEditorOpen: (styleEditorOpen) => set({ styleEditorOpen }),
  }));
  const { closeWorkspaceTransientPanes: close } = compileCommonJs(commandsSource, {
    '@/stores/workspace-store': { useWorkspaceStore: workspace, RIGHT_PANE_KEYS },
    '@/stores/frame-layout-store': { useFrameLayoutStore: frame },
  });
  for (const key of RIGHT_PANE_KEYS) {
    workspace.setState({ [key]: { documentId: 'a' } });
    assert.equal(close(), true, key);
    assert.equal(workspace.getState()[key], null, key);
  }
  frame.getState().setNotesPaneOpen(true);
  assert.equal(close(), true);
  assert.equal(frame.getState().notesPaneOpen, false);
  assert.equal(close(), false);
});
