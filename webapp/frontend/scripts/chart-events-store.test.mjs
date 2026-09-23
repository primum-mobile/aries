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
  const code = ts.transpileModule(readFileSync(new URL("../src/stores/chart-events-store.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const fakeRequire = (id) => {
    if (id === "@/lib/daemon/client") return {
      executeWorkspaceContextMenuAction: (action, payload, signal) => new Promise((resolve) => {
        calls.push({ action, payload, signal, resolve });
      }),
    };
    if (id === "@/lib/chart/perf") return { perfNow: () => performance.now(), recordChartPerf() {} };
    return require(id);
  };
  new Function("require", "module", "exports", code)(fakeRequire, compiledModule, compiledModule.exports);
  return { store: compiledModule.exports.useChartEventsStore, filter: compiledModule.exports.filteredChartEvents, rank: compiledModule.exports.rankedEventTags, calls };
}
const page = (id, total = 1) => ({ rows: [{ id, name: id }], total, sourceName: "Person" });

test("warm event drawer keeps its rows and scroll without another request", async () => {
  const { store, calls } = harness();
  const loading = store.getState().load("a");
  await store.getState().load("a");
  assert.equal(calls.length, 1);
  calls[0].resolve(page("marriage"));
  await loading;
  store.getState().patch("a", { scrollTop: 111, tagsOpen: true, tagQuery: "journey" });
  const rows = store.getState().views.a.rows;
  await store.getState().load("a");
  assert.equal(calls.length, 1);
  assert.equal(store.getState().views.a.rows, rows);
  assert.equal(store.getState().views.a.scrollTop, 111);
  assert.equal(store.getState().views.a.tagsOpen, true);
  assert.equal(store.getState().views.a.tagQuery, "journey");
});

test("event mutation invalidates quietly and rejects a stale response", async () => {
  const { store, calls } = harness();
  const first = store.getState().load("a");
  calls[0].resolve(page("old"));
  await first;
  store.getState().invalidate(["a"]);
  assert.equal(calls.length, 1); // A hidden pane does no work.
  const older = store.getState().load("a");
  store.getState().invalidate(["a"]);
  const newer = store.getState().load("a");
  assert.equal(calls[1].signal.aborted, true);
  assert.equal(store.getState().views.a.rows[0].id, "old");
  calls[2].resolve(page("new"));
  await newer;
  calls[1].resolve(page("stale"));
  await older;
  assert.equal(store.getState().views.a.rows[0].id, "new");
});

test("event pages append without replacing existing row identities", async () => {
  const { store, calls } = harness();
  const first = store.getState().load("a");
  calls[0].resolve(page("first", 2));
  await first;
  const firstRow = store.getState().views.a.rows[0];
  const second = store.getState().load("a", true);
  assert.equal(calls[1].payload.offset, 1);
  calls[1].resolve(page("second", 2));
  await second;
  assert.equal(store.getState().views.a.rows[0], firstRow);
  assert.deepEqual(store.getState().views.a.rows.map((row) => row.id), ["first", "second"]);
});

test("event cache stays bounded across many chart owners", () => {
  const { store } = harness();
  for (let i = 0; i < 100; i++) store.getState().patch(String(i), { sourceName: String(i) });
  assert.equal(Object.keys(store.getState().views).length, 32);
  assert.equal(store.getState().views["99"].sourceName, "99");
});

test("tab submenu has its own query world and shares owner invalidation", async () => {
  const { store, calls } = harness();
  store.getState().patch("a", { query: "Marriage", scrollTop: 111, loaded: true });
  const loading = store.getState().load("a:events-menu", false, "a");
  assert.equal(calls[0].payload.documentId, "a");
  assert.equal(calls[0].payload.query, "");
  calls[0].resolve(page("event"));
  await loading;
  store.getState().invalidate(["a"]);
  assert.equal(store.getState().views.a.query, "Marriage");
  assert.equal(store.getState().views.a.scrollTop, 111);
  assert.equal(store.getState().views["a:events-menu"].stale, true);
  assert.equal(calls.length, 1);
});


test("tag pills and search filter retained rows with any/all/untagged semantics", () => {
  const { store, filter, calls } = harness();
  const tags = [{ id: "r", name: "Relationship" }, { id: "j", name: "Journey" }];
  const rows = [{ id: "a", name: "Marriage", tags: [tags[0]] },
    { id: "b", name: "Move", tags }, { id: "c", name: "Graduation", tags: [] }];
  store.getState().patch("a", { rows, loaded: true, tagIds: ["r", "j"], scrollTop: 100 });
  const read = () => filter(store.getState().views.a).map((row) => row.id);
  assert.deepEqual(read(), ["a", "b"]);
  store.getState().patch("a", { tagMatch: "all" });
  assert.deepEqual(read(), ["b"]);
  store.getState().patch("a", { untagged: true, tagIds: [] });
  assert.deepEqual(read(), ["c"]);
  store.getState().patch("a", { untagged: false, query: "journey" });
  assert.deepEqual(read(), ["b"]);
  assert.equal(store.getState().views.a.rows, rows);
  assert.equal(store.getState().views.a.scrollTop, 100);
  assert.equal(calls.length, 0);
});

test("tag edits update cached assignments and preserve unrelated rows", async () => {
  const { store, calls } = harness();
  const tag = { id: "journey", name: "Journey" };
  const untouched = { id: "other", name: "Other", tags: [] };
  for (const id of ["a", "a:events-menu", "b"]) {
    store.getState().patch(id, { rows: [{ id: "event", name: "Event", tags: [] }, untouched], loaded: true });
  }
  const write = store.getState().setTags("a", "event", [], "Journey");
  assert.equal(calls[0].action, "workspace.set_event_tags");
  calls[0].resolve({ tags: [tag], tagCatalog: [tag], tagCounts: { journey: 1 }, untaggedCount: 1 });
  await write;
  for (const id of ["a", "a:events-menu"]) {
    assert.deepEqual(store.getState().views[id].rows[0].tags, [tag]);
    assert.equal(store.getState().views[id].rows[1], untouched);
  }
  assert.deepEqual(store.getState().views.b.rows[0].tags, []);
  assert.deepEqual(store.getState().views.b.tagCatalog, [tag]);
  store.getState().patch("a", { tagIds: [tag.id], scrollTop: 111 });
  const rename = store.getState().changeTag("a", tag.id, "Travel");
  calls[1].resolve({ tag: { ...tag, name: "Travel" } });
  await rename;
  assert.equal(store.getState().views["a:events-menu"].rows[0].tags[0].name, "Travel");
  const remove = store.getState().changeTag("a", tag.id);
  calls[2].resolve({ tag: { ...tag, deleted: true } });
  await remove;
  const view = store.getState().views.a;
  assert.deepEqual(view.tagIds, []);
  assert.deepEqual(view.rows[0].tags, []);
  assert.equal(view.rows.length, 2);
  assert.equal(view.scrollTop, 111);
});


test("shared catalog updates retained charts without fetching or replacing event rows", async () => {
  const { store, calls } = harness();
  const pending = store.getState().load("a");
  const rows = [{ id: "b-event", name: "Other chart", tags: [] }];
  store.getState().patch("b", { rows, loaded: true, stale: false, scrollTop: 90, tagsOpen: true });
  const recent = { id: "global", name: "Career", lastUsed: 10 };
  store.getState().applyTagCatalog([recent], 2);
  assert.equal(store.getState().views.b.rows, rows);
  assert.deepEqual(store.getState().views.b.tagCatalog, [recent]);
  assert.equal(store.getState().views.b.stale, false);
  assert.equal(store.getState().views.b.scrollTop, 90);
  calls[0].resolve({ ...page("a-event"), tagCatalog: [], catalogVersion: 1 });
  await pending;
  assert.deepEqual(store.getState().views.a.tagCatalog, [recent]);
  assert.equal(calls.length, 1);
  store.getState().applyTagCatalog([], 3);
  assert.deepEqual(store.getState().views.b.tagCatalog, []);
});

test("tags rank chart usage first, then recent assignments, then names", () => {
  const { rank } = harness();
  const catalog = [
    { id: "unused", name: "Alpha" },
    { id: "chart", name: "Journey", lastUsed: 1 },
    { id: "recent", name: "Relationship", lastUsed: 100 },
    { id: "used", name: "Health", lastUsed: 2 },
    { id: "last", name: "Work" },
  ];
  assert.deepEqual(rank(catalog, { chart: 2, used: 1 }).map((tag) => tag.id),
    ["chart", "used", "recent", "unused", "last"]);
  assert.equal(catalog[0].id, "unused");
});
