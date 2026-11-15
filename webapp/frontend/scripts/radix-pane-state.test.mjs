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
const { hasRadixPane, livePane, radixPaneOwner, retainRadixPanes } = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
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
const frameSource = await readFile(new URL('../src/stores/frame-layout-store.ts', import.meta.url), 'utf8');
const layoutSource = await readFile(new URL('../src/components/workshell/right-pane-layout.ts', import.meta.url), 'utf8');
const paneLayout = compileCommonJs(layoutSource);
const commandsSource = await readFile(new URL('../src/components/workshell/workspace-ui-commands.ts', import.meta.url), 'utf8');
const touchPaneSource = await readFile(new URL('../src/stores/touch-pane-store.ts', import.meta.url), 'utf8');
const aspectViewState = compileCommonJs(await readFile(new URL('../src/lib/chart/aspect-view-state.ts', import.meta.url), 'utf8'));
function workspaceFixture({ documents = docs, activeDocumentId = 'a', frameState = {} } = {}) {
  const daemon = create((set) => ({
    documents, activeDocumentId, lastSessionChange: null, commandSnapshot: null,
    _applyState: (documents, activeDocumentId) => set({ documents, activeDocumentId }),
    _applyOpenedDocument: ({ documents, activeDocumentId }) => set({ documents, activeDocumentId }),
    pushCommandSnapshot: (docId, snapshot) => set({ commandSnapshot: { docId, snapshot } }),
  }));
  const frameModule = compileCommonJs(frameSource, {
    zustand: { create }, 'zustand/middleware': { persist: (initializer) => initializer },
  });
  const frame = frameModule.useFrameLayoutStore;
  frame.setState(frameState);
  const touchPane = compileCommonJs(touchPaneSource, {
    zustand: { create }, '@/stores/frame-layout-store': frameModule,
  });
  const { useWorkspaceStore: workspace, RIGHT_PANE_KEYS } = compileCommonJs(awaitSource, {
    zustand: { create },
    '@/stores/daemon-workspace-store': { useDaemonWorkspaceStore: daemon },
    '@/lib/daemon/client': { patchSidebarListPreferences: () => { throw new Error('unexpected preference write'); } },
    '@/lib/list-follow-policy': followPolicy,
    '@/lib/retained-pane-activation.mjs': { sameRetainedPaneActivation },
    '@/lib/radix-pane-state': { hasRadixPane, livePane, radixPaneOwner, retainRadixPanes },
    '@/stores/frame-layout-store': frameModule,
    '@/components/workshell/right-pane-layout': paneLayout,
    '@/stores/touch-pane-store': touchPane,
    '@/lib/chart/aspect-view-state': aspectViewState,
  });
  return { daemon, workspace, frame, touchPane, RIGHT_PANE_KEYS };
}

test('real workspace actions restore panes atomically on daemon activation and open results', () => {
  const { daemon, workspace, frame } = workspaceFixture();
  workspace.getState().openTransitListPane({ documentId: 'a', sourceName: 'Same name' });
  const aPane = workspace.getState().transitListPane;
  daemon.getState()._applyState(docs, 'b');
  assert.equal(workspace.getState().transitListPane, null);
  assert.equal(frame.getState().inspectorOpen, true);
  workspace.getState().openTransitSearchPane({ documentId: 'b' });
  assert.equal(frame.getState().inspectorOpen, false);
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
  assert.equal(workspace.getState().transitListPane, aPane);
  assert.equal(frame.getState().inspectorOpen, false);
  daemon.getState()._applyState(docs, 'b');
  assert.equal(workspace.getState().transitSearchPane, bPane);
  daemon.getState()._applyState(docs, 'a');
  assert.equal(workspace.getState().transitListPane, aPane);
});

test('Events follows an untouched radix but restores each radix own binding', () => {
  const { daemon, workspace, frame } = workspaceFixture();
  workspace.getState().openChartEventsPane({ documentId: 'a' });
  const aPane = workspace.getState().chartEventsPane;
  daemon.getState()._applyState(docs, 'b');
  assert.equal(workspace.getState().chartEventsPane.documentId, 'b');
  assert.equal(frame.getState().inspectorOpen, false);
  const bPane = workspace.getState().chartEventsPane;
  daemon.getState()._applyState(docs, 'a');
  assert.equal(workspace.getState().chartEventsPane, aPane);
  daemon.getState()._applyState(docs, 'b');
  assert.equal(workspace.getState().chartEventsPane, bPane);
});

test('Notes and Inspector follow untouched radixes while remembered lists take over', () => {
  const { daemon, workspace, frame } = workspaceFixture();
  frame.getState().setNotesPaneOpen(true);
  frame.getState().setInspectorOpen(true);
  daemon.getState()._applyState(docs, 'b');
  assert.equal(frame.getState().notesPaneOpen, true);
  assert.equal(frame.getState().inspectorOpen, true);
  workspace.getState().openTransitSearchPane({ documentId: 'b' });
  assert.equal(frame.getState().notesPaneOpen, false);
  daemon.getState()._applyState(docs, 'a');
  assert.equal(workspace.getState().transitSearchPane, null);
  assert.equal(frame.getState().notesPaneOpen, true);
  assert.equal(frame.getState().inspectorOpen, true);
});

test('a keyboard Notes focus request is scoped to its explicit open and active chart', () => {
  const { daemon, workspace, frame, RIGHT_PANE_KEYS } = workspaceFixture();
  const { toggleWorkspaceNotes } = compileCommonJs(commandsSource, {
    '@/stores/workspace-store': { useWorkspaceStore: workspace, RIGHT_PANE_KEYS },
    '@/stores/frame-layout-store': { useFrameLayoutStore: frame },
  });
  const focusRequest = { opener: null, documentId: 'a' };
  toggleWorkspaceNotes(focusRequest);
  assert.equal(frame.getState().notesPaneOpen, true);
  assert.equal(frame.getState().notesFocusRequest, focusRequest);

  daemon.getState()._applyState(docs, 'b');
  assert.equal(frame.getState().notesPaneOpen, true);
  assert.equal(frame.getState().notesFocusRequest, null);

  toggleWorkspaceNotes();
  toggleWorkspaceNotes();
  assert.equal(frame.getState().notesPaneOpen, true);
  assert.equal(frame.getState().notesFocusRequest, null);
});

test('closing elsewhere never suppresses a remembered list on return', () => {
  const { daemon, workspace, frame } = workspaceFixture();
  workspace.getState().openTransitListPane({ documentId: 'a' });
  daemon.getState()._applyState(docs, 'b');
  frame.getState().setInspectorOpen(false);
  daemon.getState()._applyState(docs, 'a');
  assert.equal(workspace.getState().transitListPane.documentId, 'a');
  assert.equal(frame.getState().inspectorOpen, false);
  workspace.getState().closeTransitListPane();
  daemon.getState()._applyState(docs, 'b');
  assert.equal(frame.getState().inspectorOpen, false);
  frame.getState().setInspectorOpen(true);
  daemon.getState()._applyState(docs, 'a');
  assert.equal(workspace.getState().transitListPane.documentId, 'a');
});

test('Transit and Secondary lists restore after closing elsewhere and reopen intact after local close', () => {
  for (const kind of ['transitListPane', 'directionsPane']) {
    const { daemon, workspace, frame, RIGHT_PANE_KEYS } = workspaceFixture();
    const commands = compileCommonJs(commandsSource, {
      '@/stores/workspace-store': { useWorkspaceStore: workspace, RIGHT_PANE_KEYS },
      '@/stores/frame-layout-store': { useFrameLayoutStore: frame },
    });
    if (kind === 'transitListPane') {
      workspace.getState().openTransitListPane({ documentId: 'a', focusDatetime: '2026-10-05T12:00:00' });
    } else {
      workspace.getState().openDirectionsPane({ documentId: 'return-a', initialTab: 'secondary' });
    }
    const original = workspace.getState()[kind];
    daemon.getState()._applyState(docs, 'b');
    commands.closeWorkspaceTransientPanes();
    daemon.getState()._applyState(docs, 'a');
    assert.equal(workspace.getState()[kind], original);
    commands.closeWorkspaceTransientPanes();
    assert.equal(workspace.getState()[kind], null);
    commands.toggleWorkspaceInspector();
    assert.equal(workspace.getState()[kind], original);
    assert.equal(frame.getState().inspectorOpen, false);
    daemon.getState()._applyState(docs, 'b');
    daemon.getState()._applyState(docs, 'a');
    assert.equal(workspace.getState()[kind], original);
  }
});

test('Inspector shortcut selects Inspector after closing Chart Style Lab and while it is open', () => {
  for (const [closeLab, inspectorBehindLab] of [[true, false], [false, false], [false, true]]) {
    const { daemon, workspace, frame, RIGHT_PANE_KEYS } = workspaceFixture();
    const commands = compileCommonJs(commandsSource, {
      '@/stores/workspace-store': { useWorkspaceStore: workspace, RIGHT_PANE_KEYS },
      '@/stores/frame-layout-store': { useFrameLayoutStore: frame },
    });
    frame.getState().setInspectorOpen(inspectorBehindLab);
    frame.getState().setStyleEditorOpen(true);
    if (closeLab) frame.getState().setStyleEditorOpen(false);
    commands.toggleWorkspaceInspector();
    assert.equal(frame.getState().styleEditorOpen, false);
    assert.equal(frame.getState().inspectorOpen, true);
    commands.toggleWorkspaceInspector();
    assert.equal(frame.getState().inspectorOpen, false);
    commands.toggleWorkspaceInspector();
    assert.equal(frame.getState().inspectorOpen, true);
    assert.equal(frame.getState().styleEditorOpen, false);
    daemon.getState()._applyState(docs, 'b');
    daemon.getState()._applyState(docs, 'a');
    assert.equal(frame.getState().inspectorOpen, true);
    assert.equal(frame.getState().styleEditorOpen, false);
  }
});

test('branch navigation still restores Chart Style Lab independently of Inspector intent', () => {
  const { daemon, frame } = workspaceFixture();
  frame.getState().setStyleEditorOpen(true);
  daemon.getState()._applyState(docs, 'b');
  frame.getState().setStyleEditorOpen(false);
  frame.getState().setInspectorOpen(true);
  daemon.getState()._applyState(docs, 'a');
  assert.equal(frame.getState().styleEditorOpen, true);
  assert.equal(frame.getState().inspectorOpen, false);
});

test('a sibling tab restores its radix list, but stepping the closed tab never reopens it', () => {
  const { daemon, workspace, frame, RIGHT_PANE_KEYS } = workspaceFixture();
  const commands = compileCommonJs(commandsSource, {
    '@/stores/workspace-store': { useWorkspaceStore: workspace, RIGHT_PANE_KEYS },
    '@/stores/frame-layout-store': { useFrameLayoutStore: frame },
  });
  workspace.getState().openDirectionsPane({ documentId: 'a', initialTab: 'secondary', sourceName: 'A' });
  const pane = workspace.getState().directionsPane;
  daemon.getState()._applyState(docs, 'transit-a');
  commands.closeWorkspaceTransientPanes();
  daemon.getState()._applyState([...docs], 'transit-a');
  assert.equal(workspace.getState().directionsPane, null);
  assert.equal(frame.getState().inspectorOpen, false);
  daemon.getState()._applyState(docs, 'a');
  assert.equal(workspace.getState().directionsPane, pane);
});

test('wide list to untouched chart and back keeps its actual width and quiet same-root ticks', () => {
  const { daemon, workspace, frame } = workspaceFixture();
  frame.getState().setRightPaneWidth(300);
  workspace.getState().openSynodicCyclesPane({ documentId: 'a' });
  assert.equal(frame.getState().rightPaneWidth, 420);
  daemon.getState()._applyState(docs, 'b');
  assert.equal(frame.getState().inspectorOpen, true);
  assert.equal(frame.getState().rightPaneWidth, 420);
  daemon.getState()._applyState(docs, 'a');
  const pane = workspace.getState().synodicCyclesPane;
  let workspaceNotifications = 0;
  let frameNotifications = 0;
  workspace.subscribe(() => workspaceNotifications++);
  frame.subscribe(() => frameNotifications++);
  daemon.getState()._applyState([...docs], 'transit-a');
  assert.equal(workspace.getState().synodicCyclesPane, pane);
  assert.equal(workspaceNotifications, 0);
  assert.equal(frameNotifications, 0);
});

test('closing the query document keeps the open frame with temporary Inspector fallback', () => {
  const { daemon, workspace, frame } = workspaceFixture();
  workspace.getState().openDirectionsPane({ documentId: 'return-a' });
  daemon.getState()._applyState(docs.slice(0, 2), 'a');
  assert.equal(workspace.getState().directionsPane, null);
  assert.equal(frame.getState().inspectorOpen, true);
});

test('map controls stay map-bound and use temporary fallback on an untouched wheel', () => {
  const { daemon, workspace, frame } = workspaceFixture();
  const mapDocs = [...docs, { documentId: 'map-a', parentDocumentId: 'a', kind: 'astrocart' }];
  daemon.getState()._applyState(mapDocs, 'map-a');
  workspace.getState().openAstrocartControlsPane({ documentId: 'map-a' });
  daemon.getState()._applyState(mapDocs, 'a');
  assert.equal(workspace.getState().astrocartControlsPane, null);
  assert.equal(frame.getState().inspectorOpen, true);
});

test('Inspector persists across existing tabs and split focus without notifications', () => {
  const { daemon, workspace, frame } = workspaceFixture();
  frame.getState().setInspectorOpen(true);
  daemon.getState().pushCommandSnapshot('a', { sideBySide: { enabled: true } });
  let notifications = 0;
  frame.subscribe(() => notifications++);
  workspace.subscribe(() => notifications++);
  for (const destination of ['b', 'return-a', 'transit-a', 'a']) {
    daemon.getState()._applyState([...docs], destination);
    assert.equal(frame.getState().inspectorOpen, true, destination);
    daemon.getState()._applyState([...docs], destination);
    assert.equal(frame.getState().inspectorOpen, true, destination);
  }
  assert.equal(notifications, 0);
});

test('closing Inspector stays closed across empty charts and same-tab updates', () => {
  const { daemon, frame } = workspaceFixture();
  frame.getState().setInspectorOpen(true);
  daemon.getState()._applyState(docs, 'return-a');
  frame.getState().setInspectorOpen(false);
  for (const destination of ['return-a', 'a', 'b', 'transit-a']) {
    daemon.getState()._applyState([...docs], destination);
    assert.equal(frame.getState().inspectorOpen, false, destination);
  }
});

test('new and recalled derived charts keep current Inspector visibility', () => {
  for (const activateSeparately of [false, true]) {
    for (const open of [false, true]) {
      const { daemon, workspace, frame } = workspaceFixture();
      frame.getState().setInspectorOpen(open);
      const transitDocs = [...docs, {
        documentId: 'new-transit', parentDocumentId: 'a', kind: 'supplementary', hasChart: true,
      }];
      if (activateSeparately) daemon.getState()._applyState(transitDocs, 'a');
      workspace.getState().applyWorkspaceOpenResult({ documents: transitDocs, activeDocumentId: 'new-transit' });
      assert.equal(frame.getState().inspectorOpen, open);
      for (const destination of ['b', 'return-a', 'new-transit']) {
        workspace.getState().applyWorkspaceOpenResult({ documents: transitDocs, activeDocumentId: destination });
        assert.equal(frame.getState().inspectorOpen, open, destination);
      }
    }
  }
});

test('list fallback persists through children without overwriting the original list', () => {
  const { daemon, workspace, frame } = workspaceFixture();
  workspace.getState().openTransitListPane({ documentId: 'a', focusDatetime: '2026-10-13T12:00:00' });
  const list = workspace.getState().transitListPane;
  daemon.getState()._applyState(docs, 'b');
  const withChild = [...docs, { documentId: 'new-b', parentDocumentId: 'b', hasChart: true }];
  daemon.getState()._applyState(withChild, 'new-b');
  assert.equal(frame.getState().inspectorOpen, true);
  daemon.getState()._applyState(withChild, 'a');
  assert.equal(workspace.getState().transitListPane, list);
  assert.equal(frame.getState().inspectorOpen, false);
  daemon.getState()._applyState(withChild, 'b');
  assert.equal(frame.getState().inspectorOpen, true);
  daemon.getState()._applyState(withChild, 'a');
  assert.equal(workspace.getState().transitListPane, list);
});

test('split focus restores each radix list and uses Inspector where no content is remembered', () => {
  const { daemon, workspace, frame } = workspaceFixture();
  workspace.getState().openDirectionsPane({ documentId: 'a', initialTab: 'secondary' });
  const list = workspace.getState().directionsPane;
  daemon.getState().pushCommandSnapshot('b', { sideBySide: { enabled: true } });
  daemon.getState()._applyState([...docs], 'b');
  assert.equal(frame.getState().inspectorOpen, true);
  workspace.getState().openTransitSearchPane({ documentId: 'b' });
  const search = workspace.getState().transitSearchPane;
  daemon.getState()._applyState([...docs], 'a');
  assert.equal(workspace.getState().directionsPane, list);
  daemon.getState()._applyState([...docs], 'b');
  assert.equal(workspace.getState().transitSearchPane, search);
  assert.equal(frame.getState().inspectorOpen, false);
});

test('snapshot split mode cannot change Inspector fallback on workspace opens', () => {
  for (const enabled of [false, true]) {
    const { workspace, frame } = workspaceFixture();
    workspace.getState().openTransitListPane({ documentId: 'a' });
    workspace.getState().applyWorkspaceOpenResult({
      documents: docs, activeDocumentId: 'b', snapshot: { sideBySide: { enabled } },
    });
    assert.equal(frame.getState().inspectorOpen, true);
  }
});

test('Inspector and Notes stay combined across empty siblings', () => {
  const { daemon, frame } = workspaceFixture();
  frame.getState().setInspectorOpen(true);
  frame.getState().setNotesPaneOpen(true);
  for (const destination of ['return-a', 'b', 'transit-a', 'a']) {
    daemon.getState()._applyState([...docs], destination);
    assert.equal(frame.getState().notesPaneOpen, true);
    assert.equal(frame.getState().inspectorOpen, true);
  }
});

test('fallback stays quiet on refresh and returns after a remembered list reopens', () => {
  const { daemon, workspace, frame } = workspaceFixture();
  workspace.getState().openTransitListPane({ documentId: 'a' });
  daemon.getState()._applyState(docs, 'b');
  let notifications = 0;
  frame.subscribe(() => notifications++);
  workspace.subscribe(() => notifications++);
  daemon.getState()._applyState([...docs], 'b');
  assert.equal(notifications, 0);
  frame.getState().setInspectorOpen(false);
  daemon.getState()._applyState(docs, 'a');
  assert.ok(workspace.getState().transitListPane);
  daemon.getState()._applyState(docs, 'b');
  assert.equal(frame.getState().inspectorOpen, true);
});

test('Inspector shortcut on a wheel cannot restore retained off-surface map controls', () => {
  const { daemon, workspace, frame, RIGHT_PANE_KEYS } = workspaceFixture();
  const commands = compileCommonJs(commandsSource, {
    '@/stores/workspace-store': { useWorkspaceStore: workspace, RIGHT_PANE_KEYS },
    '@/stores/frame-layout-store': { useFrameLayoutStore: frame },
  });
  const mapDocs = [...docs, { documentId: 'map-a', parentDocumentId: 'a', kind: 'astrocart' }];
  daemon.getState()._applyState(mapDocs, 'map-a');
  workspace.getState().openAstrocartControlsPane({ documentId: 'map-a' });
  daemon.getState()._applyState(mapDocs, 'a');
  commands.closeWorkspaceTransientPanes();
  commands.toggleWorkspaceInspector();
  assert.equal(workspace.getState().astrocartControlsPane, null);
  assert.equal(frame.getState().inspectorOpen, true);
});

test('shared close and Inspector button close globally until content is reopened', () => {
  for (const closeWithSash of [true, false]) {
    const { daemon, workspace, frame, RIGHT_PANE_KEYS } = workspaceFixture();
    const commands = compileCommonJs(commandsSource, {
      '@/stores/workspace-store': { useWorkspaceStore: workspace, RIGHT_PANE_KEYS },
      '@/stores/frame-layout-store': { useFrameLayoutStore: frame },
    });
    commands.toggleWorkspaceInspector();
    daemon.getState()._applyState(docs, 'b');
    if (closeWithSash) commands.closeWorkspaceTransientPanes();
    else commands.toggleWorkspaceInspector();
    for (const destination of ['b', 'a', 'return-a']) {
      daemon.getState()._applyState([...docs], destination);
      assert.equal(frame.getState().inspectorOpen, false, destination);
    }
    commands.toggleWorkspaceInspector();
    daemon.getState()._applyState(docs, 'a');
    assert.equal(frame.getState().inspectorOpen, true);
  }
});

test('startup Inspector visibility and global widths persist across the restored tree', () => {
  const { daemon, frame } = workspaceFixture({
    documents: [], activeDocumentId: null,
    frameState: { inspectorOpen: true, sidebarOpen: false, sidebarWidth: 320, rightPaneWidth: 480 },
  });
  daemon.getState()._applyState([], null);
  assert.equal(frame.getState().inspectorOpen, true);
  const restored = [...docs, { documentId: 'restored-child', parentDocumentId: 'a', hasChart: true }];
  for (const destination of ['a', 'return-a', 'restored-child', 'b']) {
    daemon.getState()._applyState([...restored], destination);
    assert.equal(frame.getState().inspectorOpen, true, destination);
  }
  assert.equal(frame.getState().sidebarOpen, false);
  assert.equal(frame.getState().sidebarWidth, 320);
  assert.equal(frame.getState().rightPaneWidth, 480);
});

test('timed row opening a standalone chart still preserves its originating pane', () => {
  const { workspace, frame } = workspaceFixture();
  workspace.getState().openTransitListPane({ documentId: 'a', sourceName: 'A' });
  const pane = workspace.getState().transitListPane;
  workspace.getState().applyTimedChartOpenResult({
    documents: [...docs, { documentId: 'event', parentDocumentId: null }],
    activeDocumentId: 'event', documentId: 'event',
  });
  assert.equal(workspace.getState().transitListPane, pane);
  assert.equal(frame.getState().inspectorOpen, false);
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

test('hidden chrome does not erase a radix last content', () => {
  const result = retainRadixPanes(docs, 'a', 'b', empty, { a: transit, b: search }, empty);
  assert.equal(result.panes, search);
  assert.equal(retainRadixPanes(docs, 'b', 'a', search, result.retained, empty).panes, transit);
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

test('closing the cursor child keeps the list on its owner and re-aims the cursor', () => {
  const pane = {
    documentId: 'a',
    cursorDocumentId: 'transit-a',
    followPolicy: followPolicy.sourceLiveFollowPolicy({ sourceDocumentId: 'a', cursorDocumentId: 'transit-a' }),
    sourceName: 'A',
  };
  const withoutChild = docs.filter((doc) => doc.documentId !== 'transit-a');
  const retained = retainRadixPanes(withoutChild, 'a', 'a', { ...empty, directionsPane: pane }, {}, empty);
  assert.equal(retained.panes.directionsPane.cursorDocumentId, 'a');
  assert.equal(retained.panes.directionsPane.followPolicy.cursorDocumentId, 'a');
  assert.equal(livePane(pane, new Set(docs.map((doc) => doc.documentId))), pane);

  const { workspace } = workspaceFixture({ activeDocumentId: 'transit-a' });
  workspace.getState().openDirectionsPane(pane);
  workspace.getState().applyWorkspaceOpenResult({ documents: withoutChild, activeDocumentId: 'a' });
  assert.equal(workspace.getState().directionsPane?.documentId, 'a');
  assert.equal(workspace.getState().directionsPane?.cursorDocumentId, 'a');
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

test('shared sash close recognizes every registered pane and Notes', () => {
  const { workspace, frame, RIGHT_PANE_KEYS } = workspaceFixture();
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

test('touch layout: an explicit pane open shows a minimized view again, restores keep it minimized', () => {
  const { daemon, workspace, frame, touchPane } = workspaceFixture();
  workspace.getState().openDirectionsPane({ documentId: 'a', sourceName: 'A' });
  const pane = workspace.getState().directionsPane;
  // The open itself belongs to the user action in progress.
  assert.equal(touchPane.touchPaneOpenedByCurrentAction(pane), true);
  touchPane.minimizeTouchPane(pane);
  assert.equal(touchPane.useTouchPaneStore.getState().minimizedToken, pane);
  // A radix round trip restores the same pane object, still minimized.
  daemon.getState()._applyState(docs, 'b');
  daemon.getState()._applyState(docs, 'a');
  assert.equal(workspace.getState().directionsPane, pane);
  assert.equal(touchPane.useTouchPaneStore.getState().minimizedToken, pane);
  // Opening the same list again from app chrome is a no-op for the store but
  // must bring the view back.
  workspace.getState().openTransitSearchPane({ documentId: 'a' });
  assert.equal(touchPane.useTouchPaneStore.getState().minimizedToken, null);
  const search = workspace.getState().transitSearchPane;
  touchPane.minimizeTouchPane(search);
  workspace.getState().openTransitSearchPane({ documentId: 'a' });
  assert.equal(workspace.getState().transitSearchPane, search);
  assert.equal(touchPane.useTouchPaneStore.getState().minimizedToken, null);
  // Notes opened from chrome show full screen too.
  touchPane.minimizeTouchPane('notes');
  frame.getState().setNotesPaneOpen(true);
  assert.equal(touchPane.useTouchPaneStore.getState().minimizedToken, null);
  assert.equal(touchPane.touchPaneOpenedByCurrentAction('notes'), true);
});
