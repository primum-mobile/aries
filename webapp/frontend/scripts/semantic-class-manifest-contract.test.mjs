// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(
  new URL("../src/lib/style-lab/semantic-class-manifest.ts", import.meta.url),
  "utf8",
);
const javascript = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const manifest = await import(
  `data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`
);

const expectedIds = [
  "canvas.background",
  "canvas.chart",
  "canvas.span.chartRing",
  ...["geometry", "dynamic", "outerLabel"].map((id) => `layers.${id}`),
  "fills.chartField",
  "fills.houseField",
  "fills.centerField",
  "fills.zodiacBand",
  "fills.subdivisionBand",
  ...[
    "outerMaximum", "outerHouse", "outerDegree", "zodiacOuter", "innerDegree",
    "zodiacInner", "term", "angloCuspOuter", "innerBoundary", "aspectBoundary",
    "houseBoundary", "base",
  ].map((id) => `rings.${id}`),
  "zodiac.spoke",
  // The rulers themselves, each named as the parent of its own ticks.
  "zodiac.tick.inner",
  "zodiac.tick.outer",
  ...["10deg", "5deg", "1deg"].map((grade) => `zodiac.tick.inner.${grade}`),
  ...["10deg", "5deg", "1deg"].map((grade) => `zodiac.tick.outer.${grade}`),
  ...["10deg", "5deg", "1deg"].map((grade) => `zodiac.tick.angloCuspRuler.${grade}`),
  "zodiac.tick.angloHouseCusp",
  "zodiac.tick.angloAngleRuler",
  "zodiac.signGlyph",
  ...["term", "decan"].flatMap((family) =>
    ["boundary", "glyph"].map((component) => `subdivisions.${family}.${component}`),
  ),
  ...["cusp", "label", "labelLane"].map((component) => `houses.inner.${component}`),
  ...["degree", "sign", "minute"].map((component) => `houses.inner.position.${component}`),
  ...["cusp", "label"].map((component) => `houses.outer.${component}`),
  ...["ray", "arrowhead", "label"].map((component) => `angles.inner.${component}`),
  ...["degree", "sign", "minute"].map((component) => `angles.inner.position.${component}`),
  ...["ray", "arrowhead", "label"].map((component) => `angles.outer.${component}`),
  ...["leader", "glyph", "motion", "lane", "positionLane"].map((component) => `bodies.inner.${component}`),
  ...["degree", "sign", "minute"].map((component) => `bodies.inner.position.${component}`),
  ...["leader", "glyph", "motion", "lane"].map((component) => `bodies.outer.${component}`),
  "aspects.lane",
  ...["line", "glyph"].map((component) => `aspects.primary.${component}`),
  ...["endpointMarker", "line", "glyph"].map((component) => `aspects.interchart.${component}`),
  "secondaryRing.leaderLane",
  "secondaryRing.labelLane",
  ...["leader", "label"].map((component) => `secondaryRing.fixedStar.${component}`),
  ...["leader", "label"].map((component) => `secondaryRing.asteroid.${component}`),
  ...["leader", "glyph", "text"].map((component) => `secondaryRing.midpoint.${component}`),
  ...["leader", "glyph", "text"].map((component) => `secondaryRing.antiscia.${component}`),
  ...["leader", "glyph", "text"].map((component) => `secondaryRing.contraAntiscia.${component}`),
  ...["leader", "glyph", "text"].map((component) => `secondaryRing.dodecatemoria.${component}`),
  ...["leader", "label"].map((component) => `secondaryRing.arabicPart.${component}`),
  ...["leader", "glyph", "motion"].map((component) => `secondaryRing.parallelTransit.${component}`),
  "surveil.tick",
  "surveil.marker.glyph",
  "surveil.marker.label",
  "surveil.sourceLabel",
  "chartOverlay.information.topLeft",
  "chartOverlay.information.bottomLeft",
  "chartOverlay.houseSystem.bottomRight",
  ...["dayHour", "header", "signal"].flatMap((family) =>
    ["label", "glyph", "trailing"].map((component) =>
      `chartOverlay.events.${family}.${component}`,
    ),
  ),
];

test("wheel-v2 exposes the exact complete semantic class tree", () => {
  assert.equal(manifest.WHEEL_SEMANTIC_CLASS_MANIFEST_VERSION, "wheel-v2");
  assert.equal(expectedIds.length, 116);
  assert.deepEqual(
    [...manifest.WHEEL_SEMANTIC_CLASS_IDS].sort(),
    [...expectedIds].sort(),
  );
  assert.equal(
    new Set(manifest.WHEEL_SEMANTIC_CLASS_IDS).size,
    manifest.WHEEL_SEMANTIC_CLASS_IDS.length,
  );
  assert.equal(manifest.isWheelSemanticClassId("zodiac.tick.all"), false);
});

test("every class has capabilities, declarative applicability, and a preview state", () => {
  for (const definition of manifest.WHEEL_SEMANTIC_CLASS_MANIFEST) {
    assert.match(definition.labelKey, /^(?:styleLab|quickopt)\./, definition.id);
    // A class either owns profile-v2 authoring properties or says outright
    // that its one control arrives through the renderer token channel. The
    // compositing layers and the geometry lanes are the second kind; an empty
    // capability list without that flag is an oversight, not a design.
    if (definition.tokenControlled) {
      assert.deepEqual(
        definition.capabilities,
        [],
        `${definition.id} is token-controlled and must claim no capabilities`,
      );
    } else {
      assert.ok(definition.capabilities.length > 0, `${definition.id} capabilities`);
    }
    if (definition.id.startsWith("layers.")) {
      assert.equal(definition.tokenControlled, true, definition.id);
    }
    assert.ok(definition.applicability.variants.length > 0, `${definition.id} variants`);
    assert.ok(definition.applicability.layouts.length > 0, `${definition.id} layouts`);
    assert.ok(definition.applicability.previewStateId, `${definition.id} preview`);
    if (definition.inheritsFrom) {
      assert.ok(manifest.getWheelSemanticClass(definition.inheritsFrom), definition.id);
    }
  }
});

test("layer effects stay on retained scalar controls, not duplicate profile-v2 class properties", () => {
  const compositorCapabilities = new Set([
    "blur", "hueRotate",
    "brightness", "contrast", "saturation", "grayscale", "invert", "sepia",
  ]);
  const shadowCapabilities = new Set([
    "shadowColor", "shadowX", "shadowY", "shadowBlur",
  ]);
  for (const definition of manifest.WHEEL_SEMANTIC_CLASS_MANIFEST) {
    const hasCompositor = definition.capabilities.some(
      (item) => compositorCapabilities.has(item),
    );
    assert.equal(hasCompositor, false, definition.id);
    const hasShadow = definition.capabilities.some((item) => shadowCapabilities.has(item));
    assert.equal(
      hasShadow,
      definition.id.startsWith("fills.") && definition.id !== "canvas.background",
      definition.id,
    );
  }
});

test("canvas background is the retained chart material rather than a color-only surface", () => {
  const canvas = manifest.getWheelSemanticClass("canvas.background");
  assert.deepEqual(canvas.capabilities, [
    "backgroundColor",
    "patternColor",
    "gradientType",
    "gradientDirection",
    "gradientStartColor",
    "gradientEndColor",
    "gradientAngle",
    "fillPattern",
    "cellSize",
    "dotSize",
    "density",
    "angle",
    "seed",
    "opacity",
  ]);
  const chartField = manifest.getWheelSemanticClass("fills.chartField");
  assert.ok(chartField.capabilities.includes("textureMask"));
  assert.ok(chartField.capabilities.includes("shadowPattern"));
  assert.ok(!canvas.capabilities.includes("textureMask"));
  const houseField = manifest.getWheelSemanticClass("fills.houseField");
  assert.ok(houseField.capabilities.includes("shadowBlur"));
  const center = manifest.getWheelSemanticClass("fills.centerField");
  assert.deepEqual(center.capabilities.slice(-10), [
    "textureMask",
    "maskDirection",
    "maskAngle",
    "maskAmount",
    "shadowPattern",
    "shadowColor",
    "shadowX",
    "shadowY",
    "shadowBlur",
    "opacity",
  ]);
});

test("documented variant and preview applicability is explicit", () => {
  const context = (variant, layout, features = []) => ({ variant, layout, features });
  const applicable = (id, value) =>
    manifest.resolveWheelSemanticApplicability(
      manifest.getWheelSemanticClass(id),
      value,
    ).state;

  assert.equal(applicable("angles.inner.label", context("classic", "single", ["angleLabels"])), "not-applicable");
  assert.equal(applicable("angles.inner.label", context("anglo", "single", ["angleLabels"])), "applicable");
  assert.equal(applicable("angles.outer.label", context("anglo", "single", ["angleLabels"])), "not-applicable");
  assert.equal(applicable("angles.outer.label", context("anglo", "comparison", ["angleLabels"])), "applicable");
  assert.equal(applicable("houses.outer.cusp", context("classic", "comparison", ["houses"])), "not-applicable");
  assert.equal(applicable("houses.outer.cusp", context("classic", "comparison", ["houses", "comparison.outerHouses"])), "applicable");
  assert.equal(applicable("rings.aspectBoundary", context("compact", "single", ["aspects"])), "not-applicable");
  assert.equal(applicable("rings.aspectBoundary", context("classic", "single", ["aspects"])), "applicable");
});

test("variant-specific arrowheads stay honest, and special points are body glyphs", () => {
  const innerArrow = manifest.getWheelSemanticClass("angles.inner.arrowhead");
  assert.ok(manifest.resolveWheelSemanticCapabilities(innerArrow, "classic").includes("strokeWidth"));
  assert.equal(manifest.resolveWheelSemanticCapabilities(innerArrow, "anglo").includes("strokeWidth"), false);
  assert.ok(manifest.resolveWheelSemanticCapabilities(innerArrow, "anglo").includes("color"));

  // Fortune, the Vertex and the prenatal syzygy are not classes of their own.
  // They are body glyphs, so they carry the body glyph's whole control set and
  // keep their individual colours through the occurrence palette roles.
  for (const id of ["bodies.fortune", "bodies.vertex", "bodies.prenatalSyzygy"]) {
    assert.equal(manifest.getWheelSemanticClass(id), undefined, id);
  }
  const bodyGlyph = manifest.getWheelSemanticClass("bodies.inner.glyph");
  for (const capability of ["fontRef", "fontSize", "tracking", "color", "opacity"]) {
    assert.ok(bodyGlyph.capabilities.includes(capability), capability);
  }
});

test("all twelve wheel rings own one radius authority", () => {
  const rings = manifest.WHEEL_SEMANTIC_CLASS_MANIFEST.filter(
    (definition) => definition.groupId === "rings",
  );
  assert.equal(rings.length, 12);
  for (const ring of rings) {
    assert.equal(ring.primitive, "circle", ring.id);
    assert.ok(ring.capabilities.includes("radius"), ring.id);
    assert.ok(ring.capabilities.includes("strokeWidth"), ring.id);
  }
});
