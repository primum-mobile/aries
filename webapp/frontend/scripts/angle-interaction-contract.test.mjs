// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const compilerOptions = {
  module: ts.ModuleKind.ESNext,
  target: ts.ScriptTarget.ES2022,
};

function transpile(source) {
  return ts.transpileModule(source, { compilerOptions }).outputText;
}

function dataUrl(source) {
  return `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
}

async function readSource(url) {
  return (await readFile(url, "utf8")).replace(/\r\n?/g, "\n");
}

async function loadDrawChart() {
  const chartFontsUrl = dataUrl(
    transpile(
      await readSource(new URL("../src/lib/chart/chart-fonts.ts", import.meta.url)),
    ),
  );
  const canvasDrawUrl = dataUrl(
    transpile(
      await readSource(new URL("../src/lib/chart/canvas-draw.ts", import.meta.url)),
    ).replaceAll('"./chart-fonts"', `"${chartFontsUrl}"`),
  );
  const layoutModelUrl = dataUrl(
    transpile(
      await readSource(
        new URL("../src/lib/chart/wheel-layout-model.ts", import.meta.url),
      ),
    ),
  );
  const wheelStyleUrl = dataUrl(
    transpile(
      await readSource(
        new URL("../src/lib/chart/wheel-render-style.ts", import.meta.url),
      ),
    ).replaceAll('"./wheel-layout-model"', `"${layoutModelUrl}"`),
  );
  const wheelStyle = await import(wheelStyleUrl);
  const pdRingPresentationUrl = dataUrl(
    transpile(
      await readSource(
        new URL("../src/lib/chart/pd-ring-presentation.ts", import.meta.url),
      ),
    ),
  );
  const pdEventPresentationUrl = dataUrl(
    transpile(
      await readSource(
        new URL("../src/lib/chart/pd-event-presentation.ts", import.meta.url),
      ),
    ),
  );
  const glyphsUrl = dataUrl(
    transpile(
      await readSource(new URL("../src/lib/chart/glyphs.ts", import.meta.url)),
    ),
  );
  const ditherPatternUrl = dataUrl(
    transpile(
      await readSource(
        new URL("../src/lib/render/dither-pattern.ts", import.meta.url),
      ),
    ),
  );
  const outerGlyphLaneUrl = dataUrl(
    transpile(
      await readSource(
        new URL("../src/lib/chart/outer-glyph-lane.ts", import.meta.url),
      ),
    ),
  );
  const drawChartJavascript = transpile(
    await readSource(new URL("../src/lib/chart/draw-chart.ts", import.meta.url)),
  )
    .replaceAll('"./canvas-draw"', `"${canvasDrawUrl}"`)
    .replaceAll('"./chart-fonts"', `"${chartFontsUrl}"`)
    .replaceAll('"./wheel-layout-model"', `"${layoutModelUrl}"`)
    .replaceAll('"./wheel-render-style"', `"${wheelStyleUrl}"`)
    .replaceAll('"./pd-ring-presentation"', `"${pdRingPresentationUrl}"`)
    .replaceAll('"./pd-event-presentation"', `"${pdEventPresentationUrl}"`)
    .replaceAll('"./glyphs"', `"${glyphsUrl}"`)
    .replaceAll('"./outer-glyph-lane"', `"${outerGlyphLaneUrl}"`)
    .replaceAll('"../render/dither-pattern"', `"${ditherPatternUrl}"`);
  return {
    ...(await import(dataUrl(drawChartJavascript))),
    DEFAULT_WHEEL_RENDER_STYLE: wheelStyle.DEFAULT_WHEEL_RENDER_STYLE,
  };
}

const drawChart = await loadDrawChart();

function chartFixture() {
  return {
    planets: [],
    angles: { asc: 0, dsc: 180, mc: 90, ic: 270 },
    houses: {
      cusps: Array.from({ length: 12 }, (_, index) => index * 30),
    },
    aspects: [],
    options: {
      theme: 0,
      signVariant: 0,
      showHouses: false,
      showPositions: false,
      showAspects: false,
      showSymbols: false,
      showTerms: false,
      showDecans: false,
      showCusplessAscMcLabels: false,
    },
  };
}

test("all four classic angles expose the painted ray and endpoint disc", () => {
  const snapshot = {
    primaryChart: chartFixture(),
    displayDatetime: "2026-07-24T00:00:00+02:00",
    renderVariant: "round-classic",
    overlayRenderMode: "full",
    outerRingMode: "none",
  };
  const regions = drawChart.computeHitRegions(snapshot, {
    width: 800,
    height: 800,
    chartSize: 800,
    renderStyle: drawChart.DEFAULT_WHEEL_RENDER_STYLE,
    textsize: () => [12, 12],
  });
  const angles = regions.filter((region) => region.kind === "angle");

  assert.deepEqual(
    angles.map((region) => region.angleId).sort(),
    ["asc", "dsc", "ic", "mc"],
  );
  for (const region of angles) {
    assert.equal(region.shape, "line");
    assert.ok(Number.isFinite(region.x1));
    assert.ok(Number.isFinite(region.y1));
    assert.ok(Number.isFinite(region.x2));
    assert.ok(Number.isFinite(region.y2));
    const midpointX = (region.x1 + region.x2) / 2;
    const midpointY = (region.y1 + region.y2) / 2;
    assert.equal(drawChart.findHitRegion([region], midpointX, midpointY), region);
    assert.equal(drawChart.findHitRegion([region], region.x + region.r * 0.9, region.y), region);
  }
});

test("a point outside both the angle ray tolerance and endpoint disc misses", () => {
  const region = {
    kind: "angle",
    angleId: "dsc",
    x: 100,
    y: 0,
    r: 10,
    longitude: 180,
    shape: "line",
    x1: 0,
    y1: 0,
    x2: 100,
    y2: 0,
    tolerance: 6,
    priority: 30,
  };

  assert.equal(drawChart.findHitRegion([region], 50, 7), null);
  assert.equal(drawChart.findHitRegion([region], 111, 0), null);
});
