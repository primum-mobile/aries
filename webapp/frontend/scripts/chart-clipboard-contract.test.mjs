// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const frontendRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function readSource(path) {
  return readFileSync(join(frontendRoot, path), "utf8");
}

test("encoded chart PNG bytes are decoded before the native clipboard write", () => {
  const shellHost = readSource("src/lib/shell-host.ts");
  const cargoManifest = readSource("src-tauri/Cargo.toml");

  assert.match(shellHost, /const image = await Image\.fromBytes\(bytes\);/);
  assert.match(shellHost, /await writeImage\(image\);/);
  assert.match(shellHost, /finally \{\s*await image\.close\(\);/);
  assert.doesNotMatch(shellHost, /await writeImage\(bytes\);/);
  assert.match(cargoManifest, /features = \["image-png"\]/);
});

test("chart copy uses the retained PNG renderer rather than a second export path", () => {
  const homeClient = readSource("src/components/workshell/home-client.tsx");
  const copyControl = readSource("src/components/workshell/chart-copy-control.tsx");
  const workspaceContent = readSource("src/components/workshell/workspace-content.tsx");
  const renderer = readSource("src/lib/chart/chart-export-renderer.ts");
  const registry = readSource("src/lib/chart/chart-export-registry.ts");

  assert.match(homeClient, /pngChartAppearance \?\? "screen"/);
  assert.match(homeClient, /pngIncludeOverlays \?\? true/);
  assert.match(
    homeClient,
    /host\.copyImage\(rendered\.pngBytes, "image\/png"\)/,
  );
  assert.match(
    renderer,
    /return \{ width: EXPORT_LONG_EDGE, height: EXPORT_LONG_EDGE \};/,
  );
  assert.match(renderer, /radixOverlayTopLeftLines\(corner, snapshot\.radixChart\)/);
  assert.match(workspaceContent, /radixOverlayTopLeftLines\(cornerChart, chart\.radixChart\)/);
  assert.match(registry, /const PNG_EXPORT_PIXEL_SIZE = 1200;/);
  assert.match(
    registry,
    /canvas\.width = squarePng \? PNG_EXPORT_PIXEL_SIZE/,
  );
  assert.match(homeClient, /renderExport\("png", "bytes"\)/);
  assert.doesNotMatch(homeClient, /decodeBase64Bytes\(rendered\.pngBase64\)/);
  assert.match(copyControl, /data-chart-copy-feedback=\{phase\}/);
  assert.match(copyControl, /"idle" \| "confirmed" \| "done"/);
  assert.match(copyControl, /setPhase\("confirmed"\)/);
  assert.match(copyControl, /setPhase\("done"\)/);
  assert.match(copyControl, /queueMicrotask\(\(\) => \{\s*void onCopy\(\);/);
  assert.doesNotMatch(copyControl, /hover:bg-sidebar-accent/);
  assert.doesNotMatch(copyControl, /createContext|onTransitionEnd|fadeFallback|pointerInside/);
  assert.match(
    workspaceContent,
    /<ChartCopyControl[\s\S]*?<TitleText parts=\{parts\} \/>\s*<\/ChartCopyControl>/,
  );
  assert.match(
    copyControl,
    /className=\{cn\(\s*"group flex min-w-0 max-w-full/,
  );
  assert.match(copyControl, /group-hover:opacity-100/);
});
