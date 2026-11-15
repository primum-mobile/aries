// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const scriptUrl = new URL("../src/lib/chart/snapshot-render-equivalence.ts", import.meta.url);
const source = await readFile(scriptUrl, "utf8");
const javascript = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const { sameCanvasRenderState } = await import(
  `data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`
);

function chart() {
  return {
    meta: { datetime: "2026-04-15T18:37:42+01:00", name: "ignored chrome" },
    planets: [{ id: "sun", longitude: 25.7, glyph: "A", motion: "" }],
    angles: { asc: 190.9, dsc: 10.9, mc: 103.7, ic: 283.7 },
    houses: { cusps: [190.9, 220, 250, 283.7, 320, 348, 10.9, 40, 70, 103.7, 140, 168] },
    aspects: [{ p1: "sun", p2: "moon", type: 0, orb: 1 }],
    bodyAspects: { sun: [{ other: "moon", type: 0, orb: 1, showsOnClick: true }] },
    fixedStars: [{ name: "Regulus", longitude: 150 }],
    palette: { background: "#000", planets: ["#fff"] },
    options: {
      theme: 2,
      signVariant: 1,
      showHouses: true,
      showPositions: true,
      showAspects: true,
      showSymbols: true,
    },
    overlay: { rows: [{ label: "deferred" }] },
  };
}

function snapshot() {
  return {
    primaryChart: chart(),
    comparisonChart: chart(),
    radixChart: chart(),
    displayAnchorChart: chart(),
    displayDatetime: "2026-04-15T18:37:42+01:00",
    renderVariant: "round-anglo",
    overlayRenderMode: "step_fast",
    outerRingMode: "antiscia",
    comparisonLayout: "standard",
    comparisonWholeSign: false,
    interChartAspects: [{ outer: "sun", inner: "moon", type: 0, orb: 1 }],
    interChartBodyAspects: {
      "outer:sun": [{ outer: "sun", inner: "moon", type: 0, orb: 1 }],
    },
    outerRingItems: {
      antiscia: [{ id: "sun", family: "antiscia", longitude: 154.3, label: "Sun" }],
      contraAntiscia: [{ id: "sun", family: "contra", longitude: 205.7, label: "Sun" }],
    },
    document: { documentId: "doc-1", titleSuffix: "step" },
    debugTiming: { totalMs: 1 },
  };
}

test("full overlay may reuse only the exact painted Canvas state", () => {
  const stepped = snapshot();
  const full = structuredClone(stepped);
  full.overlayRenderMode = "full";
  full.primaryChart.overlay.rows[0].label = "full";
  full.comparisonChart.overlay.rows[0].label = "full";
  full.primaryChart.meta.name = "full metadata";
  full.comparisonChart.meta.name = "full metadata";
  full.comparisonChart.bodyAspects = { moon: [] };
  full.radixChart.planets[0].longitude = 99;
  full.displayAnchorChart.planets[0].longitude = 88;
  full.outerRingItems.contraAntiscia.push({
    id: "moon",
    family: "inactive",
    longitude: 10,
    label: "Moon",
  });
  full.document.titleSuffix = "full";
  full.debugTiming.totalMs = 5;
  full.settleOverlayOnly = true;
  full.renderInvalidation = { geometry: false, dynamic: false, outerLabel: false };
  assert.equal(sameCanvasRenderState(stepped, full), true);
});

test("every active Canvas and hit-test input fails closed", () => {
  const mutations = [
    (value) => { value.displayDatetime = "2026-04-15T18:38:42+01:00"; },
    (value) => { value.renderVariant = "round-classic"; },
    (value) => { value.primaryChart.planets[0].longitude += 1; },
    (value) => { value.primaryChart.fixedStars[0].longitude += 1; },
    (value) => { value.primaryChart.options.showAspects = false; },
    (value) => { value.primaryChart.bodyAspects.sun[0].orb += 1; },
    (value) => { value.comparisonChart.planets[0].longitude += 1; },
    (value) => { value.outerRingItems.antiscia[0].longitude += 1; },
    (value) => { value.interChartAspects[0].orb += 1; },
    (value) => { value.interChartBodyAspects["outer:sun"][0].orb += 1; },
  ];
  for (const mutate of mutations) {
    const left = snapshot();
    const right = structuredClone(left);
    mutate(right);
    assert.equal(sameCanvasRenderState(left, right), false);
  }
});

test("both settle entry points require exact-object paint acknowledgement", async () => {
  const homeClient = await readFile(
    new URL("../src/components/workshell/home-client.tsx", import.meta.url),
    "utf8",
  );
  const chartCanvas = await readFile(
    new URL("../src/components/workshell/chart-canvas.tsx", import.meta.url),
    "utf8",
  );
  const registry = await readFile(
    new URL("../src/lib/chart/painted-snapshot-registry.ts", import.meta.url),
    "utf8",
  );
  assert.equal((homeClient.match(/canReusePaintedDocumentCanvas\(/g) ?? []).length, 2);
  assert.match(
    registry,
    /wasDocumentSnapshotPainted\(docId, current\)[\s\S]*sameCanvasRenderState\(current, next\)/,
  );
  assert.match(
    chartCanvas,
    /if \(refreshHitRegions\) \{\s*acknowledgePaintedDocumentSnapshot\(/,
  );
});

test("aspect click and hide state override an overlay-only zero-dirty plan", async () => {
  const chartCanvas = await readFile(
    new URL("../src/components/workshell/chart-canvas.tsx", import.meta.url),
    "utf8",
  );
  assert.match(
    chartCanvas,
    /const aspectInteractionPaintKey = JSON\.stringify\(\[\s*chart\.document\?\.documentId \?\? null,\s*exclusiveOnClick,\s*selectedAspectBody,\s*hideAllAspects,\s*minorOnlyAspects,/,
  );
  assert.match(
    chartCanvas,
    /if \(paintedAspectInteractionKeyRef\.current !== aspectInteractionPaintKey\) \{\s*dirty\.dynamic = true;\s*\}/,
  );
  assert.match(
    chartCanvas,
    /hitRegionsRef\.current = computeHitRegions\([\s\S]*?clickAspectState: \{\s*selectedBody: selectedAspectBody,\s*hideAll: hideAllAspects,\s*minorOnly: minorOnlyAspects,\s*\},\s*includeStyleTargets: styleEditorActive,\s*outerLabelCollisionBounds,\s*\}\);\s*paintedAspectInteractionKeyRef\.current = aspectInteractionPaintKey;/,
  );
});

test("the masking check is asked of the map the wheel is painted from", () => {
  // The scene decides which scope a handle writes to by asking whether the
  // visible variant already authors that property. That mechanism has its own
  // test and has always passed — because that test hands it the profile map
  // directly. The app handed it the *editor's working set*, which is empty for
  // a saved profile, so on an Anglo wheel with Paper loaded
  // (`authoring.wheel.anglo.canvas.chart.scale`) the check saw no variant
  // value, the drag wrote base, anglo went on governing, and the accumulated
  // base value applied in one jump the moment scope precedence changed.
  //
  // The green mechanism test next to a broken app is the whole reason this
  // asserts the *wiring*: proving a function works is not proving it is called
  // with the right input.
  const chartCanvas = readFileSync(
    new URL("../src/components/workshell/chart-canvas.tsx", import.meta.url),
    "utf8",
  );
  const call = chartCanvas.match(
    /variantAuthoredOverrideIds: variantAuthoredOverrideIds\(([\s\S]*?)\n {12}\),/,
  );
  assert.ok(call, "chart-canvas must build the scene's variant-authored map");
  assert.match(call[1], /effectiveWheelAuthoringOverrides/,
    "scene masking must consume the same effective map as paint");
  assert.match(chartCanvas, /const effectiveWheelAuthoringOverrides = useMemo\([\s\S]*?resolveWheelPresetAuthoringOverrides\(wheelPresetInput\)/);
  // Presets come from the painted chart, keyed by content so a time step's
  // equal presets object does not re-resolve the render style.
  assert.match(chartCanvas, /const wheelGeometryPresetsKey = JSON\.stringify\(chart\.primaryChart\.options\.wheelGeometryPresets \?\? null\);/);
  assert.match(chartCanvas, /presets: JSON\.parse\(wheelGeometryPresetsKey\)/);
  assert.match(chartCanvas, /appearanceOverrides: \{[\s\S]*?effectiveTheme\?\.profileOverrides\?\.wheelAuthoring[\s\S]*?styleWorkingPreviewActive \? styleSemanticOverrides/,
    "saved appearance and active editor appearance both reach the effective map");
});


test("visibility catalog revision alone does not redraw unchanged selected geometry", () => {
  const before = snapshot();
  before.primaryChart.options.wheelGeometryPresets = { anglo: { id: "factory", revision: 4, overrides: { radius: 123 } } };
  const after = structuredClone(before);
  after.primaryChart.options.wheelGeometryPresets.anglo.revision = 5;
  assert.equal(sameCanvasRenderState(before, after), true);
  after.primaryChart.options.wheelGeometryPresets.anglo.overrides.radius = 124;
  assert.equal(sameCanvasRenderState(before, after), false);
  after.primaryChart.options.wheelGeometryPresets.anglo.overrides.radius = 123;
  after.primaryChart.options.wheelGeometryPresets.anglo.id = "other";
  assert.equal(sameCanvasRenderState(before, after), false);
});


test("traditional center labels and planetary hours invalidate a reused settle canvas", () => {
  const before = snapshot();
  before.primaryChart.options.theme = 1;
  before.primaryChart.options.showInformation = true;
  before.primaryChart.options.wheelGeometryPresets = {compact: {id: "traditional", revision: 1,
    overrides: {"wheel.presentation": "traditional-morinus"}}};
  before.primaryChart.meta.centerLines = ["Full chart name", "Tropical"];
  before.primaryChart.overlay.rows = [{group: "dayhour", label: "Hour", glyphs: [{char: "A"}]}];
  const after = structuredClone(before);
  assert.equal(sameCanvasRenderState(before, after), true);
  after.primaryChart.meta.centerLines[1] = "Lahiri";
  assert.equal(sameCanvasRenderState(before, after), false);
  after.primaryChart.meta.centerLines[1] = "Tropical";
  after.primaryChart.overlay.rows[0].glyphs[0].char = "B";
  assert.equal(sameCanvasRenderState(before, after), false);
  before.primaryChart.options.showInformation = after.primaryChart.options.showInformation = false;
  assert.equal(sameCanvasRenderState(before, after), true);
});

test("time steps keep render-style and dashboard theme identity", () => {
  // Each step publishes a new chart object. Anything keyed on that object
  // re-resolves the wheel style and misses every style-keyed paint cache.
  const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
  const chartCanvas = read("../src/components/workshell/chart-canvas.tsx");
  const surface = read("../src/components/workshell/workspace-content.tsx");
  assert.match(chartCanvas, /const chartPaletteKey = JSON\.stringify\(chart\.primaryChart\.palette \?\? null\);/);
  assert.match(chartCanvas, /\[chartPaletteKey, effectiveTheme, inheritAppTheme\]/);
  assert.match(surface, /const chartPaletteKey = JSON\.stringify\(primaryChart\.palette \?\? null\);/);
  assert.match(surface, /\[chartPaletteKey, theme\]/);
  // Module colours and rule widths resolve once per theme scope, not per step.
  assert.match(chartCanvas, /const scopeKey = \[renderStyle, effectiveTheme\] as const;/);
  assert.match(chartCanvas, /cssColorResolver\(wrap, scope\.colors\)/);
  assert.doesNotMatch(chartCanvas, /paintDashboard\([\s\S]{0,600}cssPixels\(/);
});
