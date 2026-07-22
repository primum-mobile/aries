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

const projection = await import(projectionUrl);
const schema = await import(schemaUrl);
const wheel = await import(wheelUrl);
const adapter = await import(adapterUrl);

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
      "bodies.inner.glyph": { fontSize: schema.chartPx(24) },
      "subdivisions.term.glyph": { fontSize: schema.chartPx(14) },
      "rings.zodiacOuter": { radius: schema.chartPx(382) },
      "zodiac.tick.inner.1deg": {
        strokeWidth: schema.chartPx(0.75),
        strokeStyle: "dashed",
        dashLength: schema.chartPx(3),
        dashGap: schema.chartPx(2),
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
  assert.equal(compiled.typography.classic["bodies.inner.glyph"], 24);
  assert.equal(compiled.typography.compact["bodies.inner.glyph"], 24);
  assert.equal(compiled.typography.anglo["bodies.inner.glyph"], 20);
  assert.equal(compiled.typography.classic["subdivisions.term.glyph"], 14);
  assert.equal(compiled.ringRadii.classic.zodiacOuterRing, 382);
  assert.deepEqual(
    compiled.linePaint.classic["zodiac.tick.inner.1deg"],
    {
      strokeWidthPx: 0.75,
      strokeStyle: "dashed",
      dashOnPx: 3,
      dashOffPx: 2,
      opacity: 0.8,
    },
  );
  assert.equal(compiled.linePaint.classic["zodiac.tick.inner.5deg"], undefined);
});

test("flat authoring keys export shared base styles and sparse variant styles", () => {
  const flat = {
    "authoring.wheel.base.bodies.inner.glyph.fontSize": 23,
    "authoring.wheel.classic.bodies.inner.glyph.fontSize": 25,
    "authoring.wheel.base.houses.inner.cusp.strokeWidth": 1.25,
  };
  const profile = adapter.createChartStyleProfileV2FromFlatOverrides(flat);
  assert.deepEqual(profile.styles["bodies.inner.glyph"], {
    fontSize: { value: 23, unit: "px" },
  });
  assert.deepEqual(profile.styles["houses.inner.cusp"], {
    strokeWidth: { value: 1.25, unit: "px" },
  });
  assert.deepEqual(profile.variants.classic["bodies.inner.glyph"], {
    fontSize: { value: 25, unit: "px" },
  });
  assert.equal(profile.variants.compact["bodies.inner.glyph"], undefined);

  const compiled = adapter.compileFlatWheelAuthoringOverrides(flat);
  assert.equal(compiled.typography.classic["bodies.inner.glyph"], 25);
  assert.equal(compiled.typography.compact["bodies.inner.glyph"], 23);
  assert.equal(compiled.typography.anglo["bodies.inner.glyph"], 23);
  assert.equal(compiled.linePaint.classic["houses.inner.cusp"].strokeWidthPx, 1.25);
  assert.equal(compiled.linePaint.anglo["houses.inner.cusp"].strokeWidthPx, 1.25);
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
    { fontSizePx: 24 },
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
      opacityPercent: 80,
      lineCap: undefined,
      lineJoin: undefined,
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
      opacityPercent: 100,
      lineCap: undefined,
      lineJoin: undefined,
      radiusPx: 382,
      diameterPx: 764,
    },
  );
});
