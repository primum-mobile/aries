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
const drawChart = readFileSync(
  resolve(frontendRoot, "src/lib/chart/draw-chart.ts"),
  "utf8",
);
const chartStylePanel = readFileSync(
  resolve(frontendRoot, "src/components/workshell/chart-style-panel.tsx"),
  "utf8",
);
const appThemeControls = readFileSync(
  resolve(frontendRoot, "src/components/workshell/app-theme-controls.tsx"),
  "utf8",
);
const styleLabColorPicker = readFileSync(
  resolve(frontendRoot, "src/components/workshell/style-lab-color-picker.tsx"),
  "utf8",
);
const shellHost = readFileSync(
  resolve(frontendRoot, "src/lib/shell-host.ts"),
  "utf8",
);
const tauriLib = readFileSync(
  resolve(frontendRoot, "src-tauri/src/lib.rs"),
  "utf8",
);
const appThemePreview = readFileSync(
  resolve(frontendRoot, "src/components/workshell/app-theme-preview.tsx"),
  "utf8",
);
const workspaceContent = readFileSync(
  resolve(frontendRoot, "src/components/workshell/workspace-content.tsx"),
  "utf8",
);
const workspaceFrame = readFileSync(
  resolve(frontendRoot, "src/components/workshell/workspace-frame.tsx"),
  "utf8",
);
const titlebarOptionsMenu = readFileSync(
  resolve(frontendRoot, "src/components/workshell/titlebar-options-menu.tsx"),
  "utf8",
);
const settingsDialog = readFileSync(
  resolve(frontendRoot, "src/components/workshell/settings-dialog.tsx"),
  "utf8",
);
const notesPanel = readFileSync(
  resolve(frontendRoot, "src/components/workshell/notes-panel.tsx"),
  "utf8",
);
const transitSearchView = readFileSync(
  resolve(frontendRoot, "src/components/workshell/transit-search-view.tsx"),
  "utf8",
);
const systemChartPicker = readFileSync(
  resolve(frontendRoot, "src/components/workshell/system-chart-picker.tsx"),
  "utf8",
);
const dialogPrimitive = readFileSync(
  resolve(frontendRoot, "src/components/ui/dialog.tsx"),
  "utf8",
);
const sheetPrimitive = readFileSync(
  resolve(frontendRoot, "src/components/ui/sheet.tsx"),
  "utf8",
);
const contextMenuPrimitive = readFileSync(
  resolve(frontendRoot, "src/components/ui/context-menu.tsx"),
  "utf8",
);
const dropdownMenuPrimitive = readFileSync(
  resolve(frontendRoot, "src/components/ui/dropdown-menu.tsx"),
  "utf8",
);
const tooltipPrimitive = readFileSync(
  resolve(frontendRoot, "src/components/ui/tooltip.tsx"),
  "utf8",
);
const commandPrimitive = readFileSync(
  resolve(frontendRoot, "src/components/ui/command.tsx"),
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
const globalStyles = readFileSync(
  resolve(frontendRoot, "src/app/globals.css"),
  "utf8",
);

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

test("live Style Lab edits invalidate every retained chart layer immediately", () => {
  assert.match(chartCanvas, /paintedRenderStyleRevisionRef/);
  assert.match(
    chartCanvas,
    /paintedRenderStyleRevisionRef\.current !== String\(renderStyle\.revision\)/,
  );
  const invalidationStart = chartCanvas.indexOf(
    "if (paintedRenderStyleRevisionRef.current !== String(renderStyle.revision))",
  );
  const drawStart = chartCanvas.indexOf("const drawInitial =", invalidationStart);
  assert.ok(invalidationStart >= 0 && drawStart > invalidationStart);
  const invalidation = chartCanvas.slice(invalidationStart, drawStart);
  for (const layer of ["fill", "geometry", "dynamic", "outerLabel"]) {
    assert.match(invalidation, new RegExp(`dirty\\.${layer} = true`));
  }
  assert.match(
    chartCanvas,
    /paintedRenderStyleRevisionRef\.current = String\(renderStyle\.revision\)/,
  );
  assert.match(
    chartCanvas,
    /chartFontsAreReady\([\s\S]*roleFonts[\s\S]*awaitFonts\([\s\S]*roleFonts/,
  );
});

test("app and browser Style Lab use one anchored continuous color picker", () => {
  assert.match(chartStylePanel, /<StyleLabColorPicker/);
  assert.match(appThemeControls, /<StyleLabColorPicker/);
  assert.doesNotMatch(chartStylePanel, /type="color"/);
  assert.doesNotMatch(appThemeControls, /type="color"/);
  assert.match(styleLabColorPicker, /<Popover\.Trigger/);
  assert.match(
    styleLabColorPicker,
    /<Popover\.Positioner[\s\S]*side="left"[\s\S]*align="start"/,
  );
  assert.match(styleLabColorPicker, /updateFromPointer/);
  assert.match(styleLabColorPicker, /linear-gradient\(to right, #fff, transparent\)/);
  assert.match(styleLabColorPicker, /#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00/);
  assert.match(styleLabColorPicker, /<Pipette/);
  assert.match(styleLabColorPicker, /sampleScreenColor\(\)/);
  assert.match(shellHost, /new EyeDropper\(\)\.open\(\)/);
  assert.match(shellHost, /invoke<string \| null>\("sample_screen_color"\)/);
  assert.match(tauriLib, /NSColorSampler::new\(\)/);
  assert.match(tauriLib, /colorUsingColorSpace\(&NSColorSpace::sRGBColorSpace\(\)\)/);
});

test("theme aspect paint remains adjustable by the live orb appearance modes", () => {
  const start = drawChart.indexOf("function aspectLineStyle(");
  const end = drawChart.indexOf("function drawAspectLines(", start);
  assert.ok(start >= 0 && end > start);
  const source = drawChart.slice(start, end);
  assert.match(
    source,
    /semanticLinePaint\(style,\s*"aspect",\s*standardWidth/,
  );
  assert.match(
    source,
    /thicknessScale[\s\S]*base\.width\s*\/\s*standardWidth/,
  );
  assert.match(source, /width:\s*themed\.width\s*\*\s*thicknessScale/);
  assert.match(source, /opacity:\s*base\.opacity/);
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
  assert.doesNotMatch(chartStylePanel, /uploadStyleLabFont|accept="[^"]*(?:woff|ttf|otf)|installedFonts…/);
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

test("material controls follow the retained paint composition order", () => {
  const order = [
    '"backgroundColor"',
    '"gradientType"',
    '"gradientDirection"',
    '"gradientStartColor"',
    '"gradientEndColor"',
    '"gradientAngle"',
    '"fillPattern"',
    '"patternColor"',
    '"cellSize"',
    '"dotSize"',
    '"density"',
    '"angle"',
    '"seed"',
    '"textureMask"',
    '"maskDirection"',
    '"maskAmount"',
    '"maskAngle"',
    '"shadowPattern"',
    '"shadowColor"',
    '"shadowX"',
    '"shadowY"',
    '"shadowBlur"',
    '"opacity"',
  ];
  const start = chartStylePanel.indexOf("const MATERIAL_PROPERTY_ORDER");
  const end = chartStylePanel.indexOf("] as const;", start);
  assert.ok(start >= 0 && end > start);
  const source = chartStylePanel.slice(start, end);
  let previous = -1;
  for (const property of order) {
    const current = source.indexOf(property);
    assert.ok(current > previous, `${property} must follow its paint predecessor`);
    previous = current;
  }
});

test("material inspectors disclose the paint stack and make shadows explicit", () => {
  for (const group of [
    "fill",
    "texture",
    "mask",
    "compositing",
    "filters",
    "shadow",
  ]) {
    assert.match(chartStylePanel, new RegExp(`\"${group}\"`));
  }
  assert.match(chartStylePanel, /function InspectorPropertyGroup/);
  assert.match(chartStylePanel, /shadowPattern !== "none"/);
  assert.match(chartStylePanel, /\[0, 0, 0, 0\.22\]/);
  assert.match(appThemeControls, /function MaterialGroup/);
  assert.match(appThemeControls, /role="switch"/);
  assert.match(appThemeControls, /styleLab\.group\.shadowOpacity/);
  assert.match(appThemeControls, /rememberedShadowAlpha/);
  assert.match(appThemeControls, /shadowBlur"\), 12/);
});

test("variant changes refresh the selected semantic element", () => {
  assert.match(chartCanvas, /setSceneElements\(nextStyleScene\.elements\)/);
});

test("style selection preserves authored paint behind a neutral contrast outline", () => {
  assert.match(chartCanvas, /pointer-events-none fill-none/);
  assert.match(chartCanvas, /\[stroke:var\(--aries-background\)\]/);
  assert.match(chartCanvas, /\[stroke:var\(--aries-style-lab-selection\)\]/);
  assert.match(globalStyles, /--aries-style-lab-selection:\s*#ff2bd6/);
  assert.doesNotMatch(chartCanvas, /fill-\[rgba\(125,165,255/);
});

test("shared base scope drives inspector controls and direct chart handles", () => {
  assert.match(chartStylePanel, /controlsForElement\(selectedElement, tokenMetadata, authoringEditScope\)/);
  assert.match(chartStylePanel, /styleElementEditScope\(element, editScope\)/);
  assert.match(chartCanvas, /authoringScope:\s*styleAuthoringEditScope === "base" \? "base" : profile/);
  assert.match(wheelStyleScene, /input\.authoringScope \?\? geometry\.profile/);
});

test("Profile V2 line caps and joins are reachable in the inspector", () => {
  assert.match(chartStylePanel, /authoring\?\.lineCap != null/);
  assert.match(chartStylePanel, /authoring\?\.lineJoin != null/);
  assert.match(chartStylePanel, /authoringKind === "line-cap"/);
  assert.match(chartStylePanel, /authoringKind === "line-join"/);
  for (const value of ["butt", "round", "square", "bevel", "miter"]) {
    assert.match(chartStylePanel, new RegExp(`\\["${value}", t\\(`));
  }
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

test("the sidecar remains independent while titlebar options opens the workspace editor", () => {
  assert.doesNotMatch(client, /ThemeProvider|TitlebarOptionsMenu|SettingsDialog/);
  assert.match(client, /appControlsEnabled=\{false\}/);
  assert.match(client, /inheritAppTheme=\{false\}/);
  assert.match(titlebarOptionsMenu, /t\("styleLab\.title"\)/);
  assert.match(titlebarOptionsMenu, /onOpenStyleLab/);
  assert.match(workspaceFrame, /onOpenStyleLab/);
  assert.match(workspaceContent, /styleEditorOpen/);
  assert.match(workspaceContent, /<ChartStylePanel[\s\S]*onClose=/);
  assert.doesNotMatch(settingsDialog, /value === "stylelab"/);
});

test("sidecar drafts stay agent-live without activating the Aries app profile", () => {
  assert.match(chartStylePanel, /fetchCurrentStyleLabDraft/);
  assert.match(chartStylePanel, /patchCurrentStyleLabDraft/);
  assert.match(chartStylePanel, /commitCurrentStyleLabDraft/);
  assert.match(chartStylePanel, /activate:\s*false/);
  assert.doesNotMatch(chartStylePanel, /activate:\s*true/);
});

test("the editor saves the current revision as a separately named theme", () => {
  assert.match(styleLabClient, /saveCurrentStyleLabDraftAsTheme/);
  assert.match(styleLabClient, /CURRENT_DRAFT_PATH\}\/save-as/);
  assert.match(chartStylePanel, /styleLab\.action\.saveAsTheme/);
  assert.match(chartStylePanel, /style-lab-new-theme-name/);
  assert.match(chartStylePanel, /saveCurrentStyleLabDraftAsTheme\(name/);
  assert.match(chartStylePanel, /overrides:\s*delta/);
  assert.match(styleLabClient, /splitStyleLabEditorPatch\(overrides\)/);
  assert.match(chartStylePanel, /fetchStyleLabThemeSources\(\)/);
});

test("the editor authors one portable full-app theme across semantic materials", () => {
  assert.match(chartStylePanel, /\(\["chart", "app"\]\s+as const\)/);
  assert.match(chartStylePanel, /t\(`styleLab\.domain\.\$\{domain\}`\)/);
  assert.match(chartStylePanel, /<AppThemeControls/);
  assert.match(client, /<AppThemePreview/);
  assert.match(appThemePreview, /compileThemeAppMaterials/);
  assert.match(appThemePreview, /resolvedTheme=\{previewTheme\}/);
  assert.match(appThemePreview, /exportRegistrationEnabled=\{false\}/);
  assert.equal(
    appThemePreview.match(/data-aries-surface="canvas"/g)?.length,
    1,
    "the app preview must have exactly one Canvas material paint boundary",
  );
  assert.match(appThemePreview, /data-aries-surface="sidebar"/);
  assert.match(appThemePreview, /data-aries-surface="dataHeader"/);
  assert.match(appThemePreview, /data-aries-surface="overlay"/);
  assert.match(appThemePreview, /\.\.\.baseTheme\.appAuthoring/);
  assert.match(appThemeControls, /deriveLinkedPalette/);
  assert.match(appThemeControls, /UI_TYPEFACE_TOKEN\s*=\s*"app\.type\.familyUi"/);
  assert.match(appThemeControls, /setOverride\(UI_TYPEFACE_TOKEN/);
  assert.match(appThemeControls, /resetProperty\(UI_TYPEFACE_TOKEN\)/);
  assert.match(
    appThemeControls,
    /app\.color\.interactiveAccentForeground/,
  );
  assert.match(
    appThemeControls,
    /app\.sidebar\.accentForeground/,
  );
  assert.match(
    appThemePreview,
    /var\(--aries-sidebar-accent-foreground\)/,
  );
  assert.match(workspaceContent, /resolvedTheme\?: ThemeState \| null/);
  assert.match(workspaceContent, /if \(!exportRegistrationEnabled\) return/);
  assert.match(
    appThemeControls,
    /Object\.hasOwn\(semanticOverrides,\s*CHART_BACKGROUND_TOKEN\)/,
  );
  assert.match(
    appThemeControls,
    /setOverride\(\s*CHART_BACKGROUND_TOKEN,\s*rgbArrayFromHex/,
  );
  assert.match(appThemeControls, /APP_MATERIAL_PATTERNS/);
  assert.match(appThemeControls, /APP_MATERIAL_BLEND_MODES/);
  assert.match(appThemeControls, /DEFAULT_APP_MATERIAL_RECIPE/);
  assert.doesNotMatch(appThemeControls, /baseTheme\.appAuthoring\[/);
  assert.match(appThemeControls, /styleLab\.app\.material\.backgroundAlpha/);
  assert.equal(
    appThemeControls.match(/styleLab\.app\.material\.opacity/g)?.length,
    1,
    "application materials expose one texture-opacity control",
  );
  assert.match(appThemeControls, /currentPattern !== "none"/);
  assert.match(appThemeControls, /styleLab\.app\.material\.foregroundColor/);
  assert.doesNotMatch(appThemeControls, /const PATTERNS\s*=/);
  assert.doesNotMatch(appThemeControls, /const MATERIAL_DEFAULTS\s*=/);
  assert.match(styleLabClient, /appAuthoringOverrides/);
  assert.match(styleLabClient, /APP_AUTHORING_OVERRIDE_PREFIX/);
  assert.match(styleLabClient, /type StyleLabPortableProfile/);
  assert.match(styleLabClient, /kind:\s*"aries\.style-profile"/);
  assert.match(styleLabClient, /fetchStyleLabDraftExport/);
  assert.match(
    styleLabClient,
    /\/api\/style-lab\/drafts\/\$\{encodeURIComponent\(draftId\)\}\/export/,
  );
  assert.match(chartStylePanel, /fetchStyleLabDraftExport\(\)/);
  assert.match(chartStylePanel, /\.aries-theme\.json/);
});

test("app materials paint visible document and retained-pane surfaces", () => {
  assert.doesNotMatch(
    workspaceFrame,
    /<SidebarInset[\s\S]{0,160}data-aries-surface="canvas"/,
  );
  assert.match(
    workspaceContent,
    /function WorkspaceDocumentSurface[\s\S]*data-aries-surface="canvas"[\s\S]*\[&>\*\]:bg-transparent/,
  );
  for (const chartOwnedSurface of [
    "AstrolabeView",
    "AstrologSphereView",
    "SquareChartView",
    "MundaneChartView",
    "GraphEphemerisView",
    "ChartSurface",
  ]) {
    assert.doesNotMatch(
      workspaceContent,
      new RegExp(
        `<WorkspaceDocumentSurface>[\\s\\S]{0,80}<${chartOwnedSurface}`,
      ),
    );
  }
  assert.match(
    workspaceContent,
    /function RightInspectorPaneFrame[\s\S]*data-aries-surface="panel"[\s\S]*\[&>\*\]:bg-transparent/,
  );
  assert.match(
    workspaceContent,
    /data-right-pane-module="astrocart-controls"[\s\S]*\[&>\*\]:bg-transparent/,
  );
  assert.match(notesPanel, /data-aries-surface="panel"/);
});

test("retained floating chrome reaches the active overlay and popover material profiles", () => {
  for (const [name, source] of [
    ["dialog", dialogPrimitive],
    ["sheet", sheetPrimitive],
    ["settings confirmation", settingsDialog],
    ["transit filter drawer", transitSearchView],
    ["chart picker modals", systemChartPicker],
  ]) {
    assert.match(
      source,
      /data-aries-surface="overlay"/,
      `${name} must resolve the active overlay material`,
    );
  }
  for (const [name, source] of [
    ["context menu", contextMenuPrimitive],
    ["dropdown menu", dropdownMenuPrimitive],
    ["tooltip", tooltipPrimitive],
    ["command palette", commandPrimitive],
    ["Style Lab popups", chartStylePanel],
  ]) {
    assert.match(
      source,
      /data-aries-surface="popover"/,
      `${name} must resolve the active popover material`,
    );
  }
});

test("revert restores the saved draft baseline and exchange files import as themes", () => {
  assert.match(styleLabClient, /revertCurrentStyleLabDraft/);
  assert.match(styleLabClient, /CURRENT_DRAFT_PATH\}\/revert/);
  assert.match(chartStylePanel, /revertCurrentStyleLabDraft/);
  assert.match(chartStylePanel, /remoteModifiedFromBaseline/);
  assert.match(styleLabClient, /importStyleLabTheme/);
  assert.match(styleLabClient, /\/api\/style-lab\/themes\/import/);
  assert.match(chartStylePanel, /\.jsonl/);
  assert.match(chartStylePanel, /parseThemeExchangeFile/);
  assert.match(
    chartStylePanel,
    /const importThemeFile[\s\S]*if \(applyThemeToApp\)[\s\S]*applyThemePreset\(source\.name\)[\s\S]*candidate\.name === source\.name[\s\S]*const exportProfile/,
  );
  assert.doesNotMatch(chartStylePanel, /onClick=\{resetAll\}/);
});

test("ordinary save updates the selected theme while system revert restores factory paint", () => {
  assert.match(chartStylePanel, /commitCurrentStyleLabDraft/);
  assert.match(chartStylePanel, /candidate\.name === draft\.sourceThemeName/);
  assert.match(chartStylePanel, /source\?\.system === true/);
  assert.match(chartStylePanel, /source\.factoryModified === true/);
  assert.match(chartStylePanel, /factoryDefault/);
  assert.match(styleLabClient, /factoryDefault\?: boolean/);
});

test("saved user themes can be deleted while bundled presets stay protected", () => {
  assert.match(styleLabClient, /deleteStyleLabTheme/);
  assert.match(styleLabClient, /\/api\/style-lab\/themes\//);
  assert.match(styleLabClient, /method:\s*"DELETE"/);
  assert.match(chartStylePanel, /selectedThemeSource\?\.deletable/);
  assert.match(chartStylePanel, /selectedThemeSource\.profileId/);
  assert.match(chartStylePanel, /DeleteThemeDialog/);
  assert.match(chartStylePanel, /deleteStyleLabTheme\(target\.profileId\)/);
  assert.match(chartStylePanel, /discardCurrentStyleLabDraft/);
  assert.match(chartStylePanel, /candidate\.selected/);
  assert.match(chartStylePanel, /candidate\.name === "Daylight"/);
});

test("the editor opens actual Aries theme presets as retained safe drafts", () => {
  assert.match(styleLabClient, /\/api\/style-lab\/theme-sources/);
  assert.match(styleLabClient, /sourceThemeName/);
  assert.match(chartStylePanel, /fetchStyleLabThemeSources/);
  assert.match(chartStylePanel, /createStyleLabDraftFromTheme/);
  assert.match(chartStylePanel, /quickopt\.themePresets/);
  assert.match(chartCanvas, /styleLabBaseTheme\.chartPalette/);
  assert.match(client, /styleLabBaseTheme\.appTokens/);
  assert.match(chartStylePanel, /applyThemeToApp/);
  assert.match(chartStylePanel, /applyThemePreset\(source\.name\)/);
  assert.match(workspaceContent, /<ChartStylePanel[\s\S]*applyThemeToApp/);
  assert.doesNotMatch(client, /applyThemeToApp/);
});

test("workspace Style Lab previews linked app colors and materials on the real shell", () => {
  assert.match(themeProvider, /liveAppThemePreview/);
  assert.match(themeProvider, /styleLabBaseTheme\.appTokens/);
  assert.match(themeProvider, /styleLabCssOverrides/);
  assert.match(themeProvider, /APP_AUTHORING_OVERRIDE_PREFIX/);
  assert.match(themeProvider, /compileThemeAppMaterials\([\s\S]*preview\?\.appAuthoring/);
  assert.match(appThemeControls, /materialOverrideId\(role, "backgroundColor"\)/);
  assert.match(appThemeControls, /materialOverrideId\(role, "patternColor"\)/);
  assert.match(appThemeControls, /materialOverrideId\(role, "gradientStartColor"\)/);
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
