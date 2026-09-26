// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";

function normalizeSourceText(value) {
  return value.replace(/\r\n?/g, "\n");
}

const source = normalizeSourceText(
  await readFile(
    new URL(
      "../src/components/workshell/workspace-content.tsx",
      import.meta.url,
    ),
    "utf8",
  ),
);
const homeSource = normalizeSourceText(
  await readFile(new URL("../src/components/workshell/home-client.tsx", import.meta.url), "utf8"),
);
const mapSource = normalizeSourceText(
  await readFile(new URL("../../../Res/astrocart/map.html", import.meta.url), "utf8"),
);

function sourceBetween(start, end) {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `missing source marker: ${start}`);
  const endIndex = source.indexOf(end, startIndex);
  assert.notEqual(endIndex, -1, `missing source marker: ${end}`);
  return source.slice(startIndex, endIndex);
}

test("source markers are platform-neutral", () => {
  assert.equal(normalizeSourceText("first\r\nsecond\rthird"), "first\nsecond\nthird");
});

test("retained map geometry terminates at interactive precision", () => {
  assert.match(
    source,
    /type AstrocartGeometryPrecision = "preview" \| "interactive" \| "precise";/,
  );
  assert.match(
    source,
    /type AstrocartRetainedPrecision = Exclude<AstrocartGeometryPrecision, "precise">;/,
  );
  assert.match(
    source,
    /ASTROCART_RETAINED_TERMINAL_PRECISION:[\s\S]*?=\s*"interactive";/,
  );

  const retainedLifecycle = sourceBetween(
    "React.useEffect(() => {\n    if (!active || !viewStateReady) return;\n    pushCachedModeData();",
    "  // Eclipse shadow-path overlay",
  );
  assert.doesNotMatch(retainedLifecycle, /fetchModePayload/);
  assert.doesNotMatch(retainedLifecycle, /"precise"/);
  assert.match(retainedLifecycle, /"preview"/);
  assert.match(
    retainedLifecycle,
    /cached\.precision === ASTROCART_RETAINED_TERMINAL_PRECISION/,
  );
  assert.match(
    retainedLifecycle,
    /fetchAstrocartModePayload\([\s\S]*?ASTROCART_RETAINED_TERMINAL_PRECISION/,
  );
});

test("a held child step advances moving map lines before the final settle", () => {
  assert.match(
    homeSource,
    /workspaceNavigateKey\(targetDocId, k, shift, alt, repeat, !mapTarget\)/,
  );
  assert.match(homeSource, /if \(mapTarget && res\.stepped\) \{[\s\S]*?aries:chart-step-published/);
  assert.match(homeSource, /if \(mapTarget\) \{[\s\S]*?aries:chart-step-settle/);
  const movingLifecycle = sourceBetween(
    "let requestedVersion = 0;",
    "  React.useEffect(() => {\n    const change = lastOptionsChange;",
  );
  assert.match(movingLifecycle, /addEventListener\("aries:chart-step-published", onStepPublished\)/);
  assert.match(movingLifecycle, /movingLayerRequestRef\.current \|\| refreshFrame !== null/);
  assert.match(movingLifecycle, /settled && launchedVersion !== requestedVersion/);
  assert.match(movingLifecycle, /const precision = settled \? ASTROCART_RETAINED_TERMINAL_PRECISION : "preview"/);
  assert.match(movingLifecycle, /const onStepPublished = [\s\S]*?settled = ![\s\S]*?burstOpen[\s\S]*?requestedVersion \+= 1;[\s\S]*?scheduleMovingRefresh\(\)/);
  assert.match(movingLifecycle, /const onStepSettle = [\s\S]*?if \(!settled\) \{[\s\S]*?settled = true;[\s\S]*?requestedVersion \+= 1/);
});

test("focused map forwards linked-chart arrow press and release without stealing plain map arrows", () => {
  const start = mapSource.indexOf("  let chartKeyboardNavigationEnabled = false;");
  const end = mapSource.indexOf("  window.addEventListener('keydown', (event) => routeChartNavigationKey", start);
  assert.ok(start >= 0 && end > start);
  const messages = [];
  const event = {
    key: "ArrowRight", shiftKey: false, altKey: false, ctrlKey: false, metaKey: false,
    target: { tagName: "CANVAS", isContentEditable: false },
    prevented: false, stopped: false,
    preventDefault() { this.prevented = true; },
    stopPropagation() { this.stopped = true; },
  };
  const context = {
    window: { parent: {} },
    postToParent: (message) => messages.push(message),
    event,
  };
  runInNewContext(`${mapSource.slice(start, end)}\nrouteChartNavigationKey(event, 'keydown');`, context);
  assert.equal(event.prevented, false);
  assert.equal(messages.length, 0);
  runInNewContext("chartKeyboardNavigationEnabled = true; routeChartNavigationKey(event, 'keydown'); routeChartNavigationKey(event, 'keyup');", context);
  assert.equal(event.prevented, true);
  assert.equal(event.stopped, true);
  assert.deepEqual(messages.map((message) => [message.eventType, message.key]), [
    ["keydown", "right"], ["keyup", "right"],
  ]);
  assert.match(source, /payload\.type === "navigation-key"[\s\S]*?navigation\.onNavigateHint\?\.\(payload\.key/);
  assert.match(source, /payload\.type === "navigation-key"[\s\S]*?navigation\.onNavigateHintEnd\?\.\(payload\.key\)/);
});

test("print capture fetches precise modes sequentially into request-local state", () => {
  const printLifecycle = sourceBetween(
    "const requestPrintAtlas = React.useCallback",
    "  const cancelPrintAtlasRequests = React.useCallback",
  );
  assert.doesNotMatch(printLifecycle, /Promise\.all/);
  assert.match(
    printLifecycle,
    /for \(const mode of captureContext\.lineModes\)/,
  );
  assert.match(
    printLifecycle,
    /const preciseModeCache = new Map<[\s\S]*?AstrocartModeCacheEntry[\s\S]*?>\(\);/,
  );
  assert.match(
    printLifecycle,
    /fetchAstrocartModePayload\([\s\S]*?"precise"[\s\S]*?controller\.signal/,
  );
  assert.match(
    printLifecycle,
    /payload\.meta\?\.precision !== "precise"/,
  );
  assert.match(printLifecycle, /payload\.meta\.specKey !== captureSpecKey/);
  assert.match(
    printLifecycle,
    /astrocartPayloadModeSpecKey\(payload, mode\) === expectedModeSpecKey/,
  );
  assert.ok(
    printLifecycle.indexOf("printAtlasRequestsRef.current.set") <
      printLifecycle.indexOf("void (async () =>"),
    "the request must be registered before precise fetching starts",
  );
});

test("exact geometry crosses only the capture message and stale work is cancelled", () => {
  const printLifecycle = sourceBetween(
    "const requestPrintAtlas = React.useCallback",
    "  const cancelPrintAtlasRequests = React.useCallback",
  );
  const captureMessage = sourceBetween(
    'type: "aries.capturePrintAtlas"',
    "        } catch (err)",
  );
  assert.match(captureMessage, /geojson: composed\.payload/);
  assert.doesNotMatch(printLifecycle, /aries\.setData/);

  const cancellationLifecycle = sourceBetween(
    "const cancelPrintAtlasRequests = React.useCallback",
    "  React.useLayoutEffect(() =>",
  );
  assert.match(cancellationLifecycle, /request\.controller\.abort\(\)/);
  assert.match(cancellationLifecycle, /request\.cancelChild\(\)/);
  assert.match(cancellationLifecycle, /if \(!active\) cancelPrintAtlasRequests\(\)/);
  assert.match(cancellationLifecycle, /dataGenerationKey/);
});
