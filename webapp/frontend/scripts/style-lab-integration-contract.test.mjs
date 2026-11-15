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
const cssTokenValue = readFileSync(
  resolve(frontendRoot, "src/lib/css-token-value.ts"),
  "utf8",
);
const tokenMetadata = readFileSync(
  resolve(frontendRoot, "src/lib/style-lab/token-metadata.ts"),
  "utf8",
);
const editorStore = readFileSync(
  resolve(frontendRoot, "src/stores/chart-style-editor-store.ts"),
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
const homeClient = readFileSync(
  resolve(frontendRoot, "src/components/workshell/home-client.tsx"),
  "utf8",
);
const manifestService = readFileSync(
  resolve(frontendRoot, "../daemon/manifest_service.py"),
  "utf8",
);
const manifestShortcuts = readFileSync(
  resolve(frontendRoot, "src/shortcuts/manifest-shortcuts.ts"),
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
const themeSession = readFileSync(
  resolve(frontendRoot, "src/lib/style-lab/theme-session.ts"),
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

test("inherited color tokens resolve through the active theme instead of neutral gray", () => {
  assert.equal(
    catalog.tokens["renderer.astrolabe.color.horizon"].default,
    "var(--morinus-angles)",
  );
  assert.match(tokenMetadata, /defaultReference:/);
  assert.match(tokenMetadata, /tokenByCssVar\.get\(cssVar\)\?\.semanticId/);
  assert.match(editorStore, /function createChartStyleTokenBaseReader\(/);
  assert.match(editorStore, /token\.defaultReference/);
  assert.match(editorStore, /createChartStyleTokenBaseReader\(metadata, baseTheme\)/);
  assert.match(cssTokenValue, /function resolveCssCustomPropertyValue\(/);
  assert.match(cssTokenValue, /while \(!seen\.has\(current\)\)/);
  assert.match(chartStylePanel, /createChartStyleTokenBaseReader\(tokenMetadata, baseTheme\)/);
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

test("pattern and shadow parameters stay in their material group, not Geometry", () => {
  // Pattern spacing and dot size bind as `spacing`, the shadow offsets as
  // `offset`; the section is chosen from the material property first so they
  // sit with the pattern or shadow they shape, on both tabs, in one order.
  const sectionStart = chartStylePanel.indexOf("function inspectorSectionFor(");
  const sectionSource = chartStylePanel.slice(
    sectionStart,
    chartStylePanel.indexOf("\n}\n", sectionStart),
  );
  const materialFirst = sectionSource.indexOf("surfaceMaterialProperty(element, control)");
  assert.ok(materialFirst >= 0, "material properties must be classified before numeric bindings");
  assert.ok(materialFirst < sectionSource.indexOf('property === "spacing"'));
  let previous = -1;
  for (const property of ["cellSize", "dotSize", "density", "angle", "seed"]) {
    const current = appThemeControls.indexOf(`label={t("styleLab.app.material.${property}")}`);
    assert.ok(current > previous, `${property} must follow its predecessor on the Application tab`);
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

test("titlebar options opens the workspace style editor", () => {
  // The shared Options tree carries the item; the drawer renders that tree.
  assert.match(manifestService, /"id": "open-style-lab",\s*"label": "Chart Style Lab",\s*"labelKey": "styleLab\.title"/);
  assert.match(titlebarOptionsMenu, /ManifestMenuItems/);
  assert.match(homeClient, /command === "open-style-lab"/);
  assert.match(manifestShortcuts, /Boolean\(parsed\.requireShift\) !== gesture\.shiftKey/);
  assert.match(workspaceContent, /styleEditorOpen/);
  assert.match(workspaceContent, /<ChartStylePanel[\s\S]*onClose=/);
  assert.doesNotMatch(settingsDialog, /value === "stylelab"/);
});

test("editor drafts stay live without activating the Aries app profile", () => {
  assert.match(chartStylePanel, /fetchCurrentStyleLabDraft/);
  assert.match(chartStylePanel, /patchCurrentStyleLabDraft/);
  assert.match(themeSession, /commitCurrentStyleLabDraft\(\{[^}]*activate:\s*false/);
});

test("a chart-scale drag scales the painted layers and writes once on release", () => {
  // Each move only transforms the retained canvases; no store write, no repaint.
  assert.match(chartCanvas, /drag\.handle\.elementId === WHEEL_STYLE_SCENE_ELEMENT_IDS\.chartScale\) \{\s*previewChartScale\(patch, drag\.handle\);/);
  assert.doesNotMatch(chartCanvas, /const previewChartScale[\s\S]{0,1200}setStyleOverride/);
  // Release records the on-screen transform and writes the value once.
  assert.match(chartCanvas, /retainedPaintTransformRef\.current = scalePreview\.transform;[\s\S]{0,120}applyStyleHandlePatch\(scalePreview\.patch\)/);
  // Escape drops the preview before cancelling the gesture.
  assert.match(chartCanvas, /clearChartScalePreview\(\);\s*cancelStyleGesture\(CANVAS_GESTURE_OWNER\)/);
});

test("every handle drag paints a local preview and writes the store once on release", () => {
  // Moves preview through the store's own pure edit, never through setOverride.
  assert.match(chartCanvas, /\} else if \(patch\) \{\s*previewStyleHandlePatch\(patch, drag\.handle, point\);/);
  assert.match(chartCanvas, /const previewStyleHandlePatch[\s\S]{0,1600}applyOverrideEdit\(state, patch\.semanticId/);
  assert.doesNotMatch(chartCanvas, /const previewStyleHandlePatch[\s\S]{0,1600}setStyleOverride\(/);
  assert.match(chartCanvas, /if \(handlePatch\) applyStyleHandlePatch\(handlePatch\);\s*setStyleDragPreview\(null\);/);
  // Pointing aids wait for the paint after release.
  assert.match(chartCanvas, /const refreshHitRegions = !handleDragActive && \(/);
  assert.match(editorStore, /setOverride: \(semanticId, value, radiusTarget\) => set\(\(state\) => applyOverrideEdit\(state, semanticId, value, radiusTarget\)\)/);
});

test("the app theme follows style values, not the editor revision", () => {
  assert.match(themeProvider, /useShallow\(\(state\) => state\.cssOverrides\)/);
  assert.doesNotMatch(themeProvider, /state\.revision/);
});

test("the theme menu holds Rename, Revert, Restore factory and Delete", () => {
  const menu = chartStylePanel.match(/<DropdownMenu>[\s\S]*?<\/DropdownMenu>/)?.[0] ?? "";
  assert.match(menu, /styleLab\.themeMenu\.label/);
  for (const action of ["renameTheme", "revert", "restoreFactoryTheme", "deleteTheme"]) {
    assert.match(menu, new RegExp(`styleLab\\.action\\.${action}"`));
  }
  // Factory reset and Delete live only in the menu.
  for (const action of ["restoreFactoryTheme", "deleteTheme"]) {
    assert.equal(chartStylePanel.split(`styleLab.action.${action}`).length - 1, 1, action);
  }
  assert.match(chartStylePanel, /onSubmit=\{nameForm === "rename" \? renameTheme : saveAsTheme\}/);
});

test("the footer saves on request and lights Revert on the first edit", () => {
  const footer = chartStylePanel.match(/<footer[\s\S]*?<\/footer>/)?.[0] ?? "";
  assert.match(footer, /disabled=\{!canRevert\}\s*onClick=\{revertWorkingDraft\}/);
  assert.match(footer, /disabled=\{!canSaveAs \|\| nameForm != null \|\| !\(modifiedFromBaseline \|\| pending\)\}\s*onClick=\{save\}/);
  for (const action of ["revert", "saveAsTheme", "import", "export", "commit"]) {
    assert.match(footer, new RegExp(`styleLab\\.action\\.${action}"`));
  }
  // Only Save writes the theme: closing, switching or importing keeps the
  // working copy parked instead.
  assert.equal(chartStylePanel.split("saveWorkingTheme(").length - 1, 1);
  assert.match(chartStylePanel, /const save = useCallback[\s\S]{0,400}saveWorkingTheme\(conflictMessageRef\.current\)/);
  assert.match(chartStylePanel, /useEffect\(\(\) => \(\) => \{[\s\S]{0,300}flushSyncRef\.current\(\);\s*\}, \[\]\);/);
  // Nothing changed means nothing is written.
  assert.match(themeSession, /return null;\s*\}\s*let revision/);
});

test("the editor follows the daemon's draft pushes instead of polling", () => {
  const draftEvents = readFileSync(resolve(frontendRoot, "src/lib/style-lab/draft-events.ts"), "utf8");
  const workspaceStore = readFileSync(resolve(frontendRoot, "src/stores/daemon-workspace-store.ts"), "utf8");
  assert.match(draftEvents, /export function subscribeStyleDraftChanges/);
  assert.match(workspaceStore, /case "style\.draft\.changed":\s*publishStyleDraftChange\(/);
  // A reconnect may have dropped events, so it asks the editor to re-read once.
  assert.match(workspaceStore, /void syncState\("socket-open"\);\s*publishStyleDraftChange\(null\)/);
  assert.match(chartStylePanel, /subscribeStyleDraftChanges\(/);
  assert.doesNotMatch(chartStylePanel, /setInterval/);
  // A rejected write re-reads the draft and retries instead of stopping.
  assert.match(chartStylePanel, /rebaseAndRetry\(state\.remoteDraftId\)/);
  // A failed first load retries; there is no silent local-only mode.
  assert.doesNotMatch(editorStore, /\| "local"/);
});

test("the editor footer speaks only about failures and finished actions", () => {
  assert.doesNotMatch(chartStylePanel, /<CloudOff|<Cloud /);
  assert.match(chartStylePanel, /const footerMessage = writeFailed/);
  assert.match(chartStylePanel, /styleLab\.action\.retry/);
});

test("the editor saves the current revision as a separately named theme", () => {
  assert.match(styleLabClient, /saveCurrentStyleLabDraftAsTheme/);
  assert.match(styleLabClient, /encodeURIComponent\(draftId\)\}\/save-as/);
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
  assert.match(appThemeControls, /deriveLinkedPalette/);
  assert.match(appThemeControls, /UI_TYPEFACE_TOKEN\s*=\s*"app\.type\.familyUi"/);
  assert.match(appThemeControls, /"'FreeSans', ui-sans-serif, system-ui, sans-serif"/);
  assert.match(appThemeControls, /"'Kosugi Aries', 'FreeSans', ui-sans-serif, system-ui, sans-serif"/);
  assert.match(appThemeControls, /"'DotGothic16', 'FreeSans', ui-sans-serif, system-ui, sans-serif"/);
  assert.match(appThemeControls, /"system-ui, sans-serif"/);
  assert.doesNotMatch(appThemeControls, /"'Aries UI', 'FreeSans'/);
  assert.doesNotMatch(appThemeControls, /"'Kosugi', 'FreeSans'/);
  assert.doesNotMatch(appThemeControls, /Helvetica, "Helvetica Neue"/);
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
  assert.match(chartStylePanel, /fetchStyleLabDraftExport\(binding\.draftId, undefined, binding\)/);
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
    /data-right-pane-module=\{activePaneKind \?\? undefined\}[\s\S]*\[&>\*\]:bg-transparent/,
  );
  assert.match(notesPanel, /data-aries-surface="panel"/);
  assert.match(transitSearchView, /data-aries-surface="panel"/);
});

test("retained floating chrome reaches the active overlay and popover material profiles", () => {
  for (const [name, source] of [
    ["dialog", dialogPrimitive],
    ["sheet", sheetPrimitive],
    ["settings confirmation", settingsDialog],
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
  assert.match(styleLabClient, /encodeURIComponent\(draftId\)\}\/revert/);
  assert.match(chartStylePanel, /revertCurrentStyleLabDraft/);
  assert.match(chartStylePanel, /remoteModifiedFromBaseline/);
  assert.match(styleLabClient, /importStyleLabTheme/);
  assert.match(styleLabClient, /\/api\/style-lab\/themes\/import/);
  assert.match(chartStylePanel, /\.jsonl/);
  assert.match(chartStylePanel, /parseThemeExchangeFile/);
  assert.match(
    chartStylePanel,
    /const importThemeFile[\s\S]*applyWheelTheme\(source\.name\)[\s\S]*candidate\.name === source\.name[\s\S]*const exportProfile/,
  );
  assert.doesNotMatch(chartStylePanel, /onClick=\{resetAll\}/);
});

test("ordinary save updates the selected theme while system revert restores factory paint", () => {
  assert.match(themeSession, /commitCurrentStyleLabDraft/);
  assert.match(chartStylePanel, /candidate\.name === draft\.sourceThemeName/);
  assert.match(chartStylePanel, /selectedThemeSource\?\.system === true/);
  assert.match(chartStylePanel, /selectedThemeSource\.factoryModified === true \|\| modifiedFromBaseline/);
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
  assert.match(chartStylePanel, /setLiveAppThemePreview\(true\)/);
  assert.doesNotMatch(chartStylePanel, /applyThemeToApp/);
  assert.match(chartStylePanel, /applyWheelTheme\(source\.name\)/);
});

test("workspace Style Lab previews linked app colors and materials on the real shell", () => {
  assert.match(themeProvider, /liveAppThemePreview/);
  assert.match(themeProvider, /styleLabBaseTheme\.appTokens/);
  assert.match(themeProvider, /styleLabCssOverrides/);
  assert.match(themeProvider, /APP_AUTHORING_OVERRIDE_PREFIX/);
  assert.match(themeProvider, /resolveWindowThemeAppearance\(\s*withSettingsColorPreview\(theme, settingsColorPreview\) \?\? theme,\s*preview,/);
  assert.match(themeProvider, /applyThemeToRoot\(appearance\)/);
  assert.match(themeProvider, /compileThemeAppMaterials\(\s*appearance\.appAuthoring,/);
  const windowTheme = readFileSync(resolve(frontendRoot, "src/lib/shell/theme-window-sync.ts"), "utf8");
  assert.match(windowTheme, /appAuthoring: preview\?\.appAuthoring \?\? theme\.profileOverrides\.appAuthoring/);
  assert.match(appThemeControls, /materialOverrideId\(role, "backgroundColor"\)/);
  assert.match(appThemeControls, /materialOverrideId\(role, "patternColor"\)/);
  assert.match(appThemeControls, /materialOverrideId\(role, "gradientStartColor"\)/);
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

test('band inspector combines width with the linked appearance controls through existing bindings', () => {
  assert.match(chartStylePanel, /sceneElements\.find\(element => styleClassId\(element\) === selectedElement\.appearanceClassId\)/);
  assert.match(chartStylePanel, /\.\.\.controlsForElement\(selectedElement, tokenMetadata, authoringEditScope\),\s*\.\.\.controlsForElement\(selectedAppearanceElement, tokenMetadata, authoringEditScope\)/);
  assert.match(chartStylePanel, /\[authoringEditScope, compositionProfile, selectedElement, selectedAppearanceElement, tokenMetadata\]/);
});

test("copy carries stored values and the footer never shows validator text", () => {
  // Copy takes the stored edit, else the displayed value converted to a
  // writable form (a CSS colour becomes RGB(A)).
  assert.match(chartStylePanel, /function transferValue\([\s\S]{0,700}return colorArray\(value\);/);
  assert.match(chartStylePanel, /const value = transferValue\(control, semanticOverrides\);/);
  // Raw daemon messages go to the console only.
  assert.doesNotMatch(chartStylePanel, /error instanceof Error \? error\.message : String\(error\)\)/);
  assert.match(chartStylePanel, /function userErrorMessage\(error: unknown, t: TFunc\)/);
  // Every key the daemon names is undone and the rest of the queue keeps going.
  assert.match(chartStylePanel, /const named = new Set\(error\.rejectedIds\);[\s\S]{0,200}const rejected = Object\.keys\(delta\)\.filter[\s\S]{0,600}styleLab\.status\.changeUndone[\s\S]{0,80}retryDelay = 80;/);
});

test("Sync works for bands and in either scope", () => {
  // A band picked on the wheel syncs its fill class.
  assert.match(chartStylePanel, /const syncClassId = selectedElement\?\.appearanceClassId && isWheelSemanticClassId\(selectedElement\.appearanceClassId\)/);
  assert.match(chartStylePanel, /\.\.\.wheelClassSyncScope\(syncClassDefinition, targets\),\s*source: sourceVariant,/);
  // No scope or per-style override gate: Sync carries the full look.
  assert.match(chartStylePanel, /const canSyncElement = canCopyElement\s*&& !selectedVintageElement\s*&& syncTargetVariants\.length > 0;/);
  assert.doesNotMatch(chartStylePanel, /styleLab\.sync\.(?:sharedAlready|noOverrides)/);
});

test("the theme menu can use the current wheel's look on all wheel styles", () => {
  const menu = chartStylePanel.match(/<DropdownMenu>[\s\S]*?<\/DropdownMenu>/)?.[0] ?? "";
  assert.match(menu, /onClick=\{syncWholeWheel\}[\s\S]{0,120}styleLab\.action\.syncWholeWheel/);
  // Appearance only, every class that the current wheel style paints.
  assert.match(chartStylePanel, /const syncWholeWheel = useCallback[\s\S]{0,800}buildWholeWheelSyncPatch\(\s*wheelAppearanceOverrides\(semanticOverrides\), compositionProfile, classes,/);
});
