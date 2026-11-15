// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
function harness() {
  const calls = [];
  const compiledModule = { exports: {} };
  const code = ts.transpileModule(readFileSync(new URL("../src/stores/chart-event-search-store.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const fakeRequire = (id) => id === "@/lib/daemon/client" ? {
    searchChartEvents: (payload, signal) => new Promise((resolve) => calls.push({ payload, signal, resolve })),
    fetchChartEventSearchCatalog: async () => ({ objects: [], signs: [], houses: [], motions: [], aspects: [] }),
  } : require(id);
  new Function("require", "module", "exports", code)(fakeRequire, compiledModule, compiledModule.exports);
  return { store: compiledModule.exports.useChartEventSearchStore, calls };
}

const input = { nameTagQuery: "", tagIds: [], tagMatch: "any", untagged: false,
  sort: "date", descending: false, placements: [{ objectIds: ["planet:moon"], signIndices: ["3"] }],
  aspects: [], includeAsteroids: false, stationWindowDays: "2" };

test("event search pages by scanned candidates and retains a completed result", async () => {
  const { store, calls } = harness();
  const first = store.getState().start("owner", "moon-cancer", input);
  assert.equal(calls[0].payload.offset, 0);
  calls[0].resolve({ rows: [{ id: "first" }], nextOffset: 8, totalCandidates: 12, errors: 0, done: false });
  await first;
  const second = store.getState().next("owner");
  assert.equal(calls[1].payload.offset, 8);
  calls[1].resolve({ rows: [{ id: "second" }], nextOffset: 12, totalCandidates: 12, errors: 0, done: true });
  await second;
  await store.getState().start("owner", "moon-cancer", input);
  assert.equal(calls.length, 2);
  assert.deepEqual(store.getState().views.owner.rows.map((row) => row.id), ["first", "second"]);
});

test("changed criteria abort old work and reject its late answer", async () => {
  const { store, calls } = harness();
  const old = store.getState().start("owner", "old", input);
  const fresh = store.getState().start("owner", "new", { ...input, nameTagQuery: "career" });
  assert.equal(calls[0].signal.aborted, true);
  calls[1].resolve({ rows: [{ id: "career" }], nextOffset: 1, totalCandidates: 1, errors: 0, done: true });
  await fresh;
  calls[0].resolve({ rows: [{ id: "stale" }], nextOffset: 1, totalCandidates: 1, errors: 0, done: true });
  await old;
  assert.deepEqual(store.getState().views.owner.rows.map((row) => row.id), ["career"]);
});
