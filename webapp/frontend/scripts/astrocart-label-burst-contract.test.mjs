// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const html = await readFile(
  new URL("../../../Res/astrocart/map.html", import.meta.url),
  "utf8",
);
const script = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
  .map((match) => match[1])
  .find((source) => source.includes("function scheduleAcgChipAnchors"));

assert.ok(script, "missing bundled Astrocart map script");

test("offline labels use native MapLibre sources and the local glyph atlas", () => {
  assert.match(script, /const LOCAL_GLYPHS_URL = .*\{fontstack\}\/\{range\}\.pbf/);
  assert.match(script, /function offlinePlaceSources\(\)/);
  assert.match(script, /data: new URL\(PLACES_URL, location\.href\)\.href/);
  assert.match(script, /id: 'label_town', type: 'symbol', source: OFFLINE_PLACES_SOURCE_ID/);
  assert.match(script, /id: 'label_city', type: 'symbol', source: OFFLINE_PLACES_SOURCE_ID/);
  assert.match(script, /id: 'label_country_1', type: 'symbol', source: 'protomaps'/);
  assert.match(script, /glyphs: LOCAL_GLYPHS_URL/g);
  assert.doesNotMatch(html, /id="place-labels"|id="acg-dom-labels"/);
});

test("chip anchor refresh coalesces repeated scene changes into one frame", () => {
  const start = script.indexOf("function scheduleAcgChipAnchors");
  const end = script.indexOf("function acgParanLabelExpression", start);
  assert.ok(start >= 0 && end > start);
  const callbacks = [];
  const calls = [];
  const context = {
    window: { requestAnimationFrame(callback) { callbacks.push(callback); return callbacks.length; } },
    updateAcgChipAnchors() { calls.push("refresh"); },
  };
  vm.createContext(context);
  vm.runInContext(`let acgChipAnchorFrame = 0; ${script.slice(start, end)}
    globalThis.schedule = scheduleAcgChipAnchors;`, context);

  context.schedule();
  context.schedule();
  context.schedule();
  assert.equal(callbacks.length, 1);
  callbacks.shift()();
  assert.deepEqual(calls, ["refresh"]);
  context.schedule();
  assert.equal(callbacks.length, 1);
});

test("a settled motion refreshes native chip anchors once", () => {
  const moveEnd = script.slice(script.indexOf("map.on('moveend'"), script.indexOf("map.on('zoomend'"));
  assert.match(moveEnd, /const motionSettled = endMapMotion\('move'\);/);
  assert.match(moveEnd, /if \(motionSettled\) scheduleAcgChipAnchors\(\);/);
  assert.doesNotMatch(script, /schedulePlaceLabelsRender|scheduleDomAcgLabels/);
});
