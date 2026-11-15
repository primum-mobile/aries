// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

// Spotlight "current" on a Graphic Ephemeris: the daemon centres the camera on
// the typed moment and the open view travels there like any stepped chart.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  applyGraphicEphemerisCamera,
  flushGraphicEphemerisCamera,
  registerGraphicEphemerisCamera,
} from "../src/lib/chart/graphic-ephemeris-navigation.mjs";

const read = (path) => readFile(new URL(`../src/${path}`, import.meta.url), "utf8");

test("a daemon camera reaches the mounted view; flush waits for its write", async () => {
  const applied = [];
  let flushed = 0;
  const unregister = registerGraphicEphemerisCamera("ephem-1", (camera) => applied.push(camera), async () => {
    flushed += 1;
  });
  assert.equal(applyGraphicEphemerisCamera("ephem-1", { startJd: 2462391.7, spanDays: 365.2425 }), true);
  await flushGraphicEphemerisCamera("ephem-1");
  assert.deepEqual(applied, [{ startJd: 2462391.7, spanDays: 365.2425 }]);
  assert.equal(flushed, 1);

  const replacement = registerGraphicEphemerisCamera("ephem-1", () => applied.push("replacement"), async () => {});
  unregister(); // stale cleanup must not remove the replacement
  assert.equal(applyGraphicEphemerisCamera("ephem-1", { startJd: 1, spanDays: 28 }), true);
  assert.equal(applied.at(-1), "replacement");
  replacement();
  assert.equal(applyGraphicEphemerisCamera("ephem-1", { startJd: 1, spanDays: 28 }), false);
  await flushGraphicEphemerisCamera("ephem-1"); // no view: resolves
});

test("Spotlight current flushes the camera, and its result moves the view", async () => {
  const home = await read("components/workshell/home-client.tsx");
  assert.match(home, /if \(activeDocument\?\.kind === "ephemeris"\) \{\n[^\n]*\n\s*await flushGraphicEphemerisCamera\(activeDocument\.id\);\n\s*\}\n\s*return spotlightExecute\(text, action, chart, place\);/);

  const adapter = await read("stores/daemon-workspace-adapter.ts");
  assert.match(adapter, /if \(result\.ephemerisCamera\) \{\n\s*applyGraphicEphemerisCamera\(result\.ephemerisCamera\.documentId, result\.ephemerisCamera\.camera\);/);

  const view = await read("components/workshell/graph-ephemeris-view.tsx");
  assert.match(view, /registerGraphicEphemerisCamera\(\n\s*documentId,\n\s*\(camera\) => \{\n\s*const next = normalizeEphemerisCamera\(camera\);\n\s*if \(next\) moveCamera\(next, true, EPHEMERIS_TICK_MS\);/);
  assert.match(view, /flushCameraPersist,\n\s*\);\n\s*\}, \[documentId, flushCameraPersist, moveCamera\]\);/);
  // An in-flight write counts too: the daemon merges against the camera on screen.
  assert.match(view, /if \(persistTimerRef\.current == null\) \{\n\s*await lastWriteRef\.current;/);
});
