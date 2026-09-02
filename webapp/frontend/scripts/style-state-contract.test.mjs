// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  normalizeOptionsStyleIdentity,
  normalizeThemeState,
  styleRevisionKey,
} from "../src/lib/theme/style-state.mjs";

const frontendRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const rootLayout = readFileSync(resolve(frontendRoot, "src/app/layout.tsx"), "utf8");

const legacyTheme = {
  activePreset: "Midnight",
  mode: "dark",
  version: 7,
  paletteHash: "legacy-hash",
  appTokens: { "--aries-background": "rgb(35 36 40)" },
  chartPalette: { "--morinus-frame": "rgb(220 220 221)" },
};

test("legacy cached ThemeState receives compatible style identity", () => {
  const normalized = normalizeThemeState(legacyTheme);
  assert.ok(normalized);
  assert.equal(normalized.schemaVersion, 1);
  assert.equal(normalized.styleRevision, 7);
  assert.equal(normalized.styleHash, "legacy-hash");
  assert.equal(styleRevisionKey(normalized), "1:7:legacy-hash");
  assert.equal(normalized.activeProfile, null);
  assert.deepEqual(normalized.profileOverrides, {
    appTokens: {},
    chartPalette: {},
    chartData: {},
    wheelAuthoring: {},
    appAuthoring: {},
  });
});

test("current ThemeState preserves explicit style identity", () => {
  const normalized = normalizeThemeState({
    ...legacyTheme,
    schemaVersion: 2,
    styleRevision: 11,
    styleHash: "style-hash",
    chartPalette: {
      "--morinus-background": "rgb(8 9 10)",
      "--morinus-text-bright": "rgb(240 241 242)",
    },
    activeProfile: {
      id: "studio",
      name: "Studio",
      scope: "combined",
      basePresetId: "Midnight",
      contentHash: "profile-hash",
    },
    profileOverrides: {
      appTokens: { "--aries-surface": "rgb(12 13 14)" },
      chartPalette: { "--morinus-frame": "rgb(210 211 212)" },
      chartData: { aspects: ["rgb(1 2 3)"] },
      wheelAuthoring: {
        "authoring.wheel.base.houses.inner.cusp.strokeStyle": "dotted",
      },
      appAuthoring: {
        "authoring.app.sidebar.pattern": "blueNoise",
      },
    },
  });
  assert.ok(normalized);
  assert.equal(styleRevisionKey(normalized), "2:11:style-hash");
  assert.deepEqual(normalized.chartPalette, {
    "--morinus-background": "rgb(8 9 10)",
    "--morinus-text-bright": "rgb(240 241 242)",
  });
  assert.equal(normalized.activeProfile.id, "studio");
  assert.deepEqual(normalized.profileOverrides.chartPalette, {
    "--morinus-frame": "rgb(210 211 212)",
  });
  assert.deepEqual(normalized.profileOverrides.chartData, {
    aspects: ["rgb(1 2 3)"],
  });
  assert.deepEqual(normalized.profileOverrides.wheelAuthoring, {
    "authoring.wheel.base.houses.inner.cusp.strokeStyle": "dotted",
  });
  assert.deepEqual(normalized.profileOverrides.appAuthoring, {
    "authoring.app.sidebar.pattern": "blueNoise",
  });
});

test("active profile wheel authoring reaches both live canvas and export", () => {
  const canvas = readFileSync(
    resolve(frontendRoot, "src/components/workshell/chart-canvas.tsx"),
    "utf8",
  );
  const chartExport = readFileSync(
    resolve(frontendRoot, "src/lib/chart/chart-export-renderer.ts"),
    "utf8",
  );
  assert.match(canvas, /effectiveTheme\?\.profileOverrides\?\.wheelAuthoring/);
  assert.match(
    canvas,
    /compileFlatWheelAuthoringOverrides\(\s*effectiveWheelAuthoringOverrides/,
  );
  assert.match(chartExport, /resolvedTheme\?\.profileOverrides\?\.wheelAuthoring/);
});

test("chart export receives the live transient aspect visibility state", () => {
  const surface = readFileSync(
    resolve(frontendRoot, "src/components/workshell/workspace-content.tsx"),
    "utf8",
  );
  const chartExport = readFileSync(
    resolve(frontendRoot, "src/lib/chart/chart-export-renderer.ts"),
    "utf8",
  );
  assert.match(
    surface,
    /\{\s*selectedBody:\s*selectedAspectBody,\s*hideAll:\s*hideAllAspects,\s*minorOnly:\s*minorOnlyAspects,\s*\}/,
  );
  assert.match(chartExport, /layer === "dynamic" \? \{ clickAspectState \} : \{\}/);
});

test("app materials compile at theme application and stay outside chart stepping", () => {
  const themeProvider = readFileSync(
    resolve(frontendRoot, "src/components/workshell/theme-provider.tsx"),
    "utf8",
  );
  const chartCanvas = readFileSync(
    resolve(frontendRoot, "src/components/workshell/chart-canvas.tsx"),
    "utf8",
  );
  const drawChart = readFileSync(
    resolve(frontendRoot, "src/lib/chart/draw-chart.ts"),
    "utf8",
  );
  const appMaterial = readFileSync(
    resolve(frontendRoot, "src/lib/theme/app-material.ts"),
    "utf8",
  );
  const appMaterialRuntime = readFileSync(
    resolve(frontendRoot, "src/lib/theme/app-material-runtime.ts"),
    "utf8",
  );
  assert.match(
    themeProvider,
    /preview\?\.appAuthoring \?\? theme\.profileOverrides\.appAuthoring/,
  );
  assert.match(themeProvider, /liveAppThemePreview/);
  assert.match(themeProvider, /installAppMaterialStyleSheet/);
  assert.match(appMaterial, /shadowColor/);
  assert.match(appMaterial, /shadowBlur/);
  assert.match(appMaterialRuntime, /box-shadow:\$\{material\.boxShadow\}/);
  assert.doesNotMatch(chartCanvas, /app-material(?:-runtime)?/);
  assert.doesNotMatch(drawChart, /app-material(?:-runtime)?/);
});

test("legacy options.changed event receives compatible style identity", () => {
  assert.deepEqual(
    normalizeOptionsStyleIdentity({
      themeVersion: 9,
      paletteHash: "event-hash",
    }),
    {
      schemaVersion: 1,
      themeVersion: 9,
      styleRevision: 9,
      paletteHash: "event-hash",
      styleHash: "event-hash",
    },
  );
});

test("invalid cached ThemeState is rejected", () => {
  assert.equal(normalizeThemeState({ mode: "dark" }), null);
});

test("native controls inherit the active light or dark root color scheme", () => {
  assert.match(rootLayout, /root\.style\.colorScheme = theme\.mode === "light" \? "light" : "dark"/);
  assert.match(rootLayout, /body \{[\s\S]*?color-scheme: inherit;/);
  assert.doesNotMatch(rootLayout, /html,\s*body \{[\s\S]*?color-scheme: dark;/);
});

test("the programmatic chart focus anchor never paints a native WKWebView outline", () => {
  const source = readFileSync(
    resolve(frontendRoot, "src/components/workshell/workspace-content.tsx"),
    "utf8",
  );
  const anchorIndex = source.indexOf('data-workspace-focus-anchor=""');
  assert.notEqual(anchorIndex, -1, "workspace focus anchor is missing");
  const tagStart = source.lastIndexOf("<div", anchorIndex);
  const tagEnd = source.indexOf(">", anchorIndex);
  const anchorTag = source.slice(tagStart, tagEnd);
  assert.match(anchorTag, /className="[^"]*\boutline-none\b[^"]*"/);
  assert.match(source, /chartPaneElement\.focus\(\{ preventScroll: true \}\)/);
});
