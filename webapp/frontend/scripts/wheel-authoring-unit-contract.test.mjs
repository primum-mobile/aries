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

const projectionUrl = dataUrl(await transpile(
  new URL("../src/lib/style-lab/unit-projection.ts", import.meta.url),
));
let schemaJavascript = await transpile(
  new URL("../src/lib/style-lab/authoring-schema.ts", import.meta.url),
);
schemaJavascript = schemaJavascript.replaceAll('"./unit-projection"', `"${projectionUrl}"`);
const schemaUrl = dataUrl(schemaJavascript);
const wheelUrl = dataUrl(await transpile(
  new URL("../src/lib/chart/wheel-render-style.ts", import.meta.url),
));
let adapterJavascript = await transpile(
  new URL("../src/lib/style-lab/wheel-authoring-adapter.ts", import.meta.url),
);
adapterJavascript = adapterJavascript
  .replaceAll('"../chart/wheel-render-style"', `"${wheelUrl}"`)
  .replaceAll('"./authoring-schema"', `"${schemaUrl}"`)
  .replaceAll('"./unit-projection"', `"${projectionUrl}"`);
const adapterUrl = dataUrl(adapterJavascript);
const manifestUrl = dataUrl(await transpile(
  new URL("../src/lib/style-lab/semantic-class-manifest.ts", import.meta.url),
));

const projection = await import(projectionUrl);
const schema = await import(schemaUrl);
const wheel = await import(wheelUrl);
const adapter = await import(adapterUrl);
const manifest = await import(manifestUrl);

function geometry(maxRadius = 400, profile = "classic") {
  return {
    profile,
    mode: "single",
    maxRadius,
    hasOuterRing: false,
    showTerms: true,
    showDecans: true,
    showHouses: true,
    showPositions: true,
    comparisonWithOuterHouses: false,
  };
}

function profileV2() {
  return {
    $schema: "https://aries.sh/schemas/chart-style-v2.json",
    profileSchemaVersion: 2,
    classManifestVersion: "wheel-v2",
    base: { id: "aries-default", contentHash: "sha256:test" },
    referenceSpace: schema.CHART_AUTHORING_REFERENCE_SPACE,
    styles: {
      "bodies.inner.glyph": {
        fontRef: {
          role: "symbols",
          source: "asset",
          family: ["Aries Custom Symbols"],
          cssFamily: '"AriesFont_symbols_test"',
          style: "normal",
          weight: 500,
          assetId: "symbols-test",
          variationAxes: { wght: 500 },
        },
        fontSize: schema.chartPx(24),
        tracking: schema.chartPx(1.5),
        color: {
          colorSpace: "srgb",
          components: [10, 20, 30],
          alpha: 0.75,
        },
        opacity: 0.6,
      },
      "subdivisions.term.glyph": { fontSize: schema.chartPx(14) },
      "rings.zodiacOuter": { radius: schema.chartPx(382) },
      "zodiac.tick.inner.1deg": {
        strokeWidth: schema.chartPx(0.75),
        strokeStyle: "dashed",
        dashLength: schema.chartPx(3),
        dashGap: schema.chartPx(2),
        color: {
          colorSpace: "srgb",
          components: [40, 50, 60],
          alpha: 0.9,
        },
        opacity: 0.8,
      },
    },
    variants: {
      anglo: {
        "bodies.inner.glyph": { fontSize: schema.chartPx(20) },
      },
    },
  };
}

test("profile-v2 numeric metadata uses conventional editor units and bounded projection", () => {
  const stroke = schema.AUTHORING_NUMERIC_PROPERTIES.strokeWidth;
  assert.deepEqual(
    {
      unit: stroke.editorUnit,
      step: stroke.step,
      fine: stroke.fineStep,
      large: stroke.largeStep,
      soft: stroke.softBounds,
      hard: stroke.hardBounds,
    },
    {
      unit: "px",
      step: 0.25,
      fine: 0.05,
      large: 1,
      soft: { min: 0.25, max: 6 },
      hard: { min: 0, max: 16 },
    },
  );
  assert.equal(stroke.fromEditor(1.25, { wheelRadius: 200 }), 0.625);
  assert.equal(stroke.toEditor(0.625, { wheelRadius: 200 }), 1.25);
  assert.equal(stroke.fromEditor(900, { wheelRadius: 400 }), 16);
  assert.equal(schema.AUTHORING_NUMERIC_PROPERTIES.opacity.fromEditor(82), 0.82);
  assert.equal(schema.AUTHORING_NUMERIC_PROPERTIES.opacity.toEditor(0.82), 82);
  assert.equal(schema.AUTHORING_NUMERIC_PROPERTIES.hue.fromEditor(-15), 345);
});

test("normalized wheel source metrics declare unitless values and hide migration sentinels", () => {
  for (const key of [
    "classicDegreeTickLength",
    "classicOuterZodiac",
    "compactSinglePositionLane0",
    "angloZodiacSingle",
    "angloArrowInset",
    "angloArrowMaximum",
    "biwheelOuterMax",
    "classicZodiacOuterRingRadius",
    "compactBaseRingRadius",
    "angloHouseBoundaryRingRadius",
  ]) {
    assert.equal(wheel.WHEEL_RENDER_TOKEN_UNIT_OVERRIDES[key], "", key);
  }
  const internal = new Set(wheel.WHEEL_RENDER_INTERNAL_TOKEN_KEYS);
  assert.equal(internal.has("classicZodiacOuterRingRadius"), true);
  assert.equal(internal.has("compactBaseRingRadius"), true);
  assert.equal(internal.has("angloHouseBoundaryRingRadius"), true);
  assert.equal(internal.has("angloBodySignScale"), true);
  assert.equal(internal.has("classicDegreeTickLength"), false);
});

test("every advertised text and line class has a frontend Profile V2 compiler target", () => {
  const typography = new Set(wheel.WHEEL_AUTHORING_TYPOGRAPHY_CLASSES);
  const lines = new Set(wheel.WHEEL_AUTHORING_LINE_CLASSES);
  for (const definition of manifest.WHEEL_SEMANTIC_CLASS_MANIFEST) {
    if (definition.primitive === "text") {
      assert.equal(typography.has(definition.id), true, definition.id);
    }
    if (definition.primitive === "line" || definition.primitive === "circle") {
      assert.equal(lines.has(definition.id), true, definition.id);
    }
  }
});

test("circle radius is the one source authority and diameter is a linked projection", () => {
  const base = { radius: schema.chartPx(120), opacity: 1 };
  assert.equal(schema.circleSizeFromStyle(base, "radius"), 120);
  assert.equal(schema.circleSizeFromStyle(base, "diameter"), 240);
  const edited = schema.styleWithCircleSize(base, 300, "diameter");
  assert.deepEqual(edited.radius, { value: 150, unit: "px" });
  assert.equal(projection.clampRadiusToNeighbours(190, {
    innerRadius: 160,
    outerRadius: 180,
    minimumGap: 2,
  }), 178);
});

test("profile compiler preserves class granularity and sparse variant overrides", () => {
  const compiled = adapter.compileWheelAuthoringOverrides(profileV2());
  assert.equal(compiled.referenceRadius, 400);
  assert.deepEqual(compiled.typography.classic["bodies.inner.glyph"], {
    fontRef: {
      role: "symbols",
      source: "asset",
      family: ["Aries Custom Symbols"],
      cssFamily: '"AriesFont_symbols_test"',
      style: "normal",
      weight: 500,
      assetId: "symbols-test",
      variationAxes: { wght: 500 },
    },
    fontSizePx: 24,
    trackingPx: 1.5,
    color: "rgb(10 20 30 / 75%)",
    opacity: 0.6,
  });
  assert.equal(compiled.typography.compact["bodies.inner.glyph"].fontSizePx, 24);
  assert.equal(compiled.typography.anglo["bodies.inner.glyph"].fontSizePx, 20);
  assert.equal(
    compiled.typography.classic["subdivisions.term.glyph"].fontSizePx,
    14,
  );
  assert.equal(compiled.ringRadii.classic.zodiacOuterRing, 382);
  assert.deepEqual(
    compiled.linePaint.classic["zodiac.tick.inner.1deg"],
    {
      strokeWidthPx: 0.75,
      strokeStyle: "dashed",
      dashOnPx: 3,
      dashOffPx: 2,
      color: "rgb(40 50 60 / 90%)",
      opacity: 0.8,
    },
  );
  assert.equal(compiled.linePaint.classic["zodiac.tick.inner.5deg"], undefined);
});

test("flat authoring keys export shared base styles and sparse variant styles", () => {
  const fontRef = {
    role: "symbols",
    source: "bundled",
    family: ["AriesMorinus"],
    cssFamily: '"AriesMorinus"',
    style: "normal",
    weight: 400,
  };
  const flat = {
    "authoring.wheel.base.bodies.inner.glyph.fontRef": fontRef,
    "authoring.wheel.base.bodies.inner.glyph.fontSize": 23,
    "authoring.wheel.base.bodies.inner.glyph.tracking": 0.8,
    "authoring.wheel.base.bodies.inner.glyph.color": [90, 80, 70, 0.5],
    "authoring.wheel.base.bodies.inner.glyph.opacity": 75,
    "authoring.wheel.classic.bodies.inner.glyph.fontSize": 25,
    "authoring.wheel.base.houses.inner.cusp.strokeWidth": 1.25,
    "authoring.wheel.base.houses.inner.cusp.color": [12, 34, 56],
  };
  const profile = adapter.createChartStyleProfileV2FromFlatOverrides(flat);
  assert.deepEqual(profile.styles["bodies.inner.glyph"], {
    fontRef,
    fontSize: { value: 23, unit: "px" },
    tracking: { value: 0.8, unit: "px" },
    color: {
      colorSpace: "srgb",
      components: [90, 80, 70],
      alpha: 0.5,
    },
    opacity: 0.75,
  });
  assert.deepEqual(profile.styles["houses.inner.cusp"], {
    strokeWidth: { value: 1.25, unit: "px" },
    color: {
      colorSpace: "srgb",
      components: [12, 34, 56],
    },
  });
  assert.deepEqual(profile.variants.classic["bodies.inner.glyph"], {
    fontSize: { value: 25, unit: "px" },
  });
  assert.equal(profile.variants.compact["bodies.inner.glyph"], undefined);

  const compiled = adapter.compileFlatWheelAuthoringOverrides(flat);
  assert.equal(compiled.typography.classic["bodies.inner.glyph"].fontSizePx, 25);
  assert.equal(compiled.typography.compact["bodies.inner.glyph"].fontSizePx, 23);
  assert.equal(compiled.typography.anglo["bodies.inner.glyph"].fontSizePx, 23);
  assert.deepEqual(compiled.typography.compact["bodies.inner.glyph"], {
    fontRef,
    fontSizePx: 23,
    trackingPx: 0.8,
    color: "rgb(90 80 70 / 50%)",
    opacity: 0.75,
  });
  assert.equal(compiled.linePaint.classic["houses.inner.cusp"].strokeWidthPx, 1.25);
  assert.equal(compiled.linePaint.classic["houses.inner.cusp"].color, "rgb(12 34 56)");
  assert.equal(compiled.linePaint.anglo["houses.inner.cusp"].strokeWidthPx, 1.25);
});

test("portable font references require source-specific reload identities", () => {
  const key = "authoring.wheel.base.houses.inner.label.fontRef";
  const common = {
    role: "text",
    family: ["Example"],
    cssFamily: '"Example"',
    style: "normal",
    weight: 400,
  };
  for (const fontRef of [
    { ...common, source: "asset" },
    { ...common, source: "local" },
  ]) {
    const profile = adapter.createChartStyleProfileV2FromFlatOverrides({
      [key]: fontRef,
    });
    assert.equal(profile.styles["houses.inner.label"], undefined);
  }
  assert.deepEqual(
    adapter.createChartStyleProfileV2FromFlatOverrides({
      [key]: { ...common, source: "asset", assetId: "example-asset" },
    }).styles["houses.inner.label"]?.fontRef,
    { ...common, source: "asset", assetId: "example-asset" },
  );
  assert.deepEqual(
    adapter.createChartStyleProfileV2FromFlatOverrides({
      [key]: { ...common, source: "local", postscriptName: "Example-Regular" },
    }).styles["houses.inner.label"]?.fontRef,
    { ...common, source: "local", postscriptName: "Example-Regular" },
  );
});

test("retained fill classes compile independent colors and scale deterministic texture values", () => {
  const flat = {
    "authoring.wheel.base.fills.chartField.backgroundColor": [230, 232, 234],
    "authoring.wheel.base.fills.chartField.fillPattern": "paper",
    "authoring.wheel.base.fills.zodiacBand.fillPattern": "bayer4",
    "authoring.wheel.base.fills.zodiacBand.cellSize": 4,
    "authoring.wheel.base.fills.zodiacBand.dotSize": 1,
    "authoring.wheel.base.fills.zodiacBand.backgroundColor": [247, 247, 244, 0.8],
    "authoring.wheel.base.fills.zodiacBand.patternColor": [12, 34, 56, 0.75],
    "authoring.wheel.base.fills.zodiacBand.opacity": 28,
  };
  const compiled = adapter.compileFlatWheelAuthoringOverrides(flat);
  assert.deepEqual(compiled.fillPaint.classic["fills.chartField"], {
    fillPattern: "paper",
    backgroundColor: "rgb(230 232 234)",
  });
  assert.deepEqual(compiled.fillPaint.classic["fills.zodiacBand"], {
    fillPattern: "bayer4",
    cellSizePx: 4,
    dotSizePx: 1,
    backgroundColor: "rgb(247 247 244 / 80%)",
    patternColor: "rgb(12 34 56 / 75%)",
    opacity: 0.28,
  });
  const style = wheel.createTokenizedWheelRenderStyle({ authoringOverrides: compiled });
  const fill = wheel.resolveWheelFillPaint(style, "classic", "fills.zodiacBand", 200);
  assert.deepEqual(fill, {
    fillPattern: "bayer4",
    cellSizePx: 2,
    dotSizePx: 0.5,
    backgroundColor: "rgb(247 247 244 / 80%)",
    backgroundEnabled: true,
    patternColor: "rgb(12 34 56 / 75%)",
    gradientType: "none",
    gradientDirection: "fixed",
    gradientStartColor: "rgb(35,36,40)",
    gradientEndColor: "rgb(220,220,221)",
    gradientAngle: 0,
    textureMask: "none",
    maskDirection: "fixed",
    maskAngle: 0,
    maskAmount: 28,
    shadowPattern: "none",
    shadowColor: "transparent",
    shadowXpx: 3,
    shadowYpx: 3,
    shadowBlurPx: 0,
    opacity: 0.28,
    density: 50,
    angle: 45,
    seed: 0,
  });
});

test("solar gradients and crescents compile on every closed retained fill region", () => {
  const compiled = adapter.compileFlatWheelAuthoringOverrides({
    "authoring.wheel.base.fills.houseField.gradientType": "radial",
    "authoring.wheel.base.fills.houseField.gradientDirection": "sun",
    "authoring.wheel.base.fills.houseField.gradientStartColor": [250, 249, 241],
    "authoring.wheel.base.fills.houseField.gradientEndColor": [52, 56, 61, 0.8],
    "authoring.wheel.base.fills.houseField.gradientAngle": 12,
    "authoring.wheel.base.fills.houseField.textureMask": "crescent",
    "authoring.wheel.base.fills.houseField.maskDirection": "sun",
    "authoring.wheel.base.fills.houseField.maskAngle": -4,
    "authoring.wheel.base.fills.houseField.maskAmount": 31,
    "authoring.wheel.base.fills.houseField.shadowPattern": "newsprint",
    "authoring.wheel.base.fills.houseField.shadowColor": [21, 22, 24, 0.3],
    "authoring.wheel.base.fills.houseField.shadowX": 8,
    "authoring.wheel.base.fills.houseField.shadowY": 5,
    "authoring.wheel.base.fills.houseField.shadowBlur": 3,
  });
  const style = wheel.createTokenizedWheelRenderStyle({ authoringOverrides: compiled });
  const fill = wheel.resolveWheelFillPaint(style, "classic", "fills.houseField", 400);
  assert.equal(fill.gradientType, "radial");
  assert.equal(fill.gradientDirection, "sun");
  assert.equal(fill.gradientStartColor, "rgb(250 249 241)");
  assert.equal(fill.gradientEndColor, "rgb(52 56 61 / 80%)");
  assert.equal(fill.gradientAngle, 12);
  assert.equal(fill.textureMask, "crescent");
  assert.equal(fill.maskDirection, "sun");
  assert.equal(fill.maskAngle, -4);
  assert.equal(fill.maskAmount, 31);
  assert.equal(fill.shadowPattern, "newsprint");
  assert.equal(fill.shadowColor, "rgb(21 22 24 / 30%)");
  assert.equal(fill.shadowXpx, 8);
  assert.equal(fill.shadowYpx, 5);
  assert.equal(fill.shadowBlurPx, 3);
  assert.equal(wheel.wheelFillUsesSolarDirection(style, "classic"), true);
  assert.equal(
    wheel.wheelFillUsesSolarDirection(wheel.DEFAULT_WHEEL_RENDER_STYLE, "classic"),
    false,
  );
});

test("all retained texture algorithms remain portable profile values", () => {
  for (const fillPattern of [
    "none",
    "solid",
    "stipple",
    "bayer2",
    "bayer4",
    "bayer8",
    "noise",
    "blueNoise",
    "paper",
    "newsprint",
    "hatch",
    "crosshatch",
    "scanline",
    "atkinson",
    "floydSteinberg",
  ]) {
    const compiled = adapter.compileFlatWheelAuthoringOverrides({
      "authoring.wheel.base.fills.centerField.fillPattern": fillPattern,
    });
    assert.equal(compiled.fillPaint.classic["fills.centerField"].fillPattern, fillPattern);
  }
});

test("chart canvas background compiles as a retained material with deterministic controls", () => {
  const flat = {
    "authoring.wheel.base.canvas.background.fillPattern": "blueNoise",
    "authoring.wheel.base.canvas.background.backgroundColor": [247, 247, 244],
    "authoring.wheel.base.canvas.background.patternColor": [20, 24, 30, 0.7],
    "authoring.wheel.base.canvas.background.cellSize": 2.5,
    "authoring.wheel.base.canvas.background.dotSize": 0.55,
    "authoring.wheel.base.canvas.background.opacity": 18,
    "authoring.wheel.base.canvas.background.density": 28,
    "authoring.wheel.base.canvas.background.angle": 15,
    "authoring.wheel.base.canvas.background.seed": 119,
  };
  const compiled = adapter.compileFlatWheelAuthoringOverrides(flat);
  assert.deepEqual(compiled.fillPaint.classic["canvas.background"], {
    fillPattern: "blueNoise",
    cellSizePx: 2.5,
    dotSizePx: 0.55,
    backgroundColor: "rgb(247 247 244)",
    patternColor: "rgb(20 24 30 / 70%)",
    opacity: 0.18,
    density: 28,
    angle: 15,
    seed: 119,
  });
  const style = wheel.createTokenizedWheelRenderStyle({ authoringOverrides: compiled });
  assert.deepEqual(
    wheel.resolveWheelFillPaint(style, "classic", "canvas.background", 400),
    {
      fillPattern: "blueNoise",
      cellSizePx: 2.5,
      dotSizePx: 0.55,
      backgroundColor: "rgb(247 247 244)",
      backgroundEnabled: true,
      patternColor: "rgb(20 24 30 / 70%)",
      gradientType: "none",
      gradientDirection: "fixed",
      gradientStartColor: "rgb(35,36,40)",
      gradientEndColor: "rgb(220,220,221)",
      gradientAngle: 0,
      textureMask: "none",
      maskDirection: "fixed",
      maskAngle: 0,
      maskAmount: 28,
      shadowPattern: "none",
      shadowColor: "transparent",
      shadowXpx: 6,
      shadowYpx: 6,
      shadowBlurPx: 0,
      opacity: 0.18,
      density: 28,
      angle: 15,
      seed: 119,
    },
  );
});

test("primary and comparison aspect lines remain independently overwritable", () => {
  const compiled = adapter.compileFlatWheelAuthoringOverrides({
    "authoring.wheel.base.aspects.primary.line.strokeStyle": "solid",
    "authoring.wheel.base.aspects.primary.line.strokeWidth": 0.9,
    "authoring.wheel.base.aspects.interchart.line.strokeStyle": "dotted",
    "authoring.wheel.base.aspects.interchart.line.strokeWidth": 1.4,
  });
  const style = wheel.projectWheelAuthoringStyle(
    wheel.createTokenizedWheelRenderStyle({ authoringOverrides: compiled }),
    400,
    "classic",
  );
  const primary = wheel.resolveWheelLinePaint(
    style,
    "aspect",
    4,
    { dash: [8, 8] },
    "aspects.primary.line",
  );
  const comparison = wheel.resolveWheelLinePaint(
    style,
    "aspect",
    4,
    { dash: [8, 8] },
    "aspects.interchart.line",
  );
  assert.equal(primary.width, 0.9);
  assert.equal(primary.dash, undefined);
  assert.equal(comparison.width, 1.4);
  assert.deepEqual(comparison.dash, [0, 4]);
});

test("line caps and joins remain editable through Profile V2", () => {
  const compiled = adapter.compileFlatWheelAuthoringOverrides({
    "authoring.wheel.base.bodies.inner.leader.lineCap": "round",
    "authoring.wheel.base.bodies.inner.leader.lineJoin": "bevel",
  });
  assert.deepEqual(
    {
      lineCap: compiled.linePaint.classic["bodies.inner.leader"].lineCap,
      lineJoin: compiled.linePaint.classic["bodies.inner.leader"].lineJoin,
    },
    { lineCap: "round", lineJoin: "bevel" },
  );
  const style = wheel.projectWheelAuthoringStyle(
    wheel.createTokenizedWheelRenderStyle({ authoringOverrides: compiled }),
    400,
    "classic",
  );
  const paint = wheel.resolveWheelLinePaint(
    style,
    "bodyLeader",
    1,
    {},
    "bodies.inner.leader",
  );
  assert.equal(paint.lineCap, "round");
  assert.equal(paint.lineJoin, "bevel");
  assert.deepEqual(
    adapter.readWheelAuthoringClassDefaults(
      wheel.DEFAULT_WHEEL_RENDER_STYLE,
      "classic",
      "bodies.inner.leader",
    ),
    {
      strokeWidthPx: 2,
      strokeStyle: "solid",
      color: "rgb(220,220,221)",
      opacityPercent: 100,
      lineCap: "butt",
      lineJoin: "miter",
    },
  );
});

test("direct font, ring, stroke, and dash px scale without legacy width quantization", () => {
  const authoringOverrides = adapter.compileWheelAuthoringOverrides(profileV2());
  const style = wheel.createTokenizedWheelRenderStyle({ authoringOverrides });
  const projected = wheel.projectWheelAuthoringStyle(style, 200, "classic");

  const line = wheel.resolveWheelLinePaint(
    projected,
    "degreeTick",
    99,
    {},
    "zodiac.tick.inner.1deg",
  );
  assert.deepEqual(line, {
    width: 0.375,
    dash: [1.5, 1],
    fill: "rgb(40 50 60 / 90%)",
    outline: "rgb(40 50 60 / 90%)",
    opacity: 0.8,
    lineCap: undefined,
    lineJoin: undefined,
  });
  assert.equal(
    wheel.resolveWheelLinePaint(
      projected,
      "degreeTick",
      2,
      {},
      "zodiac.tick.inner.5deg",
    ).width,
    2,
  );

  const typography400 = wheel.resolveWheelTypographyMetrics(style, "classic", 400);
  const typography200 = wheel.resolveWheelTypographyMetrics(style, "classic", 200);
  assert.equal(typography400.bodySize, 24);
  assert.equal(typography400.termSize, 14);
  assert.equal(typography200.bodySize, 12);
  assert.equal(typography200.termSize, 7);
  assert.equal(
    wheel.resolveWheelTypographyMetrics(style, "anglo", 400).bodySize,
    20,
  );
  assert.deepEqual(
    wheel.resolveWheelTypographyPaint(
      projected,
      "classic",
      "bodies.inner.glyph",
      200,
      {
        font: "fallback",
        size: 99,
        color: "black",
      },
    ),
    {
      font: '"AriesFont_symbols_test"',
      size: 12,
      weight: 500,
      style: "normal",
      tracking: 0.75,
      color: "rgb(10 20 30 / 75%)",
      opacity: 0.6,
    },
  );

  assert.equal(wheel.resolveWheelPaintedRingRadius(style, geometry(400), "zodiacOuterRing"), 382);
  assert.equal(wheel.resolveWheelPaintedRingRadius(style, geometry(200), "zodiacOuterRing"), 191);
});

test("no profile-v2 override preserves exact production defaults", () => {
  assert.equal(
    wheel.projectWheelAuthoringStyle(
      wheel.DEFAULT_WHEEL_RENDER_STYLE,
      200,
      "anglo",
    ),
    wheel.DEFAULT_WHEEL_RENDER_STYLE,
  );
  assert.deepEqual(
    wheel.resolveWheelTypographyMetrics(
      wheel.createTokenizedWheelRenderStyle(),
      "classic",
      400,
    ),
    wheel.resolveWheelTypographyMetrics(
      wheel.DEFAULT_WHEEL_RENDER_STYLE,
      "classic",
      400,
    ),
  );
  assert.equal(
    wheel.resolveWheelLinePaint(wheel.DEFAULT_WHEEL_RENDER_STYLE, "houseCusp", 2).width,
    2,
  );
});

test("inspector defaults expose reference px, percent, and linked diameter", () => {
  const style = wheel.createTokenizedWheelRenderStyle({
    authoringOverrides: adapter.compileWheelAuthoringOverrides(profileV2()),
  });
  assert.deepEqual(
    adapter.readWheelAuthoringClassDefaults(
      style,
      "classic",
      "bodies.inner.glyph",
    ),
    {
      fontRef: {
        role: "symbols",
        source: "asset",
        family: ["Aries Custom Symbols"],
        cssFamily: '"AriesFont_symbols_test"',
        style: "normal",
        weight: 500,
        assetId: "symbols-test",
        variationAxes: { wght: 500 },
      },
      fontSizePx: 24,
      trackingPx: 1.5,
      color: "rgb(10 20 30 / 75%)",
      opacityPercent: 60,
    },
  );
  assert.deepEqual(
    adapter.readWheelAuthoringClassDefaults(
      style,
      "classic",
      "zodiac.tick.inner.1deg",
      { targetWheelRadius: 200 },
    ),
    {
      strokeWidthPx: 0.75,
      strokeStyle: "dashed",
      dashOnPx: 3,
      dashOffPx: 2,
      color: "rgb(40 50 60 / 90%)",
      opacityPercent: 80,
      lineCap: "butt",
      lineJoin: "miter",
    },
  );
  assert.deepEqual(
    adapter.readWheelAuthoringClassDefaults(
      style,
      "classic",
      "rings.zodiacOuter",
      { geometry: geometry(200) },
    ),
    {
      strokeWidthPx: 3,
      strokeStyle: "solid",
      color: "rgb(220,220,221)",
      opacityPercent: 100,
      lineCap: "butt",
      lineJoin: "miter",
      radiusPx: 382,
      diameterPx: 764,
    },
  );
});

test("unset Anglo inspector widths mirror the production draw fallbacks", () => {
  const hairlineClasses = [
    "rings.zodiacOuter",
    "rings.innerBoundary",
    "rings.base",
    "zodiac.spoke",
    "zodiac.tick.angloCuspRuler.10deg",
    "zodiac.tick.angloCuspRuler.5deg",
    "zodiac.tick.angloCuspRuler.1deg",
  ];
  for (const classId of hairlineClasses) {
    assert.equal(
      adapter.readWheelAuthoringClassDefaults(
        wheel.DEFAULT_WHEEL_RENDER_STYLE,
        "anglo",
        classId,
      ).strokeWidthPx,
      wheel.DEFAULT_WHEEL_RENDER_STYLE.strokes.hairline,
      classId,
    );
  }

  for (const classId of [
    "zodiac.tick.angloHouseCusp",
    "zodiac.tick.angloAngleRuler",
    "angles.inner.ray",
    "bodies.inner.leader",
  ]) {
    assert.equal(
      adapter.readWheelAuthoringClassDefaults(
        wheel.DEFAULT_WHEEL_RENDER_STYLE,
        "anglo",
        classId,
      ).strokeWidthPx,
      wheel.DEFAULT_WHEEL_RENDER_STYLE.strokes.angloStructural,
      classId,
    );
  }
});
