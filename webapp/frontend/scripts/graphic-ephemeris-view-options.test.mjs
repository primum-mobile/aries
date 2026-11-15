// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

// Modulus and ink are per-radix display options of the Graphic Ephemeris:
// persisted with the other toggles, repainted from the scene memo, never a
// refetch or a camera move. The hovered curve is merged after the heavy scene.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../src/${path}`, import.meta.url), "utf8");
const readView = () => read("components/workshell/graph-ephemeris-view.tsx");

/** Source of `const name = React.useCallback(` up to its dependency list. */
function callbackBody(source, name) {
  const start = source.indexOf(`const ${name} = React.useCallback(`);
  assert.ok(start >= 0, `${name} exists`);
  const end = source.indexOf("\n  );", start);
  return source.slice(start, end);
}

test("modulus and ink mode persist with the other view toggles", async () => {
  const view = await readView();
  const client = await read("lib/daemon/client.ts");
  const stateType = client.slice(client.indexOf("export type EphemerisViewState"), client.indexOf("export async function fetchEphemerisViewState"));
  assert.match(stateType, /modulus\?: 360 \| 90 \| 45 \| 30;/);
  assert.match(stateType, /ink_mode\?: "tiers" \| "planets" \| "dignity";\s*mirrored\?: boolean;/);

  // Seeded from the cached state and from the restored daemon state.
  assert.match(view, /React\.useState<EphemerisModulus>\(\(\) => seededModulus\(cachedState\)\)/);
  assert.match(view, /React\.useState<EphemerisInkMode>\(\(\) => seededInkMode\(cachedState\)\)/);
  assert.match(view, /if \(!interactedRef\.current\) \{[\s\S]*setModulus\(seededModulus\(state\)\);\s*setInkMode\(seededInkMode\(state\)\);/);
  assert.match(view, /const DEFAULT_EPHEMERIS_MODULUS: EphemerisModulus = 45;/);
  assert.match(view, /const DEFAULT_EPHEMERIS_INK_MODE: EphemerisInkMode = "planets";/);

  // The toggles ref carries both, and every write sends them.
  assert.match(view, /togglesRef\.current = \{ mode, showGrid, showEventGlyphs, showLunations, visible, modulus, inkMode, mirrored[,} ]/);
  const persist = callbackBody(view, "persistViewState");
  assert.match(persist, /show_event_glyphs: toggles\.showEventGlyphs,/);
  assert.match(persist, /modulus: toggles\.modulus,\s*ink_mode: toggles\.inkMode,\s*mirrored: toggles\.mirrored,/);
});

test("changing modulus or ink repaints without a refetch or camera reset", async () => {
  const view = await readView();
  for (const [name, setter, field] of [
    ["selectModulus", "setModulus", "modulus"],
    ["selectInkMode", "setInkMode", "ink_mode"],
  ]) {
    const body = callbackBody(view, name);
    assert.match(body, new RegExp(`${setter}\\(next\\);\\s*persistViewState\\(\\{ ${field}: next \\}\\);`));
    assert.doesNotMatch(body, /fetch[A-Z]|moveCamera|cameraRef|initialCameraRef|tweenRef|ephemerisStore|setMeta|setVisibleOverrides/);
  }

  // Both feed the scene memo, which repaints through requestFrame.
  const baseScene = view.slice(view.indexOf("const baseScene = React.useMemo"), view.indexOf("const scene = React.useMemo"));
  assert.match(baseScene, /modulus,\s*inkMode,\s*mirrored,\s*dignityBySign,/);
  assert.match(baseScene, /\[colorRadixLabels, dignityBySign, effectivePlanets, fullMoonLabel, headerText, inkMode, lunarEclipseLetter, meta, mirrored, mode, modulus,/);
  assert.match(view, /sceneRef\.current = scene;\s*requestFrame\(\);/);

  // Neither reaches a data fetch or the camera restore.
  assert.match(view, /\}, \[ephemerisDataKey, metaNonce\]\);/);
  assert.match(view, /\}, \[documentId, requestFrame\]\);/);
});

test("the context menu offers modulus in longitude only and the three inks", async () => {
  const view = await readView();
  assert.match(view, /const EPHEMERIS_MODULI: readonly EphemerisModulus\[\] = \[360, 90, 45, 30\];/);
  assert.match(view, /const EPHEMERIS_INK_MODES: readonly EphemerisInkMode\[\] = \["tiers", "planets", "dignity"\];/);
  assert.match(view, /\{mode === "longitude" \? \(\s*<ContextMenuSub>\s*<ContextMenuSubTrigger>\{t\("ephem\.modulus"\)\}/);
  assert.match(view, /<ContextMenuRadioGroup\s*value=\{String\(modulus\)\}/);
  assert.match(view, /<ContextMenuSubTrigger>\{t\("ephem\.colors"\)\}[\s\S]*<ContextMenuRadioGroup\s*value=\{inkMode\}/);
  for (const key of ["ephem.inkTiers", "ephem.inkPlanets", "ephem.inkDignity", "ephem.openMenu"]) assert.ok(view.includes(`"${key}"`));
});

test("hover highlight is merged after the heavy scene and kept out of exports", async () => {
  const view = await readView();
  const baseScene = view.slice(view.indexOf("const baseScene = React.useMemo"), view.indexOf("const scene = React.useMemo"));
  assert.match(baseScene, /^const baseScene = React\.useMemo<Omit<EphemerisScene, "highlightPlanetId"> \| null>\(/);
  assert.doesNotMatch(baseScene.slice(baseScene.indexOf("() =>")), /highlightPlanetId/);
  assert.match(
    view,
    // A pinned curve (click) wins over the hovered one; a pinned natal line
    // over the hovered one, the same way.
    /const scene = React\.useMemo<EphemerisScene \| null>\(\s*\(\) =>\s*baseScene\s*\? \{ \.\.\.baseScene, highlightPlanetId: pinnedPlanetId \?\? highlightPlanetId, radixFocusKey: pinnedRadixKey \?\? hoverRadixKey, radixFocusPinned: pinnedRadixKey != null \}\s*: null,\s*\[baseScene, highlightPlanetId, hoverRadixKey, pinnedPlanetId, pinnedRadixKey\],/,
  );
  // Same hit as the tooltip, else the Inspector's curve hit; equal ids keep state.
  const highlight = callbackBody(view, "highlightAt");
  assert.match(highlight, /hit\?\.planet \?\? .*bodyAt\(clientX, clientY\)\?\.planet/);
  assert.match(highlight, /setHighlightPlanetId\(\(current\) => \(current === planet \? current : planet\)\)/);
  assert.equal((view.match(/highlightAt\(hit, (pointer\.x, pointer\.y|e\.clientX, e\.clientY)\);/g) ?? []).length, 2);
  assert.equal((view.match(/highlightAt\(null, null, null\);/g) ?? []).length, 2);
  assert.match(callbackBody(view, "composeImage"), /ephemerisExportScene\(liveScene\)/);
  assert.match(await read("lib/chart/ephemeris-plate-paint.ts"), /\{ \.\.\.scene, highlightPlanetId: null, radixFocusKey: null, radixFocusPinned: false \}/);
});

test("the plate header is one localized sentence per mode, zodiac omitted when absent", async () => {
  const view = await readView();
  const header = callbackBody(view, "headerText");
  assert.match(header, /if \(mode === "declination"\) return t\("ephem\.plateHeaderDeclination", date\);/);
  assert.match(header, /zodiacLabel\s*\? t\("ephem\.plateHeaderLongitude", \{ \.\.\.date, zodiac: zodiacLabel, modulus: modulusTxt \}\)\s*: t\("ephem\.plateHeaderLongitudeNoZodiac", \{ \.\.\.date, modulus: modulusTxt \}\)/);
  const en = JSON.parse(await read("locales/en.json"));
  assert.doesNotMatch(en["ephem.plateHeaderDeclination"], /\{modulus\}|\{zodiac\}/);
  assert.doesNotMatch(en["ephem.plateHeaderLongitudeNoZodiac"], /\{zodiac\}/);
  for (const key of ["ephem.plateHeaderLongitude", "ephem.plateHeaderLongitudeNoZodiac", "ephem.plateHeaderDeclination"]) {
    for (const slot of ["{day}", "{month}", "{year}"]) assert.ok(en[key].includes(slot), `${key} ${slot}`);
  }
});

test("mirrored edges persist, repaint the chrome and stay display-only", async () => {
  const view = await readView();
  assert.match(view, /React\.useState\(\(\) => cachedState\?\.mirrored \?\? false\)/);
  assert.match(view, /if \(typeof state\.mirrored === "boolean"\) setMirrored\(state\.mirrored\);/);
  const body = callbackBody(view, "toggleMirrored");
  assert.match(body, /setMirrored\(checked\);\s*persistViewState\(\{ mirrored: checked \}\);/);
  assert.doesNotMatch(body, /fetch[A-Z]|moveCamera|cameraRef|initialCameraRef|tweenRef|ephemerisStore|setMeta/);
  assert.match(await read("lib/chart/ephemeris-plate-paint.ts"), /scene\.modulus, scene\.mirrored[,\]]/);
  assert.match(view, /t\("ephem\.labelsOnRight"\)/);
});

test("declination equator, out-of-bounds range and sign bands persist and stay display-only", async () => {
  const view = await readView();
  const toggles = [
    ["showEquator", "setShowEquator", "show_equator", "toggleEquator", "true", "ephem.showEquator"],
    ["showOutOfBoundsRange", "setShowOutOfBoundsRange", "show_oob_range", "toggleOutOfBoundsRange", "false", "ephem.showOutOfBoundsRange"],
    ["showSignBands", "setShowSignBands", "show_sign_bands", "toggleSignBands", "false", "ephem.showSignBands"],
  ];
  const en = JSON.parse(await read("locales/en.json"));
  for (const [, setter, field, callback, fallback, key] of toggles) {
    assert.match(view, new RegExp(`React\\.useState\\(\\(\\) => cachedState\\?\\.${field} \\?\\? ${fallback}\\)`));
    assert.match(view, new RegExp(`if \\(typeof state\\.${field} === "boolean"\\) ${setter}\\(state\\.${field}\\);`));
    const body = callbackBody(view, callback);
    assert.match(body, new RegExp(`${setter}\\(checked\\);\\s*persistViewState\\(\\{ ${field}: checked \\}\\);`));
    assert.doesNotMatch(body, /fetch[A-Z]|moveCamera|cameraRef|initialCameraRef|tweenRef|ephemerisStore|setMeta/);
    assert.ok(en[key], key);
    assert.match(view, new RegExp(`t\\("${key.replace(".", "\\.")}"\\)`));
  }
  // Equator and sign bands change the static plate (and the table width).
  // (The live frame and the export share these through ephemeris-plate-paint.)
  const plate = await read("lib/chart/ephemeris-plate-paint.ts");
  assert.match(plate, /scene\.mirrored, scene\.showEquator, scene\.showSignBands, scene\.showRadix\];/);
  assert.match(plate, /scene\.mirrored \?\? false, scene\.showSignBands \?\? false, scene\.showRadix \?\? false, \{/);
  assert.match(view, /ephemerisChromeInputs\(size, style, currentScene\)/);
  // Every view toggle lives in one View drawer (submenu).
  const drawerStart = view.indexOf('<ContextMenuSubTrigger>{t("ephem.view")}</ContextMenuSubTrigger>');
  assert.ok(drawerStart > 0, "View submenu");
  const drawer = view.slice(drawerStart, view.indexOf("</ContextMenuSub>", drawerStart));
  for (const key of ["ephem.showGrid", "ephem.showEventGlyphs", "ephem.showLunations", "ephem.labelsOnRight", "ephem.showEquator", "ephem.showOutOfBoundsRange", "ephem.showSignBands"]) {
    assert.ok(drawer.includes(`t("${key}")`), `${key} in the View drawer`);
    assert.equal(view.split(`t("${key}")`).length, 2, `${key} appears once`);
  }
  assert.ok(en["ephem.view"]);
  // The three entries show only in declination mode.
  assert.match(view, /\{mode === "declination" \? \([\s\S]*?ephem\.showEquator[\s\S]*?ephem\.showOutOfBoundsRange[\s\S]*?ephem\.showSignBands[\s\S]*?\) : null\}/);
});

test("reading line: a global view toggle that anchors stepping, zoom and pan on the plot centre", async () => {
  const view = await readView();
  const client = await read("lib/daemon/client.ts");
  assert.match(client, /show_now_line\?: boolean;/);
  // On by default, seeded from cached and restored state, persisted with the toggles.
  assert.match(view, /React\.useState\(\(\) => cachedState\?\.show_now_line \?\? true\)/);
  assert.match(view, /if \(typeof state\.show_now_line === "boolean"\) setShowNowLine\(state\.show_now_line\);/);
  assert.match(callbackBody(view, "persistViewState"), /show_now_line: toggles\.showNowLine,/);
  assert.match(callbackBody(view, "toggleNowLine"), /setShowNowLine\(checked\);\s*persistViewState\(\{ show_now_line: checked \}\);/);
  // The View submenu opens with the localized current-date line checkbox,
  // above every other View toggle.
  assert.match(view, /\{t\("ephem\.view"\)\}<\/ContextMenuSubTrigger>\s*<ContextMenuSubContent className="min-w-56">\s*<ContextMenuCheckboxItem checked=\{showNowLine\} onCheckedChange=\{\(c\) => toggleNowLine\(Boolean\(c\)\)\}>\s*\{t\("ephem\.showNowLine"\)\}\s*<\/ContextMenuCheckboxItem>\s*<ContextMenuCheckboxItem checked=\{showGrid\}/);
  // Keys, pinch and ⌘-scroll zoom around the line while it is shown.
  const zoom = callbackBody(view, "zoomBy");
  assert.match(zoom, /const anchor = line \? width \/ 2 : anchorX;/);
  assert.match(zoom, /resetZoomCameraCenter\(base\)/);
  assert.match(view, /const zoomAnchorX = \(clientX: number\) => \(togglesRef\.current\.showNowLine \? plotWidth\(\) \/ 2 : plotXAt\(clientX\)\);/);
  assert.doesNotMatch(view, /zoomCameraAround\(camera, plotWidth\(\), plotXAt\(/);
  // A drag writes the camera (the document's current moment) at release.
  assert.match(callbackBody(view, "endDrag"), /if \(drag\.moved && togglesRef\.current\.showNowLine\) void flushCameraPersist\(\);/);
  // The scene carries the line and its label; the header names its date.
  assert.match(view, /showNowLine,\s*nowLineLabel,\s*headerText,/);
  const header = callbackBody(view, "headerText");
  assert.match(header, /if \(showNowLine\) \{[\s\S]*t\("ephem\.plateHeaderDeclinationAt", date\)[\s\S]*t\("ephem\.plateHeaderLongitudeAt"[\s\S]*t\("ephem\.plateHeaderLongitudeNoZodiacAt"/);

  const locales = ["de", "en", "es", "fr", "hu", "it", "ja", "ko", "ru", "tr", "zh-Hans", "zh-Hant"];
  for (const locale of locales) {
    const catalog = JSON.parse(await read(`locales/${locale}.json`));
    for (const key of ["ephem.showNowLine", "ephem.nowLineDate", "ephem.plateHeaderLongitudeAt", "ephem.plateHeaderLongitudeNoZodiacAt", "ephem.plateHeaderDeclinationAt"]) {
      assert.ok(catalog[key], `${locale} ${key}`);
    }
    for (const key of ["ephem.nowLineDate", "ephem.plateHeaderDeclinationAt"]) {
      for (const part of ["{day}", "{month}", "{year}"]) assert.ok(catalog[key].includes(part), `${locale} ${key} ${part}`);
    }
  }
});
