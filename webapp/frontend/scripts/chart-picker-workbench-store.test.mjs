// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
const require = createRequire(import.meta.url);
const tick = () => new Promise((resolve) => setImmediate(resolve));
function harness() {
  const reads = [], writes = [];
  const compiled = { exports: {} };
  const code = ts.transpileModule(readFileSync(new URL("../src/stores/chart-picker-workbench-store.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const fakeRequire = (id) => id === "@/lib/daemon/client" ? {
    fetchChartPickerWorkbench: () => new Promise((resolve, reject) => reads.push({ resolve, reject })),
    patchChartPickerWorkbench: (patch) => new Promise((resolve, reject) => writes.push({ patch, resolve, reject })),
  } : require(id);
  new Function("require", "module", "exports", code)(fakeRequire, compiled, compiled.exports);
  return { store: compiled.exports.useChartPickerWorkbenchStore, reads, writes };
}
test("restoring settings does not replace a toggle edited during loading", async () => {
  const { store, reads, writes } = harness();
  const loading = store.getState().load();
  store.getState().update({ stationWindowDays: "8" });
  reads[0].resolve({ stationWindowDays: "3", view: "search", includeAsteroids: true });
  await loading;
  await tick();
  assert.equal(store.getState().preferences.stationWindowDays, "8");
  assert.equal(store.getState().preferences.view, "search");
  assert.equal(store.getState().preferences.includeAsteroids, true);
  assert.deepEqual(writes[0].patch, { stationWindowDays: "8" });
  writes[0].resolve();
  await store.getState().flush();
});
test("rapid changes save serially with the newest value and retain results", async () => {
  const { store, reads, writes } = harness();
  const loading = store.getState().load();
  reads[0].resolve({ view: "search" });
  await loading;
  const rows = [{ key: "result" }];
  store.setState((state) => ({ session: { ...state.session, rows, selectedKey: "result", searchScrollTop: 135 } }));
  store.getState().update({ stationWindowDays: "3" });
  await tick();
  store.getState().update({ stationWindowDays: "4" });
  store.getState().update({ stationWindowDays: "5", placementDrawerOpen: false });
  assert.equal(writes.length, 1);
  writes[0].resolve();
  await tick();
  assert.deepEqual(writes[1].patch, { stationWindowDays: "5", placementDrawerOpen: false });
  writes[1].resolve();
  await store.getState().flush();
  await store.getState().load();
  assert.equal(reads.length, 1);
  assert.equal(store.getState().session.rows, rows);
  assert.equal(store.getState().session.selectedKey, "result");
  assert.equal(store.getState().session.searchScrollTop, 135);
});
test("failed save retains unsaved changes for retry without reverting controls", async () => {
  const { store, reads, writes } = harness();
  const loading = store.getState().load();
  reads[0].resolve({ view: "search" });
  await loading;
  store.getState().update({ includeAsteroids: true });
  await tick();
  store.getState().update({ includeAsteroids: false, aspectDrawerOpen: false });
  writes[0].reject(new Error("offline"));
  await tick();
  assert.equal(store.getState().persistenceError, true);
  assert.equal(store.getState().preferences.includeAsteroids, false);
  const retry = store.getState().flush();
  await tick();
  assert.deepEqual(writes[1].patch, { includeAsteroids: false, aspectDrawerOpen: false });
  writes[1].resolve();
  await retry;
  assert.equal(store.getState().persistenceError, false);
});
