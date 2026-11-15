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
  javascript = javascript.replaceAll('"colorjs.io"', JSON.stringify(import.meta.resolve("colorjs.io")));
  javascript = javascript.replaceAll('"./wheel-composition"', `"${compositionModuleUrl}"`)
    .replaceAll('"../chart/wheel-composition"', `"${compositionModuleUrl}"`);
  for (const [specifier, dependency] of Object.entries(imports)) {
    javascript = javascript.replaceAll(`"${specifier}"`, `"${urls.get(dependency)}"`);
    javascript = javascript.replaceAll(`'${specifier}'`, `"${urls.get(dependency)}"`);
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
const appearance = await import(await moduleUrl('chart/wheel-preset-appearance', {
  './wheel-geometry-ownership': 'chart/wheel-geometry-ownership',
}));
await moduleUrl("chart/wheel-projection");
await moduleUrl("chart/chart-coordinates", {"./wheel-projection": "chart/wheel-projection"});
const preset = await import(await moduleUrl("chart/wheel-geometry-preset", {
  "./chart-coordinates": "chart/chart-coordinates",
  "./wheel-render-style": "chart/wheel-render-style",
  "./wheel-geometry-ownership": "chart/wheel-geometry-ownership",
  './wheel-preset-appearance': 'chart/wheel-preset-appearance',
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

test("Neo Tokyo recalls its published beta rings and keeps minutes clear through subdivision toggles", async () => {
  const shipping = JSON.parse(await readFile(new URL("../../daemon/shipping-style-profiles.json", import.meta.url), "utf8"));
  const theme = shipping["Neo Tokyo"];
  const design = theme.wheelGeometry.designs.anglo;
  const golden = JSON.parse(await readFile(new URL("./fixtures/neo-tokyo-beta11-rings.json", import.meta.url), "utf8"));
  const layout = await import(urls.get("chart/wheel-layout-model"));
  for (const maxRadius of [180, 400, 733.5]) {
    const scale = maxRadius / golden.referenceRadius;
    const selected = {anglo: {id: "neo-tokyo", revision: 1, overrides: design.overrides}};
    const style = wheel.projectWheelAuthoringStyle(preset.resolveWheelGeometryPresetStyle(
      () => "", {revision: "beta-recall"}, {profile: "anglo", presets: selected, appearanceOverrides: theme.authoringOverrides},
    ), maxRadius, "anglo");
    for (const [showTerms, showDecans] of [[true, true], [true, false], [false, true], [false, false], [true, true]]) {
      const composition = {...design.composition, rings: design.composition.rings.map(ring => ({...ring,
        enabled: ring.archetypeId === "terms" ? showTerms : ring.archetypeId === "decans" ? showDecans : ring.enabled}))};
      const geometry = {profile: "anglo", mode: "single", maxRadius, hasOuterRing: true, outerRingMode: "asteroids",
        showTerms, showDecans, showHouses: true, showPositions: true, comparisonWithOuterHouses: false, composition};
      const rings = wheel.resolveWheelRingSet(style, geometry);
      const released = (showTerms ? 0 : golden.rings.rTerms - golden.rings.rDecans)
        + (showDecans ? 0 : golden.rings.rDecans - golden.rings.rCuspOuter);
      const expected = showTerms && showDecans ? golden.rings : Object.fromEntries(
        ["rCuspOuter", "rCuspLabelOuter", "rCuspLabel", "rInner", "rPlanet", "rAsp", "rHouse", "rBase", "rHouseName", "rLLine"]
          .map(field => [field, golden.rings[field] + released]));
      for (const [field, radius] of Object.entries(expected)) assert.ok(Math.abs(rings[field] - radius * scale) < 1e-7,
        `${maxRadius}/${showTerms}/${showDecans}/${field}: ${rings[field]} != ${radius * scale}`);
      for (const field of ["r30", "r0", "rSign"]) assert.ok(Math.abs(rings[field] - golden.rings[field] * scale) < 1e-7,
        `${field}: subdivision visibility retains the published Signs dimensions and glyph placement`);
      const typography = wheel.resolveWheelTypographyMetrics(style, "anglo", maxRadius, geometry);
      const minute = rings.rPlanet - typography.layoutUnit * style.typography.ratios.angloBodyPosition.minuteRadiusOffset;
      assert.ok(minute - typography.angloBodyPosition.minuteSize / 2 > rings.rHouse,
        "the minute run retains the beta's clearance above the house circle");
      const bands = layout.resolveWheelBandLayout(style, geometry, rings).bands;
      const cusp = bands.find(band => band.id === "cuspRuler" && band.visible);
      assert.ok(cusp && !cusp.overlay && Math.abs(cusp.outer - cusp.inner
        - (golden.rings.rCuspOuter - golden.rings.rCuspLabelOuter) * scale) < 1e-7,
      "hidden subdivisions retain the published allocated Cusp dimension and attachment");
      for (const band of bands.filter(band => band.visible && !band.overlay && band.id !== "margin")) {
        assert.ok(band.outer - band.inner >= layout.wheelBandMinimumWidth(style, geometry, band) - 1e-7);
        assert.ok(Math.abs(band.widthBounds.min - layout.wheelBandMinimumWidth(style, geometry, band)) < 1e-7,
          "the editor advertises the same content floor as the renderer");
      }
      assert.deepEqual(wheel.resolveWheelRingSet(JSON.parse(JSON.stringify(style)), geometry), rings,
        "reloading the same stored values does not move the chart");
    }
  }
});

test("content floors remain readable and detached cusp annotations retain their full lane", async () => {
  const {wheelBandMinimumWidth} = await import(urls.get("chart/wheel-layout-model"));
  const geometry = {profile: "anglo", maxRadius: 400};
  const minimum = (style, id, input = geometry) => wheelBandMinimumWidth(style, input, {id, visible: true});
  const style = wheel.DEFAULT_WHEEL_RENDER_STYLE;
  assert.equal(minimum(style, "terms"), 12.5);
  assert.equal(minimum(style, "cuspLabels"), 10);
  const fonts = size => ({...style, authoringOverrides: {...style.authoringOverrides,
    typography: {anglo: {"subdivisions.term.glyph": {fontSizePx: size}, "houses.inner.position.degree": {fontSizePx: size}}}}});
  assert.equal(minimum(fonts(0.25), "terms"), 8);
  assert.equal(minimum(fonts(128), "terms"), 14);
  assert.equal(minimum(fonts(0.25), "cuspLabels"), 8);
  const composition = structuredClone((await import(compositionModuleUrl)).WHEEL_FACTORY_SETTINGS.layouts.anglo.composition);
  composition.rings.find(ring => ring.archetypeId === "cuspRuler").enabled = false;
  assert.equal(minimum(style, "cuspLabels", {...geometry, composition}), 18);
  composition.rings.find(ring => ring.archetypeId === "cuspRuler").enabled = true;
  const ruler = composition.rings.findIndex(ring => ring.archetypeId === "cuspRuler");
  const body = composition.rings.findIndex(ring => ring.archetypeId === "bodies");
  [composition.rings[ruler], composition.rings[body]] = [composition.rings[body], composition.rings[ruler]];
  assert.equal(minimum(style, "cuspLabels", {...geometry, composition}), 18);
});

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
  assert.equal(first.authoringOverrides.recipeRadii.anglo.zodiacOuterRing, 345);
  assert.deepEqual(wheel.resolveWheelRingSet(first, input("anglo")), wheel.resolveWheelRingSet(second, input("anglo")));
  assert.notEqual(first.typography.ratios.body, second.typography.ratios.body);
  assert.equal(first.authoringOverrides.typography.anglo?.["zodiac.signGlyph"], undefined, "preset cannot own appearance");
});

test("recipe memory and explicit radius intent belong to the same selected geometry receipt", () => {
  const prefix = "authoring.wheel.anglo.";
  const geometry = {
    [`${prefix}canvas.chart.recipeVersion`]: 1,
    [`${prefix}rings.zodiacOuter.recipeRadius`]: 345,
    [`${prefix}rings.zodiacOuter.radius`]: 360,
    [`${prefix}rings.zodiacOuter.radiusAuthored`]: true,
    [`${prefix}canvas.chart.radiusPriority`]: "zodiacOuterRing",
  };
  assert.deepEqual(ownership.wheelGeometryForLayout(geometry, "anglo"), geometry);
  assert.deepEqual(ownership.wheelAppearanceOverrides(geometry), {});
  const presets = {...factory, anglo: {id: "saved-recipe", revision: 3, overrides: geometry}};
  const style = solve("anglo", {}, {}, {presets});
  assert.deepEqual(style.authoringOverrides.recipeRadii.anglo, {zodiacOuterRing: 345});
  assert.deepEqual(style.authoringOverrides.ringRadii.anglo, {zodiacOuterRing: 360});
  const reset = solve("anglo", {}, {}, {presets, preview: {profile: "anglo", overrides: {}, dirty: true}});
  assert.deepEqual(reset.authoringOverrides.recipeRadii.anglo, {});
  assert.deepEqual(reset.authoringOverrides.ringRadii.anglo ?? {}, {});
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
    geometryProfile: "anglo", geometryOverrides: {[key]: 0.7}, syncedGeometryOverrides: {[key]: 0.7},
    wheelPresetState: {revision: 6}, revision: 20, gestureStart: null,
    wheelGeometryReceipts: {anglo: {presetId: "working.anglo", revision: 4,
      overrides: {[key]: 0.7}, composition: factoryComposition("anglo")}},
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
    wheelGeometryReceipts: {anglo: {presetId: "new-selection", revision: 6,
      overrides: {[key]: 0.9}, composition: factoryComposition("anglo")}},
    revision: 23, gestureStart: null,
  });
  const presets = {...factory, anglo: {id: "previous", revision: 5, overrides: {[key]: 0.8}}};
  assert.equal(preview.dirty, false);
  assert.equal(wheel.resolveWheelScale(solve("anglo", {}, {}, {presets, preview}), "anglo"), 0.9);
});

const {WHEEL_FACTORY_SETTINGS} = await import(compositionModuleUrl);
const factoryComposition = profile => structuredClone(WHEEL_FACTORY_SETTINGS.layouts[profile].composition);

test("pending topology and dimensions share one effective preview before and after acknowledgement", async () => {
  const {WHEEL_FACTORY_SETTINGS, moveWheelRing} = await import(compositionModuleUrl);
  const original = WHEEL_FACTORY_SETTINGS.layouts.anglo.composition;
  const moved = moveWheelRing(original, "anglo-cuspRuler", "anglo-zodiac");
  const key = "authoring.wheel.anglo.canvas.chart.scale";
  const receipt = {presetId: "working.anglo", revision: 4, overrides: {[key]: 0.8}, composition: original};
  const state = {geometryProfile: "anglo", geometryOverrides: {[key]: 0.9},
    syncedGeometryOverrides: receipt.overrides, wheelPresetState: {revision: 4},
    wheelGeometryReceipts: {anglo: receipt}, pendingWheelCompositions: {anglo: moved},
    revision: 20, gestureStart: null};
  const presets = {...factory, anglo: {id: "working.anglo", revision: 4, overrides: receipt.overrides}};
  const input = {profile: "anglo", presets, preview: preset.assembleWheelGeometryPreview(state)};
  assert.equal(preset.resolveWheelPresetComposition(input, original), moved);
  assert.equal(preset.resolveWheelPresetAuthoringOverrides(input)[key], 0.9);
  const snapshot = {document: {documentId: 'radix'}, primaryChart: {
    planets: [{longitude: 123}], options: {wheelComposition: original, showterms: true},
  }};
  const effective = preset.resolveWheelPresetSnapshot(snapshot, input);
  assert.equal(effective.primaryChart.options.wheelComposition, moved);
  assert.equal(effective.document, snapshot.document);
  assert.equal(effective.primaryChart.planets, snapshot.primaryChart.planets);
  assert.equal(effective.primaryChart.options.showterms, true);
  const acknowledged = {...state, syncedGeometryOverrides: state.geometryOverrides,
    pendingWheelCompositions: {}, wheelPresetState: {revision: 5},
    wheelGeometryReceipts: {anglo: {...receipt, revision: 5, composition: moved, overrides: state.geometryOverrides}}};
  const settled = {...input, preview: preset.assembleWheelGeometryPreview(acknowledged)};
  assert.equal(preset.resolveWheelPresetComposition(settled, original), moved,
    "the structure receipt bridges the retained snapshot after optimistic state clears");
  assert.equal(preset.resolveWheelPresetAuthoringOverrides(settled)[key], 0.9);
  const caughtUp = {...settled, presets: {...presets, anglo: {...presets.anglo, revision: 5}}};
  assert.equal(preset.resolveWheelPresetComposition(caughtUp, moved), moved);
  assert.equal(preset.resolveWheelPresetSnapshot(effective, caughtUp), effective,
    'receipt catch-up keeps the coherent snapshot identity');
  const equivalent = {...input, preview: {...input.preview, layouts: {anglo: {
    ...input.preview.layouts.anglo, composition: structuredClone(moved),
  }}}};
  assert.equal(preset.resolveWheelPresetSnapshot(effective, equivalent), effective,
    'equivalent structure copies do not replace retained chart data');
});

test("a structure preview for an unopened layout retains its snapshot dimensions", async () => {
  const {moveWheelRing} = await import(compositionModuleUrl);
  const original = factoryComposition("anglo");
  const moved = moveWheelRing(original, "anglo-cuspRuler", "anglo-zodiac");
  const key = "authoring.wheel.anglo.canvas.chart.scale";
  const presets = {...factory, anglo: {id: "working.anglo", revision: 4, overrides: {[key]: 0.8}}};
  const preview = preset.assembleWheelGeometryPreview({geometryProfile: "classic", geometryOverrides: {},
    syncedGeometryOverrides: {}, wheelPresetState: {revision: 5}, wheelGeometryReceipts: {},
    pendingWheelCompositions: {anglo: moved}, revision: 5, gestureStart: null});
  const input = {profile: "anglo", presets, preview};
  assert.equal(preset.resolveWheelPresetComposition(input, original), moved);
  assert.equal(preset.resolveWheelPresetAuthoringOverrides(input)[key], 0.8);
});

test("a newer selected preset rejects local dimensions and structure from the prior identity", () => {
  const key = "authoring.wheel.anglo.canvas.chart.scale";
  const original = factoryComposition("anglo");
  const preview = preset.assembleWheelGeometryPreview({geometryProfile: "anglo", geometryOverrides: {[key]: 0.7},
    syncedGeometryOverrides: {[key]: 0.8}, wheelPresetState: {revision: 5},
    wheelGeometryReceipts: {anglo: {presetId: "user.old", revision: 4, overrides: {[key]: 0.8}, composition: original}},
    pendingWheelCompositions: {anglo: original}, revision: 6, gestureStart: true});
  const presets = {...factory, anglo: {id: "user.new", revision: 5, overrides: {[key]: 0.9}}};
  const replacement = {...original, customized: true};
  const input = {profile: "anglo", presets, preview};
  assert.equal(preset.resolveWheelPresetAuthoringOverrides(input)[key], 0.9);
  assert.equal(preset.resolveWheelPresetComposition(input, replacement), replacement);
});

test("theme source provenance separates dirty previews sharing one factory identity", async () => {
  const {moveWheelRing} = await import(compositionModuleUrl);
  const key = "authoring.wheel.anglo.canvas.chart.scale";
  const original = factoryComposition("anglo");
  const moved = moveWheelRing(original, "anglo-cuspRuler", "anglo-zodiac");
  const receipt = {presetId: "factory.anglo", sourceThemeName: "Theme A", revision: 4,
    overrides: {[key]: 0.8}, composition: original};
  const state = {geometryProfile: "anglo", geometryOverrides: {[key]: 0.7},
    syncedGeometryOverrides: receipt.overrides,
    wheelPresetState: {revision: 4, context: {sourceThemeName: "Theme A"}},
    wheelGeometryReceipts: {anglo: receipt}, pendingWheelCompositions: {anglo: moved},
    revision: 6, gestureStart: true};
  const selected = {id: "factory.anglo", sourceThemeName: "Theme B", revision: 5, overrides: {[key]: 0.9}};
  const input = {profile: "anglo", presets: {...factory, anglo: selected},
    preview: preset.assembleWheelGeometryPreview(state)};
  assert.equal(preset.resolveWheelPresetAuthoringOverrides(input)[key], 0.9,
    "a newer theme snapshot cannot inherit another source's dirty dimensions");
  assert.equal(preset.resolveWheelPresetComposition(input, original), original,
    "nor its pending order during an active gesture");
  const sameSource = {...input, presets: {...factory, anglo: {...selected, sourceThemeName: "Theme A"}}};
  assert.equal(preset.resolveWheelPresetAuthoringOverrides(sameSource)[key], 0.7,
    "same-source in-flight edits retain their authority");
  assert.equal(preset.resolveWheelPresetComposition(sameSource, original), moved);
  const newerReceipt = {...state, gestureStart: null, pendingWheelCompositions: {},
    syncedGeometryOverrides: state.geometryOverrides, wheelGeometryReceipts: {anglo: {...receipt,
      sourceThemeName: "Theme B", revision: 6, overrides: state.geometryOverrides, composition: moved}},
    wheelPresetState: {revision: 6, context: {sourceThemeName: "Theme B"}}};
  const bridge = {...sameSource, preview: preset.assembleWheelGeometryPreview(newerReceipt)};
  assert.equal(preset.resolveWheelPresetAuthoringOverrides(bridge)[key], 0.7,
    "a coherent newer source receipt bridges the retained older source snapshot");
  assert.equal(preset.resolveWheelPresetComposition(bridge, original), moved);
  const metadataFirst = {...sameSource, preview: preset.assembleWheelGeometryPreview({...state,
    wheelPresetState: {revision: 5, context: {sourceThemeName: "Theme B"}}})};
  assert.equal(preset.resolveWheelPresetAuthoringOverrides(metadataFirst)[key], 0.9,
    "newer catalog source suppresses old-source intent before chart catch-up");
  assert.equal(preset.resolveWheelPresetComposition(metadataFirst, original), original);
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

test("catalog visibility receipts keep paint identity until selected geometry actually changes", () => {
  const initial = {...factory, anglo: {id: "working.anglo", revision: 10, overrides: {
    "authoring.wheel.anglo.canvas.chart.scale": 0.8,
  }}};
  const receipt = {...initial, anglo: {...initial.anglo, revision: 11}};
  const changed = {...receipt, anglo: {...receipt.anglo, overrides: {
    "authoring.wheel.anglo.canvas.chart.scale": 0.9,
  }}};
  const resolve = presets => preset.resolveWheelGeometryPresetStyle(
    reader({}), {revision: "appearance-1"}, {profile: "anglo", presets},
  );
  assert.equal(resolve(initial).revision, resolve(receipt).revision);
  assert.notEqual(resolve(initial).revision, resolve(changed).revision);
});


test("TradMorinus 6.03 preset preserves shared centre proportions and source comparison outer bands", () => {
  const presets = {...factory, compact: {id: "factory.traditional-morinus", revision: 1,
    overrides: {"wheel.presentation": "traditional-morinus"}}};
  const style = solve("compact", {}, {}, {presets});
  assert.equal(style.presentation, "traditional-morinus");
  assert.deepEqual(ownership.wheelGeometryOverrides(presets.compact.overrides), presets.compact.overrides);
  const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);
  for (const mode of ["single", "comparison"]) for (const outerRingMode of ["none", "antiscia", "fixstars", "arabic_parts"])
    for (const showTerms of [false, true]) for (const showDecans of [false, true]) for (const showPositions of [false, true]) {
      const hasOuterRing = mode === "comparison" || outerRingMode !== "none";
      const geometry = {...input("compact"), mode, outerRingMode, hasOuterRing, showTerms, showDecans, showPositions};
      const rings = wheel.resolveWheelRingSet(style, geometry);
      const density = Number(showTerms) + Number(showDecans);
      const offset = density === 2 ? .08 : 0;
      near(rings.rBase, 400 * (.30 - offset));
      near(rings.rHouse, rings.rBase + 400 * .06);
      near(rings.rHouseName, (rings.rBase + rings.rHouse) / 2);
      near(rings.rPosHouses, 400 * .34);
      near(rings.r30, 400 * (mode === "comparison" ? .79 : .85));
      near(rings.rInner, rings.r0 - 400 * density * .08);
      if (mode === "comparison") near(rings.rOuterPlanet, rings.r30 + 400 * .075);
      const metrics = wheel.resolveWheelTypographyMetrics(style, "compact", 400, geometry);
      near(metrics.bodySize, 400 / 16);
      near(metrics.signSize, 400 / 20);
    }
  assert.equal(solve("classic", {}, {}, {presets}).presentation, undefined);
  assert.equal(solve("compact", {}, {}, {presets: factory}).presentation, undefined);
});

test("native Classic, Compact and Traditional retain their density-specific factory lanes", async () => {
  const {WHEEL_FACTORY_SETTINGS} = await import(compositionModuleUrl);
  for (const variant of ["classic", "compact", "traditional"]) {
    const profile = variant === "traditional" ? "compact" : variant;
    const selected = {...factory, [profile]: {id: `factory.${variant}`, revision: 1,
      overrides: variant === "traditional" ? {"wheel.presentation": "traditional-morinus"} : {}}};
    for (const maxRadius of [180, 400, 733.5]) {
      const style = wheel.projectWheelAuthoringStyle(solve(profile, {}, {}, {presets: selected}), maxRadius, profile);
      assert.deepEqual(style.authoringOverrides.recipeRadii[profile], {}, "use the real native empty basis");
      for (const arrangement of ["bare", "projected", "comparison"])
      for (const showTerms of [false, true]) for (const showDecans of [false, true])
      for (const showPositions of [false, true]) {
        const composition = structuredClone(WHEEL_FACTORY_SETTINGS.layouts[profile].composition);
        for (const ring of composition.rings) {
          if (ring.archetypeId === "terms") ring.enabled = showTerms;
          if (ring.archetypeId === "decans") ring.enabled = showDecans;
        }
        const geometry = {profile, mode: arrangement === "comparison" ? "comparison" : "single", maxRadius,
          hasOuterRing: arrangement !== "bare", outerRingMode: "asteroids", showTerms, showDecans,
          showHouses: true, showPositions, comparisonWithOuterHouses: arrangement === "comparison",
          showOuterHouses: arrangement === "comparison", composition};
        const expected = wheel.resolveCanonicalWheelRingSet(style, geometry);
        const actual = wheel.resolveWheelRingSet(style, geometry);
        for (const [field, radius] of Object.entries(expected)) assert.ok(Math.abs(actual[field] - radius) < 1e-7,
          `${variant}/${maxRadius}/${arrangement}/${showTerms}/${showDecans}/${showPositions}/${field}: native ${actual[field]} != factory ${radius}`);
      }
    }
  }
});

test('saved wheel paint overrides another theme and local edits remain visible in the shared screen/export resolver', () => {
  const width = 'authoring.wheel.anglo.houses.inner.cusp.strokeWidth';
  const pattern = 'authoring.wheel.anglo.houses.inner.cusp.strokeStyle';
  const font = 'authoring.wheel.anglo.bodies.inner.glyph.fontSize';
  const saved = {[width]: 0.15, [pattern]: 'dotted', [font]: 19,
    '--aries-wheel-house-cusp-opacity': 0.6};
  const presets = {...factory, anglo: {id: 'user.dots', revision: 2, overrides: {}, appearance: saved}};
  for (const themeWidth of [1, 3]) {
    const resolved = preset.resolveWheelPresetAuthoringOverrides({profile: 'anglo', presets,
      appearanceOverrides: {[width]: themeWidth, [pattern]: 'solid'}});
    assert.equal(resolved[width], 0.15);
    assert.equal(resolved[pattern], 'dotted');
    const style = solve('anglo', {'--aries-wheel-house-cusp-opacity': '1'}, {[width]: themeWidth}, {presets});
    assert.equal(style.authoringOverrides.linePaint.anglo['houses.inner.cusp'].strokeWidthPx, 0.15);
    assert.equal(style.authoringOverrides.linePaint.anglo['houses.inner.cusp'].strokeStyle, 'dotted');
    assert.equal(style.authoringOverrides.typography.anglo['bodies.inner.glyph'].fontSizePx, 19);
  }
  const edited = preset.resolveWheelPresetAuthoringOverrides({profile: 'anglo', presets,
    appearanceOverrides: {[width]: 1}, appearanceEdits: {[width]: 0.3}});
  assert.equal(edited[width], 0.3);
  const reverted = preset.resolveWheelPresetAuthoringOverrides({profile: 'anglo', presets,
    appearanceOverrides: {[width]: 1}, appearanceEdits: {[width]: null}});
  assert.equal(reverted[width], 1, 'removing a design override returns to the theme underneath');
  const original = preset.resolveWheelPresetAuthoringOverrides({profile: 'anglo', presets: factory,
    appearanceOverrides: {[width]: 3}});
  assert.equal(original[width], 3, 'old geometry-only presets continue to inherit the theme');
});

test('wheel capture materializes Base styling and excludes app chrome, palette and other wheel types', () => {
  const captured = appearance.wheelPresetAppearanceForLayout({
    'authoring.wheel.base.houses.inner.cusp.strokeWidth': 0.2,
    'authoring.wheel.base.houses.inner.cusp.strokeStyle': 'dotted',
    'authoring.wheel.anglo.houses.inner.cusp.strokeWidth': 0.15,
    'authoring.wheel.compact.houses.inner.cusp.strokeStyle': 'solid',
    'authoring.wheel.base.rings.base.radius': 150,
    'renderer.wheel.metric.houseCuspOpacity': 0.6,
    'app.color.background': [0, 0, 0],
    'chart.color.houses': [255, 255, 255],
  }, 'anglo', {'renderer.wheel.metric.houseCuspOpacity': {cssVar: '--aries-wheel-house-cusp-opacity'}});
  assert.deepEqual(captured, {
    'authoring.wheel.anglo.houses.inner.cusp.strokeWidth': 0.15,
    'authoring.wheel.anglo.houses.inner.cusp.strokeStyle': 'dotted',
    '--aries-wheel-house-cusp-opacity': 0.6,
  });
});

test('palette-linked wheel paint follows the new theme instead of freezing its original colours', () => {
  const key = 'authoring.wheel.anglo.houses.inner.cusp.color';
  const presets = {...factory, anglo: {id: 'user.dots', revision: 3, overrides: {},
    appearance: {[key]: '{chart.color.houses}'}, appearanceRoles: {'chart.color.houses': '--morinus-houses'}}};
  for (const color of ['rgb(0 0 0)', 'rgb(255 255 255)']) {
    const resolved = preset.resolveWheelPresetAuthoringOverrides({profile: 'anglo', presets,
      readAppearanceValue: cssVar => cssVar === '--morinus-houses' ? color : ''});
    assert.equal(resolved[key], color);
  }
});

test('an acknowledged geometry-only selection clears saved paint on the retained snapshot before refresh', () => {
  const key = 'authoring.wheel.anglo.houses.inner.cusp.strokeStyle';
  const input = {profile: 'anglo', presets: {anglo: {id: 'user.dots', revision: 2, overrides: {}, appearance: {[key]: 'dotted'}}},
    preview: {profile: 'anglo', presetId: 'factory.anglo', baseRevision: 3, overrides: {}, dimensionsKnown: true}};
  assert.equal(preset.resolveWheelPresetAuthoringOverrides(input)[key], undefined);
});
