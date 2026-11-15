// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { saveCopyEdit } from "./server.mjs";

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "copy-editor-"));
  const locales = join(dir, "locales");
  mkdirSync(locales);
  const write = (code, data) => writeFileSync(join(locales, `${code}.json`), `${JSON.stringify(data, null, 2)}\n`);
  write("en", { "b.second": "Second", "a.first": "Hello {name}" });
  write("de", { "a.first": "Hallo {name}" });
  write("fr", {});
  write("en-XA", { "a.first": "⟦Hélló {name}⟧" });
  const paths = { locales, backlog: join(dir, "copy_backlog.json") };
  const read = (path) => JSON.parse(readFileSync(path, "utf8"));
  return { paths, en: () => read(join(locales, "en.json")), backlog: () => read(paths.backlog) };
}

test("an edit rewrites en.json in place and queues translated locales", () => {
  const f = fixture();
  const result = saveCopyEdit({ key: "a.first", from: "Hello {name}", to: "Hi {name}" }, f.paths);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.queued, ["de"]);
  assert.deepEqual(Object.keys(f.en()), ["b.second", "a.first"], "key order is preserved");
  assert.equal(f.en()["a.first"], "Hi {name}");
  assert.deepEqual(f.backlog(), { "a.first": { was: "Hello {name}", locales: ["de"] } });
});

test("rewording keeps the original source, and reverting clears the entry", () => {
  const f = fixture();
  saveCopyEdit({ key: "a.first", from: "Hello {name}", to: "Hi {name}" }, f.paths);
  saveCopyEdit({ key: "a.first", from: "Hi {name}", to: "Hey {name}" }, f.paths);
  assert.equal(f.backlog()["a.first"].was, "Hello {name}");
  saveCopyEdit({ key: "a.first", from: "Hey {name}", to: "Hello {name}" }, f.paths);
  assert.deepEqual(f.backlog(), {});
});

test("untranslated keys change without a backlog entry", () => {
  const f = fixture();
  const result = saveCopyEdit({ key: "b.second", from: "Second", to: "Two" }, f.paths);
  assert.equal(result.status, 200);
  assert.deepEqual(f.backlog(), {});
});

test("stale source, unknown keys, empty text and placeholder changes are refused", () => {
  const f = fixture();
  assert.equal(saveCopyEdit({ key: "a.first", from: "Old", to: "New {name}" }, f.paths).status, 409);
  assert.equal(saveCopyEdit({ key: "nope", from: "", to: "x" }, f.paths).status, 422);
  assert.equal(saveCopyEdit({ key: "b.second", from: "Second", to: "  " }, f.paths).status, 422);
  assert.equal(saveCopyEdit({ key: "a.first", from: "Hello {name}", to: "Hi {who}" }, f.paths).status, 422);
  assert.equal(f.en()["a.first"], "Hello {name}");
});
