// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import { compositionModuleUrl } from "./wheel-composition-test-loader.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function transpile(url) {
  const source = await readFile(url, "utf8");
  return ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText.replaceAll('"colorjs.io"', JSON.stringify(import.meta.resolve("colorjs.io"))).replaceAll('"./wheel-composition"', `"${compositionModuleUrl}"`).replaceAll('"../chart/wheel-composition"', `"${compositionModuleUrl}"`);
}

function dataUrl(source) {
  return `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
}

const layoutModelUrl = dataUrl(
  await transpile(new URL("../src/lib/chart/wheel-layout-model.ts", import.meta.url)),
);
const wheelJavascript = (
  await transpile(new URL("../src/lib/chart/wheel-render-style.ts", import.meta.url))
).replaceAll('"./wheel-layout-model"', `"${layoutModelUrl}"`);
const wheelUrl = dataUrl(wheelJavascript);
const chartFontsUrl = dataUrl(
  await transpile(new URL("../src/lib/chart/chart-fonts.ts", import.meta.url)),
);
const textInkGapUrl = dataUrl(
  await transpile(new URL("../src/lib/chart/text-ink-gap.ts", import.meta.url)),
);
const chartFonts = await import(chartFontsUrl);
const canvasDrawUrl = dataUrl((
  await transpile(new URL("../src/lib/chart/canvas-draw.ts", import.meta.url))
).replaceAll('"./chart-fonts"', `"${chartFontsUrl}"`).replaceAll('"./text-ink-gap"', `"${textInkGapUrl}"`));
const vintageUrl = dataUrl((
  await transpile(new URL("../src/lib/chart/vintage-magazine-wheel.ts", import.meta.url))
).replaceAll('"./chart-fonts"', `"${chartFontsUrl}"`).replaceAll('"./text-ink-gap"', `"${textInkGapUrl}"`).replaceAll('"./canvas-draw"', `"${canvasDrawUrl}"`));
const genericSceneJavascript = await transpile(
  new URL("../src/lib/style-lab/style-scene.ts", import.meta.url),
);
const genericSceneUrl = dataUrl(genericSceneJavascript);
const semanticManifestJavascript = await transpile(
  new URL("../src/lib/style-lab/semantic-class-manifest.ts", import.meta.url),
);
const semanticManifestUrl = dataUrl(semanticManifestJavascript);
const unitProjectionJavascript = await transpile(
  new URL("../src/lib/style-lab/unit-projection.ts", import.meta.url),
);
const unitProjectionUrl = dataUrl(unitProjectionJavascript);
let authoringSchemaJavascript = await transpile(
  new URL("../src/lib/style-lab/authoring-schema.ts", import.meta.url),
);
authoringSchemaJavascript = authoringSchemaJavascript
  .replaceAll('"./unit-projection"', `"${unitProjectionUrl}"`);
const authoringSchemaUrl = dataUrl(authoringSchemaJavascript);
let authoringAdapterJavascript = await transpile(
  new URL("../src/lib/style-lab/wheel-authoring-adapter.ts", import.meta.url),
);
authoringAdapterJavascript = authoringAdapterJavascript
  .replaceAll('"../chart/wheel-render-style"', `"${wheelUrl}"`)
  .replaceAll('"./authoring-schema"', `"${authoringSchemaUrl}"`)
  .replaceAll('"./unit-projection"', `"${unitProjectionUrl}"`);
const authoringAdapterUrl = dataUrl(authoringAdapterJavascript);
const authoringAdapter = await import(authoringAdapterUrl);
const semanticManifest = await import(semanticManifestUrl);
let wheelSceneJavascript = await transpile(
  new URL("../src/lib/style-lab/wheel-style-scene.ts", import.meta.url),
);
wheelSceneJavascript = wheelSceneJavascript
  .replaceAll('"../chart/wheel-render-style"', `"${wheelUrl}"`)
  .replaceAll('"../chart/wheel-layout-model"', `"${layoutModelUrl}"`)
  .replaceAll('"./style-scene"', `"${genericSceneUrl}"`)
  .replaceAll('"./authoring-schema"', `"${authoringSchemaUrl}"`)
  .replaceAll('"./semantic-class-manifest"', `"${semanticManifestUrl}"`)
  .replaceAll('"./wheel-authoring-adapter"', `"${authoringAdapterUrl}"`)
  .replaceAll('"./unit-projection"', `"${unitProjectionUrl}"`)
  .replaceAll('"../chart/vintage-magazine-wheel"', `"${vintageUrl}"`);

const wheel = await import(wheelUrl);
const sceneApi = await import(dataUrl(wheelSceneJavascript));

function geometry(profile = "classic", mode = "single", overrides = {}) {
  return {
    profile,
    mode,
    maxRadius: 400,
    hasOuterRing: mode === "comparison",
    showTerms: true,
    showDecans: true,
    showHouses: true,
    showPositions: true,
    comparisonWithOuterHouses: mode === "comparison",
    ...overrides,
  };
}

test("Apogee glyph editing resolves the same Moon color role as production paint", () => {
  const scene = sceneApi.buildWheelStyleScene({
    style: wheel.DEFAULT_WHEEL_RENDER_STYLE,
    geometry: geometry(),
    useIndividualBodyColors: true,
    hitRegions: [
      { kind: "planet", planetId: "apogee", seId: 12, x: 150, y: 100, r: 8, longitude: 10, latitude: 0, speed: 0.11, priority: 40 },
    ],
  });
  const glyph = scene.elements.find((element) => element.id === "wheel.body.primary.apogee");
  assert.ok(glyph);
  assert.ok(glyph.tokenBindings.some((binding) =>
    binding.semanticId === "chart.color.body.moon" && binding.cssVar === "--morinus-body-moon"));
  assert.ok(!glyph.tokenBindings.some((binding) => binding.semanticId === "chart.color.body.apogee"));
});

test("bounded geometry tokens preserve the production default ring matrix", () => {
  // +24 for the two independently authored cusp-band wheel profiles.
  assert.equal(Object.keys(wheel.WHEEL_RENDER_TOKEN_SPECS).length, 348);
  const tokenized = wheel.createTokenizedWheelRenderStyle();
  assert.deepEqual(tokenized.geometry, wheel.DEFAULT_WHEEL_RENDER_STYLE.geometry);
  for (const profile of ["classic", "compact", "anglo", "houses", "cusps"]) {
    for (const mode of ["single", "comparison"]) {
      assert.deepEqual(
        wheel.resolveWheelRingSet(tokenized, geometry(profile, mode)),
        wheel.resolveWheelRingSet(wheel.DEFAULT_WHEEL_RENDER_STYLE, geometry(profile, mode)),
      );
    }
  }
  for (const key of [
    "classicOuterZodiac",
    "compactPositionInset",
    "angloPlanetScale",
    "biwheelOuterMax",
  ]) {
    assert.ok(wheel.WHEEL_RENDER_TOKEN_RANGES.has(key));
  }
});

test("degree tick scene occurrences match cumulative classic and exclusive Anglo paint", () => {
  const count = (scene, classId) => {
    const occurrence = scene.elements.find(
      (element) =>
        element.classId === classId
        && element.hitGeometry?.kind === "compound",
    );
    assert.ok(occurrence, classId);
    return occurrence.hitGeometry.geometries.length;
  };
  const classic = sceneApi.buildWheelStyleScene({
    style: wheel.DEFAULT_WHEEL_RENDER_STYLE,
    geometry: geometry("classic", "comparison"),
  });
  assert.equal(count(classic, "zodiac.tick.inner.10deg"), 36);
  assert.equal(count(classic, "zodiac.tick.inner.5deg"), 72);
  assert.equal(count(classic, "zodiac.tick.inner.1deg"), 360);
  assert.equal(count(classic, "zodiac.tick.outer.10deg"), 36);
  assert.equal(count(classic, "zodiac.tick.outer.5deg"), 72);
  assert.equal(count(classic, "zodiac.tick.outer.1deg"), 360);

  const anglo = sceneApi.buildWheelStyleScene({
    style: wheel.DEFAULT_WHEEL_RENDER_STYLE,
    geometry: geometry("anglo", "comparison"),
  });
  assert.equal(count(anglo, "zodiac.tick.outer.10deg"), 36);
  assert.equal(count(anglo, "zodiac.tick.outer.5deg"), 36);
  assert.equal(count(anglo, "zodiac.tick.outer.1deg"), 288);
});

test("canonical geometry edits move resolved rings and invalid groups reset atomically", () => {
  const custom = wheel.createTokenizedWheelRenderStyle({
    tokens: {
      ...wheel.DEFAULT_WHEEL_RENDER_TOKENS,
      classicOuterZodiac: 0.85,
      classicInnerPosition: 0.5,
      compactSinglePositionLane2: 0.26,
      angloPlanetScale: 0.72,
      biwheelOuterMax: 0.98,
    },
  });
  assert.ok(Math.abs(wheel.resolveWheelRingSet(custom, geometry()).r30 - 392) < 1e-9);
  assert.ok(Math.abs(wheel.resolveWheelRingSet(custom, geometry("compact", "single")).rAspAscMC - 128) < 1e-9);
  assert.equal(
    wheel.resolveWheelRingSet(custom, geometry("anglo", "single")).rPlanet,
    400 * 0.895 * 0.72 - 400 * 0.895 * 0.047,
  );
  assert.equal(
    wheel.resolveWheelRingSet(custom, geometry("classic", "comparison")).rOuterMax,
    392,
  );

  const invalid = wheel.resolveWheelRenderTokens((cssVar) => ({
    "--aries-wheel-classic-outer-zodiac": "0.9",
    "--aries-wheel-classic-outer-line": "0.8",
  })[cssVar]);
  assert.equal(
    invalid.classicOuterZodiac,
    wheel.DEFAULT_WHEEL_RENDER_TOKENS.classicOuterZodiac,
  );
  assert.equal(
    invalid.classicOuterLine,
    wheel.DEFAULT_WHEEL_RENDER_TOKENS.classicOuterLine,
  );
});

test("scene radii come from resolveWheelRingSet and expose exact painted-ring handles", () => {
  for (const profile of ["classic", "compact", "anglo"]) {
    for (const mode of ["single", "comparison"]) {
      const input = geometry(profile, mode);
      const scene = sceneApi.buildWheelStyleScene({
        style: wheel.DEFAULT_WHEEL_RENDER_STYLE,
        geometry: input,
      });
      assert.deepEqual(
        scene.rings,
        wheel.resolveWheelRingSet(wheel.DEFAULT_WHEEL_RENDER_STYLE, input),
      );
      assert.ok(scene.elements.some((item) => item.id === "wheel.ring.zodiac.outer"));
      assert.ok(scene.elements.some((item) => item.id === "wheel.zodiac.spokes"));
      assert.ok(scene.elements.some((item) => item.id === "wheel.house.cusps"));
      assert.ok(scene.elements.some((item) => item.id === "wheel.aspect.lines"));
    }
  }

  const classic = sceneApi.buildWheelStyleScene({
    style: wheel.DEFAULT_WHEEL_RENDER_STYLE,
    geometry: geometry(),
  });
  const zodiacHandle = classic.handles.find(
    (handle) => handle.id === "wheel.ring.zodiac.outer.handle.radius",
  );
  assert.equal(
    zodiacHandle.binding.semanticId,
    "authoring.wheel.classic.rings.zodiacOuter.radius",
  );
  const sharedBase = sceneApi.buildWheelStyleScene({
    style: wheel.DEFAULT_WHEEL_RENDER_STYLE,
    geometry: geometry(),
    authoringScope: "base",
  });
  assert.equal(
    sharedBase.handles.find(
      (handle) => handle.id === "wheel.ring.zodiac.outer.handle.radius",
    ).binding.semanticId,
    "authoring.wheel.base.rings.zodiacOuter.radius",
  );
  const zodiacRing = classic.elements.find(
    (element) => element.id === "wheel.ring.zodiac.outer",
  );
  assert.equal(zodiacHandle.binding.cssVar, "");
  assert.equal(zodiacHandle.binding.value, zodiacRing.authoringDefaults.radiusPx);
  assert.equal(
    zodiacRing.tokenBindings[0].semanticId,
    "renderer.wheel.metric.zodiacOuterRingWidthScale",
  );
  assert.deepEqual(
    zodiacRing.tokenBindings.slice(0, 5).map((binding) => binding.property),
    ["stroke-width", "stroke-dash", "stroke-dash", "stroke-dash", "opacity"],
  );
  assert.equal(
    classic.elements.find((element) => element.id === "wheel.ring.body").hitGeometry,
    null,
  );
  assert.equal(
    classic.elements.some((element) => element.id === "wheel.ring.degree.inner.1"),
    false,
  );
  assert.ok(
    classic.elements.find((element) => element.id === "wheel.ring.base")
      .tokenBindings.some(
        (binding) => binding.semanticId === "renderer.wheel.color.baseRing",
      ),
  );
  assert.ok(
    classic.elements.find((element) => element.id === "wheel.ring.house")
      .tokenBindings.some(
        (binding) => binding.semanticId === "renderer.wheel.color.houseBoundaryRing",
      ),
  );
  const spokeRadius = (classic.rings.rInner + classic.rings.r30) / 2;
  assert.equal(
    sceneApi.hitTestWheelStyleScene(classic, 400 - spokeRadius, 400)?.element.id,
    "wheel.zodiac.spokes",
  );
  assert.ok(
    classic.elements.find((element) => element.id === "wheel.zodiac.spokes")
      .tokenBindings.some((binding) => binding.semanticId === "renderer.wheel.color.zodiacSpoke"),
  );
  const patch = sceneApi.resolveWheelStyleHandleDrag(
    zodiacHandle,
    { start: zodiacHandle.position, current: [zodiacHandle.position[0] + 10, zodiacHandle.position[1]] },
  );
  assert.deepEqual(patch, {
    semanticId: "authoring.wheel.classic.rings.zodiacOuter.radius",
    cssVar: "",
    value: zodiacRing.authoringDefaults.radiusPx + 10,
  });

  const angloComparison = sceneApi.buildWheelStyleScene({
    style: wheel.DEFAULT_WHEEL_RENDER_STYLE,
    geometry: geometry("anglo", "comparison"),
  });
  const outerMaximum = angloComparison.handles.find(
    (handle) => handle.id === "wheel.ring.comparison.maximum.handle.radius",
  );
  assert.equal(outerMaximum.editability.state, "editable");
  assert.equal(
    outerMaximum.binding.semanticId,
    "authoring.wheel.anglo.rings.outerMaximum.radius",
  );
  assert.ok(
    angloComparison.elements.find((element) => element.id === "wheel.ring.base")
      .tokenBindings.some(
        (binding) => binding.semanticId === "renderer.wheel.color.angloBaseRing",
      ),
  );
});

test("the scene carries all semantic classes without pretending hidden paint is active", () => {
  const scene = sceneApi.buildWheelStyleScene({
    style: wheel.DEFAULT_WHEEL_RENDER_STYLE,
    geometry: geometry("classic", "single", {
      showTerms: false,
      showDecans: false,
      showHouses: false,
      showPositions: false,
    }),
  });
  const semanticClassIds = new Set(
    scene.elements
      .map((element) => element.classId)
      .filter((classId) => semanticManifest.isWheelSemanticClassId(classId)),
  );
  assert.equal(semanticClassIds.size, semanticManifest.WHEEL_SEMANTIC_CLASS_IDS.length);
  assert.deepEqual(
    [...semanticClassIds].sort(),
    [...semanticManifest.WHEEL_SEMANTIC_CLASS_IDS].sort(),
  );

  const hiddenTermGlyph = scene.elements.find(
    (element) => element.id === "wheel.manifest.subdivisions.term.glyph",
  );
  assert.ok(hiddenTermGlyph.stateTags.includes("manifest-placeholder"));
  assert.ok(hiddenTermGlyph.stateTags.includes("manifest-editable"));
  assert.ok(hiddenTermGlyph.stateTags.includes("manifest-missing:terms"));
  assert.ok(hiddenTermGlyph.authoringDefaults.fontSizePx > 0);
  assert.equal(hiddenTermGlyph.hitGeometry, null);

  const centerFill = scene.elements.find(
    (element) => element.id === "wheel.fill.center-field",
  );
  assert.equal(centerFill.hitGeometry.kind, "disc");
  assert.equal(centerFill.authoringDefaults.fillPattern, "none");
  assert.ok(centerFill.authoringDefaults.cellSizePx > 0);
  assert.ok(centerFill.authoringDefaults.dotSizePx > 0);
  assert.equal(centerFill.authoringDefaults.gradientType, "none");
  assert.equal(centerFill.authoringDefaults.gradientDirection, "fixed");
  assert.equal(centerFill.authoringDefaults.textureMask, "none");
  assert.equal(centerFill.authoringDefaults.maskDirection, "fixed");
  assert.equal(centerFill.authoringDefaults.maskAmountPercent, 28);

  const chartFill = scene.elements.find(
    (element) => element.id === "wheel.fill.chart-field",
  );
  assert.equal(chartFill.classId, "fills.chartField");
  assert.equal(chartFill.hitGeometry.kind, "disc");
  assert.equal(chartFill.hitGeometry.radius, scene.rings.r30);
  assert.equal(chartFill.authoringDefaults.fillPattern, "none");
  assert.equal(chartFill.authoringDefaults.gradientType, "none");
  assert.equal(chartFill.authoringDefaults.textureMask, "none");
  assert.equal(chartFill.authoringDefaults.shadowPattern, "none");

  const hiddenHouseFill = scene.elements.find(
    (element) => element.id === "wheel.manifest.fills.houseField",
  );
  assert.ok(hiddenHouseFill.stateTags.includes("manifest-missing:houses"));

  const zonedScene = sceneApi.buildWheelStyleScene({
    style: wheel.DEFAULT_WHEEL_RENDER_STYLE,
    geometry: geometry("classic", "single"),
  });
  const houseFill = zonedScene.elements.find(
    (element) => element.id === "wheel.fill.house-field",
  );
  assert.equal(houseFill.classId, "fills.houseField");
  assert.equal(houseFill.hitGeometry.kind, "annulus");
  assert.equal(houseFill.hitGeometry.innerRadius, zonedScene.rings.rAsp);
  assert.equal(houseFill.hitGeometry.outerRadius, zonedScene.rings.rHouse);
  assert.equal(houseFill.authoringDefaults.textureMask, "none");
  const glyphFill = zonedScene.elements.find(
    (element) => element.id === "wheel.fill.glyph-field",
  );
  assert.equal(glyphFill.classId, "fills.glyphField");
  assert.equal(glyphFill.hitGeometry.kind, "annulus");
  assert.equal(glyphFill.hitGeometry.innerRadius, zonedScene.rings.rHouse);
  assert.equal(glyphFill.hitGeometry.outerRadius, zonedScene.rings.rInner);
  const zodiacFill = zonedScene.elements.find(
    (element) => element.id === "wheel.fill.zodiac-band",
  );
  assert.equal(zodiacFill.hitGeometry.kind, "annulus");
  assert.equal(zodiacFill.hitGeometry.innerRadius, zonedScene.rings.r0);
  assert.equal(zodiacFill.hitGeometry.outerRadius, zonedScene.rings.r30);
  const elementSlices = zonedScene.elements.find(
    (element) => element.id === "wheel.fill.zodiac-element-slices",
  );
  assert.equal(elementSlices.classId, "fills.zodiacElementSlices");
  assert.equal(elementSlices.hitGeometry.innerRadius, zonedScene.rings.r0);
  assert.equal(elementSlices.hitGeometry.outerRadius, zonedScene.rings.r30);
  assert.equal(elementSlices.authoringDefaults.fillPattern, "none");
  assert.equal(elementSlices.authoringDefaults.backgroundColor, undefined);
  assert.equal(
    elementSlices.authoringDefaults.patternColor,
    wheel.DEFAULT_WHEEL_RENDER_STYLE.palette.frame,
  );
  assert.ok(zodiacFill.priority > elementSlices.priority);
  const elementFieldScene = sceneApi.buildWheelStyleScene({
    style: wheel.DEFAULT_WHEEL_RENDER_STYLE,
    geometry: geometry("classic", "single"),
    useZodiacElementFieldColors: true,
  });
  const activeZodiacFill = elementFieldScene.elements.find(
    (element) => element.id === "wheel.fill.zodiac-band",
  );
  const activeElementFields = elementFieldScene.elements.find(
    (element) => element.id === "wheel.fill.zodiac-element-slices",
  );
  assert.ok(activeElementFields.priority > activeZodiacFill.priority);
  const termFill = zonedScene.elements.find(
    (element) => element.id === "wheel.fill.term-band",
  );
  assert.equal(termFill.classId, "fills.termBand");
  assert.equal(termFill.hitGeometry.innerRadius, zonedScene.rings.rDecans);
  assert.equal(termFill.hitGeometry.outerRadius, zonedScene.rings.r0);
  const decanFill = zonedScene.elements.find(
    (element) => element.id === "wheel.fill.decan-band",
  );
  assert.equal(decanFill.classId, "fills.decanBand");
  assert.equal(decanFill.hitGeometry.innerRadius, zonedScene.rings.rInner);
  assert.equal(decanFill.hitGeometry.outerRadius, zonedScene.rings.rDecans);

  const angloBands = sceneApi.buildWheelStyleScene({
    style: wheel.DEFAULT_WHEEL_RENDER_STYLE,
    geometry: geometry("anglo", "single"),
  });
  const angloDecanFill = angloBands.elements.find(
    (element) => element.id === "wheel.fill.decan-band",
  );
  assert.equal(angloDecanFill.hitGeometry.innerRadius, angloBands.rings.rCuspOuter);
  assert.notEqual(angloDecanFill.hitGeometry.innerRadius, angloBands.rings.rInner);

  for (const profile of ["houses", "cusps"]) {
    const cuspBandScene = sceneApi.buildWheelStyleScene({
      style: wheel.DEFAULT_WHEEL_RENDER_STYLE,
      geometry: geometry(profile, "single"),
    });
    const cuspDegreeFill = cuspBandScene.elements.find(
      (element) => element.id === "wheel.fill.cusp-degree-band",
    );
    assert.equal(cuspDegreeFill.classId, "fills.cuspDegreeBand");
    assert.equal(cuspDegreeFill.hitGeometry.kind, "annulus");
    assert.equal(cuspDegreeFill.hitGeometry.innerRadius, cuspBandScene.rings.rInner);
    assert.equal(cuspDegreeFill.hitGeometry.outerRadius, cuspBandScene.rings.r30);
    const hitRadius = (
      cuspDegreeFill.hitGeometry.innerRadius
      + cuspDegreeFill.hitGeometry.outerRadius
    ) / 2;
    assert.equal(
      sceneApi.hitTestWheelStyleScene(
        cuspBandScene,
        cuspBandScene.center[0] + hitRadius,
        cuspBandScene.center[1],
      )?.element.id,
      "wheel.fill.cusp-degree-band",
    );
  }
  assert.equal(
    sceneApi.hitTestWheelStyleScene(
      scene,
      scene.center[0],
      scene.center[1],
    )?.element.id,
    "wheel.fill.center-field",
  );

  const canvas = scene.elements.find(
    (element) => element.id === "wheel.canvas",
  );
  assert.equal(canvas.classId, "canvas.background");
  assert.equal(canvas.authoringDefaults.fillPattern, "none");
  assert.equal(canvas.authoringDefaults.gradientType, "none");
  assert.equal(canvas.authoringDefaults.gradientDirection, "fixed");
  assert.equal(canvas.authoringDefaults.textureMask, undefined);
  assert.equal(canvas.authoringDefaults.backgroundColor, wheel.DEFAULT_WHEEL_RENDER_STYLE.palette.background);
  assert.equal(canvas.authoringDefaults.densityPercent, 50);
  assert.equal(canvas.authoringDefaults.angleDegrees, 45);
  assert.equal(canvas.authoringDefaults.seed, 0);
  assert.deepEqual(canvas.tokenBindings, []);

  const wrongVariantAngleLabel = scene.elements.find(
    (element) => element.id === "wheel.manifest.angles.inner.label",
  );
  assert.ok(wrongVariantAngleLabel.stateTags.includes("manifest-not-applicable"));
  assert.equal(wrongVariantAngleLabel.editability.reason, "inactive-state");

  const unavailableOverlay = scene.elements.find(
    (element) => element.id === "wheel.manifest.chartOverlay.information.topLeft",
  );
  assert.ok(unavailableOverlay.stateTags.includes("manifest-editable"));
  assert.ok(
    unavailableOverlay.stateTags.includes(
      "manifest-missing:overlay.information.topLeft",
    ),
  );
  assert.ok(unavailableOverlay.authoringDefaults.fontSizePx > 0);

  const anglo = sceneApi.buildWheelStyleScene({
    style: wheel.DEFAULT_WHEEL_RENDER_STYLE,
    geometry: geometry("anglo", "single"),
  });
  const filledArrowhead = anglo.elements.find(
    (element) => element.id === "wheel.manifest.angles.inner.arrowhead",
  );
  assert.equal(filledArrowhead.authoringDefaults.strokeWidthPx, undefined);
  assert.equal(filledArrowhead.authoringDefaults.strokeStyle, undefined);
  assert.ok(filledArrowhead.authoringDefaults.opacityPercent > 0);

  const comparison = sceneApi.buildWheelStyleScene({
    style: wheel.DEFAULT_WHEEL_RENDER_STYLE,
    geometry: geometry("classic", "comparison"),
  });
  const endpointMarker = comparison.elements.find(
    (element) => element.id === "wheel.manifest.aspects.interchart.endpointMarker",
  );
  assert.equal(endpointMarker.primitive, "line");
  assert.ok(endpointMarker.authoringDefaults.strokeWidthPx > 0);
  assert.ok(endpointMarker.authoringDefaults.opacityPercent > 0);
});

test("the Anglo scene reports the production hairline defaults for unset classes", () => {
  const scene = sceneApi.buildWheelStyleScene({
    style: wheel.DEFAULT_WHEEL_RENDER_STYLE,
    geometry: geometry("anglo", "single"),
  });
  for (const classId of [
    "rings.zodiacOuter",
    "rings.innerBoundary",
    "rings.base",
    "zodiac.spoke",
    "zodiac.tick.angloCuspRuler.10deg",
    "zodiac.tick.angloCuspRuler.5deg",
    "zodiac.tick.angloCuspRuler.1deg",
  ]) {
    const sceneElement = scene.elements.find(
      (element) => element.classId === classId,
    );
    assert.ok(sceneElement, classId);
    assert.equal(
      sceneElement.authoringDefaults.strokeWidthPx,
      wheel.DEFAULT_WHEEL_RENDER_STYLE.strokes.hairline,
      classId,
    );
  }
});

test("the scene exposes all twelve painted circle roles with isolated standard controls", () => {
  const seen = new Set();
  for (const profile of ["classic", "compact", "anglo"]) {
    const scene = sceneApi.buildWheelStyleScene({
      style: wheel.DEFAULT_WHEEL_RENDER_STYLE,
      geometry: geometry(profile, "comparison"),
    });
    for (const element of scene.elements) {
      if (element.primitive !== "circle" || !element.hitGeometry) continue;
      const width = element.tokenBindings.find((binding) =>
        binding.semanticId.endsWith("RingWidthScale")
      );
      if (!width) continue;
      const role = width.semanticId
        .replace("renderer.wheel.metric.", "")
        .replace("WidthScale", "");
      seen.add(role);
      assert.deepEqual(
        element.tokenBindings.slice(0, 5).map((binding) => binding.property),
        ["stroke-width", "stroke-dash", "stroke-dash", "stroke-dash", "opacity"],
        element.id,
      );
      assert.ok(
        element.tokenBindings.some((binding) => binding.property === "color"),
        `${element.id} color`,
      );
      const radius = element.tokenBindings.find((binding) => binding.property === "radius");
      assert.ok(radius?.semanticId.includes(profile), `${element.id} radius`);
      assert.ok(
        element.handles.some(
          (handle) => handle.kind === "radial" && handle.editability.state === "editable",
        ),
        `${element.id} radial handle`,
      );
    }
  }
  assert.deepEqual([...seen].sort(), [...wheel.WHEEL_PAINTED_RING_ROLES].sort());
});

test("direct handles write reference-space profile-v2 values and stay live after overrides", () => {
  const style = wheel.createTokenizedWheelRenderStyle({
    authoringOverrides: authoringAdapter.compileFlatWheelAuthoringOverrides({
      "authoring.wheel.classic.rings.zodiacOuter.radius": 340,
      "authoring.wheel.classic.rings.zodiacOuter.strokeWidth": 3,
      "authoring.wheel.classic.bodies.inner.glyph.fontSize": 28,
    }),
  });
  const scene = sceneApi.buildWheelStyleScene({
    style,
    geometry: geometry("classic", "single", { maxRadius: 200 }),
    center: [200, 200],
    viewport: { width: 400, height: 400 },
    hitRegions: [
      { kind: "planet", planetId: "sun", seId: 0, x: 150, y: 100, r: 8, longitude: 10, latitude: 0, speed: 1, priority: 40 },
    ],
  });
  const radius = scene.handles.find(
    (handle) => handle.id === "wheel.ring.zodiac.outer.handle.radius",
  );
  const stroke = scene.handles.find(
    (handle) => handle.id === "wheel.ring.zodiac.outer.handle.stroke",
  );
  const fontSize = scene.handles.find(
    (handle) => handle.id === "wheel.body.primary.sun.handle.scale",
  );
  assert.deepEqual(
    [radius.binding.semanticId, radius.binding.value, radius.binding.valuePerPixel],
    ["authoring.wheel.classic.rings.zodiacOuter.radius", 340, 2],
  );
  assert.deepEqual(
    [stroke.binding.semanticId, stroke.binding.value, stroke.binding.valuePerPixel],
    ["authoring.wheel.classic.rings.zodiacOuter.strokeWidth", 3, 0.1],
  );
  assert.deepEqual(
    [fontSize.binding.semanticId, fontSize.binding.value, fontSize.binding.valuePerPixel],
    ["authoring.wheel.classic.bodies.inner.glyph.fontSize", 28, 2],
  );
  for (const [handle, expected] of [
    [radius, 350],
    [stroke, 3.5],
    [fontSize, 38],
  ]) {
    assert.deepEqual(
      sceneApi.resolveWheelStyleHandleDrag(handle, {
        start: handle.position,
        current: [handle.position[0] + 5, handle.position[1]],
      }),
      { semanticId: handle.binding.semanticId, cssVar: "", value: expected },
    );
  }
});

test("production hit regions become stable, exact semantic scene instances", () => {
  const hitRegions = [
    { kind: "planet", planetId: "sun", seId: 0, x: 300, y: 200, r: 12, longitude: 10, latitude: 0, speed: 1, leaderSegments: [{ start: [290, 250], end: [295, 215] }, { start: [295, 215], end: [300, 212] }], priority: 40 },
    { kind: "fortune", x: 500, y: 200, r: 12, longitude: 40, priority: 35 },
    { kind: "vertex", x: 530, y: 200, r: 12, longitude: 50, priority: 36 },
    { kind: "syzygy", x: 560, y: 200, r: 12, longitude: 60, priority: 37 },
    { kind: "house", houseIndex: 1, x: 240, y: 240, r: 10, longitude: 0, priority: 22 },
    { kind: "angle", angleId: "asc", x: 120, y: 400, r: 10, longitude: 0, left: 108, top: 390, width: 30, height: 20, priority: 30 },
    { kind: "sign", signIndex: 0, x: 100, y: 200, r: 360, longitude: 15, cx: 400, cy: 400, innerRadius: 300, outerRadius: 360, startLon: 0, endLon: 30, asc: 0, priority: 10 },
    { kind: "subdivision", family: "term", component: "boundary", itemId: "aries-0", x: 600, y: 130, r: 5, x1: 600, y1: 100, x2: 600, y2: 160, tolerance: 5, priority: 14 },
    { kind: "subdivision", family: "term", component: "glyph", itemId: "aries-0", glyph: "A", x: 620, y: 200, r: 10, left: 610, top: 190, width: 20, height: 20, priority: 15 },
    { kind: "subdivision", family: "decan", component: "boundary", itemId: "aries-0", x: 650, y: 130, r: 5, x1: 650, y1: 100, x2: 650, y2: 160, tolerance: 5, priority: 14 },
    { kind: "subdivision", family: "decan", component: "glyph", itemId: "aries-0", glyph: "B", x: 670, y: 200, r: 10, left: 660, top: 190, width: 20, height: 20, priority: 15 },
    { kind: "aspect", p1: "sun", p2: "moon", aspectType: 6, x: 250, y: 250, r: 0, shape: "line", x1: 200, y1: 200, x2: 300, y2: 300, tolerance: 5, priority: 18 },
    { kind: "aspect", p1: "sun", p2: "venus", aspectType: 3, x: 350, y: 350, r: 10, shape: "glyph", priority: 32 },
    { kind: "secondary_ring", family: "fixed_stars", itemId: "regulus", label: "Regulus", x: 700, y: 300, r: 10, longitude: 150, shape: "rect", left: 680, top: 290, width: 50, height: 20, leader: { start: [500, 400], end: [650, 400] }, priority: 46 },
  ];
  const scene = sceneApi.buildWheelStyleScene({
    style: wheel.DEFAULT_WHEEL_RENDER_STYLE,
    geometry: geometry(),
    center: [400, 400],
    viewport: { width: 800, height: 800 },
    hitRegions,
  });
  for (const id of [
    "wheel.body.primary.sun",
    "wheel.body.primary.sun.leader",
    "wheel.body.primary.fortune",
    "wheel.body.primary.vertex",
    "wheel.body.primary.syzygy",
    "wheel.house.cusp.1",
    "wheel.house.label.1",
    "wheel.angle.primary.asc",
    "wheel.angle.primary.asc.label",
    "wheel.zodiac.sign.0",
    "wheel.term.boundary.aries-0",
    "wheel.term.glyph.aries-0",
    "wheel.decan.boundary.aries-0",
    "wheel.decan.glyph.aries-0",
    "wheel.aspect.primary.sun.moon.6.line",
    "wheel.aspect.primary.sun.venus.3.glyph",
    "wheel.secondary.fixed_stars.regulus.primary",
    "wheel.secondary.fixed_stars.regulus.primary.leader",
  ]) {
    assert.ok(scene.elements.some((item) => item.id === id), id);
  }
  const houseCusp = scene.elements.find((item) => item.id === "wheel.house.cusp.1");
  assert.equal(
    houseCusp.tokenBindings[0].semanticId,
    "renderer.wheel.metric.houseCuspWidthScale",
  );
  assert.ok(houseCusp.tokenBindings.some((binding) => binding.property === "opacity"));
  assert.ok(houseCusp.tokenBindings.some(
    (binding) => binding.semanticId === "renderer.wheel.color.houseCusp",
  ));
  assert.equal(
    houseCusp.handles[0].binding.semanticId,
    "authoring.wheel.classic.houses.inner.cusp.strokeWidth",
  );
  const angle = scene.elements.find((item) => item.id === "wheel.angle.primary.asc");
  assert.equal(
    angle.tokenBindings[0].semanticId,
    "renderer.wheel.metric.angleWidthScale",
  );
  const aspect = scene.elements.find(
    (item) => item.id === "wheel.aspect.primary.sun.moon.6.line",
  );
  assert.equal(
    aspect.tokenBindings[0].semanticId,
    "renderer.wheel.metric.aspectWidthScale",
  );
  const bodyGlyph = scene.elements.find((item) => item.id === "wheel.body.primary.sun");
  assert.equal(bodyGlyph.labelKey, "styleLab.scene.bodyGlyphs");
  assert.ok(
    bodyGlyph.tokenBindings.some(
      (binding) => binding.semanticId === "renderer.wheel.font.bodySymbols",
    ),
  );
  assert.ok(bodyGlyph.tokenBindings.every((binding) => binding.property !== "stroke-width"));
  assert.deepEqual(
    bodyGlyph.tokenBindings
      .filter((binding) => binding.property === "font-size")
      .map((binding) => binding.semanticId),
    ["renderer.wheel.metric.bodyScale"],
  );
  assert.equal(
    bodyGlyph.handles[0].binding.semanticId,
    "authoring.wheel.classic.bodies.inner.glyph.fontSize",
  );
  // Fortune, the Vertex and the prenatal syzygy are body glyphs. They select
  // as one, so they carry the glyph's whole control set instead of a lone
  // colour, and each still paints through its own occurrence palette role.
  for (const [id, paletteRole] of [
    ["wheel.body.primary.fortune", "chart.color.body.fortune"],
    ["wheel.body.primary.vertex", "chart.color.peregrine"],
    ["wheel.body.primary.syzygy", "chart.color.positions"],
  ]) {
    const point = scene.elements.find((item) => item.id === id);
    assert.equal(point.classId, "bodies.inner.glyph", id);
    assert.ok(point.authoringDefaults.fontSizePx > 0, id);
    assert.ok(point.authoringDefaults.opacityPercent != null, id);
    assert.ok(point.paletteRoleIds.includes(paletteRole), `${id} palette`);
  }
  assert.equal(
    scene.elements.some((item) => /^bodies\.(?:fortune|vertex|prenatalSyzygy)$/.test(item.classId)),
    false,
  );
  const bodyLeader = scene.elements.find((item) => item.id === "wheel.body.primary.sun.leader");
  assert.equal(
    bodyLeader.tokenBindings[0].semanticId,
    "renderer.wheel.metric.bodyLeaderWidthScale",
  );
  assert.equal(bodyLeader.primitive, "line");
  assert.ok(bodyLeader.tokenBindings.some(
    (binding) => binding.semanticId === "renderer.wheel.color.bodyLeader",
  ));
  assert.equal(
    scene.elements.find((item) => item.id === "wheel.term.boundary.aries-0")
      .tokenBindings[0].semanticId,
    "renderer.wheel.metric.termBoundaryWidthScale",
  );
  assert.ok(
    scene.elements.find((item) => item.id === "wheel.term.boundary.aries-0")
      .tokenBindings.some((binding) => binding.semanticId === "renderer.wheel.color.termBoundary"),
  );
  assert.equal(
    scene.elements.find((item) => item.id === "wheel.decan.boundary.aries-0")
      .tokenBindings[0].semanticId,
    "renderer.wheel.metric.decanBoundaryWidthScale",
  );
  const termGlyph = scene.elements.find((item) => item.id === "wheel.term.glyph.aries-0");
  assert.ok(termGlyph.tokenBindings.some(
    (binding) => binding.semanticId === "renderer.wheel.font.termSymbols",
  ));
  assert.ok(termGlyph.tokenBindings.some(
    (binding) => binding.semanticId === "renderer.wheel.metric.termGlyphScale",
  ));
  assert.ok(termGlyph.tokenBindings.some(
    (binding) => binding.semanticId === "renderer.wheel.color.termGlyph",
  ));
  assert.ok(termGlyph.tokenBindings.every((binding) => binding.property !== "stroke-width"));
  const decanGlyph = scene.elements.find((item) => item.id === "wheel.decan.glyph.aries-0");
  assert.ok(decanGlyph.tokenBindings.some(
    (binding) => binding.semanticId === "renderer.wheel.font.decanSymbols",
  ));
  assert.ok(decanGlyph.tokenBindings.some(
    (binding) => binding.semanticId === "renderer.wheel.metric.decanGlyphScale",
  ));
  assert.ok(decanGlyph.tokenBindings.some(
    (binding) => binding.semanticId === "renderer.wheel.color.decanGlyph",
  ));
  const angleLabel = scene.elements.find((item) => item.id === "wheel.angle.primary.asc.label");
  assert.ok(angleLabel.tokenBindings.some(
    (binding) => binding.semanticId === "renderer.wheel.metric.angleLabelScale",
  ));
  assert.ok(angleLabel.tokenBindings.some(
    (binding) => binding.semanticId === "renderer.wheel.metric.angleLabelWeight",
  ));
  assert.ok(angleLabel.tokenBindings.some(
    (binding) => binding.semanticId === "renderer.wheel.color.angleLabel",
  ));
  assert.equal(
    scene.elements.find((item) => item.id === "wheel.secondary.fixed_stars.regulus.primary.leader")
      .tokenBindings[0].semanticId,
    "renderer.wheel.metric.outerLeaderWidthScale",
  );
  assert.ok(
    scene.elements.find((item) => item.id === "wheel.secondary.fixed_stars.regulus.primary")
      .tokenBindings.some(
        (binding) => binding.semanticId === "renderer.wheel.metric.outerLabelScale",
      ),
  );
  assert.ok(
    scene.elements.find((item) => item.id === "wheel.secondary.fixed_stars.regulus.primary")
      .tokenBindings.every(
        (binding) => !binding.semanticId.endsWith("OuterScale"),
      ),
  );
  assert.equal(
    scene.elements.find((item) => item.id === "wheel.secondary.fixed_stars.regulus.primary.leader").layer,
    "dynamic",
  );
  assert.ok(
    scene.elements.find((item) => item.id === "wheel.aspect.primary.sun.venus.3.glyph")
      .tokenBindings.every((binding) => binding.property !== "stroke-width"),
  );
  assert.equal(
    sceneApi.hitTestWheelStyleScene(scene, 250, 250)?.element.id,
    "wheel.aspect.primary.sun.moon.6.line",
  );
  assert.equal(
    sceneApi.hitTestWheelStyleScene(scene, 292.5, 232.5)?.element.id,
    "wheel.body.primary.sun.leader",
  );
  assert.equal(
    sceneApi.hitTestWheelStyleScene(scene, 600, 130)?.element.id,
    "wheel.term.boundary.aries-0",
  );
  assert.equal(
    sceneApi.hitTestWheelStyleScene(scene, 620, 200)?.element.id,
    "wheel.term.glyph.aries-0",
  );
  assert.equal(
    sceneApi.hitTestWheelStyleScene(scene, 650, 130)?.element.id,
    "wheel.decan.boundary.aries-0",
  );
  assert.equal(
    sceneApi.hitTestWheelStyleScene(scene, 670, 200)?.element.id,
    "wheel.decan.glyph.aries-0",
  );
  assert.equal(
    sceneApi.hitTestWheelStyleScene(scene, 120, 400)?.element.id,
    "wheel.angle.primary.asc.label",
  );
  assert.equal(
    sceneApi.hitTestWheelStyleScene(scene, 575, 400)?.element.id,
    "wheel.secondary.fixed_stars.regulus.primary.leader",
  );

  const elementColorScene = sceneApi.buildWheelStyleScene({
    style: wheel.DEFAULT_WHEEL_RENDER_STYLE,
    geometry: geometry(),
    center: [400, 400],
    viewport: { width: 800, height: 800 },
    useZodiacElementColors: true,
    signColors: Array.from({ length: 12 }, (_, index) => `sign-${index}`),
    hitRegions,
  });
  const aries = elementColorScene.elements.find((item) => item.id === "wheel.zodiac.sign.0");
  assert.ok(aries.tokenBindings.some(
    (binding) => binding.semanticId === "chart.color.element.fire" && binding.value === "sign-0",
  ));
});

test("style-only renderer targets become exact selectable scene elements", () => {
  const rectTarget = (classId, itemId, x, y, extra = {}) => ({
    kind: "style_target",
    classId,
    itemId,
    shape: "rect",
    styleOnly: true,
    x,
    y,
    r: 8,
    left: x - 8,
    top: y - 8,
    width: 16,
    height: 16,
    priority: 48,
    ...extra,
  });
  const lineTarget = (classId, itemId, x1, y1, x2, y2, extra = {}) => ({
    kind: "style_target",
    classId,
    itemId,
    shape: "line",
    styleOnly: true,
    x: (x1 + x2) / 2,
    y: (y1 + y2) / 2,
    r: 0,
    x1,
    y1,
    x2,
    y2,
    tolerance: 5,
    priority: 48,
    ...extra,
  });
  const classicTargets = [
    rectTarget("bodies.inner.position.degree", "body:sun:position:degree", 80, 80),
    rectTarget("bodies.inner.position.minute", "body:sun:position:minute", 100, 80),
    rectTarget("bodies.inner.motion", "body:sun:motion", 120, 80),
    rectTarget("angles.inner.position.degree", "angle:asc:position:degree", 140, 80),
    rectTarget("angles.inner.position.minute", "angle:asc:position:minute", 160, 80),
    rectTarget("houses.inner.position.degree", "house:1:position:degree", 180, 80),
    rectTarget("houses.inner.position.minute", "house:1:position:minute", 200, 80),
    rectTarget("bodies.outer.motion", "outer-body:moon:motion", 220, 80),
    rectTarget("houses.outer.label", "house:1:outer-label", 240, 80),
    lineTarget("houses.outer.cusp", "house:1:outer-cusp", 260, 70, 260, 95),
    lineTarget("surveil.tick", "surveil:0:tick", 280, 70, 280, 95),
    rectTarget("surveil.marker.glyph", "surveil:0:marker:glyph", 300, 80),
    rectTarget("surveil.marker.label", "surveil:1:marker:label", 320, 80),
    rectTarget("surveil.sourceLabel", "surveil:0:source", 340, 80),
    lineTarget("houses.inner.cusp", "house:1:cusp:0", 360, 70, 360, 95),
    lineTarget("angles.inner.ray", "angle:asc:ray", 380, 70, 380, 95),
    lineTarget("angles.inner.arrowhead", "angle:asc:arrowhead:0", 400, 70, 410, 80),
    lineTarget("angles.outer.ray", "outer-angle:asc:ray", 420, 70, 420, 95),
    lineTarget("angles.outer.arrowhead", "outer-angle:asc:arrowhead:0", 440, 70, 450, 80),
    lineTarget(
      "secondaryRing.midpoint.leader",
      "secondary:midpoints:one:leader",
      460,
      70,
      460,
      95,
      { ownerId: "secondary:midpoints:one" },
    ),
    rectTarget(
      "secondaryRing.midpoint.glyph",
      "secondary:midpoints:one:glyph",
      480,
      80,
      { ownerId: "secondary:midpoints:one" },
    ),
    rectTarget(
      "secondaryRing.midpoint.text",
      "secondary:midpoints:one:text",
      500,
      80,
      { ownerId: "secondary:midpoints:one" },
    ),
    rectTarget(
      "secondaryRing.parallelTransit.motion",
      "secondary:parallel_transits:one:motion",
      520,
      80,
      { ownerId: "secondary:parallel_transits:one" },
    ),
    rectTarget(
      "chartOverlay.information.topLeft",
      "overlay:top-left",
      540,
      80,
      { colorValue: "#999", compactOverlay: false },
    ),
    rectTarget(
      "chartOverlay.information.bottomLeft",
      "overlay:bottom-left",
      560,
      80,
      { colorValue: "#999", compactOverlay: false },
    ),
    rectTarget(
      "chartOverlay.houseSystem.bottomRight",
      "overlay:house-system",
      580,
      80,
      { colorValue: "#999", compactOverlay: false },
    ),
    ...["dayHour", "header", "signal"].flatMap((group, groupIndex) =>
      ["label", "glyph", "trailing"].map((component, componentIndex) =>
        rectTarget(
          `chartOverlay.events.${group}.${component}`,
          `overlay:${group}:${component}`,
          600 + groupIndex * 60 + componentIndex * 20,
          80,
          {
            colorValue: "#aaa",
            compactOverlay: false,
            ...(component === "glyph" ? { bodyId: "sun" } : {}),
          },
        )
      )
    ),
  ];
  const classic = sceneApi.buildWheelStyleScene({
    style: wheel.DEFAULT_WHEEL_RENDER_STYLE,
    geometry: geometry("classic", "comparison", { showPositions: false }),
    center: [400, 400],
    viewport: { width: 800, height: 800 },
    hitRegions: [
      {
        kind: "planet",
        planetId: "sun",
        seId: 0,
        x: 400,
        y: 200,
        r: 10,
        longitude: 0,
        latitude: 0,
        speed: 1,
        priority: 40,
      },
      {
        kind: "planet",
        planetId: "moon",
        seId: 1,
        x: 450,
        y: 200,
        r: 10,
        longitude: 20,
        latitude: 0,
        speed: -1,
        chartRole: "outer",
        priority: 40,
      },
      ...classicTargets,
    ],
  });
  for (const target of classicTargets) {
    const occurrence = classic.elements.find(
      (element) =>
        element.classId === target.classId
        && element.stateTags.includes("production-style-target"),
    );
    assert.ok(occurrence, target.classId);
    assert.ok(occurrence.hitGeometry, `${target.classId} geometry`);
    assert.equal(
      occurrence.id.startsWith("wheel.manifest."),
      false,
      `${target.classId} must not be a placeholder`,
    );
  }
  for (const [classId, metricId] of [
    ["bodies.inner.position.degree", "renderer.wheel.metric.bodyPositionDegreeScale"],
    ["bodies.inner.position.minute", "renderer.wheel.metric.bodyPositionMinuteScale"],
    ["angles.inner.position.degree", "renderer.wheel.metric.anglePositionDegreeScale"],
    ["angles.inner.position.minute", "renderer.wheel.metric.anglePositionMinuteScale"],
    ["houses.inner.position.degree", "renderer.wheel.metric.housePositionDegreeScale"],
    ["houses.inner.position.minute", "renderer.wheel.metric.housePositionMinuteScale"],
    ["bodies.inner.motion", "renderer.wheel.metric.motionScale"],
    ["bodies.outer.motion", "renderer.wheel.metric.motionScale"],
    ["houses.outer.label", "renderer.wheel.metric.houseLabelScale"],
  ]) {
    const occurrence = classic.elements.find(
      (element) =>
        element.classId === classId
        && element.stateTags.includes("production-style-target"),
    );
    assert.ok(
      occurrence.tokenBindings.some((binding) => binding.semanticId === metricId),
      `${classId} -> ${metricId}`,
    );
  }
  assert.ok(
    classic.elements.find(
      (element) =>
        element.classId === "houses.outer.cusp"
        && element.stateTags.includes("production-style-target"),
    ).tokenBindings.some(
      (binding) => binding.semanticId === "renderer.wheel.metric.houseCuspWidthScale",
    ),
  );
  assert.ok(
    classic.elements.find(
      (element) =>
        element.classId === "surveil.tick"
        && element.stateTags.includes("production-style-target"),
    ).tokenBindings.some(
      (binding) => binding.semanticId === "renderer.wheel.metric.surveilTickLengthScale",
    ),
  );
  assert.ok(
    classic.elements.find(
      (element) =>
        element.classId === "bodies.outer.motion"
        && element.stateTags.includes("production-style-target"),
    ).tokenBindings.some(
      (binding) => binding.semanticId === "chart.color.body.moon",
    ),
  );
  assert.equal(
    sceneApi.hitTestWheelStyleScene(classic, 100, 80)?.element.classId,
    "bodies.inner.position.minute",
  );
  assert.equal(
    classic.elements
      .flatMap((element) => element.tokenBindings)
      .some((binding) => binding.cssVar === ""),
    false,
    "production scene token bindings must resolve to real CSS variables",
  );
  const featureProbe = sceneApi.buildWheelStyleScene({
    style: wheel.DEFAULT_WHEEL_RENDER_STYLE,
    geometry: geometry("classic", "single", { showPositions: false }),
    hitRegions: [
      rectTarget("bodies.inner.position.degree", "body:sun:position:degree", 80, 80),
    ],
  });
  assert.equal(
    featureProbe.elements.find(
      (element) => element.id === "wheel.manifest.bodies.inner.position.minute",
    ).stateTags.includes("manifest-missing:positions"),
    false,
  );

  const angloTargets = [
    rectTarget(
      "bodies.inner.position.sign",
      "body:sun:position:sign",
      80,
      120,
      { signIndex: 7 },
    ),
    rectTarget(
      "angles.inner.position.sign",
      "angle:asc:position:sign",
      100,
      120,
      { signIndex: 4 },
    ),
    rectTarget(
      "houses.inner.position.sign",
      "house:1:position:sign",
      120,
      120,
      { signIndex: 10 },
    ),
  ];
  const anglo = sceneApi.buildWheelStyleScene({
    style: wheel.DEFAULT_WHEEL_RENDER_STYLE,
    geometry: geometry("anglo", "single", { showPositions: false }),
    useZodiacElementColors: true,
    signColors: Array.from({ length: 12 }, (_, index) => `sign-${index}`),
    hitRegions: angloTargets,
  });
  for (const [classId, metricId] of [
    ["bodies.inner.position.sign", "renderer.wheel.metric.bodyPositionSignScale"],
    ["angles.inner.position.sign", "renderer.wheel.metric.anglePositionSignScale"],
    ["houses.inner.position.sign", "renderer.wheel.metric.housePositionSignScale"],
  ]) {
    const occurrence = anglo.elements.find(
      (element) =>
        element.classId === classId
        && element.stateTags.includes("production-style-target"),
    );
    assert.ok(occurrence, classId);
    assert.ok(
      occurrence.tokenBindings.some((binding) => binding.semanticId === metricId),
      `${classId} -> ${metricId}`,
    );
  }
  for (const [classId, semanticId, value] of [
    ["bodies.inner.position.sign", "chart.color.element.water", "sign-7"],
    ["angles.inner.position.sign", "chart.color.element.fire", "sign-4"],
    ["houses.inner.position.sign", "chart.color.element.air", "sign-10"],
  ]) {
    const occurrence = anglo.elements.find(
      (element) =>
        element.classId === classId
        && element.stateTags.includes("production-style-target"),
    );
    assert.ok(
      occurrence.tokenBindings.some(
        (binding) =>
          binding.semanticId === semanticId
          && binding.value === value,
      ),
      `${classId} -> ${semanticId}`,
    );
  }
});

test("interchart aspect endpoints synthesize one authored body-leader line per endpoint", () => {
  const inputGeometry = geometry("classic", "comparison");
  const rings = wheel.resolveWheelRingSet(
    wheel.DEFAULT_WHEEL_RENDER_STYLE,
    inputGeometry,
  );
  // Interchart angle endpoints can be projected at rAspAscMC, but the painted
  // endpoint marker always spans the renderer's rAsp -> rLLine2 lane.
  const endpoint = [400 + rings.rAspAscMC, 400];
  const hitRegions = [
    {
      kind: "aspect",
      p1: "sun",
      p2: "moon",
      aspectType: 6,
      scope: "interchart",
      shape: "line",
      x: 400,
      y: 400,
      r: 0,
      x1: 400 - rings.rAsp,
      y1: 400,
      x2: endpoint[0],
      y2: endpoint[1],
      tolerance: 5,
      priority: 18,
    },
    {
      kind: "aspect",
      p1: "mars",
      p2: "venus",
      aspectType: 3,
      scope: "interchart",
      shape: "line",
      x: 400,
      y: 400,
      r: 0,
      x1: 400,
      y1: 400 - rings.rAsp,
      x2: endpoint[0],
      y2: endpoint[1],
      tolerance: 5,
      priority: 18,
    },
  ];
  const scene = sceneApi.buildWheelStyleScene({
    style: wheel.DEFAULT_WHEEL_RENDER_STYLE,
    geometry: inputGeometry,
    center: [400, 400],
    viewport: { width: 800, height: 800 },
    hitRegions,
  });
  const markers = scene.elements.filter(
    (element) => element.classId === "aspects.interchart.endpointMarker",
  );
  assert.equal(markers.length, 1);
  assert.equal(markers[0].primitive, "line");
  assert.equal(markers[0].hitGeometry.kind, "line");
  assert.equal(markers[0].hitGeometry.start[0], 400 + rings.rAsp);
  assert.equal(markers[0].hitGeometry.end[0], 400 + rings.rLLine2);
  assert.ok(markers[0].tokenBindings.some(
    (binding) => binding.semanticId === "renderer.wheel.metric.bodyLeaderWidthScale",
  ));
  assert.ok(markers[0].tokenBindings.some(
    (binding) => binding.semanticId === "renderer.wheel.color.bodyLeader",
  ));
  assert.equal(
    markers[0].handles[0].binding.semanticId,
    "authoring.wheel.classic.aspects.interchart.endpointMarker.strokeWidth",
  );
  const markerMidpoint = (
    markers[0].hitGeometry.start[0] + markers[0].hitGeometry.end[0]
  ) / 2;
  assert.equal(
    sceneApi.hitTestWheelStyleScene(scene, markerMidpoint, 400)?.element.id,
    markers[0].id,
  );
});

// A position readout is one printed value, so its three components share one
// colour role. Colouring the sign component by the zodiac role split a single
// reading across two families because that component happens to be a glyph.
// Font deliberately still splits: the sign needs a face whose cmap has the
// glyph. Colour groups by meaning; font is constrained by coverage.
test("a position readout shares one colour role but keeps its symbol font", () => {
  const geometry = {
    profile: "classic",
    mode: "single",
    maxRadius: 400,
    hasOuterRing: false,
    showTerms: true,
    showDecans: true,
    showHouses: true,
    showPositions: true,
    comparisonWithOuterHouses: false,
  };
  const components = ["degree", "sign", "minute"];
  const hitRegions = components.map((component, index) => ({
    kind: "style_target",
    styleOnly: true,
    classId: `bodies.inner.position.${component}`,
    itemId: `body:sun:position:${component}`,
    shape: "rect",
    x: 10 + index,
    y: 10,
    r: 4,
    left: 10 + index,
    top: 10,
    width: 8,
    height: 8,
    signIndex: 7,
  }));
  const scene = sceneApi.buildWheelStyleScene({
    style: wheel.DEFAULT_WHEEL_RENDER_STYLE,
    geometry,
    hitRegions,
  });

  const colours = new Map();
  const fonts = new Map();
  for (const component of components) {
    const element = scene.elements.find(
      (candidate) => candidate.classId === `bodies.inner.position.${component}`,
    );
    assert.ok(element, `no scene element for ${component}`);
    const colour = element.tokenBindings.find((b) => b.property === "color");
    const font = element.tokenBindings.find((b) => b.property === "font-family");
    assert.ok(colour, `${component} has no colour binding`);
    colours.set(component, colour.semanticId);
    if (font) fonts.set(component, font.semanticId);
  }

  assert.equal(
    new Set(colours.values()).size,
    1,
    `position components must share one colour role: ${JSON.stringify([...colours])}`,
  );
  assert.equal(colours.get("sign"), "chart.color.positions");
  // The sign must not fall back to the zodiac ring's role.
  assert.notEqual(colours.get("sign"), "chart.color.signs");
  // ...but it must still use a symbol face, unlike its numeric siblings.
  assert.notEqual(fonts.get("sign"), fonts.get("degree"));
});

// ---------------------------------------------------------------------------
// The chart-scale handle.
//
// Scale is a declared affordance, not something inferred from which ring was
// grabbed. Inference was tried and reverted: its `index === 0` discriminator is
// wrong in two reachable layouts — a classic biwheel with houses hidden, and
// anglo synastry — where no painted ring is index 0, so the gesture silently
// did something else.
// ---------------------------------------------------------------------------

function chartScaleHandleOf(scene) {
  return scene.handles.find(
    (handle) => handle.elementId === sceneApi.WHEEL_STYLE_SCENE_ELEMENT_IDS.chartScale,
  );
}

test("every layout offers exactly one chart-scale handle, whatever is painted", () => {
  let states = 0;
  for (const profile of ["classic", "compact", "anglo"]) {
    for (const mode of ["single", "comparison"]) {
      for (const showHouses of [false, true]) {
        for (const showTerms of [false, true]) {
          const scene = sceneApi.buildWheelStyleScene({
            style: wheel.DEFAULT_WHEEL_RENDER_STYLE,
            geometry: geometry(profile, mode, { showHouses, showTerms }),
          });
          const scaleHandles = scene.handles.filter(
            (handle) =>
              handle.elementId === sceneApi.WHEEL_STYLE_SCENE_ELEMENT_IDS.chartScale,
          );
          assert.equal(
            scaleHandles.length,
            1,
            `${profile}/${mode} houses:${showHouses} terms:${showTerms} `
            + `offered ${scaleHandles.length} scale handles`,
          );
          const [handle] = scaleHandles;
          assert.equal(handle.editability.state, "editable");
          assert.equal(handle.binding.property, "scale");
          assert.ok(
            handle.binding.semanticId.endsWith(".canvas.chart.scale"),
            `scale handle authors ${handle.binding.semanticId}`,
          );
          states += 1;
        }
      }
    }
  }
  assert.ok(states >= 24, `expected a real matrix, checked ${states}`);
});

test("the scale handle is not a ring handle and authors no ring radius", () => {
  const scene = sceneApi.buildWheelStyleScene({
    style: wheel.DEFAULT_WHEEL_RENDER_STYLE,
    geometry: geometry("classic", "single"),
  });
  const handle = chartScaleHandleOf(scene);
  assert.ok(handle);
  // No painted ring may write the scale id, and the scale may not write a ring.
  assert.equal(authoringAdapter.wheelRingRoleForClass("canvas.chart"), undefined);
  for (const other of scene.handles) {
    if (other === handle) continue;
    assert.notEqual(
      other.binding?.semanticId,
      handle.binding.semanticId,
      "a ring handle shares the chart-scale semantic id",
    );
  }
  assert.doesNotMatch(handle.binding.semanticId, /\.radius$/);
  // Its element is deliberately unclickable: a hit circle at the wheel's rim
  // would swallow clicks meant for the outermost ring.
  const element = scene.elements.find(
    (candidate) => candidate.id === sceneApi.WHEEL_STYLE_SCENE_ELEMENT_IDS.chartScale,
  );
  assert.ok(element);
  assert.equal(element.hitGeometry, null);
});

test("a scale drag tracks the pointer and is invertible within the gesture", () => {
  // Purity, identity and within-gesture invertibility (invariants 1-3), checked
  // at several pane sizes because the ring units bug was invisible at exactly
  // one of them (invariant 8).
  for (const maxRadius of [180, 400, 512, 733.5]) {
    const scene = sceneApi.buildWheelStyleScene({
      style: wheel.DEFAULT_WHEEL_RENDER_STYLE,
      geometry: geometry("classic", "single", { maxRadius }),
      viewport: { width: maxRadius * 2, height: maxRadius * 2 },
    });
    const handle = chartScaleHandleOf(scene);
    assert.ok(handle, `no scale handle at ${maxRadius}`);
    const start = handle.position;
    const drag = (current) =>
      sceneApi.resolveWheelStyleHandleDrag(handle, { start, current });

    // Identity: no movement changes nothing.
    assert.equal(drag(start).value, handle.binding.value);

    // Purity: the same gesture state resolves identically twice.
    const inward = [
      start[0] + (handle.center[0] - start[0]) * 0.25,
      start[1] + (handle.center[1] - start[1]) * 0.25,
    ];
    assert.deepEqual(drag(inward), drag(inward));

    // Dragging towards the centre shrinks the wheel, and never past the floor.
    assert.ok(drag(inward).value < handle.binding.value, `no shrink at ${maxRadius}`);
    assert.ok(drag(handle.center).value >= wheel.WHEEL_SCALE_RANGE.min - 1e-9);
    // ...and it can never be pushed past 1, where it would clip the pane.
    const outward = [
      handle.center[0] + (start[0] - handle.center[0]) * 3,
      handle.center[1] + (start[1] - handle.center[1]) * 3,
    ];
    assert.ok(drag(outward).value <= wheel.WHEEL_SCALE_RANGE.max + 1e-9);

    // Within-gesture invertibility: a path returning to its origin restores it.
    assert.equal(drag(start).value, handle.binding.value);
  }
});

test("the scale handle keeps tracking the pointer once the wheel is already scaled", () => {
  // The handle's travel is measured against the unscaled pane. Measuring it
  // against the shrunken wheel instead would make an already-small chart drag
  // at a fraction of the pointer's speed, and it could never be dragged back.
  const paneRadius = 400;
  for (const scale of [1, 0.6, wheel.WHEEL_SCALE_RANGE.min]) {
    const style = {
      ...wheel.DEFAULT_WHEEL_RENDER_STYLE,
      authoringOverrides: {
        ...wheel.DEFAULT_WHEEL_RENDER_STYLE.authoringOverrides,
        wheelScale: { classic: scale },
      },
    };
    const scene = sceneApi.buildWheelStyleScene({
      style,
      geometry: geometry("classic", "single", { maxRadius: paneRadius * scale }),
      viewport: { width: paneRadius * 2, height: paneRadius * 2 },
    });
    const handle = chartScaleHandleOf(scene);
    assert.ok(handle);
    assert.ok(
      Math.abs(handle.binding.value - scale) < 1e-9,
      `handle reported ${handle.binding.value} for an authored scale of ${scale}`,
    );
    // One pixel outward is one pixel of unscaled wheel radius, at any scale.
    assert.ok(
      Math.abs(handle.binding.valuePerPixel - 1 / paneRadius) < 1e-9,
      `scale ${scale}: valuePerPixel ${handle.binding.valuePerPixel} != ${1 / paneRadius}`,
    );
  }
});

test("every outer-ring family the daemon emits reaches a manifest class", () => {
  // The daemon's spelling is the contract. `fixstar` used to miss a check for
  // "fixed" and fell through to the unnamed fallback, so a fixed-star label
  // was authored as `secondaryRing.fixstar.label` — a class the manifest does
  // not know, with no size, no opacity and its raw colour tokens on show.
  // Every family here is a string `export_ring_item` actually ships.
  const families = [
    "fixstar",
    "asteroid",
    "midpoint",
    "arabic_part",
    "parallel_transits",
    "antiscia",
    "contra_antiscia",
    "dodecatemoria",
  ];
  // Deliberately not `hybrid_hit`: `export_hybrid_items` ships every item in
  // the Hybrid Hits ring under its own family, so a fixed star there is a
  // fixed star. There is no hybrid family to resolve and no class for one.
  assert.equal(wheel.resolveWheelSecondaryRingClassIds("hybrid_hit"), null);
  const manifestIds = new Set(semanticManifest.WHEEL_SEMANTIC_CLASS_IDS);
  for (const family of families) {
    const classes = wheel.resolveWheelSecondaryRingClassIds(family);
    assert.ok(classes, `${family} resolves to no class set`);
    for (const [role, classId] of Object.entries(classes)) {
      assert.ok(
        manifestIds.has(classId),
        `${family}.${role} -> ${classId} is not a manifest class`,
      );
    }
  }
});

test("a fixed-star label is one manifest class with its own size and opacity", () => {
  const scene = sceneApi.buildWheelStyleScene({
    style: wheel.DEFAULT_WHEEL_RENDER_STYLE,
    geometry: geometry("classic", "single"),
    hitRegions: [{
      kind: "secondary_ring",
      family: "fixstar",
      itemId: "algol",
      label: "Algol",
      x: 700, y: 120, r: 20, longitude: 55,
      shape: "rect", left: 680, top: 112, width: 44, height: 16,
      segments: [{ text: "Algol", kind: "text" }],
      leader: { start: [660, 140], end: [680, 120] },
    }],
  });
  const live = scene.elements.filter(
    (element) => !element.stateTags.includes("manifest-placeholder")
      && String(element.classId).startsWith("secondaryRing.fix"),
  );
  assert.deepEqual(
    live.map((element) => element.classId).sort(),
    ["secondaryRing.fixedStar.label", "secondaryRing.fixedStar.leader"],
  );
  const label = live.find((element) => element.classId.endsWith(".label"));
  for (const property of [
    "fontRef",
    "fontWeight",
    "fontStyle",
    "fontSizePx",
    "trackingPx",
    "color",
    "opacityPercent",
  ]) {
    assert.ok(
      label.authoringDefaults[property] != null,
      `the label reports no ${property}`,
    );
  }
  // One role, the one the renderer paints an outer-ring label with. Offering
  // positions and signs as well put three inert colour rows on one label.
  assert.deepEqual(label.paletteRoleIds, ["chart.color.textDim"]);
});

test("a class declares one primitive, whatever occurrence of it is on screen", () => {
  // The inspector reads the primitive to place a property in a section, so a
  // scene element that disagrees with the manifest moves the colour row
  // between Stroke/Typography and Appearance depending on what is drawn.
  const byId = new Map(
    semanticManifest.WHEEL_SEMANTIC_CLASS_MANIFEST.map((definition) => [
      definition.id,
      definition,
    ]),
  );
  for (const mode of ["single", "comparison"]) {
    const scene = sceneApi.buildWheelStyleScene({
      style: wheel.DEFAULT_WHEEL_RENDER_STYLE,
      geometry: geometry("classic", mode),
    });
    for (const element of scene.elements) {
      const definition = byId.get(element.classId);
      if (!definition) continue;
      assert.equal(
        element.primitive,
        definition.primitive,
        `${element.id} (${element.classId}) paints as ${element.primitive}`,
      );
    }
  }
});

test("direct manipulation writes to the scope that governs the visible wheel", () => {
  // Base is the lowest precedence. With the Edit scope on "All wheel styles",
  // a drag on a wheel whose variant already authors that property used to
  // accumulate into a base value nothing painted — the wheel stood still and
  // the change arrived all at once when something made base govern again.
  const stored = { "authoring.wheel.anglo.canvas.chart.scale": 0.942016 };
  const style = wheel.resolveWheelRenderStyleFromTokens(() => "", {
    authoringOverrides: authoringAdapter.compileFlatWheelAuthoringOverrides(stored),
  });
  const scaleHandleId = (profile) => {
    const scene = sceneApi.buildWheelStyleScene({
      style,
      geometry: geometry(profile, "single"),
      authoringScope: "base",
      variantAuthoredOverrideIds:
        authoringAdapter.variantAuthoredOverrideIds(stored, profile),
    });
    return scene.handles.find((handle) => handle.binding?.property === "scale")
      ?.binding?.semanticId;
  };
  assert.equal(scaleHandleId("anglo"), "authoring.wheel.anglo.canvas.chart.scale");
  // Nothing masks base on the other wheels, so the shared value still governs
  // and the shared value is still what the handle moves.
  assert.equal(scaleHandleId("classic"), "authoring.wheel.base.canvas.chart.scale");
  assert.equal(scaleHandleId("compact"), "authoring.wheel.base.canvas.chart.scale");
  // Without the variant map the old behaviour stands: scope wins outright.
  const noMap = sceneApi.buildWheelStyleScene({
    style,
    geometry: geometry("anglo", "single"),
    authoringScope: "base",
  });
  assert.equal(
    noMap.handles.find((handle) => handle.binding?.property === "scale")
      ?.binding?.semanticId,
    "authoring.wheel.base.canvas.chart.scale",
  );
});

test("nothing on the wheel is editable without being nameable", () => {
  // A class with a drag handle and no manifest entry can be moved but never
  // found again: the element list is built from the manifest, so it has no row
  // to name what the user just changed. Nine classes were in that state — the
  // chart scale, the band span, six geometry lanes and the unpainted aspect
  // lane, which the id fallback had been calling `ring.aspect`.
  const manifestIds = new Set(semanticManifest.WHEEL_SEMANTIC_CLASS_IDS);
  const orphans = new Set();
  for (const profile of ["classic", "compact", "anglo"]) {
    for (const mode of ["single", "comparison"]) {
      const scene = sceneApi.buildWheelStyleScene({
        style: wheel.DEFAULT_WHEEL_RENDER_STYLE,
        geometry: geometry(profile, mode),
      });
      for (const element of scene.elements) {
        if (element.editability.state !== "editable") continue;
        if (manifestIds.has(element.classId)) continue;
        orphans.add(`${element.classId} (${profile}/${mode}, ${element.id})`);
      }
    }
  }
  assert.deepEqual([...orphans], []);
});

test("the chart scale is authored from the chart, not from the paper", () => {
  const scene = sceneApi.buildWheelStyleScene({
    style: wheel.DEFAULT_WHEEL_RENDER_STYLE,
    geometry: geometry("classic", "single"),
  });
  const chart = scene.elements.find((element) => element.classId === "canvas.chart");
  assert.ok(chart, "canvas.chart is a scene element");
  assert.equal(chart.handles.length, 1);
  assert.equal(chart.handles[0].binding.property, "scale");
  // The band span reports the factor its diamond authors, so the class the list
  // can now name is not a class with an empty inspector. A factor rather than
  // the inner circle's radius: as a radius it was the same circle the inner
  // chevron authors, and whichever value was applied last silently won.
  const span = scene.elements.find(
    (element) => element.classId === "canvas.span.chartRing",
  );
  assert.ok(span.authoringDefaults.spanScalePercent > 0);
  assert.equal(span.handles[0].binding.property, "spanScale");
});

test("a cap is reachable wherever a dash can show one", () => {
  // Every ring is stroked as an arc; solid, a cap shapes nothing, but each
  // dash of a dashed or dotted ring has two ends and the adapter reads a round
  // cap as what makes a dash a dot. `lineJoin` stays off rings and open lines
  // on purpose: measured against `draw-chart`, every one of them is painted as
  // two-point segments and full arcs, so a join has no corner to shape. The
  // single exception is the directed Drishti head on `aspects.primary.line`.
  for (const definition of semanticManifest.WHEEL_SEMANTIC_CLASS_MANIFEST) {
    if (definition.groupId !== "rings") continue;
    assert.ok(definition.capabilities.includes("lineCap"), definition.id);
    assert.equal(definition.capabilities.includes("lineJoin"), false, definition.id);
  }
  const drishti = semanticManifest.getWheelSemanticClass("aspects.primary.line");
  assert.ok(drishti.capabilities.includes("lineJoin"));
});

test("an outer-ring family we cannot name is drawn but never offered", () => {
  // The old fallback invented `secondaryRing.<family>.label`, which is not a
  // manifest class, so the inspector fell through to the item's raw renderer
  // tokens and editing its colour rewrote a palette role shared by 25 classes.
  const scene = sceneApi.buildWheelStyleScene({
    style: wheel.DEFAULT_WHEEL_RENDER_STYLE,
    geometry: geometry("classic", "single"),
    hitRegions: [{
      kind: "secondary_ring",
      family: "not_a_family",
      itemId: "x",
      label: "X",
      x: 700, y: 120, r: 20, longitude: 55,
      shape: "rect", left: 680, top: 112, width: 20, height: 10,
      segments: [{ text: "X", kind: "text" }],
    }],
  });
  assert.equal(
    scene.elements.some((element) => element.classId.startsWith("secondaryRing.not_a_family")),
    false,
  );
});

test("a seated glyph reports the band limit that governs it, in one space", () => {
  // The wheel capped a dragged glyph at its band and the inspector did not cap
  // a typed one, so the same property had two different limits. The ceiling
  // now travels with the size it limits, in the reference px the size is
  // authored in — the earlier measurement that compared it against rendered px
  // was reading two different spaces and invented a cap that was not there.
  for (const profile of ["classic", "compact", "anglo"]) {
    for (const maxRadius of [400, 150]) {
      const scene = sceneApi.buildWheelStyleScene({
        style: wheel.DEFAULT_WHEEL_RENDER_STYLE,
        geometry: geometry(profile, "single", { maxRadius }),
      });
      for (const element of scene.elements) {
        const defaults = element.authoringDefaults ?? {};
        if (defaults.fontSizePx == null) continue;
        if (String(element.classId).startsWith("secondaryRing.")) {
          // Rim labels are placed outward with leaders and angular collision
          // handling; a band thickness is not their limit and they report none.
          assert.equal(defaults.fontSizeCeilingPx, undefined, element.classId);
          continue;
        }
        if (defaults.fontSizeCeilingPx == null) continue;
        assert.ok(
          defaults.fontSizeCeilingPx >= defaults.fontSizePx - 1e-9,
          `${element.classId} @ ${profile}/${maxRadius}: ceiling `
          + `${defaults.fontSizeCeilingPx} below its own size ${defaults.fontSizePx}`,
        );
      }
    }
  }
});

test("the ceiling is scale-invariant, like the bands it comes from", () => {
  // Bands and authored sizes are both fractions of the wheel, so whether a
  // glyph has room cannot depend on how large the chart is drawn.
  const ceilings = new Map();
  for (const maxRadius of [400, 300, 200, 150, 100]) {
    const scene = sceneApi.buildWheelStyleScene({
      style: wheel.DEFAULT_WHEEL_RENDER_STYLE,
      geometry: geometry("classic", "single", { maxRadius }),
    });
    for (const element of scene.elements) {
      const ceiling = element.authoringDefaults?.fontSizeCeilingPx;
      if (ceiling == null) continue;
      const seen = ceilings.get(element.classId);
      if (seen == null) ceilings.set(element.classId, ceiling);
      else {
        assert.ok(
          Math.abs(seen - ceiling) < 1e-6,
          `${element.classId}: ceiling ${ceiling} at ${maxRadius} != ${seen}`,
        );
      }
    }
  }
  assert.ok(ceilings.size > 0);
});

test("the term and decan content floors still hold", () => {
  // These two bands are the only ones the solver gives a glyph-sized minimum,
  // and they work. Adding the ceiling must not narrow them.
  const style = wheel.DEFAULT_WHEEL_RENDER_STYLE;
  for (const maxRadius of [400, 200, 100]) {
    const input = geometry("classic", "single", { maxRadius });
    const rings = wheel.resolveWheelRingSet(style, input);
    const metrics = wheel.resolveWheelTypographyMetrics(style, "classic", maxRadius);
    assert.ok(
      rings.r0 - rings.rDecans >= metrics.termSize - 1e-6,
      `term band ${rings.r0 - rings.rDecans} below its glyph ${metrics.termSize} at ${maxRadius}`,
    );
    assert.ok(
      rings.rDecans - rings.rInner >= metrics.decanSize - 1e-6,
      `decan band ${rings.rDecans - rings.rInner} below its glyph ${metrics.decanSize} at ${maxRadius}`,
    );
  }
});

test("each degree ruler is a selectable sub-band that owns its ticks", () => {
  // The ruler used to have no scene presence at all: it *was* its ticks, so
  // there was nothing to select and nothing to drag but tick length.
  const findRuler = (scene, classId) =>
    scene.elements.find(
      (element) => element.classId === classId && element.hitGeometry?.kind === "annulus",
    );
  const classic = sceneApi.buildWheelStyleScene({
    style: wheel.DEFAULT_WHEEL_RENDER_STYLE,
    geometry: geometry("classic", "comparison"),
  });

  for (const [classId, sign] of [["zodiac.tick.inner", 1], ["zodiac.tick.outer", -1]]) {
    const ruler = findRuler(classic, classId);
    assert.ok(ruler, `${classId} has no selectable band`);
    assert.equal(ruler.handles.length, 1, `${classId} needs one depth handle`);
    const binding = ruler.handles[0].binding;
    assert.equal(binding.property, "rulerDepth");
    // Percent of its band, matching the flat channel and the inspector row.
    assert.ok(
      Math.abs(binding.value - 20) < 1e-6,
      `${classId} default depth should be 20% of its band, got ${binding.value}`,
    );
    // The outer ruler hangs inward, so its depth grows as its radius falls.
    assert.ok(
      Math.sign(binding.valuePerPixel) === sign,
      `${classId} drag direction is inverted`,
    );
    // Its ticks hang off it, so a click can read the ruler and a double-click
    // can descend to one tick group.
    const prefix = `${classId}.`;
    const ticks = classic.elements.filter(
      (element) => typeof element.classId === "string" && element.classId.startsWith(prefix),
    );
    assert.equal(ticks.length, 3, `${classId} should own three tick groups`);
    for (const tick of ticks) {
      assert.equal(tick.parentId, ruler.id, `${tick.classId} is not parented to its ruler`);
    }
  }

  // Anglo places the outer ruler on the outer ring — outside the zodiac band
  // and inside the margin, which is therefore its host. This is the only degree
  // ruler anglo draws (`!isAngloWheel` gates the inner one), so it must be
  // sizable or the whole profile has nothing to size.
  const anglo = sceneApi.buildWheelStyleScene({
    style: wheel.DEFAULT_WHEEL_RENDER_STYLE,
    geometry: geometry("anglo", "comparison"),
  });
  const angloOuter = findRuler(anglo, "zodiac.tick.outer");
  assert.ok(angloOuter, "anglo still shows its outer ruler");
  assert.equal(
    angloOuter.handles.length,
    1,
    "anglo's only degree ruler must offer a depth handle",
  );
  assert.equal(angloOuter.handles[0].binding.property, "rulerDepth");
});

test("the House Wheel scene offers exactly the elements it paints", () => {
  // The Style Lab can only style what the scene lists. A layout that resolves
  // to a profile the scene never branches for gets an empty or wrong element
  // set, and every control on it silently does nothing — which is how the House
  // Wheel shipped unstyleable. Anglo is the baseline because the House Wheel is
  // its ring stack with the zodiac band removed.
  const houses = sceneApi.buildWheelStyleScene({
    style: wheel.DEFAULT_WHEEL_RENDER_STYLE,
    geometry: geometry("houses", "single"),
  });
  const anglo = sceneApi.buildWheelStyleScene({
    style: wheel.DEFAULT_WHEEL_RENDER_STYLE,
    geometry: geometry("anglo", "single"),
  });
  const classIds = (scene) =>
    new Set(
      scene.elements
        .filter(
          (element) =>
            !element.stateTags.includes("manifest-applicability:not-applicable"),
        )
        .map((element) => element.classId),
    );
  const housesClasses = classIds(houses);
  const angloClasses = classIds(anglo);

  // Everything the House Wheel actually draws must be selectable. The cusp band
  // is the whole point of the layout: it is where its zodiac is printed.
  for (const classId of [
    "canvas.background",
    "fills.cuspDegreeBand",
    "rings.angloCuspOuter",
    "houses.inner.position.degree",
    "houses.inner.position.sign",
    "houses.inner.position.minute",
    "houses.inner.cusp",
  ]) {
    assert.ok(housesClasses.has(classId), `House Wheel must expose ${classId}`);
  }

  // And nothing it does not draw: no zodiac band, no ruler, no subdivisions.
  for (const classId of [
    "zodiac.signGlyph",
    "zodiac.tick.angloCuspRuler.1deg",
    "zodiac.tick.angloCuspRuler.5deg",
    "zodiac.tick.angloCuspRuler.10deg",
    "subdivisions.term.glyph",
    "subdivisions.decan.glyph",
  ]) {
    assert.ok(!housesClasses.has(classId), `House Wheel must not expose ${classId}`);
  }

  // The House Wheel must not be a stripped-down scene by accident: apart from
  // the zodiac band and everything seated in it, it owns Anglo's classes.
  const ZODIAC_BAND_ONLY = new Set([
    "fills.zodiacBand",
    "fills.zodiacElementSlices",
    "fills.termBand",
    "fills.decanBand",
    "rings.zodiacInner",
    "rings.term",
  ]);
  const missing = [...angloClasses].filter(
    (classId) =>
      !housesClasses.has(classId)
      && !classId.startsWith("zodiac.")
      && !classId.startsWith("subdivisions.")
      && !ZODIAC_BAND_ONLY.has(classId),
  );
  assert.deepEqual(missing, [], "House Wheel is missing Anglo structural classes");
});

test("the Cusp Wheel scene exposes the same radial authoring surface independently", () => {
  const houses = sceneApi.buildWheelStyleScene({
    style: wheel.DEFAULT_WHEEL_RENDER_STYLE,
    geometry: geometry("houses", "single"),
  });
  const cusps = sceneApi.buildWheelStyleScene({
    style: wheel.DEFAULT_WHEEL_RENDER_STYLE,
    geometry: geometry("cusps", "single"),
  });
  const applicableClasses = (scene) => scene.elements
    .filter((element) => !element.stateTags.includes("manifest-applicability:not-applicable"))
    .map((element) => element.classId)
    .sort();

  assert.deepEqual(applicableClasses(cusps), applicableClasses(houses));
  assert.ok(cusps.elements.every((element) => element.stateTags.includes("profile:cusps")));
});

test('composition exposes radius controls alongside stable widths', () => {
  const composition = {schemaVersion: 1, customized: true, projection: 'zodiac', rings:
    ['decans','terms','cuspLabels','bodies','houses','hub'].map(archetypeId => ({
      instanceId: `cusps-${archetypeId}`, archetypeId, enabled: true, chartRole: 'primary',
    })),
  };
  const scene = sceneApi.buildWheelStyleScene({
    style: wheel.DEFAULT_WHEEL_RENDER_STYLE,
    geometry: geometry('cusps', 'single', {composition}),
  });
  const handle = scene.handles.find(h => h.binding?.semanticId.endsWith('cusps-terms.bandWidth'));
  assert.ok(handle);
  assert.ok(scene.handles.some(h => h.binding?.semanticId.endsWith('.radius')));
  const distance = 4;
  const radians = handle.angleDegrees * Math.PI / 180;
  const patch = sceneApi.resolveWheelStyleHandleDrag(handle, {
    start: handle.position,
    current: [handle.position[0] + Math.cos(radians) * distance,
      handle.position[1] + Math.sin(radians) * distance],
  });
  assert.equal(patch.semanticId, 'authoring.wheel.cusps.canvas.ring.cusps-terms.bandWidth');
  assert.ok(patch.value < handle.binding.value);
});

test('the Anglo cusp ruler exposes its whole band and retains its width handle', async () => {
  const {WHEEL_FACTORY_SETTINGS} = await import(compositionModuleUrl);
  const composition = WHEEL_FACTORY_SETTINGS.layouts.anglo.composition;
  const scene = sceneApi.buildWheelStyleScene({
    style: wheel.DEFAULT_WHEEL_RENDER_STYLE,
    geometry: geometry('anglo', 'single', {composition}),
  });
  const instance = composition.rings.find(ring => ring.archetypeId === 'cuspRuler');
  const band = scene.elements.find(element => element.id === `wheel.composition.${instance.instanceId}`);
  assert.ok(band);
  assert.equal(band.hitGeometry.kind, 'annulus');
  assert.equal(band.hitGeometry.outerRadius, scene.rings.rCuspOuter);
  assert.equal(band.hitGeometry.innerRadius, scene.rings.rCuspLabelOuter);
  assert.equal(band.handles.length, 1);
  assert.equal(band.handles[0].binding.semanticId,
    `authoring.wheel.anglo.canvas.ring.${instance.instanceId}.bandWidth`);
  // Blank parts of the ruler select its band; individual painted marks retain
  // their higher-priority style targets.
  let foundBand = false;
  for (let offset = 0; offset < 360 && !foundBand; offset += 0.5) {
    for (const fraction of [0.25, 0.5, 0.75]) {
      const radius = band.hitGeometry.innerRadius
        + (band.hitGeometry.outerRadius - band.hitGeometry.innerRadius) * fraction;
      const angle = offset * Math.PI / 180;
      const hit = sceneApi.hitTestWheelStyleScene(scene,
        scene.center[0] + radius * Math.cos(angle), scene.center[1] + radius * Math.sin(angle));
      if (hit?.element.id === band.id) { foundBand = true; break; }
    }
  }
  assert.ok(foundBand, 'the ruler must have a reachable band surface');
});

test('a Cusp ruler touching Signs has matching scene ticks and an inward-facing width handle', async () => {
  const {WHEEL_FACTORY_SETTINGS} = await import(compositionModuleUrl);
  for (const outside of [false, true]) {
    const composition = structuredClone(WHEEL_FACTORY_SETTINGS.layouts.anglo.composition);
    const cusp = composition.rings.splice(composition.rings.findIndex(r => r.archetypeId === 'cuspRuler'), 1)[0];
    const signs = composition.rings.findIndex(r => r.archetypeId === 'zodiac');
    composition.rings.splice(signs + Number(!outside), 0, cusp);
    const scene = sceneApi.buildWheelStyleScene({style: wheel.DEFAULT_WHEEL_RENDER_STYLE,
      geometry: geometry('anglo', 'single', {composition})});
    const band = scene.elements.find(element => element.id === `wheel.composition.${cusp.instanceId}`);
    const signBand = scene.elements.find(element => element.id === 'wheel.composition.anglo-zodiac');
    assert.ok(band && signBand);
    assert.ok(band.hitGeometry.innerRadius >= signBand.hitGeometry.innerRadius);
    assert.ok(band.hitGeometry.outerRadius <= signBand.hitGeometry.outerRadius);
    assert.equal(band.handles[0].radius, outside ? band.hitGeometry.innerRadius : band.hitGeometry.outerRadius);
    assert.ok(outside ? band.handles[0].binding.valuePerPixel < 0
      : band.handles[0].binding.valuePerPixel > 0);
    assert.ok(!scene.elements.some(element => element.id === `wheel.composition.${cusp.instanceId}.boundary`));
    const ticks = scene.elements.find(element => element.id === 'wheel.zodiac.tick.angloCuspRuler.10deg');
    assert.ok(ticks?.hitGeometry.geometries.length);
    const segment = ticks.hitGeometry.geometries[0];
    const distance = point => Math.hypot(point[0] - scene.center[0], point[1] - scene.center[1]);
    assert.ok(outside ? distance(segment.end) < distance(segment.start)
      : distance(segment.end) > distance(segment.start));
  }
});

test('reordered ruler boundary targets match allocated lanes and omit hosted or disabled cusp circles', () => {
  for (const outside of [false, true]) {
    const composition = {schemaVersion: 1, customized: true, projection: 'zodiac', rings:
      [...(outside ? ['cuspRuler', 'zodiac'] : ['zodiac', 'cuspRuler']),
        'terms', 'degree', 'decans', 'cuspLabels', 'bodies', 'houses', 'hub'].map(archetypeId => ({
        instanceId: `anglo-${archetypeId}`, archetypeId,
        enabled: archetypeId !== 'cuspLabels', chartRole: 'primary',
      }))};
    const scene = sceneApi.buildWheelStyleScene({style: wheel.DEFAULT_WHEEL_RENDER_STYLE,
      geometry: geometry('anglo', 'single', {composition})});
    const boundaries = scene.elements.filter(element => element.id.endsWith('.boundary')
      && element.id.startsWith('wheel.composition.'));
    assert.deepEqual(boundaries.map(element => element.id).sort(),
      ['zodiac', 'terms', 'degree', 'decans', 'bodies', 'houses', 'hub']
        .map(kind => `wheel.composition.anglo-${kind}.boundary`).sort());
    assert.equal(new Set(boundaries.map(element => element.hitGeometry.radius)).size, 7);
    const hosted = scene.elements.find(element => element.id === 'wheel.composition.anglo-cuspRuler');
    assert.ok(hosted?.handles.some(handle => handle.binding.semanticId.endsWith('.bandWidth')));
  }
});

test('adjoining cusp ruler and annotations share a material rim while separate annotations retain their boundary', () => {
  for (const placement of ['adjoining', 'separate', 'reverse']) {
    const prefix = ['zodiac', 'terms', 'degree', 'decans'];
    const order = [...prefix, ...(placement === 'separate'
      ? ['cuspRuler', 'bodies', 'cuspLabels']
      : placement === 'reverse' ? ['cuspLabels', 'cuspRuler', 'bodies']
        : ['cuspRuler', 'cuspLabels', 'bodies']), 'houses', 'hub'];
    const composition = {schemaVersion: 1, customized: true, projection: 'zodiac', rings:
      order.map(archetypeId => ({instanceId: `anglo-${archetypeId}`, archetypeId, enabled: true, chartRole: 'primary'}))};
    const scene = sceneApi.buildWheelStyleScene({style: wheel.DEFAULT_WHEEL_RENDER_STYLE,
      geometry: geometry('anglo', 'single', {composition})});
    assert.equal(scene.elements.some(element => element.id === 'wheel.composition.anglo-cuspLabels.boundary'), placement !== 'adjoining');
    const rim = scene.elements.find(element => element.id === 'wheel.composition.anglo-cuspRuler.boundary');
    assert.equal(rim.classId, 'rings.angloCuspOuter');
    assert.equal(rim.hitGeometry.radius, scene.rings.rCuspOuter);
    assert.equal(rim.handles.find(handle => handle.binding.property === 'radius')?.binding.semanticId,
      'authoring.wheel.anglo.rings.angloCuspOuter.radius');
    const tick = scene.elements.find(element => element.id === 'wheel.zodiac.tick.angloCuspRuler.10deg')
      .hitGeometry.geometries[0];
    const distance = point => Math.hypot(point[0] - scene.center[0], point[1] - scene.center[1]);
    assert.ok(Math.abs(distance(tick.start) - rim.hitGeometry.radius) < 1e-7);
    assert.ok(distance(tick.end) < distance(tick.start));
    const degree = scene.elements.find(element => element.id === 'wheel.composition.anglo-degree.boundary');
    assert.equal(degree.classId, 'rings.innerDegree');
    assert.equal(degree.hitGeometry.radius, scene.rings.rDegreeOuter);
    assert.equal(degree.handles.find(handle => handle.binding.property === 'radius')?.binding.semanticId,
      'authoring.wheel.anglo.rings.innerDegree.radius');
    for (const kind of ['cuspRuler', 'cuspLabels']) {
      const band = scene.elements.find(element => element.id === `wheel.composition.anglo-${kind}`);
      assert.ok(band?.handles.some(handle => handle.binding.semanticId.endsWith('.bandWidth')),
        'both constituent bands remain independently editable');
    }
    if (placement !== 'adjoining') {
      const boundary = scene.elements.find(element => element.id === 'wheel.composition.anglo-cuspLabels.boundary');
      assert.equal(boundary.classId, 'rings.outerDegree');
      assert.equal(boundary.tokenBindings.find(binding => binding.property === 'radius')?.radiusTarget, 'cuspLabels');
    }
  }
});

test('composition cusp tick targets retain their material containment and direction when Degree and subdivisions toggle', () => {
  const orders = {
    allocated: ['degree', 'zodiac', 'terms', 'decans', 'cuspRuler', 'cuspLabels', 'bodies', 'houses', 'hub'],
    outside: ['cuspRuler', 'zodiac', 'terms', 'degree', 'decans', 'cuspLabels', 'bodies', 'houses', 'hub'],
    inside: ['zodiac', 'cuspRuler', 'terms', 'degree', 'decans', 'cuspLabels', 'bodies', 'houses', 'hub'],
  };
  for (const [placement, order] of Object.entries(orders)) for (const subdivisions of [true, false])
  for (const degreeEnabled of [true, false]) {
    const composition = {schemaVersion: 1, customized: true, projection: 'zodiac', rings:
      ['outerHouses', 'outerBodies', ...order].map(archetypeId => ({archetypeId,
        instanceId: `anglo-${archetypeId}`, chartRole: archetypeId.startsWith('outer') ? 'outer' : 'primary',
        enabled: archetypeId === 'degree' ? degreeEnabled
          : ['terms', 'decans'].includes(archetypeId) ? subdivisions : true}))};
    const scene = sceneApi.buildWheelStyleScene({style: wheel.DEFAULT_WHEEL_RENDER_STYLE,
      geometry: geometry('anglo', 'single', {composition, showTerms: subdivisions, showDecans: subdivisions}),
      hitRegions: [...Array.from({length: 12}, (_, index) => ({kind: 'house', chartRole: 'primary',
        house: index + 1, longitude: 3 + index * 30, x: 0, y: 0, r: 4})),
      ...['asc', 'mc'].map((angleId, index) => ({kind: 'angle', angleId, chartRole: 'primary',
        longitude: index * 90, x: 0, y: 0, r: 4}))]});
    const band = scene.elements.find(element => element.id === 'wheel.composition.anglo-cuspRuler').hitGeometry;
    const labels = scene.elements.find(element => element.id === 'wheel.composition.anglo-cuspLabels')?.hitGeometry;
    const materialInner = placement === 'allocated' && labels && Math.abs(labels.outerRadius - band.innerRadius) < 1e-7
      ? labels.innerRadius : band.innerRadius;
    const inward = placement !== 'inside';
    const context = `${placement}/subdivisions ${subdivisions}/Degree ${degreeEnabled}`;
    const ticks = scene.elements.filter(element => /^zodiac\.tick\.angloCuspRuler\./.test(element.classId))
      .flatMap(element => element.hitGeometry?.geometries ?? []);
    const houseTicks = scene.elements.find(element => element.classId === 'zodiac.tick.angloHouseCusp')
      .hitGeometry.geometries;
    const angleTicks = scene.elements.find(element => element.classId === 'zodiac.tick.angloAngleRuler')
      .hitGeometry.geometries;
    assert.equal(ticks.length, inward ? 360 : 348, context);
    assert.equal(houseTicks.length, 12, context);
    assert.equal(angleTicks.length, 2, context);
    const radius = point => Math.hypot(point[0] - scene.center[0], point[1] - scene.center[1]);
    const base = inward ? band.outerRadius : band.innerRadius;
    for (const tick of [...ticks, ...houseTicks, ...angleTicks]) {
      assert.ok(Math.abs(radius(tick.start) - base) < 1e-7, `${context}: target starts at own band edge`);
      assert.ok(inward ? radius(tick.end) < radius(tick.start) : radius(tick.end) > radius(tick.start), context);
      assert.ok(radius(tick.end) >= materialInner - 1e-7 && radius(tick.end) <= band.outerRadius + 1e-7,
        `${context}: target remains within contiguous Cusp material or its hosted instrument`);
    }
  }
});

test('raw historical cusp tick targets preserve their direction without a composition', () => {
  for (const subdivisions of [true, false]) {
    const scene = sceneApi.buildWheelStyleScene({style: wheel.DEFAULT_WHEEL_RENDER_STYLE,
      geometry: geometry('anglo', 'single', {showTerms: subdivisions, showDecans: subdivisions})});
    const ticks = scene.elements.filter(element => /^zodiac\.tick\.angloCuspRuler\./.test(element.classId))
      .flatMap(element => element.hitGeometry?.geometries ?? []);
    assert.equal(ticks.length, subdivisions ? 360 : 348);
    const radius = point => Math.hypot(point[0] - scene.center[0], point[1] - scene.center[1]);
    assert.ok(ticks.every(tick => subdivisions ? radius(tick.end) < radius(tick.start)
      : radius(tick.end) > radius(tick.start)));
  }
});

test('band boundaries do not steal nearby cusp text selection', async () => {
  const {WHEEL_FACTORY_SETTINGS} = await import(compositionModuleUrl);
  const composition = WHEEL_FACTORY_SETTINGS.layouts.anglo.composition;
  const input = geometry('anglo', 'single', {composition});
  const scene = sceneApi.buildWheelStyleScene({style: wheel.DEFAULT_WHEEL_RENDER_STYLE, geometry: input});
  const ruler = composition.rings.find(ring => ring.archetypeId === 'cuspRuler');
  const band = scene.elements.find(element => element.id === `wheel.composition.${ruler.instanceId}`);
  const x = scene.center[0] + band.hitGeometry.innerRadius;
  const y = scene.center[1];
  const withLabel = sceneApi.buildWheelStyleScene({style: wheel.DEFAULT_WHEEL_RENDER_STYLE, geometry: input,
    hitRegions: [{kind: 'style_target', classId: 'houses.inner.position.degree', itemId: 'cusp-label',
      styleOnly: true, shape: 'rect', x, y, r: 8, left: x - 8, top: y - 8, width: 16, height: 16, priority: 48}],
  });
  assert.equal(sceneApi.hitTestWheelStyleScene(withLabel, x, y)?.element.classId, 'houses.inner.position.degree');
});

test('a hidden Anglo cusp ruler has no selectable band, width handle, or house-cusp tick target', async () => {
  const {WHEEL_FACTORY_SETTINGS} = await import(compositionModuleUrl);
  const original = WHEEL_FACTORY_SETTINGS.layouts.anglo.composition;
  const composition = {...original, rings: original.rings.map(ring => ring.archetypeId === 'cuspRuler'
    ? {...ring, enabled: false} : ring)};
  const instance = composition.rings.find(ring => ring.archetypeId === 'cuspRuler');
  const scene = sceneApi.buildWheelStyleScene({style: wheel.DEFAULT_WHEEL_RENDER_STYLE,
    geometry: geometry('anglo', 'single', {composition}),
    hitRegions: [{kind: 'house', house: 2, longitude: 20, x: 400, y: 100, r: 10}],
  });
  assert.ok(!scene.elements.some(element => element.id === `wheel.composition.${instance.instanceId}`));
  assert.ok(!scene.handles.some(handle => handle.binding?.semanticId.includes(`.${instance.instanceId}.`)));
  assert.ok(!scene.elements.some(element => element.classId === 'zodiac.tick.angloHouseCusp' && element.hitGeometry));
});

test('enabled subdivisions on an untouched Cusp recipe remain selectable', async () => {
  const {WHEEL_FACTORY_SETTINGS} = await import(compositionModuleUrl);
  const original = WHEEL_FACTORY_SETTINGS.layouts.cusps.composition;
  const composition = {...original, rings: original.rings.map(ring => ['terms', 'decans'].includes(ring.archetypeId)
    ? {...ring, enabled: true} : ring)};
  assert.equal(composition.customized, false);
  const scene = sceneApi.buildWheelStyleScene({style: wheel.DEFAULT_WHEEL_RENDER_STYLE,
    geometry: geometry('cusps', 'single', {composition, showTerms: false, showDecans: false}),
  });
  for (const [kind, classId] of [['terms', 'fills.termBand'], ['decans', 'fills.decanBand']]) {
    const instance = composition.rings.find(ring => ring.archetypeId === kind);
    const band = scene.elements.find(element => element.id === `wheel.composition.${instance.instanceId}`);
    const fill = scene.elements.find(element => element.classId === classId && element.hitGeometry);
    assert.ok(band, `${kind} must retain its width target`);
    assert.ok(fill, `${kind} must retain its painted material target`);
    assert.deepEqual(fill.hitGeometry, band.hitGeometry);
    assert.ok(fill.hitGeometry.outerRadius > fill.hitGeometry.innerRadius);
  }
});

test('factory band handles preserve their starting width and use solved bounds at every scale', async () => {
  const {WHEEL_FACTORY_SETTINGS, WHEEL_RING_ARCHETYPES} = await import(compositionModuleUrl);
  const layoutModel = await import(layoutModelUrl);
  for (const profile of ['classic', 'compact', 'anglo', 'houses', 'cusps']) {
    const composition = WHEEL_FACTORY_SETTINGS.layouts[profile].composition;
    for (const mode of ['single', 'comparison']) {
      for (const maxRadius of [200, 400, 800]) {
        const input = geometry(profile, mode, {composition, maxRadius});
        const scene = sceneApi.buildWheelStyleScene({style: wheel.DEFAULT_WHEEL_RENDER_STYLE, geometry: input});
        const layout = layoutModel.resolveWheelBandLayout(wheel.DEFAULT_WHEEL_RENDER_STYLE, input, scene.rings);
        const scale = wheel.DEFAULT_WHEEL_RENDER_STYLE.authoringOverrides.referenceRadius / maxRadius;
        for (const handle of scene.handles.filter(item => item.binding?.semanticId.endsWith('.bandWidth'))) {
          const instanceId = handle.elementId.slice('wheel.composition.'.length);
          const band = layout.bands.find(item => item.instanceId === instanceId);
          assert.ok(band?.widthBounds, `${profile}/${mode}/${instanceId} must declare its editing bounds`);
          assert.equal(handle.binding.min, band.widthBounds.min * scale);
          assert.equal(handle.binding.max, Math.min(400, band.widthBounds.max * scale));
          const patch = sceneApi.resolveWheelStyleHandleDrag(handle, {start: handle.position, current: handle.position});
          assert.equal(patch.value, handle.binding.value,
            `${profile}/${mode}/${instanceId} must preserve the exact width without movement`);
          const angle = handle.angleDegrees * Math.PI / 180;
          const jitter = 0.01 / Math.abs(handle.binding.valuePerPixel);
          const tiny = sceneApi.resolveWheelStyleHandleDrag(handle, {start: handle.position,
            current: [handle.position[0] + Math.cos(angle) * jitter, handle.position[1] + Math.sin(angle) * jitter]});
          assert.equal(tiny.value, handle.binding.value,
            `${profile}/${mode}/${instanceId} must preserve the exact width below one fine step`);
          const instance = composition.rings.find(item => item.instanceId === instanceId);
          const minimum = WHEEL_RING_ARCHETYPES[instance.archetypeId].minWidth;
          assert.ok(handle.binding.value >= minimum - 1e-7, "factory widths must meet the shared semantic minimum");
        }
      }
    }
  }
});

test('an enabled original Anglo degree ruler has a width handle without reordering', async () => {
  const {WHEEL_FACTORY_SETTINGS} = await import(compositionModuleUrl);
  const composition = structuredClone(WHEEL_FACTORY_SETTINGS.layouts.anglo.composition);
  const degree = composition.rings.find(ring => ring.archetypeId === 'degree');
  degree.enabled = true;
  const scene = sceneApi.buildWheelStyleScene({style: wheel.DEFAULT_WHEEL_RENDER_STYLE,
    geometry: geometry('anglo', 'single', {composition}),
  });
  assert.ok(scene.handles.some(handle => handle.binding?.semanticId.includes(`.${degree.instanceId}.`)));
});

test('explicitly hosted cusp ruler keeps its controls without a phantom circle target', async () => {
  const {WHEEL_FACTORY_SETTINGS} = await import(compositionModuleUrl);
  for (const mode of ['single', 'comparison']) for (const hosted of [false, true]) {
    const composition = structuredClone(WHEEL_FACTORY_SETTINGS.layouts.anglo.composition);
    if (hosted) {
      for (const ring of composition.rings) {
        if (['terms', 'decans', 'cuspLabels'].includes(ring.archetypeId)) ring.enabled = false;
      }
      const ruler = composition.rings.splice(composition.rings.findIndex(ring => ring.archetypeId === 'cuspRuler'), 1)[0];
      composition.rings.splice(composition.rings.findIndex(ring => ring.archetypeId === 'zodiac') + 1, 0, ruler);
    }
    const scene = sceneApi.buildWheelStyleScene({style: wheel.DEFAULT_WHEEL_RENDER_STYLE,
      geometry: geometry('anglo', mode, {composition, showTerms: !hosted, showDecans: !hosted}),
    });
    assert.equal(scene.elements.some(element => element.id === sceneApi.WHEEL_STYLE_SCENE_ELEMENT_IDS.ringCuspOuter),
      !hosted, `${mode}: only a separate cusp band has its own circle`);
    assert.ok(scene.handles.some(handle => handle.binding?.semanticId.includes('.anglo-cuspRuler.')),
      `${mode}: the ruler width remains editable`);
    assert.ok(scene.elements.some(element => element.classId === 'zodiac.tick.angloCuspRuler.10deg'),
      `${mode}: the ruler ticks remain selectable`);
  }
});

test('open exterior cusp labels keep their band editor but have no phantom boundary target', () => {
  for (const profile of ['anglo', 'houses', 'cusps']) for (const outside of [false, true]) {
    for (const outerEnclosure of [false, true]) {
      const ids = outside ? ['cuspLabels', 'zodiac'] : ['zodiac', 'cuspLabels'];
      const composition = {schemaVersion: 1, customized: true, projection: profile === 'houses' ? 'houses' : 'zodiac',
        rings: ['outerBodies', 'outerHouses', ...ids, 'bodies', 'houses', 'hub'].map(archetypeId => ({
          archetypeId, instanceId: `test-${archetypeId}`, enabled: true,
          chartRole: archetypeId.startsWith('outer') ? 'outer' : 'primary',
        }))};
      const scene = sceneApi.buildWheelStyleScene({style: wheel.DEFAULT_WHEEL_RENDER_STYLE,
        geometry: geometry(profile, 'comparison', {composition, comparisonWithOuterHouses: outerEnclosure})});
      const id = 'wheel.composition.test-cuspLabels';
      assert.equal(scene.elements.some(e => e.id === `${id}.boundary`), !outside || outerEnclosure);
      assert.equal(scene.elements.find(e => e.id === id)?.hitGeometry.kind, 'annulus');
      assert.ok(scene.handles.some(h => h.id === `${id}.width`));
      assert.ok(scene.elements.some(e => e.id === 'wheel.composition.test-zodiac.boundary'));
    }
  }
});

test('band selection links existing material controls while width keeps its geometry owner', async () => {
  const {WHEEL_FACTORY_SETTINGS} = await import(compositionModuleUrl);
  const roles = {zodiac: 'fills.zodiacBand', terms: 'fills.termBand', decans: 'fills.decanBand',
    cuspRuler: 'fills.cuspDegreeBand', cuspLabels: 'fills.cuspDegreeBand', bodies: 'fills.glyphField', houses: 'fills.houseField'};
  for (const profile of ['classic', 'compact', 'anglo', 'houses', 'cusps']) {
    const composition = structuredClone(WHEEL_FACTORY_SETTINGS.layouts[profile].composition);
    const style = {...wheel.DEFAULT_WHEEL_RENDER_STYLE, authoringOverrides: {
      ...wheel.DEFAULT_WHEEL_RENDER_STYLE.authoringOverrides,
      fillPaint: {[profile]: Object.fromEntries(Object.values(roles).map(role => [role, {
        fillPattern: 'hatch', gradientType: 'linear', textureMask: 'crescent',
      }]))},
    }};
    const scene = sceneApi.buildWheelStyleScene({style, geometry: geometry(profile, 'single', {composition})});
    for (const [kind, role] of Object.entries(roles)) {
      const band = scene.elements.find(e => e.id === `wheel.composition.${profile}-${kind}`);
      if (!band) continue;
      assert.equal(band.appearanceClassId, role);
      const appearance = scene.elements.find(e => e.classId === band.appearanceClassId);
      assert.ok(appearance, `${profile}/${kind}: appearance target exists`);
      assert.equal(appearance.authoringDefaults.fillPattern, 'hatch');
      assert.equal(appearance.authoringDefaults.gradientType, 'linear');
      assert.equal(appearance.authoringDefaults.textureMask, 'crescent');
      assert.ok(band.authoringDefaults.bandWidthPx > 0);
      assert.equal(band.handles[0].binding.semanticId,
        `authoring.wheel.${profile}.canvas.ring.${profile}-${kind}.bandWidth`);
      // Blank band interiors still select the structural band, now carrying
      // the appearance link, rather than an unrelated line or background.
      const radius = (band.hitGeometry.innerRadius + band.hitGeometry.outerRadius) / 2;
      let reached = false;
      for (let angle = 0; angle < 360 && !reached; angle += 0.5) {
        const radians = angle * Math.PI / 180;
        reached = sceneApi.hitTestWheelStyleScene(scene, scene.center[0] + radius * Math.cos(radians),
          scene.center[1] + radius * Math.sin(radians))?.element.id === band.id;
      }
      assert.ok(reached, `${profile}/${kind}: clickable band exposes its materials`);
    }
    for (const e of scene.elements.filter(e => e.primitive === 'circle' || e.primitive === 'text')) {
      assert.equal(e.appearanceClassId, undefined, 'boundaries and glyphs keep independent selection');
    }
  }
});

test('cusp ruler gaps expose a continuous background at multiple sizes and widths', async () => {
  const {WHEEL_FACTORY_SETTINGS} = await import(compositionModuleUrl);
  const composition = WHEEL_FACTORY_SETTINGS.layouts.anglo.composition;
  for (const maxRadius of [180, 400, 800]) for (const width of [8, 20]) {
    const style = {...wheel.DEFAULT_WHEEL_RENDER_STYLE, authoringOverrides: {
      ...wheel.DEFAULT_WHEEL_RENDER_STYLE.authoringOverrides,
      ringWidths: {anglo: {'anglo-cuspRuler': width}},
    }};
    const scene = sceneApi.buildWheelStyleScene({style,
      geometry: geometry('anglo', 'single', {composition, maxRadius})});
    const band = scene.elements.find(e => e.id === 'wheel.composition.anglo-cuspRuler');
    const material = scene.elements.find(e => e.classId === band.appearanceClassId);
    assert.equal(band.appearanceClassId, 'fills.cuspDegreeBand');
    assert.equal(material.hitGeometry.outerRadius, scene.rings.rCuspOuter);
    assert.equal(material.hitGeometry.innerRadius, scene.rings.rInner);
    const radius = (band.hitGeometry.innerRadius + band.hitGeometry.outerRadius) / 2;
    for (const angle of [12.5, 42.5, 102.5, 192.5, 252.5, 312.5]) {
      const radians = angle * Math.PI / 180;
      assert.equal(sceneApi.hitTestWheelStyleScene(scene,
        scene.center[0] + radius * Math.cos(radians),
        scene.center[1] + radius * Math.sin(radians))?.element.id, band.id,
        `blank gap at ${angle}, radius ${maxRadius}, width ${width}`);
    }
    const tickElements = scene.elements.filter(e => e.id.startsWith('wheel.zodiac.tick.anglo')
      && e.hitGeometry?.kind === 'compound');
    assert.ok(tickElements.length > 0);
    assert.ok(tickElements.some(e => e.hitGeometry.geometries.some(g => {
      if (g.kind !== 'line') return false;
      return sceneApi.hitTestWheelStyleScene(scene,
        (g.start[0] + g.end[0]) / 2, (g.start[1] + g.end[1]) / 2)?.element.id === e.id;
    })), 'painted ticks remain selectable');
  }
});

test('tiny exterior cusp markers expose the same short radial segments in the editor', () => {
  const composition = {schemaVersion: 1, customized: true, projection: 'zodiac',
    rings: ['cuspLabels', 'zodiac', 'bodies', 'houses', 'hub'].map(archetypeId => ({
      archetypeId, instanceId: `tiny-${archetypeId}`, enabled: true, chartRole: 'primary',
    }))};
  const scene = sceneApi.buildWheelStyleScene({style: wheel.DEFAULT_WHEEL_RENDER_STYLE,
    geometry: geometry('anglo', 'single', {composition}),
    hitRegions: Array.from({length: 12}, (_, i) => ({kind: 'house', houseIndex: i + 1,
      longitude: i * 30, x: 400, y: 400, r: 10})),
  });
  const markers = scene.elements.find(element => element.classId === 'zodiac.tick.angloHouseCusp'
    && element.hitGeometry.kind === 'compound');
  assert.ok(markers);
  assert.equal(markers.hitGeometry.geometries.length, 12);
  for (const segment of markers.hitGeometry.geometries) {
    assert.ok(Math.hypot(segment.end[0] - segment.start[0], segment.end[1] - segment.start[1]) < 4);
  }
});

test("triplicity triangles follow uniform and element colors without changing their geometry", async () => {
  const palette = { signs: "uniform-sign", domicil: "dignity-green", elements: ["fire", "earth", "air", "water"] };
  const bounds = { x: 10, y: 20, w: 18, h: 24 };
  for (const [index, element] of ["fire", "earth", "air", "water"].entries()) {
    const facts = { minorDignityCount: 1, primaryTriplicityElement: element };
    const marker = (mode) => wheel.resolveMinorDignityDecoration(facts, bounds, 24,
      { font: "FreeSans", dignityColor: palette.domicil,
        triplicityColor: wheel.triplicityElementColor(element, palette, mode),
        measure: (_text, size) => [size * 0.6, size * 0.7] },
      { showDignityGlyphs: true }).markers[0];
    const uniform = marker(false), colored = marker(true);
    assert.equal(uniform.color, palette.signs);
    assert.equal(colored.color, palette.elements[index]);
    assert.equal(wheel.triplicityColorRole(element, false), "--morinus-signs");
    assert.equal(wheel.triplicityColorRole(element, true), `--morinus-element-${element}`);
    assert.deepEqual(uniform.bounds, colored.bounds);
  }
  for (const path of ["square-chart-view", "astrolabe-view", "astrolog-sphere-view", "mundane-chart-view"]) {
    const source = await readFile(new URL(`../src/components/workshell/${path}.tsx`, import.meta.url), "utf8");
    assert.match(source, /triplicityColorRole\([^,]+,\s*Boolean\(appearance\?\.useZodiacElementColors\)\)/, path);
  }
});

test("minor dignities use independent superscripts and a triplicity triangle without planet contours", async () => {
  const bounds = { x: 10, y: 20, w: 18, h: 24 };
  const facts = { minorDignityCount: 3, hasTermDignity: true, hasFaceDignity: true, primaryTriplicityElement: "fire" };
  const motionBounds = { x: 28, y: 35, w: 15, h: 9 };
  const markerStyle = { font: "FreeSans", triplicityColor: "fire-color", dignityColor: "dignity-green", motionBounds,
    measure: (text, size) => [size * 0.6, size * (text === "*" ? 0.3 : 0.7)] };
  const resolve = (options, body = facts) => wheel.resolveMinorDignityDecoration(body, bounds, 24, markerStyle, options);
  for (const showDignityGlyphs of [false, true]) for (const showTermGlyphs of [false, true]) for (const showFaceGlyphs of [false, true]) {
    const decoration = resolve({ showDignityGlyphs, showTermGlyphs, showFaceGlyphs });
    const expected = [...(showTermGlyphs ? ["*"] : []), ...(showFaceGlyphs ? ["𝑭"] : []), ...(showDignityGlyphs ? ["△"] : [])];
    assert.deepEqual(decoration?.markers.map(marker => marker.text) ?? [], expected);
    assert.equal(decoration?.outline, undefined);
  }
  const options = { showDignityGlyphs: true, showTermGlyphs: true, showFaceGlyphs: true };
  for (const dignity of ["casus", "exil", "domicil", "exal", "peregrin"]) {
    const decoration = resolve(options, { ...facts, dignity });
    const [term, face, triplicity] = decoration.markers;
    assert.equal(term.color, "dignity-green");
    assert.equal(face.color, "dignity-green");
    assert.equal(triplicity.color, "fire-color");
    assert.equal(term.weight, 700);
    assert.equal(face.font, "AriesDignityFace");
    assert.equal(face.weight, 400, "The mathematical glyph already carries its bold italic weight");
    assert.ok(term.bounds.h > bounds.h * 0.35, "The five-point asterisk remains visible at chart size");
    assert.ok(Math.abs(triplicity.strokeWidth / (triplicity.bounds.h - triplicity.strokeWidth) - 0.1) < 1e-8);
    assert.ok(face.bounds.x > term.bounds.x + term.bounds.w);
    assert.ok(term.bounds.y < bounds.y + bounds.h / 2 && face.bounds.y < bounds.y + bounds.h / 2);
    assert.ok(triplicity.bounds.x > motionBounds.x + motionBounds.w);
    for (const marker of decoration.markers) {
      assert.ok(decoration.bounds.x <= marker.bounds.x && decoration.bounds.y <= marker.bounds.y);
      assert.ok(decoration.bounds.x + decoration.bounds.w >= marker.bounds.x + marker.bounds.w);
      assert.ok(decoration.bounds.y + decoration.bounds.h >= marker.bounds.y + marker.bounds.h);
    }
  }
  assert.equal(resolve(options, { minorDignityCount: 0 }), undefined);
  assert.deepEqual(resolve(options, { ...facts, hasTermDignity: false, hasFaceDignity: false }).markers.map(marker => marker.text), ["△"]);
  for (const height of [14, 24, 48]) {
    const ink = { x: 12, y: 31, w: height * 0.7, h: height };
    const [term, face, triangle] = wheel.resolveMinorDignityDecoration(facts, ink, height, markerStyle, options).markers;
    assert.ok(Math.abs(term.bounds.y + term.bounds.h - face.bounds.y - face.bounds.h) < 1e-8,
      "Superscripts share an ink baseline despite different font bearings");
    for (const script of [term, face]) {
      assert.ok(script.bounds.x > ink.x + ink.w, "Superscripts clear the planet's visible ink");
      assert.ok(script.bounds.y >= ink.y - height * 0.15, "Superscripts stay attached to the upper right");
      assert.ok(script.bounds.y + script.bounds.h < ink.y + height / 2);
    }
    assert.ok(triangle.bounds.y > ink.y + height / 2, "The triangle sits at the lower right");
    assert.ok(triangle.bounds.y + triangle.bounds.h > ink.y + height, "The triangle straddles the ink bottom");
  }
  const js = ts.transpileModule(await readFile(new URL("../src/lib/chart/canvas-draw.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exported = {};
  new Function("require", "exports", js)(() => chartFonts, exported);
  const calls = [], stack = [];
  const ctx = { globalAlpha: 1, save() { stack.push({ ...this }); }, restore() { Object.assign(this, stack.pop()); },
    measureText() {
      assert.equal(this.textBaseline, "alphabetic", "Marker measurement must use the painting baseline");
      return { actualBoundingBoxAscent: 7, actualBoundingBoxLeft: -2 };
    },
    fillText(text, x, y) { calls.push({ kind: "fill", text, color: this.fillStyle, x, y, font: this.font }); },
    strokeText(text) { calls.push({ kind: "stroke", text, color: this.strokeStyle }); },
    arc() { throw new Error("Dignity annotations must not add rings"); } };
  new exported.CanvasDraw({ getContext: () => ctx }).text([10, 20], "G", {
    fill: "#cd5c5c", font: "AriesMorinus", size: 24, markers: resolve(options).markers,
  });
  assert.deepEqual(calls.filter(call => call.text === "G").map(({kind, text, color, x, y}) => ({kind, text, color, x, y})), [{ kind: "fill", text: "G", color: "#cd5c5c", x: 10, y: 20 }]);
  assert.deepEqual(calls.filter(call => call.kind === "fill").map(call => call.text), ["G", "*", "𝑭", "△"]);
  assert.match(calls.find(call => call.text === "*").font, /^normal 700 /);
  assert.match(calls.find(call => call.text === "𝑭").font, /^normal 400 \d+px AriesDignityFace$/);
  for (const inheritedBaseline of ["top", "middle", "alphabetic"]) {
    for (const marker of resolve(options).markers) {
      ctx.textBaseline = inheritedBaseline;
      exported.paintTextMarker(ctx, marker);
      const painted = calls.at(-1), pad = (marker.strokeWidth ?? 0) / 2;
      const ink = chartFonts.bundledGlyphInkBounds(marker.text, marker.font, marker.size, marker.weight);
      assert.ok(Math.abs(painted.x + ink.x - marker.bounds.x - pad) < 1e-8,
        "Marker ink starts at its measured left edge");
      assert.ok(Math.abs(painted.y + ink.y - marker.bounds.y - pad) < 1e-8,
        "Marker ink starts at its measured top, independent of inherited baseline");
      assert.equal(ctx.textBaseline, inheritedBaseline, "Marker painting restores the planet's baseline");
    }
  }
  let measurements = 0;
  ctx.measureText = function () {
    measurements++;
    const shift = this.textAlign === "center" ? 10 : 0;
    return { actualBoundingBoxLeft: 2 + shift, actualBoundingBoxRight: 18 - shift,
      actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 4 };
  };
  const draw = new exported.CanvasDraw({ getContext: () => ctx });
  const measureOptions = { font: "AriesMorinus", size: 31, baseline: "middle" };
  assert.deepEqual(draw.textbounds("centered-body-ink", measureOptions), { x: -2, y: -8, w: 20, h: 12 });
  assert.deepEqual(draw.textbounds("centered-body-ink", { ...measureOptions, align: "center" }), { x: -12, y: -8, w: 20, h: 12 });
  draw.textbounds("centered-body-ink", measureOptions);
  assert.equal(measurements, 2, "Ink-bound caching distinguishes centered and left-aligned planet paint");
});

test("WebKit's clamped asterisk descent cannot shrink dignity annotations", async () => {
  const js = ts.transpileModule(await readFile(new URL("../src/lib/chart/canvas-draw.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exported = {};
  new Function("require", "exports", js)(() => chartFonts, exported);
  const context = {
    save() {}, restore() {},
    measureText() {
      const size = Number(this.font.match(/(\d+)px/)[1]);
      // WebKit reports the asterisk from its cap top to the baseline, although
      // its ink ends well above it; its left/right boxes also include advance.
      return { width: size * 0.389, actualBoundingBoxLeft: 0,
        actualBoundingBoxRight: size * 0.389,
        actualBoundingBoxAscent: size * 0.729, actualBoundingBoxDescent: 0 };
    },
  };
  const draw = new exported.CanvasDraw({ getContext: () => context });
  const star = draw.textbounds("*", { font: "FreeSans", weight: 700, size: 40, baseline: "alphabetic" });
  assert.equal(star.h, 12.88, "Font outline ink excludes the empty space below the asterisk");
  assert.ok(Math.abs(star.w - 13.36) < 1e-8);
  assert.ok(Math.abs(star.x - 0.92) < 1e-8);
  const body = { x: 20, y: 30, w: 20.15625, h: 34.53125 };
  const markers = wheel.resolveMinorDignityDecoration(
    { minorDignityCount: 3, hasTermDignity: true, hasFaceDignity: true, primaryTriplicityElement: "earth" },
    body, 40,
    { font: "FreeSans", dignityColor: "green", triplicityColor: "earth",
      measure(text, size, font, weight) {
        const ink = draw.textbounds(text, { font, size, weight, baseline: "alphabetic" });
        return [ink.w, ink.h];
      } },
    { showDignityGlyphs: true, showTermGlyphs: true, showFaceGlyphs: true },
  ).markers;
  assert.ok(Math.abs(markers[0].bounds.h / body.h - 0.45) < 0.015);
  assert.ok(Math.abs(markers[1].bounds.h / body.h - 0.4) < 0.015);
  assert.ok(Math.abs((markers[2].bounds.h - markers[2].strokeWidth) / body.h - 0.4) < 0.015);
  assert.equal(chartFonts.bundledGlyphInkBounds("D", "CustomSymbols, AriesMorinus", 40), undefined,
    "Uploaded chart fonts retain their own measured outlines");
  assert.equal(chartFonts.bundledGlyphInkBounds("D", "AriesMorinus", 40, 700), undefined,
    "Synthetic chart weight retains the browser's actual measurement");
});

test('composed radius drags and numeric edits share solved values, limits, and thickness', async () => {
  const {WHEEL_FACTORY_SETTINGS} = await import(compositionModuleUrl);
  for (const profile of ['classic', 'compact', 'anglo', 'houses', 'cusps'])
  for (const mode of ['single', 'comparison'])
  for (const reordered of [false, true])
  for (const maxRadius of [200, 400, 800]) {
    const composition = structuredClone(WHEEL_FACTORY_SETTINGS.layouts[profile].composition);
    if (reordered) {
      const a = composition.rings.findIndex(ring => ring.archetypeId === 'bodies');
      const b = composition.rings.findIndex(ring => ring.archetypeId === 'houses');
      [composition.rings[a], composition.rings[b]] = [composition.rings[b], composition.rings[a]];
    }
    const input = geometry(profile, mode, {composition, maxRadius});
    const widthId = `authoring.wheel.${profile}.canvas.ring.${profile}-bodies.bandWidth`;
    const radiusId = `authoring.wheel.${profile}.rings.innerBoundary.radius`;
    const priorityId = `authoring.wheel.${profile}.canvas.chart.radiusPriority`;
    const overrides = {};
    const styleFor = patch => ({...wheel.DEFAULT_WHEEL_RENDER_STYLE,
      authoringOverrides: authoringAdapter.compileFlatWheelAuthoringOverrides(patch)});
    let scene = sceneApi.buildWheelStyleScene({style: styleFor(overrides), geometry: input});
    const width = scene.handles.find(handle => handle.binding?.semanticId === widthId);
    assert.ok(width);
    overrides[widthId] = width.binding.value + 2;
    for (const movement of [2, -1, 1, -2]) {
      scene = sceneApi.buildWheelStyleScene({style: styleFor(overrides), geometry: input});
      const handle = scene.handles.find(item => item.binding?.semanticId === radiusId);
      assert.ok(handle, `${profile}/${mode}/${reordered}: reachable diameter handle`);
      const element = scene.elements.find(item => item.id === handle.elementId);
      assert.equal(element.authoringDefaults.radiusPx, handle.binding.value);
      assert.equal(element.authoringDefaults.diameterPx, handle.binding.value * 2);
      assert.ok(handle.binding.value >= handle.binding.min - 1e-7 && handle.binding.value <= handle.binding.max + 1e-7);
      const touch = sceneApi.resolveWheelStyleHandleDrag(handle, {start: handle.position, current: handle.position});
      assert.equal(touch.value, handle.binding.value, 'grabbing a fractional diameter is an identity');
      const patch = sceneApi.resolveWheelStyleHandleDrag(handle, {start: handle.position,
        current: [handle.position[0] + movement / handle.binding.valuePerPixel, handle.position[1]]});
      assert.equal(patch.semanticId, radiusId);
      const numeric = {...overrides, [radiusId]: patch.value, [priorityId]: 'innerBoundaryRing'};
      const graphical = {...overrides, [patch.semanticId]: patch.value, [priorityId]: 'innerBoundaryRing'};
      const next = sceneApi.buildWheelStyleScene({style: styleFor(graphical), geometry: input});
      assert.deepEqual(next.rings, sceneApi.buildWheelStyleScene({style: styleFor(numeric), geometry: input}).rings);
      assert.ok(Math.abs(next.elements.find(item => item.classId === 'rings.innerBoundary')
        .authoringDefaults.radiusPx - patch.value) < 1e-7, `${profile}/${mode}/${reordered}/${maxRadius}/${movement}: the painted diameter must answer the drag (${patch.value} vs ${next.elements.find(item => item.classId === 'rings.innerBoundary').authoringDefaults.radiusPx})`);
      const nextWidth = next.handles.find(item => item.binding?.semanticId === widthId);
      assert.ok(Math.abs(nextWidth.binding.value - overrides[widthId]) < 1e-7, 'diameter preserves saved thickness');
      overrides[radiusId] = patch.value;
      overrides[priorityId] = 'innerBoundaryRing';
    }
  }
});

test('persisted edit priority keeps paint, scene, and released handles on the same wheel', async () => {
  const {WHEEL_FACTORY_SETTINGS} = await import(compositionModuleUrl);
  const overrides = {
    'authoring.wheel.anglo.rings.zodiacOuter.radius': 300,
    'authoring.wheel.anglo.rings.zodiacOuter.radiusAuthored': true,
    'authoring.wheel.anglo.rings.innerBoundary.radius': 320,
    'authoring.wheel.anglo.rings.innerBoundary.radiusAuthored': true,
    'authoring.wheel.anglo.canvas.chart.recipeVersion': 1,
    'authoring.wheel.anglo.canvas.chart.radiusPriority': 'innerBoundaryRing',
  };
  for (const mode of ['single', 'comparison']) {
    const composition = structuredClone(WHEEL_FACTORY_SETTINGS.layouts.anglo.composition);
    for (const ring of composition.rings) if (['terms', 'decans', 'houses'].includes(ring.archetypeId)) ring.enabled = true;
    const input = geometry('anglo', mode, {composition});
    const style = {...wheel.DEFAULT_WHEEL_RENDER_STYLE,
      authoringOverrides: authoringAdapter.compileFlatWheelAuthoringOverrides(overrides)};
    const scene = sceneApi.buildWheelStyleScene({style, geometry: input});
    assert.deepEqual(scene.rings, wheel.resolveWheelRingSet(style, input));
    if (mode === 'single') {
      assert.equal(scene.rings.r30, 379);
      assert.equal(scene.rings.rInner, 320);
    }
    const handle = scene.handles.find(item => item.binding?.semanticId === 'authoring.wheel.anglo.rings.innerBoundary.radius');
    assert.equal(handle.binding.value, scene.rings.rInner, mode);
    const priorStyle = {...style, authoringOverrides: {...style.authoringOverrides, radiusPriority: {}}};
    assert.ok(scene.rings.rInner > wheel.resolveWheelRingSet(priorStyle, input).rInner, mode);
    const touched = sceneApi.resolveWheelStyleHandleDrag(handle, {start: handle.position, current: handle.position});
    assert.equal(touched.value, handle.binding.value);
    const reloaded = sceneApi.buildWheelStyleScene({style: {...wheel.DEFAULT_WHEEL_RENDER_STYLE,
      authoringOverrides: authoringAdapter.compileFlatWheelAuthoringOverrides(JSON.parse(JSON.stringify(overrides)))}, geometry: input});
    assert.deepEqual(reloaded.rings, scene.rings);
    assert.equal(reloaded.handles.find(item => item.id === handle.id).binding.value, touched.value);
  }
});

test('every composed boundary handle reports its painted circle after width edits', async () => {
  const {WHEEL_FACTORY_SETTINGS} = await import(compositionModuleUrl);
  for (const profile of ['classic', 'compact', 'anglo', 'houses', 'cusps'])
  for (const mode of ['single', 'comparison']) {
    const composition = structuredClone(WHEEL_FACTORY_SETTINGS.layouts[profile].composition);
    const a = composition.rings.findIndex(ring => ring.archetypeId === 'bodies');
    const b = composition.rings.findIndex(ring => ring.archetypeId === 'houses');
    [composition.rings[a], composition.rings[b]] = [composition.rings[b], composition.rings[a]];
    const style = {...wheel.DEFAULT_WHEEL_RENDER_STYLE, authoringOverrides: {
      ...wheel.DEFAULT_WHEEL_RENDER_STYLE.authoringOverrides,
      ringWidths: {[profile]: {[`${profile}-bodies`]: 60}},
    }};
    const scene = sceneApi.buildWheelStyleScene({style, geometry: geometry(profile, mode, {composition})});
    for (const handle of scene.handles.filter(item => item.binding?.semanticId.endsWith('.radius'))) {
      const element = scene.elements.find(item => item.id === handle.elementId);
      assert.ok(Math.abs(handle.radius - element.authoringDefaults.radiusPx) < 1e-7,
        `${profile}/${mode}/${element.classId}: handle must sit on its own painted circle`);
      assert.ok(handle.binding.value >= handle.binding.min - 1e-7 && handle.binding.value <= handle.binding.max + 1e-7);
    }
  }
});

test('outer-degree handle limits follow the displayed target when its legacy binding changes', async () => {
  const {WHEEL_FACTORY_SETTINGS, moveWheelRing} = await import(compositionModuleUrl);
  const composition = structuredClone(WHEEL_FACTORY_SETTINGS.layouts.anglo.composition);
  for (const ring of composition.rings) if (['terms', 'decans', 'houses'].includes(ring.archetypeId)) ring.enabled = true;
  const reordered = moveWheelRing(composition, 'anglo-cuspLabels', 'anglo-terms');
  assert.ok(reordered);
  for (const maxRadius of [200, 400, 800])
  for (const [profile, input, previous, target] of [
    ['anglo', geometry('anglo', 'single', {composition: reordered, maxRadius}), 'degree', 'cuspLabels'],
    ['anglo', geometry('anglo', 'comparison', {maxRadius}), 'cuspLabels', 'degree'],
  ]) {
    const style = {...wheel.DEFAULT_WHEEL_RENDER_STYLE, authoringOverrides: {
      ...wheel.DEFAULT_WHEEL_RENDER_STYLE.authoringOverrides, outerDegreeBinding: {[profile]: previous},
    }};
    const scene = sceneApi.buildWheelStyleScene({style, geometry: input});
    const handle = scene.handles.find(item => item.binding?.semanticId === `authoring.wheel.${profile}.rings.outerDegree.radius`);
    assert.ok(handle, `${profile}/${maxRadius}: displayed boundary remains editable`);
    assert.equal(handle.binding.radiusTarget, target);
    const range = wheel.resolveWheelPaintedRingRadiusRange({...style,
      authoringOverrides: {...style.authoringOverrides, outerDegreeBinding: {[profile]: target}}}, input, 'outerDegreeRing');
    assert.ok(range);
    assert.ok(Math.abs(handle.binding.min - range.min * 400 / maxRadius) < 1e-8);
    assert.ok(Math.abs(handle.binding.max - range.max * 400 / maxRadius) < 1e-8);
    const patch = sceneApi.resolveWheelStyleHandleDrag(handle, {start: handle.position, current: handle.position});
    assert.equal(patch.radiusTarget, target);
    assert.equal(patch.value, handle.binding.value);
  }
});

test('the existing chart-ring span remains live with a factory composition', async () => {
  const {WHEEL_FACTORY_SETTINGS} = await import(compositionModuleUrl);
  const input = geometry('classic', 'single', {composition: WHEEL_FACTORY_SETTINGS.layouts.classic.composition});
  const scene = sceneApi.buildWheelStyleScene({style: wheel.DEFAULT_WHEEL_RENDER_STYLE, geometry: input});
  const span = scene.elements.find(element => element.classId === 'canvas.span.chartRing');
  const handle = span.handles.find(item => item.binding?.property === 'spanScale');
  assert.ok(handle);
  const authored = authoringAdapter.compileFlatWheelAuthoringOverrides({[handle.binding.semanticId]: 101});
  const result = sceneApi.buildWheelStyleScene({style: {...wheel.DEFAULT_WHEEL_RENDER_STYLE,
    authoringOverrides: authored}, geometry: input});
  assert.notEqual(result.rings.rInner, scene.rings.rInner);
});


test("subdivision ruler ink follows the shared Colors switch and explicit tokens", () => {
  const inherited = wheel.resolveWheelRenderStyleFromTokens();
  const overridden = wheel.resolveWheelRenderStyleFromTokens(key => ({
    "--aries-wheel-term-glyph-color": "#112233",
    "--aries-wheel-decan-glyph-color": "#445566",
  })[key]);
  for (const [kind, explicit] of [["term", "#112233"], ["decan", "#445566"]]) {
    for (const rulerColor of ["#ff0000", "#00ff00"]) {
      assert.equal(wheel.subdivisionGlyphColor(inherited, kind, rulerColor, true), rulerColor);
      assert.equal(wheel.subdivisionGlyphColor(inherited, kind, rulerColor, false), inherited.palette.signs);
      for (const enabled of [true, false]) {
        assert.equal(wheel.subdivisionGlyphColor(overridden, kind, rulerColor, enabled), explicit);
      }
    }
  }
});
