// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const frontendRoot = resolve(scriptDir, "..");
const repoRoot = resolve(frontendRoot, "../..");
const generatorPath = resolve(scriptDir, "generate-style-profile-catalog.mjs");
const catalogPath = resolve(repoRoot, "webapp/daemon/style_profile_catalog_generated.py");
const client = readFileSync(
  resolve(frontendRoot, "src/app/style-lab/style-lab-client.tsx"),
  "utf8",
);
const chartCanvas = readFileSync(
  resolve(frontendRoot, "src/components/workshell/chart-canvas.tsx"),
  "utf8",
);
const chartStylePanel = readFileSync(
  resolve(frontendRoot, "src/components/workshell/chart-style-panel.tsx"),
  "utf8",
);
const workspaceContent = readFileSync(
  resolve(frontendRoot, "src/components/workshell/workspace-content.tsx"),
  "utf8",
);
const daemonClient = readFileSync(
  resolve(frontendRoot, "src/lib/daemon/client.ts"),
  "utf8",
);
const styleLabClient = readFileSync(
  resolve(frontendRoot, "src/lib/style-lab/client.ts"),
  "utf8",
);
const wheelStyleScene = readFileSync(
  resolve(frontendRoot, "src/lib/style-lab/wheel-style-scene.ts"),
  "utf8",
);
const themeProvider = readFileSync(
  resolve(frontendRoot, "src/components/workshell/theme-provider.tsx"),
  "utf8",
);
const launcher = readFileSync(
  resolve(frontendRoot, "scripts/style-lab-up.sh"),
  "utf8",
);
const nextConfig = readFileSync(resolve(frontendRoot, "next.config.ts"), "utf8");

function loadGeneratedCatalog() {
  const source = readFileSync(catalogPath, "utf8");
  const match = source.match(/_CATALOG = json\.loads\(r'''([\s\S]*?)'''\)/);
  assert.ok(match, "generated Python catalog must contain its embedded JSON payload");
  return JSON.parse(match[1]);
}

const catalog = loadGeneratedCatalog();
const variants = (suffix) => catalog.tokens[`renderer.wheel.${suffix}`]?.variantApplicability;

test("stored style fonts reload before a persisted draft is previewed", () => {
  assert.match(chartStylePanel, /loadStoredStyleLabFonts\(controller\.signal\)/);
  assert.match(chartStylePanel, /STYLE_FONT_ASSETS_READY_EVENT/);
});

test("native chart fonts and draft compositor effects survive the live handoff", () => {
  assert.match(themeProvider, /--aries-wheel-font-text/);
  assert.match(themeProvider, /--aries-wheel-font-symbols/);
  assert.match(chartCanvas, /styleEditorCanvasStyle/);
  assert.match(chartCanvas, /Object\.entries\(styleCssOverrides\).*wheel-effect-/s);
  assert.match(chartCanvas, /style=\{styleEditorCanvasStyle\}/);
});

test("compositor effects are offered only by retained layer classes", () => {
  assert.match(chartStylePanel, /classId === "layers\.geometry"/);
  assert.match(chartStylePanel, /classId === "layers\.dynamic"/);
  assert.match(chartStylePanel, /classId === "layers\.outerLabel"/);
  assert.doesNotMatch(
    chartStylePanel,
    /element\.primitive === "surface" \|\| element\.primitive === "group"/,
  );
  assert.doesNotMatch(chartStylePanel, /layerEffectKey\(element\.layer\)/);
});

test("one searchable font picker discovers system and packaged faces on open", () => {
  assert.match(chartStylePanel, /fontWindow\.queryLocalFonts\(\)/);
  assert.match(chartStylePanel, /<InspectorCombobox[\s\S]*onOpenChange=\{\(open\) =>/);
  assert.match(chartStylePanel, /listStyleLabFonts/);
  assert.doesNotMatch(chartStylePanel, /type="file"|uploadFont|installedFonts…/);
});

test("numeric fields provide compact press-and-hold increment chevrons", () => {
  assert.match(chartStylePanel, /function NumberStepperButtons/);
  assert.match(chartStylePanel, /<NumberField\.Increment/);
  assert.match(chartStylePanel, /<NumberField\.Decrement/);
  assert.match(chartStylePanel, /step=\{displayStep\}/);
  assert.match(chartStylePanel, /smallStep=\{displaySmallStep\}/);
  assert.match(chartStylePanel, /precision = fractionDigits\(displaySmallStep\)/);
  assert.doesNotMatch(chartStylePanel, /type="range"/);
});

test("variant changes refresh the selected semantic element", () => {
  assert.match(chartCanvas, /setSceneElements\(nextStyleScene\.elements\)/);
});

test("shared base scope drives inspector controls and direct chart handles", () => {
  assert.match(chartStylePanel, /controlsForElement\(selectedElement, tokenMetadata, authoringEditScope\)/);
  assert.match(chartStylePanel, /styleElementEditScope\(element, editScope\)/);
  assert.match(chartCanvas, /authoringScope:\s*styleAuthoringEditScope === "base" \? "base" : profile/);
  assert.match(wheelStyleScene, /input\.authoringScope \?\? geometry\.profile/);
});

test("the inspector switcher is exhaustive without exposing scene hierarchy ids", () => {
  assert.match(chartStylePanel, /WHEEL_SEMANTIC_CLASS_MANIFEST/);
  assert.match(chartStylePanel, /isWheelSemanticClassId\(classId\)/);
  assert.match(chartStylePanel, /styleLab\.class\.hiddenEditable/);
  assert.match(chartStylePanel, /styleLab\.class\.notApplicable/);
  assert.match(chartStylePanel, /definition\.applicability\.previewStateId/);
  assert.match(chartStylePanel, /isManifestPlaceholderElement/);
});

test("the sidecar owns a chart picker selection instead of following the app document", () => {
  assert.match(client, /<SystemChartPicker[\s\S]*onPickRow=\{openPickedChart\}/);
  assert.match(client, /styleLabChartSourceId\(row\)/);
  assert.match(client, /primarySourceId/);
  assert.match(client, /comparisonSourceId/);
  assert.doesNotMatch(client, /activeDocumentId/);
  assert.doesNotMatch(client, /workspaceOpen/);
});

test("the sidecar previews wheel variants and chart layers without mutating Aries options", () => {
  assert.match(client, /round-classic/);
  assert.match(client, /round-compact/);
  assert.match(client, /round-anglo/);
  assert.match(client, /fetchStyleLabPreviewManifest/);
  assert.match(client, /fetchStyleLabPreviewSnapshot\(previewRequest/);
  assert.match(client, /styleGestureActive/);
  assert.match(client, /gestureStart !== null/);
  assert.match(client, /fixtureState: \{\}/);
  assert.match(styleLabClient, /\/api\/style-lab\/preview-schema/);
  assert.match(styleLabClient, /\/api\/style-lab\/preview-snapshot/);
  assert.doesNotMatch(client, /patchOptions|TitlebarOptionsMenu|SettingsDialog/);
  assert.doesNotMatch(styleLabClient, /\/api\/options/);
  assert.doesNotMatch(daemonClient, /style-lab\/preview-snapshot/);
});

test("the chart style lab is a standalone sidecar, not Aries app chrome", () => {
  assert.doesNotMatch(client, /ThemeProvider|TitlebarOptionsMenu|SettingsDialog/);
  assert.match(client, /appControlsEnabled=\{false\}/);
  assert.match(client, /inheritAppTheme=\{false\}/);
  assert.doesNotMatch(workspaceContent, /ChartStylePanel|Paintbrush|handleToggleStyleEditor/);
});

test("sidecar drafts stay agent-live without activating the Aries app profile", () => {
  assert.match(chartStylePanel, /fetchCurrentStyleLabDraft/);
  assert.match(chartStylePanel, /patchCurrentStyleLabDraft/);
  assert.match(chartStylePanel, /commitCurrentStyleLabDraft/);
  assert.match(chartStylePanel, /activate:\s*false/);
  assert.doesNotMatch(chartStylePanel, /activate:\s*true/);
});

test("the sidecar authenticates readiness and survives its launcher shell", () => {
  assert.match(launcher, /\/api\/style-lab\/catalog\?q=__aries_style_lab_probe__/);
  assert.match(launcher, /ARIES_NEXT_DIST_DIR=\.next-style-lab/);
  assert.match(launcher, /start_new_session=True/);
  assert.doesNotMatch(launcher, /tauri-daemon\.json/);
  assert.match(nextConfig, /ARIES_NEXT_DIST_DIR/);
});

test("the checked-in style profile catalog matches the generator", () => {
  const result = spawnSync(process.execPath, [generatorPath, "--check"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("wheel variant applicability follows renderer behavior, not token names", () => {
  const all = ["classic", "compact", "anglo"];
  const nonAnglo = ["classic", "compact"];

  // Compact reuses these Classic renderer inputs.
  assert.deepEqual(variants("metric.classicDegreeTickLength"), nonAnglo);
  assert.deepEqual(variants("metric.classicPlanetSectorLength"), nonAnglo);
  assert.deepEqual(variants("metric.classicOuterProjectedLine"), nonAnglo);
  assert.deepEqual(variants("metric.aspectClassicWidth"), nonAnglo);
  assert.deepEqual(variants("metric.aspectClassicDashOn"), nonAnglo);

  // These renderer paths never run for Anglo wheels.
  assert.deepEqual(variants("metric.mediumStrokeBase"), nonAnglo);
  assert.deepEqual(variants("metric.chartRingStrokeMin"), nonAnglo);
  assert.deepEqual(variants("metric.degreeTickStrokeLarge"), nonAnglo);
  assert.deepEqual(variants("metric.houseClassicOffsetScale"), nonAnglo);
  assert.deepEqual(variants("metric.biwheelOuterPlanetSector"), nonAnglo);

  // These inputs are genuinely profile-specific.
  assert.deepEqual(variants("metric.classicInnerBase"), ["classic"]);
  assert.deepEqual(variants("metric.classicRetrogradeOffset"), ["classic"]);
  assert.deepEqual(variants("metric.classicSignScale"), ["classic"]);
  assert.deepEqual(variants("metric.compactBase"), ["compact"]);
  assert.deepEqual(variants("metric.compactRetrogradeInset"), ["compact"]);
  assert.deepEqual(variants("metric.compactSignScale"), ["compact"]);
  assert.deepEqual(variants("metric.angleLabelScale"), ["anglo"]);
  assert.deepEqual(variants("metric.angleLabelWeight"), ["anglo"]);
  assert.deepEqual(variants("metric.angloHouseScale"), ["anglo"]);
  assert.deepEqual(variants("metric.aspectAngloWidth"), ["anglo"]);

  // "Compact" here describes viewport chrome, not the Compact wheel profile.
  assert.deepEqual(variants("metric.overlayCompactBreakpoint"), all);
  assert.deepEqual(variants("metric.overlayCompactInfoFontScale"), all);
  assert.deepEqual(variants("metric.houseLabelScale"), all);
  assert.deepEqual(variants("metric.hairlineStroke"), all);
  assert.deepEqual(variants("metric.geometryBlur"), all);
});

test("variant applicability is complete for wheel tokens and absent elsewhere", () => {
  for (const [semanticId, token] of Object.entries(catalog.tokens)) {
    if (semanticId.startsWith("renderer.wheel.")) {
      assert.ok(
        Array.isArray(token.variantApplicability) && token.variantApplicability.length > 0,
        `${semanticId} must declare at least one wheel variant`,
      );
      continue;
    }
    assert.equal(
      token.variantApplicability,
      null,
      `${semanticId} must not gain wheel-only applicability metadata`,
    );
  }
});
