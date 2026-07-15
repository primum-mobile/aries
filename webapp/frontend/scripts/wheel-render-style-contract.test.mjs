import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const wheelStyleSource = await readFile(
  new URL("../src/lib/chart/wheel-render-style.ts", import.meta.url),
  "utf8",
);
const wheelStyleJavascript = ts.transpileModule(wheelStyleSource, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const {
  DEFAULT_WHEEL_RENDER_STYLE,
  createWheelRenderStyle,
  resolveWheelRenderStyle,
  resolveWheelStrokeMetrics,
  resolveWheelTypographyMetrics,
} = await import(
  `data:text/javascript;base64,${Buffer.from(wheelStyleJavascript).toString("base64")}`
);

test("default wheel profile preserves classic, compact, and Anglo metrics", () => {
  const classic = resolveWheelTypographyMetrics(DEFAULT_WHEEL_RENDER_STYLE, "classic", 400);
  const compact = resolveWheelTypographyMetrics(DEFAULT_WHEEL_RENDER_STYLE, "compact", 400);
  const anglo = resolveWheelTypographyMetrics(DEFAULT_WHEEL_RENDER_STYLE, "anglo", 400);

  assert.deepEqual(classic, {
    bodySize: 25,
    outerSize: 25,
    signSize: 20,
    subdivisionSize: 400 / 24,
    angleLabelScale: 0.75,
    angleLabelWeight: 500,
    syzygyScale: 0.58,
  });
  assert.deepEqual(compact, classic);
  assert.deepEqual(anglo, {
    bodySize: 25,
    outerSize: 20,
    signSize: 16,
    subdivisionSize: 12.5,
    angleLabelScale: 0.75,
    angleLabelWeight: 500,
    syzygyScale: 0.58,
  });
});

test("default stroke profile preserves reference scaling and degree breakpoint", () => {
  assert.deepEqual(resolveWheelStrokeMetrics(DEFAULT_WHEEL_RENDER_STYLE, 600), {
    medium: 2,
    degreeTick: 1,
    ascMc: 4,
  });
  assert.deepEqual(resolveWheelStrokeMetrics(DEFAULT_WHEEL_RENDER_STYLE, 601), {
    medium: 2,
    degreeTick: 2,
    ascMc: 4,
  });
  assert.deepEqual(resolveWheelStrokeMetrics(DEFAULT_WHEEL_RENDER_STYLE, 720), {
    medium: 2,
    degreeTick: 2,
    ascMc: 5,
  });
});

test("render styles own an immutable snapshot of the dynamic palette", () => {
  const palette = {
    ...DEFAULT_WHEEL_RENDER_STYLE.palette,
    background: "dynamic-background",
    planets: [...DEFAULT_WHEEL_RENDER_STYLE.palette.planets],
    aspects: [...DEFAULT_WHEEL_RENDER_STYLE.palette.aspects],
  };
  const style = createWheelRenderStyle({
    palette,
    revision: 42,
    fontUi: "UI test",
    fontSymbols: "Symbol test",
  });

  palette.background = "mutated";
  palette.planets[0] = "mutated";
  assert.equal(style.schemaVersion, 1);
  assert.equal(style.revision, 42);
  assert.equal(style.palette.background, "dynamic-background");
  assert.notEqual(style.palette.planets[0], "mutated");
  assert.deepEqual(style.typography.families, { ui: "UI test", symbols: "Symbol test" });
  assert.ok(Object.isFrozen(style));
  assert.ok(Object.isFrozen(style.palette));
  assert.ok(Object.isFrozen(style.palette.planets));
  assert.ok(Object.isFrozen(style.typography));
});

test("legacy options and an explicit style resolve to equivalent contracts", () => {
  const palette = {
    ...DEFAULT_WHEEL_RENDER_STYLE.palette,
    planets: [...DEFAULT_WHEEL_RENDER_STYLE.palette.planets],
    aspects: [...DEFAULT_WHEEL_RENDER_STYLE.palette.aspects],
  };
  const legacy = resolveWheelRenderStyle({
    palette,
    styleRevision: 9,
    fontUi: "UI legacy",
    fontSymbols: "Symbols legacy",
  });
  const explicit = createWheelRenderStyle({
    palette,
    revision: 9,
    fontUi: "UI legacy",
    fontSymbols: "Symbols legacy",
  });

  assert.deepEqual(legacy, explicit);
  assert.strictEqual(resolveWheelRenderStyle({ renderStyle: explicit }), explicit);
});

test("ChartCanvas passes one memoized renderStyle to every draw and hit path", async () => {
  const source = await readFile(
    new URL("../src/components/workshell/chart-canvas.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /const renderStyle = useMemo\(/);
  assert.equal((source.match(/drawSnapshotLayer\(/g) ?? []).length, 3);
  assert.equal((source.match(/\n\s+renderStyle,\n/g) ?? []).length, 4);
  assert.doesNotMatch(source, /\n\s+palette,\n\s+renderStyle,/);
  assert.match(source, /computeHitRegions\([\s\S]*?renderStyle,/);
});

test("draw and hit paths resolve the shared metrics instead of private literals", async () => {
  const source = await readFile(
    new URL("../src/lib/chart/draw-chart.ts", import.meta.url),
    "utf8",
  );
  assert.equal((source.match(/resolveWheelTypographyMetrics\(/g) ?? []).length, 2);
  assert.match(source, /const style = resolveDrawStyle\(opts\)/);
  assert.match(source, /return resolveWheelRenderStyle\(opts\)/);
  assert.match(source, /const style = resolveWheelRenderStyle\(opts\)/);
  assert.match(source, /style\.outerLabels\.edgePadFactor/);
  assert.doesNotMatch(source, /hasAspectLayer/);
  assert.doesNotMatch(source, /renderVariant !== "round-compact"/);
  assert.doesNotMatch(source, /function chart(?:Outer)?SymbolSize/);
  assert.doesNotMatch(source, /const ANGLO_ANGLE_LABEL_(?:SCALE|WEIGHT)/);
});
