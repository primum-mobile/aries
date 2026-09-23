// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { compositionModuleUrl } from "./wheel-composition-test-loader.mjs";

const urls = new Map([["chart/wheel-composition", compositionModuleUrl]]);
async function moduleUrl(path, imports = {}) {
  let source = await readFile(new URL(`../src/lib/${path}.ts`, import.meta.url), "utf8");
  if (path === "chart/wheel-geometry-ownership") {
    const ownership = await readFile(new URL("../src/lib/chart/wheel-geometry-ownership.json", import.meta.url), "utf8");
    source = source.replace(/import ownership from [^;]+;/, `const ownership = ${ownership};`);
  }
  let javascript = ts.transpileModule(source, {
    compilerOptions: {module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022},
  }).outputText;
  javascript = javascript.replaceAll('"./wheel-composition"', `"${compositionModuleUrl}"`)
    .replaceAll('"../chart/wheel-composition"', `"${compositionModuleUrl}"`);
  for (const [specifier, dependency] of Object.entries(imports)) {
    javascript = javascript.replaceAll(`"${specifier}"`, `"${urls.get(dependency)}"`);
  }
  const url = `data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`;
  urls.set(path, url);
  return url;
}
await moduleUrl("style-lab/unit-projection");
await moduleUrl("style-lab/authoring-schema", {"./unit-projection": "style-lab/unit-projection"});
await moduleUrl("chart/wheel-layout-model", {"./wheel-composition": "chart/wheel-composition"});
const wheel = await import(await moduleUrl("chart/wheel-render-style", {"./wheel-layout-model": "chart/wheel-layout-model"}));
await moduleUrl("style-lab/wheel-authoring-adapter", {
  "../chart/wheel-render-style": "chart/wheel-render-style",
  "./authoring-schema": "style-lab/authoring-schema",
  "./unit-projection": "style-lab/unit-projection",
});
const ownership = await import(await moduleUrl("chart/wheel-geometry-ownership"));
const preset = await import(await moduleUrl("chart/wheel-geometry-preset", {
  "./wheel-render-style": "chart/wheel-render-style",
  "./wheel-geometry-ownership": "chart/wheel-geometry-ownership",
  "../style-lab/wheel-authoring-adapter": "style-lab/wheel-authoring-adapter",
}));

const profiles = ["classic", "compact", "anglo", "houses", "cusps"];
const factory = Object.fromEntries(profiles.map(profile => [profile, {id: `factory-${profile}`, revision: 1, overrides: {}}]));
const reader = values => key => values[key] ?? "";
const input = profile => ({profile, mode: "comparison", maxRadius: 400, hasOuterRing: true,
  showTerms: true, showDecans: true, showHouses: true, showPositions: true, comparisonWithOuterHouses: false});
const solve = (profile, values, overrides = {}, options = {}) => preset.resolveWheelGeometryPresetStyle(
  reader(values), {revision: "test"}, {profile, presets: factory, appearanceOverrides: overrides, ...options},
);

test("factory geometry is exact in every wheel after geometry-bearing theme changes", () => {
  const contaminated = Object.fromEntries(Object.values(ownership.WHEEL_GEOMETRY_LEGACY_TOKENS).map(css => [css, "0.42"]));
  contaminated["--aries-wheel-body-scale"] = "0.09";
  for (const profile of profiles) {
    const style = solve(profile, contaminated, {
      "authoring.wheel.base.canvas.chart.scale": 0.7,
      [`authoring.wheel.${profile}.rings.zodiacOuter.radius`]: 270,
      [`authoring.wheel.${profile}.canvas.ring.zodiac.bandWidth`]: 90,
      [`authoring.wheel.${profile}.bodies.inner.glyph.fontSize`]: 31,
    });
    assert.deepEqual(style.geometry, wheel.DEFAULT_WHEEL_RENDER_STYLE.geometry, profile);
    assert.deepEqual(style.ringRadiusOverrides, wheel.DEFAULT_WHEEL_RENDER_STYLE.ringRadiusOverrides, profile);
    assert.deepEqual(wheel.resolveWheelRingSet(style, input(profile)), wheel.resolveWheelRingSet(wheel.DEFAULT_WHEEL_RENDER_STYLE, input(profile)), profile);
    assert.equal(wheel.resolveWheelScale(style, profile), wheel.resolveWheelScale(wheel.DEFAULT_WHEEL_RENDER_STYLE, profile), profile);
    assert.equal(style.authoringOverrides.typography[profile]["bodies.inner.glyph"].fontSizePx, 31);
    assert.equal(style.typography.ratios.body, 0.09);
  }
});

test("custom geometry survives theme switches while appearance can change", () => {
  const presets = {...factory, anglo: {id: "custom", revision: 2, overrides: {
    "authoring.wheel.anglo.canvas.chart.scale": 0.85,
    "authoring.wheel.anglo.rings.zodiacOuter.radius": 345,
    "authoring.wheel.anglo.zodiac.signGlyph.fontSize": 80,
  }}};
  const first = solve("anglo", {"--aries-wheel-body-scale": "0.06"}, {}, {presets});
  const second = solve("anglo", {"--aries-wheel-body-scale": "0.09", "--aries-wheel-anglo-zodiac-single": "0.7"}, {}, {presets});
  assert.equal(wheel.resolveWheelScale(first, "anglo"), 0.85);
  assert.equal(first.authoringOverrides.ringRadii.anglo.zodiacOuterRing, 345);
  assert.deepEqual(wheel.resolveWheelRingSet(first, input("anglo")), wheel.resolveWheelRingSet(second, input("anglo")));
  assert.notEqual(first.typography.ratios.body, second.typography.ratios.body);
  assert.equal(first.authoringOverrides.typography.anglo?.["zodiac.signGlyph"], undefined, "preset cannot own appearance");
});

test("empty geometry draft resets saved dimensions and only previews its own wheel", () => {
  const presets = {...factory, anglo: {id: "custom", revision: 2, overrides: {"authoring.wheel.anglo.canvas.chart.scale": 0.8}}};
  const reset = solve("anglo", {}, {}, {presets, preview: {profile: "anglo", overrides: {}, dirty: true}});
  const other = solve("anglo", {}, {}, {presets, preview: {profile: "classic", overrides: {}}});
  assert.equal(wheel.resolveWheelScale(reset, "anglo"), wheel.resolveWheelScale(wheel.DEFAULT_WHEEL_RENDER_STYLE, "anglo"));
  assert.equal(wheel.resolveWheelScale(other, "anglo"), 0.8);
});

test("newer daemon geometry replaces a stale clean preview retained after closing the editor", () => {
  const key = "authoring.wheel.anglo.canvas.chart.scale";
  const preview = preset.assembleWheelGeometryPreview({
    geometryProfile: "anglo", geometryOverrides: {[key]: 0.8},
    syncedGeometryOverrides: {[key]: 0.8}, wheelPresetState: {revision: 4},
    revision: 20, gestureStart: null,
  });
  const presets = {...factory, anglo: {id: "new-selection", revision: 5, overrides: {[key]: 0.95}}};
  const style = solve("anglo", {}, {}, {presets, preview});
  assert.equal(preview.dirty, false);
  assert.equal(wheel.resolveWheelScale(style, "anglo"), 0.95);
  assert.match(style.revision, /draft-none$/);
  assert.equal(preset.resolveWheelPresetAuthoringOverrides({profile: "anglo", presets, preview})[key], 0.95,
    "editor scene uses the same canonical values");
});

test("pending local changes and an active gesture retain preview until revision reconciliation", () => {
  const key = "authoring.wheel.anglo.canvas.chart.scale";
  const presets = {...factory, anglo: {id: "remote", revision: 5, overrides: {[key]: 0.95}}};
  const state = {geometryProfile: "anglo", geometryOverrides: {},
    syncedGeometryOverrides: {[key]: 0.8}, wheelPresetState: {revision: 4},
    revision: 20, gestureStart: null};
  const pendingReset = preset.assembleWheelGeometryPreview(state);
  assert.equal(pendingReset.dirty, true, "deleting the last value remains a local edit");
  assert.equal(wheel.resolveWheelScale(solve("anglo", {}, {}, {presets, preview: pendingReset}), "anglo"),
    wheel.resolveWheelScale(wheel.DEFAULT_WHEEL_RENDER_STYLE, "anglo"));
  const dragging = preset.assembleWheelGeometryPreview({...state,
    geometryOverrides: {[key]: 0.8}, gestureStart: {[key]: 0.8}});
  assert.equal(dragging.dirty, false);
  assert.equal(wheel.resolveWheelScale(solve("anglo", {}, {}, {presets, preview: dragging}), "anglo"), 0.8);
});

test("theme snapshot wins over a clean parked preview after a metadata-only revision update", () => {
  const key = "authoring.wheel.anglo.canvas.chart.scale";
  // Settings can refresh the preset catalog without replacing the parked
  // editor's geometry. Both now report revision 5, but only the snapshot
  // contains the newly selected theme's dimensions.
  const preview = preset.assembleWheelGeometryPreview({
    geometryProfile: "anglo", geometryOverrides: {}, syncedGeometryOverrides: {},
    wheelPresetState: {revision: 5}, revision: 20, gestureStart: null,
  });
  const presets = {...factory, anglo: {id: "working.anglo", revision: 5,
    overrides: {[key]: 0.942016}}};
  assert.equal(wheel.resolveWheelScale(solve("anglo", {}, {}, {presets, preview}), "anglo"), 0.942016);
  assert.equal(preset.resolveWheelPresetAuthoringOverrides({profile: "anglo", presets, preview})[key], 0.942016);
});

test("acknowledged local geometry bridges an older retained chart snapshot", () => {
  const key = "authoring.wheel.anglo.canvas.chart.scale";
  const preview = preset.assembleWheelGeometryPreview({
    geometryProfile: "anglo", geometryOverrides: {[key]: 0.9},
    syncedGeometryOverrides: {[key]: 0.9}, wheelPresetState: {revision: 6},
    revision: 23, gestureStart: null,
  });
  const presets = {...factory, anglo: {id: "previous", revision: 5, overrides: {[key]: 0.8}}};
  assert.equal(preview.dirty, false);
  assert.equal(wheel.resolveWheelScale(solve("anglo", {}, {}, {presets, preview}), "anglo"), 0.9);
});

test("legacy geometry token presets apply through the existing bounded token resolver", () => {
  const presets = {...factory, classic: {id: "migrated", revision: 1, overrides: {"renderer.wheel.metric.classicTermSectorLength": 0.05}}};
  const migrated = solve("classic", {}, {}, {presets});
  assert.equal(migrated.geometry.classic.termSectorLength, 0.05);
});

test("snapshots without a preset map retain prior theme behavior", () => {
  const overrides = {"authoring.wheel.anglo.canvas.chart.scale": 0.82};
  const legacy = solve("anglo", {}, overrides, {presets: undefined});
  assert.equal(wheel.resolveWheelScale(legacy, "anglo"), 0.82);
  const missingEntry = solve("anglo", {}, overrides, {presets: {}});
  assert.equal(wheel.resolveWheelScale(missingEntry, "anglo"), wheel.resolveWheelScale(wheel.DEFAULT_WHEEL_RENDER_STYLE, "anglo"));
});

test("multiwheel uses the shared preset style and its overall scale while retaining its own band solver", async () => {
  const source = await readFile(new URL("../src/components/workshell/multiwheel-chart-canvas.tsx", import.meta.url), "utf8");
  assert.match(source, /resolveWheelGeometryPresetStyle\(/);
  assert.match(source, /side \* 0\.475 \* resolveWheelScale\(wheelRenderStyle, profile\)/);
  assert.match(source, /resolveMultiwheelLayout\(/);
  assert.match(source, /projectWheelAuthoringStyle\(wheelRenderStyle, layout\.maxRadius, profile\)/);
});

test("native geometry gestures wait for the visible preset; appearance gestures remain available", async () => {
  const source = await readFile(new URL("../src/components/workshell/chart-canvas.tsx", import.meta.url), "utf8");
  const start = source.indexOf("  const startStyleHandleDrag = (");
  const end = source.indexOf("  const endStyleHandleDrag =", start);
  assert.ok(start >= 0 && end > start);
  const javascript = ts.transpileModule(source.slice(start, end), {
    compilerOptions: {target: ts.ScriptTarget.ES2022},
  }).outputText;
  const makeHandler = new Function("env", `
    const {isWheelGeometryKey, useChartStyleEditorStore, styleSceneRef,
      stylePointFromClient, styleHandleDragRef, setActiveDragSemanticId,
      selectStyleElement, beginStyleGesture, CANVAS_GESTURE_OWNER} = env;
    ${javascript}
    return startStyleHandleDrag;
  `);
  for (const [semanticId, geometryProfile, geometryTransition, expected] of [
    ["authoring.wheel.anglo.canvas.chart.scale", "anglo", false, true],
    ["authoring.wheel.anglo.rings.zodiacOuter.radius", "classic", false, false],
    ["authoring.wheel.anglo.rings.zodiacOuter.radius", null, false, false],
    ["authoring.wheel.anglo.rings.zodiacOuter.radius", "anglo", true, false],
    ["authoring.wheel.anglo.bodies.inner.glyph.fontSize", "classic", true, true],
  ]) {
    const calls = [];
    const drag = {current: null};
    const handle = makeHandler({
      isWheelGeometryKey: ownership.isWheelGeometryKey,
      useChartStyleEditorStore: {getState: () => ({geometryProfile, geometryTransition})},
      styleSceneRef: {current: {profile: "anglo", elements: []}},
      stylePointFromClient: () => [1, 2], styleHandleDragRef: drag,
      setActiveDragSemanticId: () => {}, selectStyleElement: () => {},
      beginStyleGesture: () => calls.push("gesture"), CANVAS_GESTURE_OWNER: "canvas",
    });
    handle({clientX: 1, clientY: 2, pointerId: 1, preventDefault() {}, stopPropagation() {},
      currentTarget: {setPointerCapture: () => calls.push("capture")}},
    {binding: {semanticId}, editability: {state: "editable"}});
    assert.deepEqual(calls, expected ? ["capture", "gesture"] : [], semanticId);
    assert.equal(drag.current != null, expected, semanticId);
  }
});
