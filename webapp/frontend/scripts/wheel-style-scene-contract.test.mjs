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
  }).outputText;
}

function dataUrl(source) {
  return `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
}

const wheelJavascript = await transpile(
  new URL("../src/lib/chart/wheel-render-style.ts", import.meta.url),
);
const wheelUrl = dataUrl(wheelJavascript);
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
  .replaceAll('"./style-scene"', `"${genericSceneUrl}"`)
  .replaceAll('"./authoring-schema"', `"${authoringSchemaUrl}"`)
  .replaceAll('"./semantic-class-manifest"', `"${semanticManifestUrl}"`)
  .replaceAll('"./wheel-authoring-adapter"', `"${authoringAdapterUrl}"`);

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

test("bounded geometry tokens preserve the production default ring matrix", () => {
  assert.equal(Object.keys(wheel.WHEEL_RENDER_TOKEN_SPECS).length, 319);
  const tokenized = wheel.createTokenizedWheelRenderStyle();
  assert.deepEqual(tokenized.geometry, wheel.DEFAULT_WHEEL_RENDER_STYLE.geometry);
  for (const profile of ["classic", "compact", "anglo"]) {
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
  assert.equal(wheel.resolveWheelRingSet(custom, geometry()).r30, 340);
  assert.equal(
    wheel.resolveWheelRingSet(custom, geometry("compact", "single")).rAspAscMC,
    104,
  );
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
    { start: zodiacHandle.position, current: [zodiacHandle.position[0] + 20, zodiacHandle.position[1]] },
  );
  assert.deepEqual(patch, {
    semanticId: "authoring.wheel.classic.rings.zodiacOuter.radius",
    cssVar: "",
    value: zodiacRing.authoringDefaults.radiusPx + 20,
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
  assert.equal(semanticClassIds.size, 105);
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

  const wrongVariantAngleLabel = scene.elements.find(
    (element) => element.id === "wheel.manifest.angles.inner.label",
  );
  assert.ok(wrongVariantAngleLabel.stateTags.includes("manifest-not-applicable"));
  assert.equal(wrongVariantAngleLabel.editability.reason, "inactive-state");

  const unavailableOverlay = scene.elements.find(
    (element) => element.id === "wheel.manifest.chartOverlay.information.topLeft",
  );
  assert.ok(unavailableOverlay.stateTags.includes("manifest-not-applicable"));
  assert.deepEqual(unavailableOverlay.authoringDefaults, {});

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
  assert.equal(endpointMarker.authoringDefaults.strokeWidthPx, undefined);
  assert.ok(endpointMarker.authoringDefaults.opacityPercent > 0);
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
  for (const [id, classId, paletteRole] of [
    ["wheel.body.primary.fortune", "bodies.fortune", "chart.color.body.fortune"],
    ["wheel.body.primary.vertex", "bodies.vertex", "chart.color.peregrine"],
    ["wheel.body.primary.syzygy", "bodies.prenatalSyzygy", "chart.color.positions"],
  ]) {
    const point = scene.elements.find((item) => item.id === id);
    assert.equal(point.classId, classId);
    assert.equal(point.authoringDefaults.fontSizePx, undefined, id);
    assert.deepEqual(point.handles, [], id);
    assert.ok(point.paletteRoleIds.includes(paletteRole), `${id} palette`);
  }
  assert.equal(
    scene.handles.some((handle) => /bodies\.(?:fortune|vertex|prenatalSyzygy)\.fontSize$/.test(handle.binding?.semanticId ?? "")),
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
