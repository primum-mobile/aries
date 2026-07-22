import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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
    /const aspectInteractionPaintKey = JSON\.stringify\(\[\s*chart\.document\?\.documentId \?\? null,\s*exclusiveOnClick,\s*selectedAspectBody,\s*hideAllAspects,/,
  );
  assert.match(
    chartCanvas,
    /if \(paintedAspectInteractionKeyRef\.current !== aspectInteractionPaintKey\) \{\s*dirty\.dynamic = true;\s*\}/,
  );
  assert.match(
    chartCanvas,
    /hitRegionsRef\.current = computeHitRegions\([\s\S]*?clickAspectState: \{ selectedBody: selectedAspectBody, hideAll: hideAllAspects \},\s*\}\);\s*paintedAspectInteractionKeyRef\.current = aspectInteractionPaintKey;/,
  );
});
