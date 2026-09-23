// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const frontendRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(
  join(frontendRoot, "src/styles/style-token-public.generated.json"),
  "utf8",
));
const globals = readFileSync(join(frontendRoot, "src/app/globals.css"), "utf8");
const chartCanvas = readFileSync(
  join(frontendRoot, "src/components/workshell/chart-canvas.tsx"),
  "utf8",
);
const drawChart = readFileSync(join(frontendRoot, "src/lib/chart/draw-chart.ts"), "utf8");

test("wheel compositor exposes the complete bounded paint-only effect set", () => {
  const effects = manifest.tokens.filter(({ cssVar }) => cssVar.includes("-wheel-effect-"));
  assert.equal(effects.length, 39);
  assert.equal(effects.filter(({ type }) => type === "color").length, 3);
  assert.equal(effects.filter(({ type }) => type === "number").length, 36);

  for (const layer of ["geometry", "dynamic", "outer-label"]) {
    for (const role of [
      "opacity",
      "blur",
      "brightness-scale",
      "contrast-scale",
      "saturate-scale",
      "hue-rotate",
      "grayscale-opacity",
      "invert-opacity",
      "sepia-opacity",
      "shadow-offset-x",
      "shadow-offset-y",
      "shadow-blur",
      "shadow-color",
    ]) {
      assert.ok(
        effects.some(({ cssVar }) => cssVar === `--aries-wheel-effect-${layer}-${role}`),
        `${layer} ${role} must remain authorable`,
      );
    }
  }

  for (const token of effects.filter(({ cssVar }) => cssVar.endsWith("-blur"))) {
    assert.deepEqual(token.bounds, { min: 0, max: 64, step: 0.5 });
    assert.equal(token.unit, "px");
  }
});

test("effects stay on retained canvas compositing and out of chart geometry", () => {
  assert.match(globals, /\.aries-chart-paint-effects > canvas:nth-of-type\(2\)/);
  assert.match(globals, /\.aries-chart-paint-effects > canvas:nth-of-type\(3\)/);
  assert.match(globals, /\.aries-chart-paint-effects > canvas:nth-of-type\(4\)/);
  assert.doesNotMatch(globals, /\.aries-chart-paint-effects > canvas:nth-of-type\(1\)/);
  for (const filter of [
    "blur(",
    "brightness(",
    "contrast(",
    "saturate(",
    "hue-rotate(",
    "grayscale(",
    "invert(",
    "sepia(",
    "drop-shadow(",
  ]) {
    assert.ok(globals.includes(filter), `${filter} must stay in the CSS compositor`);
  }
  assert.match(chartCanvas, /aries-chart-paint-effects/);
  assert.doesNotMatch(drawChart, /--aries-wheel-effect-/);
});

test("fill textures are deterministic cached assets that repaint with live steps", () => {
  assert.match(drawChart, /const fillTextureTileCache = new Map/);
  const textureStart = drawChart.indexOf("function fillTexturePattern(");
  const textureEnd = drawChart.indexOf("function paintFillRegion(", textureStart);
  assert.ok(textureStart >= 0 && textureEnd > textureStart);
  const textureSource = drawChart.slice(textureStart, textureEnd);
  assert.doesNotMatch(textureSource, /Math\.random/);
  assert.match(textureSource, /fillTextureTileCache\.get/);
  assert.match(drawChart, /if \(layer === "fill"\)[\s\S]*?drawRetainedFillLayer/);
  assert.match(
    drawChart,
    /draw\.fillBackground\(style\.palette\.background\);[\s\S]*?paintCanvasBackgroundMaterial/,
  );
  assert.match(
    drawChart,
    /resolveWheelFillPaint\([\s\S]*?"canvas\.background"/,
  );
  assert.match(
    drawChart,
    /paintCanvasBackgroundMaterial\([\s\S]*?paintFillRegion\([\s\S]*?"fills\.chartField"[\s\S]*?"fills\.houseField"[\s\S]*?"fills\.centerField"/,
  );
  assert.match(chartCanvas, /const fillSignature = \[\s*renderStyle\.revision,/);
  assert.match(chartCanvas, /overlayRenderMode === "step_fast"[\s\S]*?fill: true/);
  assert.match(drawChart, /createLinearGradient/);
  assert.match(drawChart, /createRadialGradient/);
  assert.match(drawChart, /textureMask === "crescent"[\s\S]*?ctx\.clip\("evenodd"\)/);
  assert.match(
    drawChart,
    /paint\.shadowPattern !== "none"[\s\S]*?ctx\.shadowOffsetX[\s\S]*?fillTexturePattern/,
  );
  assert.match(
    chartCanvas,
    /const solarFillSignature =\s*wheelFillUsesSolarDirection/,
  );
  assert.match(
    chartCanvas,
    /solarFillSignature != null[\s\S]*?paintedSolarFillSignatureRef/,
  );
});

test("zodiac, term, and decan materials paint disjoint physical bands", () => {
  const retainedStart = drawChart.indexOf("function drawRetainedFillLayer(");
  const retainedEnd = drawChart.indexOf("\n/**", retainedStart);
  assert.ok(retainedStart >= 0 && retainedEnd > retainedStart);
  const retainedSource = drawChart.slice(retainedStart, retainedEnd);
  assert.doesNotMatch(retainedSource, /fills\.subdivisionBand/);
  assert.doesNotMatch(retainedSource, /paintZodiacElementSlices\(/);
  assert.match(
    drawChart,
    /!chart\.options\.useZodiacElementFieldColors[\s\S]*?ctx\.fillStyle = color;[\s\S]*?ctx\.fill\(\);/,
  );
  assert.match(
    drawChart,
    /zodiacElementTextureFillClass\(style, profile\)[\s\S]*?"texture-only"/,
  );
  assert.match(
    retainedSource,
    /if \(!zodiacElementFieldFillIsActive\(chart, style, profile\)\)[\s\S]*?"fills\.zodiacBand"[\s\S]*?hasWheelRing\(chart, "zodiac"\) \? ringset\.r30 : 0,\s*ringset\.r0,/,
  );
  assert.match(
    retainedSource,
    /if \(isAngloWheel\(chart\) && \(hasWheelRing\(chart, "cuspLabels"\) \|\| hasWheelRing\(chart, "cuspRuler"\)\)\)[\s\S]*?"fills\.cuspDegreeBand"[\s\S]*?isCuspBandWheel\(chart\) \? ringset\.r30 : hasWheelRing\(chart, "cuspRuler"\)[\s\S]*?hasWheelRing\(chart, "cuspLabels"\) \? ringset\.rInner : ringset\.rCuspLabelOuter \?\? ringset\.rInner,/,
  );
  assert.match(
    drawChart,
    /if \(layer === "geometry"\) \{[\s\S]*?paintZodiacElementSlices\([\s\S]*?ringset\.r30,\s*ringset\.r0,/,
  );
  assert.match(
    retainedSource,
    /"fills\.termBand"[\s\S]*?ringset\.rTerms,\s*ringset\.rTermsInner \?\? ringset\.rDecans,/,
  );
  assert.match(
    retainedSource,
    /"fills\.decanBand"[\s\S]*?ringset\.rDecans,\s*ringset\.rDecansInner \?\? ringset\.rCuspOuter \?\? ringset\.rInner,/,
  );
});
