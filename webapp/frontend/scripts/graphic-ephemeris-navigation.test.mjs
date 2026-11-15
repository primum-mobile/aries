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

const readView = () =>
  readFile(new URL("../src/components/workshell/graph-ephemeris-view.tsx", import.meta.url), "utf8");

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
  // Each arrow step is a short clockwork tick; a held arrow chains from the tick target.
  // With the reading line the centre steps by calendar months under the fixed
  // line; without it both edges do.
  assert.match(ephemerisSource, /const base = targetCamera\(\);[\s\S]*const next = clampCamera\(togglesRef\.current\.showNowLine \? stepCameraCenter\(base, key\) : stepCamera\(base, key\)\);/);
  // A step lands only on resident months: it waits for them (repeats meanwhile
  // are dropped), so a held burst runs at the speed data arrives, never blank.
  assert.match(ephemerisSource, /if \(pendingStepRef\.current\) return;/);
  // A step lands once its curves are resident; overlays never hold it back.
  assert.match(ephemerisSource, /\(camera: EphemerisCamera\) => ephemerisStore\.isResident\(camera\.startJd, cameraEndJd\(camera\), false\),/);
  assert.match(ephemerisSource, /if \(stepResident\(next\)\) \{\s*moveCamera\(next, true, EPHEMERIS_TICK_MS\);/);
  assert.match(ephemerisSource, /if \(pending && stepResidentRef\.current\(pending\)\) stepLandedRef\.current\(\);/);
  assert.match(ephemerisSource, /if \(heldNavigationKeysRef\.current\.size > 0\) \{\s*arm\(\);/);
});

test("Space restores the opening moment at the standard zoom and cannot reset the hidden parent chart", async () => {
  const [homeSource, ephemerisSource] = await Promise.all([
    readFile(new URL("../src/components/workshell/home-client.tsx", import.meta.url), "utf8"),
    readView(),
  ]);
  const targetResolver = homeSource.slice(
    homeSource.indexOf("function navigateTargetForDocument"),
    homeSource.indexOf("function useActiveDocumentChart"),
  );
  assert.doesNotMatch(targetResolver, /doc\.kind === "ephemeris"|key === "space"/);
  assert.match(ephemerisSource, /const initialCameraRef = React\.useRef<EphemerisCamera \| null>\(openingCamera\);/);
  assert.match(ephemerisSource, /initialCameraRef\.current = camera;/);
  assert.match(
    ephemerisSource,
    /const resetToInitialCamera = React\.useCallback\([\s\S]*const initial = defaultCameraAround\(cameraCenterJd\(opening\)\);[\s\S]*heldNavigationKeysRef\.current\.clear\(\);[\s\S]*moveCamera\(initial, true, EPHEMERIS_TICK_MS\);/,
  );
  assert.match(ephemerisSource, /if \(key === "space"\) \{\s*resetToInitialCamera\(\);\s*return;/);
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
    /registerDisplayModeToggle\(\(\) => \{[\s\S]*togglesRef\.current\.mode === "longitude" \? "declination" : "longitude";[\s\S]*selectMode\(next\);/,
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
  assert.match(buttonSource, /setPointerCapture\(event\.pointerId\)/);
  assert.match(buttonSource, /onLostPointerCapture=\{stopHold\}/);
  assert.match(buttonSource, /onPointerLeave=\{\(\) => \{[\s\S]*capturedPointerIdRef\.current === null\) stopHold\(\)/);
  assert.match(buttonSource, /onBlur=\{\(\) => \{[\s\S]*capturedPointerIdRef\.current === null\) stopHold\(\)/);
  assert.match(
    buttonSource,
    /React\.useEffect\(\(\) => \(\) => \{[\s\S]*if \(wasHolding\) onEnd\(navigationKey\);/,
  );
});

test("camera frames repaint from the block store without React state or fetches", async () => {
  const ephemerisSource = await readView();
  const frame = ephemerisSource.slice(
    ephemerisSource.indexOf("frameRef.current = () => {"),
    ephemerisSource.indexOf("}, [requestFrame, viewId]);"),
  );
  assert.match(frame, /ephemerisStore\.setInterest\(viewId,/);
  assert.match(frame, /ephemerisStore\.frameData\(camera\.startJd, endJd\)/);
  assert.match(frame, /paintEphemerisPlate\(/);
  assert.doesNotMatch(frame, /fetch[A-Z]|setCamera|setMenu|setHover/);
  // The window machinery is gone: one path through the month-block store.
  assert.doesNotMatch(ephemerisSource, /fetchGraphicEphemeris|frameWithKnownMarkers|GRAPHIC_EPHEMERIS_SPANS|steppedGraphicEphemerisAnchor/);
  // Curves alone gate the camera; the marks follow without the series.
  assert.match(ephemerisSource, /fetchSeries: \(year, month, count, signal\) => fetchEphemerisSeries\(year, month, count, signal\)/);
  assert.match(ephemerisSource, /fetchBlocks: \(year, month, count, signal\) => fetchEphemerisMarks\(year, month, count, signal\)/);
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
  assert.match(ephemerisSource, /cached\.revision === ephemerisDataKey/);
  assert.match(ephemerisSource, /ephemerisStore\.setDataKey\(next\.dataKey\)/);
  assert.match(storeSource, /ephemerisDataKey: event\.ephemerisDataKey/);
});
