// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../src/lib/chart/side-by-side-refresh.ts", import.meta.url), "utf8");
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { createSplitPeerRefreshGate } = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
const contextSource = await readFile(new URL("../src/lib/chart/aspect-list-context.ts", import.meta.url), "utf8");
const contextJs = ts.transpileModule(contextSource, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { aspectListViewContext } = await import(`data:text/javascript;base64,${Buffer.from(contextJs).toString("base64")}`);
const empty = () => ({ lastSessionChange: null, lastOptionsChange: null, steppedSnapshot: null, commandSnapshot: null });
const frame = (mode) => ({ docId: "active", snapshot: { overlayRenderMode: mode } });

test("single canvases retain a comparison list with stable roles when focus changes", () => {
  const snapshot = {
    document: { documentId: "left", viewMode: 0 }, comparisonChart: null,
    sideBySide: { enabled: true, leftDocumentId: "left", rightDocumentId: "transit", activeSide: "left", revision: 1 },
  };
  const left = aspectListViewContext(snapshot, "left");
  assert.equal(left.comparisonVisible, true);
  assert.equal(left.comparisonDocumentId, "transit");
  const focusedRight = { ...snapshot, document: { ...snapshot.document, documentId: "transit" }, sideBySide: { ...snapshot.sideBySide, activeSide: "right" } };
  const right = aspectListViewContext(focusedRight, "transit");
  assert.equal(right.revision, left.revision);
  assert.equal(right.comparisonDocumentId, "left");
  const replacement = { ...snapshot, sideBySide: { ...snapshot.sideBySide, rightDocumentId: "progression" } };
  assert.notEqual(aspectListViewContext(replacement, "left").revision, left.revision);
  assert.equal(aspectListViewContext({ ...snapshot, sideBySide: { ...snapshot.sideBySide, revision: 99 } }, "left").revision, left.revision);
});

test("incomplete or closed split pairs restore the normal chart list context", () => {
  const single = { document: { documentId: "left", viewMode: 0 }, comparisonChart: null };
  const normal = aspectListViewContext(single, "left");
  const partial = { ...single, sideBySide: { enabled: true, leftDocumentId: "left", rightDocumentId: null } };
  assert.deepEqual(aspectListViewContext(partial, "left"), normal);
  assert.equal(normal.comparisonVisible, false);
  assert.equal(normal.comparisonDocumentId, null);
  assert.equal(aspectListViewContext(single, "previous"), null);
});

test("explicit sources keep list owner, selection and cursors stable across focus and Tab", () => {
  const inner = { id: "right:inner", side: "right", documentId: "transit", ownerDocumentId: "natal", label: "Natal", cursorIdentity: "natal:0" };
  const outer = { id: "right:outer", side: "right", documentId: "transit", ownerDocumentId: "transit", label: "Transit", cursorIdentity: "transit:1" };
  const chart = {
    document: { documentId: "left", viewMode: 1 }, comparisonChart: {},
    sideBySide: { enabled: true, leftDocumentId: "left", rightDocumentId: "transit", activeSide: "left",
      aspectList: { sources: [inner, outer], primarySourceId: inner.id, outerSourceId: outer.id } },
  };
  const before = aspectListViewContext(chart, "left");
  // Activation may arrive before the focused pane's replacement snapshot.
  assert.deepEqual(aspectListViewContext(chart, "transit"), before);
  const hidden = { ...chart, document: { documentId: "transit", viewMode: 0 }, comparisonChart: null,
    sideBySide: { ...chart.sideBySide, activeSide: "right" } };
  assert.deepEqual(aspectListViewContext(hidden, "transit"), before);
  assert.equal(before.queryDocumentId, "left");
  assert.deepEqual(before.relatedDocumentIds, ["transit", "natal"]);
  const stepped = { ...chart, sideBySide: { ...chart.sideBySide, aspectList: {
    ...chart.sideBySide.aspectList, sources: [inner, { ...outer, cursorIdentity: "transit:2" }],
  } } };
  const after = aspectListViewContext(stepped, "left");
  assert.equal(after.revision, before.revision);
  assert.notEqual(after.cursorIdentity, before.cursorIdentity);
});

test("a peer biwheel refreshes a changed ring owner only after burst completion", () => {
  const gate = createSplitPeerRefreshGate("peer", () => ["moving-ring"]);
  const previous = empty();
  const step = { ...previous, lastSessionChange: { docId: "moving-ring", rebuiltChildIds: [], changeReason: "step" } };
  assert.equal(gate(step, previous), false);
  const settled = { ...step, steppedSnapshot: frame("full") };
  assert.equal(gate(settled, step), true);
  assert.equal(gate({ ...settled, commandSnapshot: frame("full") }, settled), false);
});

test("30 related steps cause no peer fetch inside the burst and one fetch at full completion", () => {
  const gate = createSplitPeerRefreshGate("peer");
  let previous = empty();
  for (let i = 0; i < 30; i++) {
    const state = { ...previous,
      lastSessionChange: { docId: "active", rebuiltChildIds: ["peer"], changeReason: "step", seq: i },
      steppedSnapshot: frame("step_fast"),
    };
    assert.equal(gate(state, previous), false);
    previous = state;
  }
  const settled = { ...previous, steppedSnapshot: frame("full") };
  assert.equal(gate(settled, previous), true);
  assert.equal(gate({ ...settled, commandSnapshot: frame("full") }, settled), false);
});

test("unrelated charts and ordinary active steps never fetch the peer", () => {
  const gate = createSplitPeerRefreshGate("peer");
  const previous = empty();
  const state = { ...previous,
    lastSessionChange: { docId: "active", rebuiltChildIds: [], changeReason: "step" },
    steppedSnapshot: frame("full"),
  };
  assert.equal(gate(state, previous), false);
});

test("peer display options refresh immediately; theme-only paint stays in the renderer", () => {
  const gate = createSplitPeerRefreshGate("peer");
  const previous = empty();
  const change = { refreshedDocumentIds: ["peer"], styleOnly: false, listDataChanged: false };
  assert.equal(gate({ ...previous, lastOptionsChange: change }, previous), true);
  assert.equal(gate({ ...previous, lastOptionsChange: { ...change, styleOnly: true } }, previous), false);
  assert.equal(gate({ ...previous, lastOptionsChange: { ...change, refreshedDocumentIds: ["other"] } }, previous), false);
});

test("a full command completes a pending dependent refresh", () => {
  const gate = createSplitPeerRefreshGate("peer");
  const previous = empty();
  const dirty = { ...previous, lastSessionChange: { docId: "peer", rebuiltChildIds: [], changeReason: "step" } };
  assert.equal(gate(dirty, previous), false);
  assert.equal(gate({ ...dirty, commandSnapshot: frame("full") }, dirty), true);
});

test("every paired step publishes both panes without peer fetches or settle waits", async () => {
  const { splitSnapshotForDocument } = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
  const gate = createSplitPeerRefreshGate("child");
  let previous = empty();
  for (let index = 0; index < 30; index++) {
    const eventState = { ...previous, lastSessionChange: {
      docId: "parent", rebuiltChildIds: ["child"], changeReason: "step", seq: index,
    } };
    assert.equal(gate(eventState, previous), false);
    const child = { document: { documentId: "child", displayDatetime: String(index) }, overlayRenderMode: "step_fast" };
    const snapshot = { document: { documentId: "parent", displayDatetime: String(index) },
      overlayRenderMode: "step_fast", sideBySideSnapshots: { child } };
    const next = { ...eventState, steppedSnapshot: { docId: "parent", snapshot } };
    assert.equal(gate(next, eventState), false);
    assert.equal(splitSnapshotForDocument(snapshot, "child"), child);
    assert.equal(splitSnapshotForDocument(snapshot, "parent"), snapshot);
    assert.equal(splitSnapshotForDocument(snapshot, "hidden"), null);
    previous = next;
  }
  const snapshot = { ...previous.steppedSnapshot.snapshot, overlayRenderMode: "full" };
  assert.equal(gate({ ...previous, steppedSnapshot: { docId: "parent", snapshot } }, previous), false);
});

test("paint acknowledgement waits for both pane canvases from the same frame", async () => {
  const registrySource = (await readFile(new URL("../src/lib/chart/painted-snapshot-registry.ts", import.meta.url), "utf8"))
    .replace(/import \{ sameCanvasRenderState \} from [^;]+;/, "const sameCanvasRenderState = () => true;");
  const registryJs = ts.transpileModule(registrySource, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
  const { acknowledgePaintedDocumentSnapshot, wasDocumentSnapshotPainted } = await import(
    `data:text/javascript;base64,${Buffer.from(registryJs).toString("base64")}`,
  );
  const child = { document: { documentId: "child" } };
  const parent = { document: { documentId: "parent" }, sideBySideSnapshots: { child } };
  acknowledgePaintedDocumentSnapshot("parent", parent);
  assert.equal(wasDocumentSnapshotPainted("parent", parent), false);
  acknowledgePaintedDocumentSnapshot("child", child);
  assert.equal(wasDocumentSnapshotPainted("parent", parent), true);
  const nextChild = { ...child };
  const nextParent = { ...parent, sideBySideSnapshots: { child: nextChild } };
  acknowledgePaintedDocumentSnapshot("parent", nextParent);
  assert.equal(wasDocumentSnapshotPainted("parent", nextParent), false);
});

test("context-menu child opens retain the visible frame until activation has its new snapshot", async () => {
  const { runInNewContext } = await import("node:vm");
  const read = async (path) => readFile(new URL(`../src/${path}`, import.meta.url), "utf8");
  const [adapter, menu, store, gate] = await Promise.all([
    read("stores/daemon-workspace-adapter.ts"),
    read("components/workshell/chart-context-menu.tsx"),
    read("stores/daemon-workspace-store.ts"),
    read("stores/workspace-command-snapshot-gate.ts"),
  ]);
  function extract(source, name, callback = false) {
    const file = ts.createSourceFile("test.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let found;
    function visit(node) {
      if (node.name?.getText(file) === name) {
        if (callback && ts.isVariableDeclaration(node)) found = node.initializer.arguments[0].getText(file);
        if (!callback && ts.isFunctionDeclaration(node)) found = node.getText(file).replace(/^export /, "");
      }
      ts.forEachChild(node, visit);
    }
    visit(file);
    assert.ok(found, name);
    return found;
  }
  const program = [
    gate.replace(/^export /gm, ""),
    extract(adapter, "applyImmediateWorkspaceResult"),
    extract(adapter, "runImmediateWorkspaceCommand"),
    extract(store, "handleEvent"),
    `const runAction = ${extract(menu, "runAction", true)};`,
    "globalThis.commands = { runAction, handleEvent, hasPendingWorkspaceSnapshotCommand };",
  ].join("\n");
  const javascript = ts.transpileModule(program, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;

  for (const split of [false, true]) {
    const visible = { document: { documentId: "radix" }, sideBySide: { enabled: split } };
    const stale = { document: { documentId: "child" }, sideBySide: { enabled: !split } };
    const replacement = { document: { documentId: "child" }, sideBySide: { enabled: split } };
    const cache = new Map([["radix", visible], ["child", stale]]);
    const frames = [visible];
    const errors = [];
    let resolveResponse;
    let rejectResponse;
    let flush;
    const response = new Promise((resolve, reject) => { resolveResponse = resolve; rejectResponse = reject; });
    const state = {
      pushCommandSnapshot(id, snapshot) { cache.set(id, snapshot); },
      _applyState(_docs, id) { frames.push(cache.get(id)); },
      _applyTree() { frames.push(cache.get("child")); },
      _applyActive(id) { frames.push(cache.get(id)); },
    };
    const sandbox = {
      activeDocumentId: "radix",
      handleChartEventsMenuAction: async () => false,
      executeWorkspaceContextMenuAction: () => response,
      rememberDocumentSnapshot: (id, snapshot) => cache.set(id, snapshot),
      invalidateDocumentSnapshots: (ids) => ids.forEach((id) => cache.delete(id)),
      recordChartPerf() {},
      useDaemonWorkspaceStore: { getState: () => state },
      scheduleDeferredWorkspaceEventFlush() { flush = true; },
      console: { error: (...args) => errors.push(args) },
    };
    // The real event handler writes these module-scoped deferred slots.
    runInNewContext(`let deferredTree = null; let deferredActive;\n${javascript}`, sandbox);
    const commands = sandbox.commands;
    const opening = commands.runAction("workspace.open_supplementary", { documentId: "radix", kind: "transit" });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(commands.hasPendingWorkspaceSnapshotCommand(), true);
    commands.handleEvent({ type: "documents.changed", tree: [] });
    commands.handleEvent({ type: "active_document.changed", docId: "child" });
    assert.equal(flush, true);
    assert.deepEqual(frames, [visible], "early activation must not select the cached opposite layout");
    resolveResponse({ documentId: "child", activeDocumentId: "child", documents: [], snapshot: replacement });
    await opening;
    assert.deepEqual(errors, []);
    assert.equal(commands.hasPendingWorkspaceSnapshotCommand(), false);
    assert.deepEqual(frames, [visible, replacement]);
    // A failed open releases the event barrier without clearing the chart.
    sandbox.executeWorkspaceContextMenuAction = () => new Promise((_, reject) => { rejectResponse = reject; });
    const failed = commands.runAction("workspace.open_supplementary", { documentId: "child", kind: "transit" });
    await new Promise((resolve) => setImmediate(resolve));
    rejectResponse(new Error("test transport failure"));
    await failed;
    assert.equal(commands.hasPendingWorkspaceSnapshotCommand(), false);
    assert.deepEqual(frames, [visible, replacement]);
    assert.equal(errors.length, 1);
  }
});
