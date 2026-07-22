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
  ...["geometry", "dynamic", "outerLabel"].map((id) => `layers.${id}`),
  ...[
    "outerMaximum", "outerHouse", "outerDegree", "zodiacOuter", "innerDegree",
    "zodiacInner", "term", "angloCuspOuter", "innerBoundary", "aspectBoundary",
    "houseBoundary", "base",
  ].map((id) => `rings.${id}`),
  "zodiac.spoke",
  ...["10deg", "5deg", "1deg"].map((grade) => `zodiac.tick.inner.${grade}`),
  ...["10deg", "5deg", "1deg"].map((grade) => `zodiac.tick.outer.${grade}`),
  ...["10deg", "5deg", "1deg"].map((grade) => `zodiac.tick.angloCuspRuler.${grade}`),
  "zodiac.tick.angloHouseCusp",
  "zodiac.tick.angloAngleRuler",
  "zodiac.signGlyph",
  ...["term", "decan"].flatMap((family) =>
    ["boundary", "glyph"].map((component) => `subdivisions.${family}.${component}`),
  ),
  ...["cusp", "label"].map((component) => `houses.inner.${component}`),
  ...["degree", "sign", "minute"].map((component) => `houses.inner.position.${component}`),
  ...["cusp", "label"].map((component) => `houses.outer.${component}`),
  ...["ray", "arrowhead", "label"].map((component) => `angles.inner.${component}`),
  ...["degree", "sign", "minute"].map((component) => `angles.inner.position.${component}`),
  ...["ray", "arrowhead", "label"].map((component) => `angles.outer.${component}`),
  ...["leader", "glyph", "motion"].map((component) => `bodies.inner.${component}`),
  ...["degree", "sign", "minute"].map((component) => `bodies.inner.position.${component}`),
  ...["leader", "glyph", "motion"].map((component) => `bodies.outer.${component}`),
  "bodies.fortune",
  "bodies.vertex",
  "bodies.prenatalSyzygy",
  ...["line", "glyph"].map((component) => `aspects.primary.${component}`),
  ...["endpointMarker", "line", "glyph"].map((component) => `aspects.interchart.${component}`),
  ...["leader", "label"].map((component) => `secondaryRing.fixedStar.${component}`),
  ...["leader", "label"].map((component) => `secondaryRing.asteroid.${component}`),
  ...["leader", "glyph", "text"].map((component) => `secondaryRing.midpoint.${component}`),
  ...["leader", "label"].map((component) => `secondaryRing.hybridHit.${component}`),
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
  assert.equal(expectedIds.length, 105);
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
    assert.ok(definition.capabilities.length > 0, `${definition.id} capabilities`);
    assert.ok(definition.applicability.variants.length > 0, `${definition.id} variants`);
    assert.ok(definition.applicability.layouts.length > 0, `${definition.id} layouts`);
    assert.ok(definition.applicability.previewStateId, `${definition.id} preview`);
    if (definition.inheritsFrom) {
      assert.ok(manifest.getWheelSemanticClass(definition.inheritsFrom), definition.id);
    }
  }
});

test("effects are truthful retained-layer capabilities, not pretend per-class CSS", () => {
  const effectCapabilities = new Set([
    "blur", "shadowColor", "shadowX", "shadowY", "shadowBlur", "hueRotate",
    "brightness", "contrast", "saturation", "grayscale", "invert", "sepia",
  ]);
  for (const definition of manifest.WHEEL_SEMANTIC_CLASS_MANIFEST) {
    const hasEffect = definition.capabilities.some((item) => effectCapabilities.has(item));
    assert.equal(hasEffect, definition.id.startsWith("layers."), definition.id);
  }
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

test("variant-specific arrowheads and inherited point sizing stay honest", () => {
  const innerArrow = manifest.getWheelSemanticClass("angles.inner.arrowhead");
  assert.ok(manifest.resolveWheelSemanticCapabilities(innerArrow, "classic").includes("strokeWidth"));
  assert.equal(manifest.resolveWheelSemanticCapabilities(innerArrow, "anglo").includes("strokeWidth"), false);
  assert.ok(manifest.resolveWheelSemanticCapabilities(innerArrow, "anglo").includes("color"));

  for (const id of ["bodies.fortune", "bodies.vertex", "bodies.prenatalSyzygy"]) {
    const definition = manifest.getWheelSemanticClass(id);
    assert.equal(definition.inheritsFrom, "bodies.inner.glyph");
    assert.deepEqual(definition.capabilities, ["color"], id);
    assert.equal(definition.colorTarget, "palette-role", id);
    assert.equal(definition.capabilities.includes("fontSize"), false, id);
    assert.equal(definition.capabilities.includes("radius"), false, id);
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
