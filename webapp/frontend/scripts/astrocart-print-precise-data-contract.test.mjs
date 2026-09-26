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
  .find((source) => source.includes("function snapshotPrecisePrintGeojson"));

assert.ok(script, "missing bundled Astrocart precise-print contract");

function sourceBetween(startMarker, endMarker) {
  const start = script.indexOf(startMarker);
  const end = script.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `missing ${startMarker}`);
  return script.slice(start, end);
}

const snapshotSource = sourceBetween(
  "function snapshotPrecisePrintGeojson",
  "function activeStyleForPrintAtlas",
);
const builderSource = sourceBetween(
  "function buildRuntimeOverlayScene",
  "function rebuildPolarOverlayPaths",
);

function preciseFixture(marker = "precise-source") {
  return {
    type: "FeatureCollection",
    meta: {
      precision: "precise",
      birthplace: { longitude: 13.4, latitude: 52.5 },
    },
    marker,
    features: [{
      type: "Feature",
      properties: { kind: "MC", label: marker },
      geometry: {
        type: "LineString",
        coordinates: [[10, 84], [10, 89]],
      },
    }],
  };
}

test("print capture accepts only a deep precise GeoJSON snapshot", () => {
  const snapshotPrecisePrintGeojson = new Function(
    `${snapshotSource}\nreturn snapshotPrecisePrintGeojson;`,
  )();

  for (const invalid of [
    undefined,
    null,
    {},
    { type: "FeatureCollection", features: [] },
    {
      type: "FeatureCollection",
      features: [],
      meta: { precision: "preview" },
    },
  ]) {
    assert.throws(
      () => snapshotPrecisePrintGeojson(invalid),
      /requires precise GeoJSON/,
    );
  }

  const source = preciseFixture();
  const snapshot = snapshotPrecisePrintGeojson(source);
  assert.notEqual(snapshot, source);
  assert.notEqual(snapshot.features, source.features);
  assert.equal(snapshot.meta.precision, "precise");

  source.marker = "mutated-later";
  source.features[0].properties.label = "mutated-later";
  assert.equal(snapshot.marker, "precise-source");
  assert.equal(snapshot.features[0].properties.label, "precise-source");
});

test("the pure scene builder consumes explicit print data without touching the live scene", () => {
  const calls = [];
  const context = { calls };
  vm.createContext(context);
  vm.runInContext(
    `
      const selectedProjection = 'mercator';
      const currentData = { marker: 'live-data' };
      const currentMapData = { marker: 'live-map-data' };
      function appendPolarOverlayPaths(data, source, target) {
        target.push({ source, marker: data.marker });
      }
      function appendPolarOverlayPolygons(data, source, target) {
        target.push({ source, marker: data.marker });
      }
      function appendPolarOverlayPoints(data, source, target) {
        target.push({ source, marker: data.marker });
      }
      function clipFeatureCollectionToMapBand(data, options) {
        return { marker: data.marker, options };
      }
      ${builderSource}
      const scene = buildRuntimeOverlayScene(
        { marker: 'precise-print' },
        { marker: 'asterism' },
        { marker: 'eclipse' },
        'globe',
      );
      globalThis.result = {
        scene,
        liveDataMarker: currentData.marker,
        liveMapDataMarker: currentMapData.marker,
      };
    `,
    context,
  );

  const result = JSON.parse(JSON.stringify(context.result));
  assert.equal(result.scene.data.marker, "precise-print");
  assert.equal(result.scene.mapData.marker, "precise-print");
  assert.equal(result.scene.mapData.options.omitPolarPoints, true);
  assert.ok(
    result.scene.polarPaths.some(
      (entry) => entry.source === "acg" && entry.marker === "precise-print",
    ),
  );
  assert.equal(result.scene.asterismData.marker, "asterism");
  assert.equal(result.scene.eclipseData.marker, "eclipse");
  assert.equal(result.liveDataMarker, "live-data");
  assert.equal(result.liveMapDataMarker, "live-map-data");
});

test("all print render consumers use the explicit scene and never refresh the visible map", () => {
  const styleBuilder = sourceBetween(
    "function activeStyleForPrintAtlas",
    "function encodePrintCanvas",
  );
  assert.match(styleBuilder, /style\.sources\[ACG_SOURCE_ID\]\.data = scene\.mapData/);
  assert.match(
    styleBuilder,
    /style\.sources\[ASTERISM_SOURCE_ID\]\.data = scene\.mapAsterismData/,
  );
  assert.match(
    styleBuilder,
    /style\.sources\[ECLIPSE_SOURCE_ID\]\.data = scene\.mapEclipseData/,
  );
  assert.doesNotMatch(styleBuilder, /currentMapData|syncVisibilityFilters|map\.triggerRepaint/);

  const polarRenderer = sourceBetween(
    "function renderPrintAtlasPolarOverlay",
    "function printAtlasProjectedPoint",
  );
  assert.match(polarRenderer, /paths: scene\.polarPaths/);
  assert.match(polarRenderer, /points: scene\.polarPoints/);
  assert.match(polarRenderer, /polygons: scene\.polarPolygons/);

  const birthplaceRenderer = sourceBetween(
    "function drawPrintAtlasBirthplaceMarker",
    "function renderPrintAtlasSupplementOverlay",
  );
  assert.match(birthplaceRenderer, /birthplaceCoordinates\(scene\.data\)/);
  assert.doesNotMatch(birthplaceRenderer, /birthplaceCoordinates\(currentData\)/);
});

test("capture snapshots precise data before its first await and the bridge passes it explicitly", () => {
  const capture = sourceBetween(
    "async function capturePrintAtlas",
    "function themeTokens",
  );
  const snapshotIndex = capture.indexOf(
    "const preciseData = snapshotPrecisePrintGeojson(geojson)",
  );
  const firstAwaitIndex = capture.indexOf("await ");
  assert.ok(snapshotIndex >= 0 && firstAwaitIndex > snapshotIndex);
  assert.match(
    capture,
    /buildRuntimeOverlayScene\(\s*preciseData,\s*currentAsterismData,\s*currentEclipseData,/,
  );
  assert.match(
    capture,
    /applyDisplayStyleToData\(preciseData, ACTIVE_ASTROCART_STYLE\)/,
  );
  assert.doesNotMatch(capture, /\bcurrentMapData\b|\bcurrentData\s*=/);

  const bridge = sourceBetween(
    "case 'aries.capturePrintAtlas'",
    "case 'aries.cancelPrintAtlas'",
  );
  assert.match(
    bridge,
    /acg\.capturePrintAtlas\(\s*data\.pageFormat,\s*data\.selection,\s*data\.geojson,\s*controller\.signal,/,
  );
});

const workspaceSource = await readFile(
  new URL("../src/components/workshell/workspace-content.tsx", import.meta.url),
  "utf8",
);

function workspaceSourceBetween(startMarker, endMarker) {
  const start = workspaceSource.indexOf(startMarker);
  const end = workspaceSource.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `missing ${startMarker}`);
  return workspaceSource.slice(start, end);
}

test("print capture reads per-mode keys from composite daemon payloads", async () => {
  const ts = (await import("typescript")).default;
  const helperSource = workspaceSourceBetween(
    "function astrocartPayloadModeSpecKey",
    "function composeAstrocartModePayload",
  );
  const compiled = ts.transpileModule(
    `${helperSource}\nglobalThis.helper = astrocartPayloadModeSpecKey;`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022 } },
  ).outputText;
  const context = {};
  vm.createContext(context);
  vm.runInContext(compiled, context);
  const modeKey = context.helper;

  // ``?modes=standard`` is the request shape the print atlas uses.
  const composite = {
    meta: {
      composite: true,
      modes: ["standard", "local_space"],
      modeSpecKeys: { standard: "key-standard", local_space: "key-local" },
    },
  };
  assert.equal(modeKey(composite, "standard"), "key-standard");
  assert.equal(modeKey(composite, "local_space"), "key-local");
  assert.equal(modeKey(composite, "geodetic_giza"), null);
  assert.equal(
    modeKey({ meta: { mode: "standard", modeSpecKey: "key-standard" } }, "standard"),
    "key-standard",
  );
  // A single-mode key never vouches for a different mode.
  assert.equal(
    modeKey({ meta: { mode: "standard", modeSpecKey: "key-standard" } }, "local_space"),
    null,
  );
  assert.equal(modeKey({ meta: { composite: true, modes: ["standard"] } }, "standard"), null);

  const capture = workspaceSourceBetween(
    "const requestPrintAtlas = React.useCallback",
    "const cancelPrintAtlasRequests",
  );
  assert.match(capture, /astrocartPayloadModeSpecKey\(payload, mode\)/);
  assert.doesNotMatch(capture, /payload\.meta\.modeSpecKey/);
});

test("print atlas failures carry a reason instead of settling silently", () => {
  const capture = workspaceSourceBetween(
    "const requestPrintAtlas = React.useCallback",
    "const cancelPrintAtlasRequests",
  );
  assert.doesNotMatch(
    capture.replace(/const abortListener = \(\) => \{[\s\S]*?\n      \};/, ""),
    /settlePrintAtlasRequest\(requestId, null\);/,
  );
  const settle = workspaceSourceBetween(
    "const settlePrintAtlasRequest = React.useCallback",
    "const requestPrintAtlas = React.useCallback",
  );
  assert.match(settle, /console\.error\("\[acg-print\] atlas capture unavailable:"/);
  assert.match(
    script,
    /type: 'print-atlas',\s*requestId,\s*ok: false,\s*error:/,
  );
});


test("the iframe bridge accepts a single current-map page and still rejects invalid captures", () => {
  const handler = workspaceSourceBetween(
    'if (payload.type === "print-atlas" && payload.requestId)',
    'if (payload.type === "ruler"',
  );
  const expression = handler.slice(handler.indexOf("const atlas = ") + 14, handler.indexOf(";\n        settlePrintAtlasRequest"));
  const accept = new Function("payload", `return (${expression});`);
  const page = { dataUrl: "data:image/png;base64,fixture", containsAstrology: true };
  for (const count of [1, 7]) {
    const atlas = { pages: Array.from({ length: count }, () => ({ ...page })) };
    assert.equal(accept({ ok: true, atlas }), atlas);
  }
  assert.equal(accept({ ok: true, atlas: { pages: [] } }), null);
  assert.equal(accept({ ok: false, atlas: { pages: [page] } }), null);
  assert.equal(accept({ ok: true, atlas: { pages: [{ ...page, containsAstrology: false }] } }), null);
  assert.equal(accept({ ok: true, atlas: { pages: [{ ...page, dataUrl: "invalid" }] } }), null);
});
