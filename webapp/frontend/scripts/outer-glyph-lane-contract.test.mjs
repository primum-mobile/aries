// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const laneSource = await readFile(
  new URL("../src/lib/chart/outer-glyph-lane.ts", import.meta.url),
  "utf8",
);
const laneJavascript = ts.transpileModule(laneSource, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const {
  resolveOuterGlyphLane,
  resolveOuterPaintEnvelopeScale,
  resolveChartPaintTarget,
} = await import(
  `data:text/javascript;base64,${Buffer.from(laneJavascript).toString("base64")}`
);

const drawChartSource = await readFile(
  new URL("../src/lib/chart/draw-chart.ts", import.meta.url),
  "utf8",
);
const chartCanvasSource = await readFile(
  new URL("../src/components/workshell/chart-canvas.tsx", import.meta.url),
  "utf8",
);

test("outer glyph lane leaves the configured gap before glyph ink", () => {
  const lane = resolveOuterGlyphLane(380, 40, 5, 300);
  assert.deepEqual(lane, {
    centerRadius: 380,
    leaderRadius: 355,
    outerRadius: 400,
    gap: 5,
  });
  assert.equal(lane.centerRadius - lane.leaderRadius - 40 / 2, 5);
});

test("outer paint envelope only reduces the target when paint exceeds the wheel", () => {
  assert.equal(resolveOuterPaintEnvelopeScale(392, 400), 1);
  assert.equal(resolveOuterPaintEnvelopeScale(420, 400), 1.05);
});

test("paint target fits diameter around the historical centre", () => {
  assert.deepEqual(resolveChartPaintTarget(1200, 1000, 1, 60, false), {
    side: 1000,
    centerY: 500,
  });
  assert.deepEqual(resolveChartPaintTarget(800, 1000, 1, 60, true), {
    side: 800,
    centerY: 500,
  });
  assert.equal(
    resolveChartPaintTarget(1200, 1000, 1, 60, true).side,
    880,
  );
  assert.equal(
    resolveChartPaintTarget(1200, 1000, 1.05, 60, true).side,
    880 / 1.05,
  );
  assert.equal(
    resolveChartPaintTarget(1200, 1000, 1, 50, true).side,
    900,
  );
  assert.equal(resolveChartPaintTarget(1200, 1000, 1, 60, true).centerY, 500);
  assert.equal(resolveChartPaintTarget(800, 1000, 1, 60, true).centerY, 500);
});

test("glyph families share one lane and bypass the word-label push-out", () => {
  assert.match(drawChartSource, /function isOuterGlyphFamily/);
  assert.match(drawChartSource, /const lane = outerGlyphLane\(ringset, glyphSize, typography, style\)/);
  assert.match(drawChartSource, /const glyphLane = isOuterGlyphFamily\(item\.family\)/);
  assert.match(drawChartSource, /if \(!glyphLane\) \{\s*\[x, y\] = ensureTextOutsideOuterWheel/);
  assert.match(drawChartSource, /outerRingItemFontSize\(item, typography\)[\s\S]*?\.leaderRadius/);
  assert.match(
    drawChartSource,
    /ordered\.every\(\(item\) => isOuterGlyphFamily\(item\.family\)\)[\s\S]*?\? \[\][\s\S]*?: collisionBounds/,
  );
  assert.doesNotMatch(drawChartSource, /avoidOuterBodyCollisionBounds/);
});

test("canvas keeps the historical centre and fits to the visible title text", () => {
  const envelopeSource = drawChartSource.slice(
    drawChartSource.indexOf("export function resolveChartOuterPaintEnvelope("),
    drawChartSource.indexOf("export function drawSnapshotLayer("),
  );
  assert.match(chartCanvasSource, /resolveChartOuterPaintEnvelope\(/);
  assert.match(chartCanvasSource, /\[data-aries-titlebar-title\]/);
  assert.doesNotMatch(chartCanvasSource, /\[data-aries-titlebar-backplate\]/);
  assert.doesNotMatch(chartCanvasSource, /function chartTopInset\(/);
  assert.match(
    chartCanvasSource,
    /const target = resolveChartPaintTarget\(/,
  );
  assert.match(
    chartCanvasSource,
    /const wheelCenter:[\s\S]*?target\.y \+ target\.side \/ 2/,
  );
  assert.match(drawChartSource, /const center: Pt = opts\.center/);
  assert.match(envelopeSource, /const hasOuterRing = hasComparison \|\| snapshot\.outerRingMode !== "none"/);
  assert.match(envelopeSource, /if \(!hasOuterRing\)[\s\S]*?paintRadiusScale: 1[\s\S]*?avoidTitlebar: false/);
  assert.match(envelopeSource, /outerModeGlyphSize\(snapshot\.outerRingMode, typography\)/);
  assert.doesNotMatch(envelopeSource, /candidateRingsets/);
  assert.doesNotMatch(envelopeSource, /outerRingItems/);
  assert.doesNotMatch(envelopeSource, /textsize|measureText/);
});
