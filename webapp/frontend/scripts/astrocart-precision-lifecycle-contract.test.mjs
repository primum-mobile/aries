// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  new URL(
    "../src/components/workshell/workspace-content.tsx",
    import.meta.url,
  ),
  "utf8",
);

function sourceBetween(start, end) {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `missing source marker: ${start}`);
  const endIndex = source.indexOf(end, startIndex);
  assert.notEqual(endIndex, -1, `missing source marker: ${end}`);
  return source.slice(startIndex, endIndex);
}

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
    /payload\.meta\.modeSpecKey === expectedModeSpecKey/,
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
