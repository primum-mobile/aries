// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  navigateGraphicEphemeris,
  registerGraphicEphemerisNavigator,
  releaseGraphicEphemerisNavigation,
} from "../src/lib/chart/graphic-ephemeris-navigation.mjs";

test("routes active-document navigation and explicit release without plot focus", () => {
  const received = [];
  const released = [];
  const unregister = registerGraphicEphemerisNavigator("ephemeris-1", (key) => {
    received.push(key);
  }, (key) => {
    released.push(key);
  });

  assert.equal(navigateGraphicEphemeris("ephemeris-1", "left"), true);
  assert.equal(navigateGraphicEphemeris("ephemeris-1", "up"), true);
  assert.equal(navigateGraphicEphemeris("ephemeris-1", "space"), true);
  assert.equal(releaseGraphicEphemerisNavigation("ephemeris-1", "left"), true);
  assert.equal(releaseGraphicEphemerisNavigation("ephemeris-1", null), true);
  assert.deepEqual(received, ["left", "up", "space"]);
  assert.deepEqual(released, ["left", null]);

  unregister();
  assert.equal(navigateGraphicEphemeris("ephemeris-1", "right"), false);
  assert.equal(releaseGraphicEphemerisNavigation("ephemeris-1", "right"), false);
});

test("stale cleanup cannot remove a replacement navigator", () => {
  const received = [];
  const unregisterFirst = registerGraphicEphemerisNavigator(
    "ephemeris-1",
    () => received.push("first"),
    () => received.push("first-release"),
  );
  const unregisterSecond = registerGraphicEphemerisNavigator(
    "ephemeris-1",
    () => received.push("second"),
    () => received.push("second-release"),
  );

  unregisterFirst();
  assert.equal(navigateGraphicEphemeris("ephemeris-1", "down"), true);
  assert.equal(releaseGraphicEphemerisNavigation("ephemeris-1", "down"), true);
  assert.deepEqual(received, ["second", "second-release"]);

  unregisterSecond();
});

test("global arrows and burst completion stay wired to the mounted ephemeris", async () => {
  const [homeSource, ephemerisSource] = await Promise.all([
    readFile(
      new URL("../src/components/workshell/home-client.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL(
        "../src/components/workshell/graph-ephemeris-view.tsx",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);

  assert.match(
    homeSource,
    /activeDocument\?\.kind === "ephemeris"[\s\S]*\(isStepEnvelopeKey\(key\) \|\| key === "space"\)[\s\S]*const handled = navigateGraphicEphemeris\([\s\S]*if \(!handled\)[\s\S]*console\.warn\([\s\S]*return;/,
  );
  assert.match(
    homeSource,
    /useLayoutEffect\(\(\) => \{\s*activeDocRef\.current = activeDoc;/,
  );
  assert.match(
    ephemerisSource,
    /React\.useLayoutEffect\(\(\) => \{\s*return registerGraphicEphemerisNavigator\([\s\S]*navigationPressRef\.current\(key\)[\s\S]*navigationReleaseRef\.current\(key\)/,
  );
  assert.match(
    ephemerisSource,
    /heldNavigationKeysRef\.current\.size > 0[\s\S]*deferredNavigationTailRef\.current = runPostPaintTail/,
  );
  assert.match(
    ephemerisSource,
    /pendingAnchorPersistenceRef\.current = next/,
  );
});

test("Space restores the opening anchor and cannot reset the hidden parent chart", async () => {
  const [homeSource, ephemerisSource] = await Promise.all([
    readFile(
      new URL("../src/components/workshell/home-client.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL(
        "../src/components/workshell/graph-ephemeris-view.tsx",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);

  const targetResolver = homeSource.slice(
    homeSource.indexOf("function navigateTargetForDocument"),
    homeSource.indexOf("function useActiveDocumentChart"),
  );
  assert.doesNotMatch(targetResolver, /doc\.kind === "ephemeris"|key === "space"/);
  assert.match(ephemerisSource, /const initialAnchorRef = React\.useRef<EphemerisAnchor \| null>\(null\);/);
  assert.match(ephemerisSource, /initialAnchorRef\.current = \{ \.\.\.seededAnchor \};/);
  assert.match(ephemerisSource, /initialAnchorRef\.current = \{ \.\.\.fallbackAnchor \};/);
  assert.match(
    ephemerisSource,
    /const resetToInitialAnchor = React\.useCallback\([\s\S]*heldNavigationKeysRef\.current\.clear\(\);[\s\S]*pendingAnchorPersistenceRef\.current = null;[\s\S]*deferredNavigationTailRef\.current = null;[\s\S]*commitAnchor\(\{ \.\.\.initial \}\);/,
  );
  assert.match(
    ephemerisSource,
    /if \(key === "space"\) \{\s*resetToInitialAnchor\(\);\s*return;/,
  );
});

test("Graphic Ephemeris reuses the chart rail with month and year directions", async () => {
  const [homeSource, workspaceSource, ephemerisSource] = await Promise.all([
    readFile(
      new URL("../src/components/workshell/home-client.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL(
        "../src/components/workshell/workspace-content.tsx",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL(
        "../src/components/workshell/graph-ephemeris-view.tsx",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);

  const ephemerisSurface = workspaceSource.slice(
    workspaceSource.indexOf('if (activeDoc?.kind === "ephemeris")'),
    workspaceSource.indexOf('if (activeDoc?.kind === "transit-search")'),
  );
  assert.match(ephemerisSurface, /<GraphicEphemerisArea[\s\S]*navbar=\{navbar\}/);

  const graphicArea = workspaceSource.slice(
    workspaceSource.indexOf("function GraphicEphemerisArea"),
    workspaceSource.indexOf("function WorkspaceDocumentSurface"),
  );
  assert.match(graphicArea, /<ChartArea[\s\S]*navbar=\{ephemerisNavbar\}[\s\S]*<GraphEphemerisView/);
  assert.match(
    graphicArea,
    /modeHintLabel: modeButtonLabel[\s\S]*onToggleModeHint: displayMode \? requestAlternateDisplayMode/,
  );
  assert.match(
    graphicArea,
    /registerDisplayModeToggle=\{registerDisplayModeToggle\}[\s\S]*onDisplayModeChange=\{handleDisplayModeChange\}/,
  );
  assert.match(
    ephemerisSource,
    /registerDisplayModeToggle\(\(\) => \{[\s\S]*modeRef\.current === "longitude" \? "declination" : "longitude";[\s\S]*selectMode\(next\);/,
  );
  assert.match(ephemerisSource, /setMode\(next\);\s*onDisplayModeChange\?\.\(next\);/);
  assert.match(
    workspaceSource,
    /const showCustomModeHint = Boolean\(hasChart && modeHintLabel && onToggleModeHint\);/,
  );

  const groupBuilder = workspaceSource.slice(
    workspaceSource.indexOf("export function navigationHintGroups"),
    workspaceSource.indexOf("function buildLeftRightHintGroups"),
  );
  assert.match(
    groupBuilder,
    /kind === "ephemeris"[\s\S]*buildNavigationHintGroup\("month", "left", "right"[\s\S]*buildNavigationHintGroup\("year", "down", "up"/,
  );
  assert.match(workspaceSource, /left: "←", right: "→", up: "↑", down: "↓"/);
  assert.match(
    homeSource,
    /hasChart: activeChartPresent \|\| activeDoc\?\.kind === "ephemeris"/,
  );
  assert.match(homeSource, /onNavigateHint: routeNavigationKey/);
  assert.match(homeSource, /onNavigateHintEnd: releaseNavigationHint/);
});

test("chart rail pointer and keyboard activation both close their navigation burst", async () => {
  const workspaceSource = await readFile(
    new URL(
      "../src/components/workshell/workspace-content.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  const buttonSource = workspaceSource.slice(
    workspaceSource.indexOf("function StepHintArrowButton"),
    workspaceSource.indexOf("function ShortcutFlag"),
  );

  assert.match(
    buttonSource,
    /const stopHold = React\.useCallback\([\s\S]*if \(wasHolding\) \{[\s\S]*onEnd\(navigationKey\)/,
  );
  assert.match(
    buttonSource,
    /const handleClick = React\.useCallback\([\s\S]*fireStep\(\);\s*onEnd\(navigationKey\);/,
  );
  assert.match(buttonSource, /onPointerUp=\{stopHold\}/);
  assert.match(buttonSource, /onPointerCancel=\{stopHold\}/);
  assert.match(buttonSource, /onPointerLeave=\{stopHold\}/);
  assert.match(buttonSource, /onBlur=\{stopHold\}/);
  assert.match(
    buttonSource,
    /React\.useEffect\(\(\) => \(\) => \{[\s\S]*if \(wasHolding\) onEnd\(navigationKey\);/,
  );
});

test("cached navigation publishes once and cancelled paint releases the rAF slot", async () => {
  const ephemerisSource = await readFile(
    new URL(
      "../src/components/workshell/graph-ephemeris-view.tsx",
      import.meta.url,
    ),
    "utf8",
  );

  const commitAnchorSource = ephemerisSource.match(
    /const commitAnchor = React\.useCallback\([\s\S]*?\n  \);/,
  )?.[0];
  assert.ok(commitAnchorSource);
  assert.doesNotMatch(commitAnchorSource, /applyPayload\(/);
  assert.match(
    ephemerisSource,
    /const pendingPaint = paintRef\.current;[\s\S]*cancelAnimationFrame\(pendingPaint\);[\s\S]*paintRef\.current === pendingPaint[\s\S]*paintRef\.current = null;/,
  );
});

test("held navigation publishes a coherent event-glyph frame", async () => {
  const ephemerisSource = await readFile(
    new URL(
      "../src/components/workshell/graph-ephemeris-view.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  const fetchBlock = ephemerisSource.slice(
    ephemerisSource.indexOf("// --- Series fetch."),
    ephemerisSource.indexOf("// --- Paint"),
  );

  assert.match(
    ephemerisSource,
    /const requiresEventMarkers = showEventGlyphs && mode === "longitude";/,
  );
  assert.match(
    fetchBlock,
    /if \(cached && \(!requiresEventMarkers \|\| cachedMarkers\)\)[\s\S]*frameWithMarkers\(cached, cachedMarkers\)/,
  );
  assert.match(
    fetchBlock,
    /if \(cached\) \{[\s\S]*fetchGraphicEphemerisStations\([\s\S]*applyPayload\(frameWithMarkers\(cached, markerPayload\)\)/,
  );
  assert.match(fetchBlock, /includeStations: requiresEventMarkers/);
  assert.match(
    fetchBlock,
    /rememberStations\(warmKey, markerPayloadFromFrame\(warmPayload\)\)/,
  );
  assert.match(
    fetchBlock,
    /if \(!ephemerisStationCache\.has\(cacheKey\)\) fetchStations\(\);/,
  );
  assert.doesNotMatch(fetchBlock, /applyPayload\(cached\);/);
});

test("ephemeris cache identity is independent from retained-list invalidation", async () => {
  const [ephemerisSource, storeSource] = await Promise.all([
    readFile(
      new URL(
        "../src/components/workshell/graph-ephemeris-view.tsx",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL("../src/stores/daemon-workspace-store.ts", import.meta.url),
      "utf8",
    ),
  ]);

  const dataKeyHook = ephemerisSource.match(
    /function useEphemerisDataKey\(\)[\s\S]*?\n}/,
  )?.[0];
  assert.ok(dataKeyHook);
  assert.match(dataKeyHook, /lastOptionsChange\?\.ephemerisDataKey/);
  assert.doesNotMatch(dataKeyHook, /listDataChanged/);
  assert.match(ephemerisSource, /ephemerisCacheKey\(ephemerisDataKey,/);
  assert.match(storeSource, /ephemerisDataKey: event\.ephemerisDataKey/);
});
