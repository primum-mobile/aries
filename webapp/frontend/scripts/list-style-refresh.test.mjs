// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function source(path) {
  const text = await readFile(new URL(path, import.meta.url), "utf8");
  return ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

function namedNode(root, name, predicate) {
  let found;
  function visit(node) {
    if (predicate(node) && node.name?.getText() === name) found = node;
    if (!found) ts.forEachChild(node, visit);
  }
  visit(root);
  assert.ok(found, `Mounted source must declare ${name}`);
  return found;
}

function property(root, name) {
  return namedNode(root, name, ts.isPropertyAssignment);
}

const fn = (root, name) => namedNode(root, name, ts.isFunctionDeclaration);
const variable = (root, name) => namedNode(root, name, ts.isVariableDeclaration);
const declaration = (root, name) => `const ${variable(root, name).getText()};`;

// Execute the mounted pure calculations without importing the React shell,
// constructing a second implementation, or requiring a running browser.
function evaluate(code, bindings = {}) {
  const js = ts.transpileModule(code, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports = {};
  return new Function("exports", ...Object.keys(bindings), js)(exports, ...Object.values(bindings));
}

test("secondary retained projection compensates only visible prepended rows", async () => {
  const directions = await source("../src/components/workshell/directions-view.tsx");
  const harness = await source("../src/components/workshell/stitched-list-harness.ts");
  const filters = await source("../src/lib/secondary-progression-filters.ts");
  const panel = fn(directions, "SecondaryDirectionsPanel");
  const projection = variable(panel, "rows").initializer.arguments[0].getText();
  const prepend = variable(panel, "visibleCount").initializer.getText();
  const compensation = [];
  function findCompensation(node) {
    if (ts.isCallExpression(node) && node.expression.getText() === "React.useLayoutEffect" &&
        node.arguments[0].getText().includes("scroller.scrollTop += plan.count * rowHeight")) {
      compensation.push(node.arguments[0].getText());
    }
    ts.forEachChild(node, findCompensation);
  }
  findCompensation(panel);
  assert.equal(compensation.length, 1);
  const helpers = [
    declaration(directions, "SECONDARY_STATION_FILTER_IDS"),
    fn(directions, "secondaryStationFilterKey").getText(),
    fn(harness, "filterRetainedRows").getText(),
    fn(filters, "secondaryPointRolesMatch").getText(),
  ].join("\n");
  const row = (id, actor, target, aspect, station = false) => Object.freeze({
    id, isStation: station,
    fields: Object.freeze({ promObjectId: actor, sigObjectId: target, aspectIndex: aspect }),
  });
  const earlier = Object.freeze([
    row("sun-station", "planet:sun", null, null, true),
    row("asteroid-station", "asteroid:75100", null, null, true),
    row("sun-ingress", "planet:sun", null, null),
    row("sun-moon", "planet:sun", "planet:moon", 0),
    row("sun-asc", "planet:sun", "angle:asc", 1),
    row("asc-moon", "angle:asc", "planet:moon", 0),
  ]);
  const resident = row("resident-station", "planet:sun", null, null, true);
  const sourceRows = Object.freeze([...earlier, resident]);
  const original = JSON.stringify(sourceRows);
  const cases = [
    { from: ["planet:sun", "asteroid:75100", "angle:asc"], to: ["planet:moon", "angle:asc"], aspects: [0, 1], stations: false, ids: earlier.map(r => r.id) },
    { from: ["planet:sun"], to: ["planet:moon"], aspects: [0], stations: false, ids: ["sun-station", "sun-ingress", "sun-moon"] },
    { from: ["planet:sun", "asteroid:75100"], to: [], aspects: [], stations: true, ids: ["sun-station", "asteroid-station"] },
    { from: ["planet:sun"], to: [], aspects: [], stations: false, ids: ["sun-station", "sun-ingress"] },
    { from: ["angle:asc"], to: ["planet:moon"], aspects: [0], stations: false, ids: ["asc-moon"] },
    { from: [], to: ["planet:moon"], aspects: [0], stations: true, ids: [] },
  ];
  // Repeat and reverse toggles while the same source island remains resident.
  for (const selection of [...cases, ...cases.toReversed(), ...cases]) {
    const selectedFromIds = new Set(selection.from);
    const selectedToIds = new Set(selection.to);
    const bindings = {
      sourceRows, nextStore: { rows: sourceRows }, prependedCount: earlier.length,
      stationsOnly: selection.stations, stationsOnlyRef: { current: selection.stations },
      selectedFromIds, selectedToIds, from: selectedFromIds, to: selectedToIds,
      selectedAspectIds: selection.aspects, aspects: new Set(selection.aspects),
    };
    const actual = evaluate(`${helpers}\nreturn { rows: (${projection})(), count: ${prepend} };`, bindings);
    assert.deepEqual(actual.rows.filter(r => r !== resident).map(r => r.id), selection.ids);
    assert.equal(actual.count, selection.ids.length);
    assert.equal(JSON.stringify(sourceRows), original);
    assert.equal(sourceRows.at(-1), resident);
    const scroller = { scrollTop: 37, clientHeight: 300 };
    const scrollPlanRef = { current: actual.count > 0 ? { kind: "prepend", count: actual.count } : null };
    const syncs = [];
    evaluate(`(${compensation[0]})();`, {
      scrollPlanRef, scrollerRef: { current: scroller }, rowHeight: 37,
      dispatchVirtualScrollSync: value => syncs.push(value),
    });
    assert.equal(scroller.scrollTop, 37 + selection.ids.length * 37);
    assert.equal(scrollPlanRef.current, null);
    assert.deepEqual(syncs, actual.count > 0 ? [scroller] : []);
  }
});

test("options event isolation retains list worlds and scopes chart invalidation", async () => {
  const sourceFile = await source("../src/stores/daemon-workspace-store.ts");
  const applyOptions = property(sourceFile, "_applyOptionsChange").initializer.getText();
  const helpers = ["sameRetainedListDisplay", "isRetainedListDisplay"]
    .map(name => fn(sourceFile, name).getText()).join("\n");
  for (const change of [
    { styleOnly: true, listDataChanged: false },
    { styleOnly: false, listDataChanged: false },
    { styleOnly: false, listDataChanged: true },
    { styleOnly: false, listDataChanged: true, retainedListTarget: "aspect-list" },
    { styleOnly: false, listDataChanged: true, listDataDomain: "houses" },
    { styleOnly: false, listDataChanged: false, houseVisibility: false },
    { styleOnly: false, listDataChanged: false, houseVisibility: false, launcherKind: "astrolabe" },
  ]) {
    const retained = Object.freeze({ seq: 7 });
    let state = {
      activeDocumentId: "active", pendingHouseToggles: 0,
      documents: [{ documentId: "active", launcherKind: change.launcherKind }, { documentId: "peer" }],
      lastOptionsChange: retained, lastRetainedDataOptionsChange: retained,
      lastAspectListOptionsChange: retained, lastSpeculumOptionsChange: retained,
      lastHouseFreeListOptionsChange: retained,
      retainedListDisplay: { hiddenObjectIds: [] },
      steppedSnapshot: { docId: "active" }, commandSnapshot: { docId: "peer" },
    };
    const stepped = state.steppedSnapshot;
    const command = state.commandSnapshot;
    const sessions = [], invalidations = [];
    const apply = evaluate(`${helpers}\nreturn (${applyOptions});`, {
      set: updater => { state = { ...state, ...updater(state) }; },
    });
    const store = {
      ...state,
      _applyOptionsChange: apply,
      _applySessionChange: change => sessions.push(change),
      _confirmHouseVisibility: () => {},
    };
    const event = { type: "options.changed", refreshMode: "display-overlay", refreshedDocumentIds: ["active", "peer"], ...change };
    evaluate(`${fn(sourceFile, "handleEvent").getText()}\nhandleEvent(event);`, {
      event, useDaemonWorkspaceStore: { getState: () => store, setState: patch => { state = { ...state, ...patch }; } },
      normalizeOptionsStyleIdentity: () => ({}),
      invalidateDocumentSnapshots: ids => invalidations.push(ids),
      setRetainedHouseVisibility: () => {},
    });
    const paintOnly = change.styleOnly || typeof change.houseVisibility === "boolean";
    assert.deepEqual(invalidations, paintOnly ? [] : [["active", "peer"]]);
    assert.equal(state.lastOptionsChange.seq, 8);
    assert.equal(state.lastRetainedDataOptionsChange,
      change.listDataChanged && !change.retainedListTarget ? state.lastOptionsChange : retained);
    assert.equal(state.lastAspectListOptionsChange,
      change.listDataChanged ? state.lastOptionsChange : retained);
    assert.equal(state.lastSpeculumOptionsChange,
      change.listDataChanged && !change.retainedListTarget ? state.lastOptionsChange : retained);
    // A house-system switch is no new revision for lists that never read houses.
    assert.equal(state.lastHouseFreeListOptionsChange,
      change.listDataChanged && !change.retainedListTarget && change.listDataDomain !== "houses"
        ? state.lastOptionsChange : retained);
    assert.equal(state.steppedSnapshot, stepped);
    assert.equal(state.commandSnapshot, paintOnly ? command : null);
    assert.equal(sessions.length, paintOnly && !change.launcherKind ? 0 : 1);
    for (const session of sessions) assert.equal(session.listDataChanged, false);
  }
});

test("eclipse virtual bounds cover finite series and stale or resized viewports", async () => {
  const eclipses = await source("../src/components/workshell/eclipses-view.tsx");
  const window = evaluate(`${declaration(eclipses, "VIRTUAL_OVERSCAN_ROWS")}\n${fn(eclipses, "eclipseVirtualWindow").getText()}\nreturn eclipseVirtualWindow;`);
  for (const count of [0, 1, 5, 80, 4000]) {
    for (const seed of [-1, 0, count - 1, count + 100]) {
      for (const rowHeight of [28, 31, 37]) {
        for (const viewport of [
          { scrollTop: 0, height: 0, headerHeight: 30 },
          { scrollTop: -50, height: 320, headerHeight: 30 },
          { scrollTop: 10_000, height: 320, headerHeight: 30 },
          { scrollTop: 1_000_000, height: 30_000, headerHeight: 30 },
          { scrollTop: 100, height: 20, headerHeight: 30 },
        ]) {
          assert.deepEqual(window(count, seed, rowHeight, viewport, false), {
            startIndex: 0, endIndex: count, paddingTop: 0, paddingBottom: 0,
          });
          const actual = window(count, seed, rowHeight, viewport, true);
          assert.ok(actual.startIndex >= 0 && actual.startIndex <= actual.endIndex);
          assert.ok(actual.endIndex <= count);
          assert.ok(actual.paddingTop >= 0 && actual.paddingBottom >= 0);
          assert.equal(actual.paddingTop + (actual.endIndex - actual.startIndex) * rowHeight + actual.paddingBottom, count * rowHeight);
          if (count > 0) assert.ok(actual.endIndex > actual.startIndex);
        }
      }
    }
  }
  assert.deepEqual(window(80, 51, 28, { scrollTop: 10_000, height: 320, headerHeight: 30 }, true), {
    startIndex: 51, endIndex: 80, paddingTop: 1428, paddingBottom: 0,
  });
});

test("a house-system switch never rebuilds the synodic list", async () => {
  const synodic = (await source("../src/components/workshell/synodic-cycle-list-view.tsx")).getFullText();
  assert.match(synodic, /useHouseFreeListOptionsRevision\(\) \+ useRetainedListRevision/);
  assert.doesNotMatch(synodic, /useRetainedListOptionsRevision/);
});
