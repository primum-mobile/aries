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
  .find((source) => source.includes("function beginMapMotion"));

assert.ok(script, "missing bundled Astrocart map script");

function sourceBetween(startMarker, endMarker) {
  const start = script.indexOf(startMarker);
  const end = script.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `missing ${startMarker}`);
  return script.slice(start, end);
}

const motionCoordinator = sourceBetween(
  "function beginMapMotion",
  "function onAsterismStarMove",
);
const labelCoordinator = sourceBetween(
  "function schedulePlaceLabelsRender",
  "function renderPlaceLabels",
);

function createHarness() {
  const callbacks = new Map();
  const renders = [];
  const hoverStates = [];
  let nextFrameId = 1;
  const context = {
    window: {
      requestAnimationFrame(callback) {
        const id = nextFrameId;
        nextFrameId += 1;
        callbacks.set(id, callback);
        return id;
      },
      cancelAnimationFrame(id) {
        callbacks.delete(id);
      },
    },
    document: {
      getElementById() {
        return { classList: { remove() {} } };
      },
    },
    ACG_PERF_MODE: true,
    perfState: {
      domLabelBurstSettles: 0,
      domLabelSkippedWhileMoving: 0,
      placeLabelSkippedWhileMoving: 0,
    },
    setAsterismHoverEnabled(enabled) {
      hoverStates.push(enabled);
    },
    postPerfSnapshot() {},
    renderDomAcgLabels(reason) {
      renders.push(["acg", reason]);
    },
    renderPlaceLabels(reason) {
      renders.push(["places", reason]);
    },
  };
  vm.createContext(context);
  vm.runInContext(
    `
      const activeMapMotionPhases = new Set();
      let domAcgLabelsDirty = false;
      let placeLabelsDirty = false;
      let domLabelLayoutRaf = 0;
      let domLabelLayoutReason = '';
      let perfLastRenderAt = 0;
      function perfNow() { return 0; }
      ${motionCoordinator}
      ${labelCoordinator}
      globalThis.contract = {
        beginMapMotion,
        endMapMotion,
        beginDomAcgMovement,
        endDomAcgMovement,
        scheduleDomAcgLabels,
        schedulePlaceLabelsRender,
      };
    `,
    context,
  );
  return {
    callbacks,
    context,
    hoverStates,
    renders,
    flushOne() {
      assert.equal(callbacks.size, 1, "expected one authoritative layout frame");
      const [[id, callback]] = callbacks;
      callbacks.delete(id);
      callback();
    },
  };
}

test("overlapping move and zoom phases produce no in-burst DOM layout and one settle", () => {
  const harness = createHarness();
  const api = harness.context.contract;

  // A queued dataset layout must be cancelled when a gesture starts.
  api.schedulePlaceLabelsRender("dataset");
  assert.equal(harness.callbacks.size, 1);
  api.beginDomAcgMovement(api.beginMapMotion("move"));
  assert.equal(harness.callbacks.size, 0);

  for (let index = 0; index < 4; index += 1) {
    api.scheduleDomAcgLabels("move");
    api.schedulePlaceLabelsRender("move");
  }
  api.beginDomAcgMovement(api.beginMapMotion("zoom"));
  api.scheduleDomAcgLabels("zoom");
  assert.equal(harness.callbacks.size, 0);
  assert.deepEqual(harness.renders, []);

  const moveSettled = api.endMapMotion("move");
  api.endDomAcgMovement("moveend", moveSettled);
  assert.equal(moveSettled, false);
  assert.equal(harness.callbacks.size, 0);
  assert.deepEqual(harness.renders, []);

  const zoomSettled = api.endMapMotion("zoom");
  api.endDomAcgMovement("zoomend", zoomSettled);
  assert.equal(zoomSettled, true);
  assert.equal(harness.callbacks.size, 1);

  harness.flushOne();
  assert.deepEqual(harness.renders, [
    ["acg", "zoomend"],
    ["places", "zoomend"],
  ]);
  assert.equal(harness.context.perfState.domLabelBurstSettles, 1);
  assert.ok(harness.context.perfState.domLabelSkippedWhileMoving > 0);
  assert.ok(harness.context.perfState.placeLabelSkippedWhileMoving > 0);
  assert.deepEqual(harness.hoverStates, [false, true]);

  // Duplicate terminal events cannot create a second settle.
  const duplicateSettled = api.endMapMotion("zoom");
  api.endDomAcgMovement("zoomend", duplicateSettled);
  assert.equal(duplicateSettled, false);
  assert.equal(harness.callbacks.size, 0);
});

test("the burst coordinator is basemap-independent and retains existing labels", () => {
  assert.doesNotMatch(labelCoordinator, /USE_LOCAL_BASEMAP|USE_MINIMAL_BASEMAP/);
  assert.doesNotMatch(labelCoordinator, /classList\.add\(['"]is-moving['"]\)/);
  assert.doesNotMatch(script, /#acg-dom-labels\.is-moving\s*\{/);

  const moveEnd = sourceBetween(
    "map.on('moveend'",
    "map.on('zoomend'",
  );
  assert.ok(
    moveEnd.indexOf("endMapMotion('move')") <
      moveEnd.indexOf("endDomAcgMovement('moveend', motionSettled)"),
  );
  assert.match(moveEnd, /if \(motionSettled\) scheduleCityLabelsRefresh/);

  const placeRenderer = sourceBetween(
    "function renderPlaceLabels",
    "function geometrySegments",
  );
  const acgRenderer = sourceBetween(
    "function renderDomAcgLabels",
    "function isCoordinateVisibleOnCurrentProjection",
  );
  assert.match(placeRenderer, /if \(isDomLabelMovementActive\(\)\)/);
  assert.match(acgRenderer, /if \(isDomLabelMovementActive\(\)\)/);
});
