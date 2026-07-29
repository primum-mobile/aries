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
  .find((source) => source.includes("function flushRetainedRuntimeOverlayScene"));

assert.ok(script, "missing bundled Astrocart scene coordinator");

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
const sceneCoordinator = [
  sourceBetween(
    "function runtimeOverlaySceneDeferred",
    "function applyDisplayStyle",
  ),
  sourceBetween(
    "function pushEclipseData",
    "function applyDevColors",
  ),
].join("\n");

function createHarness() {
  const calls = [];
  const context = { calls };
  vm.createContext(context);
  vm.runInContext(
    `
      const ACG_SOURCE_ID = 'acg';
      const ACG_LABEL_SOURCE_ID = 'acg-labels-src';
      const ASTERISM_SOURCE_ID = 'asterisms';
      const ECLIPSE_SOURCE_ID = 'eclipse-path';
      const ACG_PERF_MODE = true;
      const perfState = {
        runtimeSceneDeferredPushes: 0,
        runtimeSceneCoherentFlushes: 0,
      };
      let perfLastRenderAt = 0;
      function perfNow() { return 0; }
      const activeMapMotionPhases = new Set();
      let mapHostActive = true;
      let retainedDataDirty = false;
      let retainedAsterismDirty = false;
      let retainedEclipseDirty = false;
      let retainedEclipseFitPending = false;
      let currentData = { type: 'FeatureCollection', marker: 'data-0', features: [] };
      let currentAsterismData = { type: 'FeatureCollection', marker: 'asterism-0', features: [] };
      let currentEclipseData = { type: 'FeatureCollection', marker: 'eclipse-0', features: [] };
      let currentMapData = currentData;
      let currentMapAsterismData = currentAsterismData;
      let currentMapEclipseData = currentEclipseData;
      let polarAsterismStarHitTargets = [];
      const ACTIVE_ASTROCART_STYLE = null;

      const map = {
        isStyleLoaded: () => true,
        getSource(id) {
          return {
            setData(data) {
              calls.push(['setData', id, data.marker]);
            },
          };
        },
        getLayer: () => true,
        triggerRepaint() {
          calls.push(['repaint']);
        },
      };

      function isDomLabelMovementActive() {
        return activeMapMotionPhases.size > 0;
      }
      function setAsterismHoverEnabled(value) {
        calls.push(['hover', value]);
      }
      function rebuildPolarOverlayPaths() {
        calls.push(['polar']);
        currentMapData = currentData;
        currentMapAsterismData = currentAsterismData;
        currentMapEclipseData = currentEclipseData;
      }
      function ensureAcgLayers() { calls.push(['ensure', 'acg']); }
      function ensureAsterismLayer() { calls.push(['ensure', 'asterism']); }
      function ensureEclipseLayers() { calls.push(['ensure', 'eclipse']); }
      function hideAsterismStarPopup() { calls.push(['hide-popup']); }
      function syncBirthplaceMarker() { calls.push(['marker']); }
      function updateLegend() { calls.push(['legend']); }
      function syncReferenceVisibility() { calls.push(['reference']); }
      function scheduleRuntimeOverlayReplay() { calls.push(['replay']); }
      function fitFeatureCollection() { calls.push(['fit']); }
      function scheduleDomAcgLabels(reason) { calls.push(['dom-labels', reason]); }
      function applyDisplayStyle() { calls.push(['display-style']); }
      function setStatus() {}
      function postPerfSnapshot(reason) { calls.push(['perf', reason]); }

      ${motionCoordinator}
      ${sceneCoordinator}

      globalThis.contract = {
        beginMapMotion,
        endMapMotion,
        pushData,
        pushAsterismData,
        pushEclipseData,
        refreshPolarProjectionData,
        flushRetainedRuntimeOverlayScene,
        setHostActive(value) { mapHostActive = value; },
        setPayload(kind, marker) {
          const payload = { type: 'FeatureCollection', marker, features: [] };
          if (kind === 'data') currentData = payload;
          if (kind === 'asterism') currentAsterismData = payload;
          if (kind === 'eclipse') currentEclipseData = payload;
        },
        perfState,
      };
    `,
    context,
  );
  return { calls, api: context.contract };
}

function sceneWork(calls) {
  return calls.filter(([kind]) => [
    "polar",
    "setData",
    "marker",
    "legend",
    "reference",
    "dom-labels",
    "repaint",
  ].includes(kind));
}

test("latest scene payloads stay offscreen through overlapping movement and flush once", () => {
  const { api, calls } = createHarness();

  assert.equal(api.beginMapMotion("move"), true);
  assert.equal(api.beginMapMotion("zoom"), false);
  calls.length = 0;

  api.setPayload("data", "data-1");
  api.pushData();
  api.setPayload("data", "data-2");
  api.pushData();
  api.setPayload("asterism", "asterism-1");
  api.pushAsterismData();
  api.setPayload("eclipse", "eclipse-1");
  api.pushEclipseData({ fit: true });

  assert.deepEqual(sceneWork(calls), []);
  assert.equal(api.perfState.runtimeSceneDeferredPushes, 4);

  const moveSettled = api.endMapMotion("move");
  assert.equal(moveSettled, false);
  assert.equal(api.flushRetainedRuntimeOverlayScene("moveend"), false);
  assert.deepEqual(sceneWork(calls), []);

  const zoomSettled = api.endMapMotion("zoom");
  assert.equal(zoomSettled, true);
  assert.equal(api.flushRetainedRuntimeOverlayScene("zoomend"), true);

  assert.equal(calls.filter(([kind]) => kind === "polar").length, 1);
  assert.deepEqual(
    JSON.parse(JSON.stringify(calls.filter(([kind]) => kind === "setData"))),
    [
      ["setData", "acg", "data-2"],
      ["setData", "acg-labels-src", "data-2"],
      ["setData", "asterisms", "asterism-1"],
      ["setData", "eclipse-path", "eclipse-1"],
    ],
  );
  for (const kind of ["marker", "legend", "reference", "dom-labels", "repaint"]) {
    assert.equal(calls.filter(([entry]) => entry === kind).length, 1, kind);
  }
  assert.equal(api.perfState.runtimeSceneCoherentFlushes, 1);

  const workCount = sceneWork(calls).length;
  assert.equal(api.flushRetainedRuntimeOverlayScene("duplicate"), false);
  assert.equal(sceneWork(calls).length, workCount);
});

test("hidden payloads use the same dirty scene without replaying camera fit", () => {
  const { api, calls } = createHarness();
  api.setHostActive(false);
  calls.length = 0;

  api.setPayload("data", "hidden-data");
  api.pushData();
  api.setPayload("asterism", "hidden-asterism");
  api.pushAsterismData();
  api.setPayload("eclipse", "hidden-eclipse");
  api.pushEclipseData({ fit: true });
  assert.deepEqual(sceneWork(calls), []);

  api.setHostActive(true);
  assert.equal(api.flushRetainedRuntimeOverlayScene("reactivate"), true);
  assert.equal(calls.filter(([kind]) => kind === "polar").length, 1);
  assert.equal(calls.filter(([kind]) => kind === "fit").length, 0);
  assert.equal(calls.filter(([kind]) => kind === "dom-labels").length, 1);
});

test("public data replacement defers before styling and final events own the flush", () => {
  const publicApi = sourceBetween(
    "setData(geojson)",
    "setAsterismData(geojson)",
  );
  assert.ok(
    publicApi.indexOf("runtimeOverlaySceneDeferred()") <
      publicApi.indexOf("applyDisplayStyle(ACTIVE_ASTROCART_STYLE, false)"),
  );

  for (const phase of ["move", "zoom"]) {
    const handler = sourceBetween(
      `map.on('${phase}end'`,
      phase === "move" ? "map.on('zoomend'" : "wireControlsOnce();",
    );
    const phaseEnd = `const motionSettled = endMapMotion('${phase}');`;
    assert.ok(
      handler.indexOf(phaseEnd) >= 0 &&
        handler.indexOf(phaseEnd) <
          handler.indexOf("if (motionSettled) flushRetainedRuntimeOverlayScene"),
    );
  }
});
