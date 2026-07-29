// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const frontendRoot = new URL("../", import.meta.url);

async function source(path) {
  return readFile(new URL(path, frontendRoot), "utf8");
}

async function loadAstrocartModeCompositor() {
  const workspace = await source(
    "src/components/workshell/workspace-content.tsx",
  );
  const start = workspace.indexOf("const ASTROCART_LINE_MODES");
  const end = workspace.indexOf("function toggleAstrocartLineMode", start);
  assert.ok(start >= 0 && end > start, "missing astrocart compositor source");
  const compiled = ts.transpileModule(
    `${workspace.slice(start, end)}
export { composeAstrocartModePayload };
`,
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  const moduleExports = {};
  const context = {
    exports: moduleExports,
    module: { exports: moduleExports },
  };
  vm.runInNewContext(compiled, context);
  return context.module.exports.composeAstrocartModePayload;
}

function astrocartLineFeature(mode, id, labelId, kind, extra = {}) {
  return {
    type: "Feature",
    id: `${mode}:${id}`,
    geometry: {
      type: "MultiLineString",
      coordinates: [[[10, -20], [10, 20]]],
    },
    properties: {
      point: "ephemeris-body:0",
      kind,
      label_id: `${mode}:${labelId}`,
      astrocart_mode: mode,
      astrocart_layer: "natal",
      line_system: mode === "standard" ? "in_mundo" : mode,
      ...extra,
    },
  };
}

function astrocartZenithFeature(
  mode,
  id,
  labelId,
  layer,
  layerId,
  coordinates,
  extra = {},
) {
  const displaySystem = mode === "standard" ? "in_mundo" : mode;
  return {
    type: "Feature",
    id: `${mode}:${id}`,
    geometry: { type: "Point", coordinates },
    properties: {
      point: "ephemeris-body:0",
      kind: "ZENITH",
      label_id: `${mode}:${labelId}`,
      astrocart_mode: mode,
      astrocart_modes: [mode],
      astrocart_layer: layer,
      ...(layerId ? { astrocart_layer_id: layerId } : {}),
      line_system: "in_mundo",
      display_line_system: displaySystem,
      display_line_systems: [displaySystem],
      display_line_system_by_mode: { [mode]: displaySystem },
      ...extra,
    },
  };
}

function astrocartPrimaryPayload(mode) {
  const reverseParan = mode === "geodetic_giza";
  const displaySystem = mode === "standard" ? "in_mundo" : mode;
  return {
    type: "FeatureCollection",
    features: [
      astrocartLineFeature(mode, "static", "static", "MC"),
      astrocartLineFeature(mode, "aspect", "aspect", "ASPECT", {
        aspect_id: "trine",
        target_angle: "ASC",
      }),
      astrocartLineFeature(mode, "dynamic", "dynamic", "MC", {
        astrocart_layer: "transit",
        astrocart_layer_id: "transit:a",
        astrocart_technique: "transit",
      }),
      astrocartLineFeature(mode, "natal-asc", "natal-asc", "ASC", {
        point: "natal_asc",
        natal_angle: true,
      }),
      astrocartZenithFeature(
        mode,
        "natal-zenith",
        "natal-zenith",
        "natal",
        null,
        [12, 34],
      ),
      astrocartZenithFeature(
        mode,
        "transit-a-zenith",
        "transit-a-zenith",
        "transit",
        "transit:a",
        [13, 35],
        {
          astrocart_technique: "transit",
          astrocart_cursor_iso: "2026-07-24T12:00:00Z",
        },
      ),
      astrocartZenithFeature(
        mode,
        "progression-b-zenith",
        "progression-b-zenith",
        "progression",
        "progression:b",
        [14, 36],
        {
          astrocart_technique: "secondary_progression",
          astrocart_cursor_iso: "2026-07-24T12:00:00Z",
        },
      ),
      astrocartZenithFeature(
        mode,
        "transit-c-zenith",
        "transit-c-zenith",
        "transit",
        "transit:c",
        [13, 35],
        {
          astrocart_technique: "transit",
          astrocart_cursor_iso: "2026-07-24T12:00:00Z",
        },
      ),
      {
        type: "Feature",
        id: `${mode}:paran`,
        geometry: {
          type: "LineString",
          coordinates: [[-180, 22], [180, 22]],
        },
        properties: {
          kind: "PARAN",
          a_point: reverseParan ? "ephemeris-body:1" : "ephemeris-body:0",
          a_angle: reverseParan ? "DSC" : "MC",
          b_point: reverseParan ? "ephemeris-body:0" : "ephemeris-body:1",
          b_angle: reverseParan ? "MC" : "DSC",
          label_id: `${mode}:paran`,
          astrocart_mode: mode,
          astrocart_modes: [mode],
          astrocart_layer: "natal",
          line_system: "in_mundo",
          display_line_system: displaySystem,
          display_line_systems: [displaySystem],
          display_line_system_by_mode: { [mode]: displaySystem },
        },
      },
    ],
    meta: { mode, lineSystem: displaySystem },
  };
}

test("astrocart configuration uses the daemon-owned whole-spec contract", async () => {
  const client = await source("src/lib/daemon/client.ts");
  assert.match(
    client,
    /\/api\/workspace\/document\/\$\{encodeURIComponent\(astrocartDocumentId\)\}\/astrocart\/spec/,
  );
  assert.match(client, /workspacePost<AstrocartConfigurationPayload>/);
  assert.match(client, /\{ spec \}/);
  assert.match(client, /defaultSpec: AstrocartMapSpec/);
  assert.match(client, /staticAngleLinePointIds: string\[\]/);
  assert.match(client, /participantIds: string\[\]/);
  assert.match(client, /actorIds: string\[\]/);
  assert.match(client, /movingActorIds: string\[\]/);
  assert.match(client, /export type AstrocartPdfPageFormat = "A4" \| "A3"/);
  assert.match(client, /pointIds: string\[\]/);
  assert.match(client, /lineKinds: string\[\]/);
  assert.match(client, /layerKinds: Array<"natal" \| "transit" \| "progression">/);
  assert.match(client, /aspectIds: string\[\]/);
  assert.match(client, /includeZenith: boolean/);
  assert.match(
    client,
    /\/astrocart\/export`,[\s\S]*params,[\s\S]*signal/,
  );
  assert.match(
    client,
    /\/astrocart\/export-bytes`,[\s\S]*params,[\s\S]*signal/,
  );
  assert.match(client, /params: AstrocartPdfExportOptions & \{ path: string/);
  assert.match(client, /params: AstrocartPdfExportOptions & \{ filename: string/);
});

test("primary mode composition deduplicates only invariant physical overlays", async () => {
  const compose = await loadAstrocartModeCompositor();
  const primaryModes = [
    "standard",
    "geodetic_greenwich",
    "geodetic_giza",
  ];
  const modeSpecKeys = {
    standard: "standard-key",
    geodetic_greenwich: "greenwich-key",
    geodetic_giza: "giza-key",
    local_space: "local-key",
  };
  const cache = new Map(
    primaryModes.map((mode) => [
      mode,
      {
        sessionRevision: 4,
        modeSpecKey: modeSpecKeys[mode],
        precision: "preview",
        payload: astrocartPrimaryPayload(mode),
      },
    ]),
  );
  cache.set("local_space", {
    sessionRevision: 4,
    modeSpecKey: modeSpecKeys.local_space,
    precision: "preview",
    payload: {
      type: "FeatureCollection",
      features: [
        astrocartLineFeature(
          "local_space",
          "local-ray",
          "local-ray",
          "LOCAL_SPACE",
          { astrocart_layer: "natal" },
        ),
        astrocartZenithFeature(
          "local_space",
          "local-zenith",
          "local-zenith",
          "natal",
          null,
          [12, 34],
        ),
      ],
      meta: { mode: "local_space", lineSystem: "local_space" },
    },
  });
  const inputSnapshot = JSON.stringify(
    [...cache.entries()].map(([mode, entry]) => [mode, entry.payload]),
  );

  const result = compose(
    [
      "local_space",
      "geodetic_giza",
      "standard",
      "geodetic_greenwich",
    ],
    4,
    modeSpecKeys,
    cache,
  );
  const payload = JSON.parse(JSON.stringify(result.payload));
  const properties = payload.features.map((feature) => feature.properties);

  assert.equal(result.complete, true);
  assert.deepEqual(payload.meta.modes, [
    "standard",
    "geodetic_greenwich",
    "geodetic_giza",
    "local_space",
  ]);
  assert.equal(payload.features.length, 19);
  assert.equal(
    properties.filter(
      (item) =>
        item.kind === "MC" &&
        item.astrocart_mode !== "local_space",
    ).length,
    6,
  );
  for (const kind of ["ASPECT", "ASC"]) {
    assert.equal(
      properties.filter(
        (item) =>
          item.kind === kind &&
          item.astrocart_mode !== "local_space",
      ).length,
      3,
    );
  }

  const primaryPhysicalFeatures = payload.features.filter(
    (feature) =>
      ["PARAN", "ZENITH"].includes(feature.properties.kind) &&
      feature.properties.astrocart_mode !== "local_space",
  );
  const primaryPhysical = primaryPhysicalFeatures.map(
    (feature) => feature.properties,
  );
  assert.equal(primaryPhysical.length, 5);
  assert.equal(
    primaryPhysical.filter((item) => item.kind === "PARAN").length,
    1,
  );
  assert.deepEqual(
    primaryPhysical
      .map((item) => item.astrocart_layer_id ?? "natal")
      .sort(),
    ["natal", "natal", "progression:b", "transit:a", "transit:c"].sort(),
  );
  for (const item of primaryPhysical) {
    assert.deepEqual(item.astrocart_modes, primaryModes);
    assert.deepEqual(item.display_line_systems, [
      "in_mundo",
      "geodetic_greenwich",
      "geodetic_giza",
    ]);
    assert.deepEqual(item.display_line_system_by_mode, {
      standard: "in_mundo",
      geodetic_greenwich: "geodetic_greenwich",
      geodetic_giza: "geodetic_giza",
    });
    assert.equal(item.astrocart_mode, "standard");
    assert.equal(item.display_line_system, "in_mundo");
    assert.match(item.label_id, /^standard:/);
  }
  assert.ok(
    primaryPhysicalFeatures.every((feature) => /^standard:/.test(feature.id)),
  );

  assert.equal(
    properties.filter((item) => item.astrocart_mode === "local_space").length,
    2,
  );
  const localZenith = properties.find(
    (item) =>
      item.kind === "ZENITH" && item.astrocart_mode === "local_space",
  );
  assert.deepEqual(localZenith.astrocart_modes, ["local_space"]);
  assert.deepEqual(localZenith.display_line_system_by_mode, {
    local_space: "local_space",
  });

  const featureIds = payload.features.map((feature) => feature.id);
  const labelIds = properties
    .map((item) => item.label_id)
    .filter(Boolean);
  assert.equal(new Set(featureIds).size, featureIds.length);
  assert.equal(new Set(labelIds).size, labelIds.length);
  assert.equal(
    JSON.stringify(
      [...cache.entries()].map(([mode, entry]) => [mode, entry.payload]),
    ),
    inputSnapshot,
    "composition must not mutate cached payloads",
  );

  const standard = compose(["standard"], 4, modeSpecKeys, cache);
  assert.equal(
    JSON.stringify(standard.payload.features),
    JSON.stringify(cache.get("standard").payload.features),
    "single-mode feature shape must remain unchanged",
  );

  const unrelatedSpecChange = {
    ...modeSpecKeys,
    standard: "standard-key-2",
    geodetic_greenwich: "greenwich-key-2",
    geodetic_giza: "giza-key-2",
  };
  assert.equal(
    compose(["local_space"], 4, unrelatedSpecChange, cache).complete,
    true,
    "Local Space must survive unrelated primary-line configuration changes",
  );
  assert.equal(
    compose(["standard"], 4, unrelatedSpecChange, cache).complete,
    false,
    "a changed primary-line semantic key must invalidate its own cache",
  );
});

test("retained controls keep independent selections, dynamic actors, and applied-only PDF export", async () => {
  const controls = await source(
    "src/components/workshell/astrocart-controls.tsx",
  );
  for (const role of [
    "angular_line_source",
    "paran_participant",
    "aspect_to_angle_source",
    "transit_actor",
    "secondary_progression_actor",
    "minor_progression_actor",
    "tertiary_progression_actor",
    "solar_arc_actor",
  ]) {
    assert.ok(controls.includes(role), `missing point role ${role}`);
  }
  assert.match(
    controls,
    /storeAstrocartConfiguration\([\s\S]*documentId,[\s\S]*submittedSpec/,
  );
  assert.match(controls, /pendingSaveRef/);
  assert.match(controls, /SPEC_SAVE_DEBOUNCE_MS/);
  assert.match(controls, /onPreviewChange\(next\)/);
  assert.match(controls, /const hasNewerDraft =/);
  assert.match(controls, /const normalizedDraft = copySpec\(payload\.spec\)/);
  assert.match(controls, /configuration\.dynamicTechniques/);
  assert.match(controls, /type="datetime-local"/);
  assert.match(controls, /cursorIso: new Date\(\)\.toISOString\(\)/);
  assert.match(controls, /cursorIso: localDateTimeInstant\(event\.target\.value\)/);
  assert.doesNotMatch(controls, /Sheet(Content|Trigger|Footer)/);
  assert.match(controls, /data-astrocart-controls-pane/);
  assert.match(controls, /LIST_PANE_CLASSES\.compactHeader/);
  assert.match(controls, /VirtualPointList/);
  assert.match(controls, /const EXPORT_ROLE = "export_participant"/);
  assert.match(
    controls,
    /defaultPdfSelection\(payload\.spec, natalLayerVisible\)/,
  );
  assert.match(controls, /\(\["A4", "A3"\] as const\)/);
  assert.match(controls, /dirty \|\|[\s\S]*lineModes\.length === 0/);
  assert.match(controls, /resolveShellHost\(\)/);
  assert.match(controls, /host\.capabilities\.nativeFileDialogs/);
  assert.match(controls, /host\.selectSavePath\(/);
  assert.match(controls, /exportAstrocartPdf\(/);
  assert.match(controls, /exportAstrocartPdfBytes\(/);
  assert.match(controls, /decodeBase64Bytes\(result\.dataBase64\)/);
  assert.match(controls, /host\.downloadBytes\(/);
  assert.match(controls, /techniques: Object\.fromEntries/);
  assert.match(
    controls,
    /const configurationRequestKey = `\$\{documentId\}:\$\{catalogRevision\}`/,
  );
  assert.match(controls, /const preserveDirtyDraft =/);
  assert.match(controls, /const standardSpec = configurationRef\.current\?\.defaultSpec/);
  assert.match(controls, /pendingStandardViewResetDocumentRef/);
  assert.match(controls, /activeSaveSpecRef/);
  assert.match(controls, /queueSpecSave\(next, true\)/);
  assert.match(controls, /onStandardViewReset\(\)/);
  assert.match(
    controls,
    /defaultPdfSelection\(next, natalLayerVisible\)/,
  );
  assert.match(controls, /t\("astrocart\.config\.resetToStandardView"\)/);
  assert.match(controls, /t\("astrocart\.config\.standardView"\)/);
  assert.match(controls, /point\.family === "standard_body"/);
  assert.match(controls, /point\.family === "chiron"/);
  assert.match(controls, /point\.family === "fixed_star"/);
  assert.match(controls, /t\("astrocart\.config\.planets"\)/);
  assert.match(controls, /t\("astrocart\.config\.allStars"\)/);
  assert.match(controls, /t\("astrocart\.config\.clearAll"\)/);
  assert.doesNotMatch(controls, /t\("astrocart\.config\.(selectVisible|clearVisible)"\)/);
  const saveLoop = controls.slice(
    controls.indexOf("const flushPendingSaves"),
    controls.indexOf("const queueSpecSave"),
  );
  assert.ok(
    saveLoop.indexOf("if (hasNewerDraft) continue;") <
      saveLoop.indexOf("configurationRef.current = payload;"),
    "an intermediate save response must not replace a newer local draft",
  );
  assert.ok(
    controls.indexOf("if (hasNewerDraft) continue;") <
      controls.indexOf("const completeStandardViewReset"),
    "standard mode must wait for the latest canonical spec",
  );
});

test("map and inspector parans share the retained configuration writer", async () => {
  const controls = await source(
    "src/components/workshell/astrocart-controls.tsx",
  );
  const workspace = await source(
    "src/components/workshell/workspace-content.tsx",
  );
  assert.match(controls, /appliedParanIntentRevisionRef/);
  assert.match(controls, /enabled: paranIntent\.enabled/);
  assert.match(workspace, /paranIntent=\{paranIntent\}/);
  assert.match(
    workspace,
    /canonicalAstrocartSpecRef\.current = spec;[\s\S]*applyAstrocartSpecVisibility\(spec\)/,
  );
  assert.doesNotMatch(workspace, /storeAstrocartConfiguration/);
});

test("new angular-line points optimistically join supported paran participants", async () => {
  const controls = await source(
    "src/components/workshell/astrocart-controls.tsx",
  );
  assert.match(controls, /function activateAngularLinePoints\(/);
  assert.match(
    controls,
    /point\.capabilities\[PARAN_ROLE\]\?\.status === "supported"/,
  );
  assert.match(
    controls,
    /!previouslySelected\.has\(pointId\) && paranCapable\.has\(pointId\)/,
  );
  assert.match(
    controls,
    /activateAngularLinePoints\(configuration, current, selectedIds\)/,
  );
});

test("new timing layers activate standard capable actors and technique changes retain valid choices", async () => {
  const controls = await source(
    "src/components/workshell/astrocart-controls.tsx",
  );
  const supportedStart = controls.indexOf("function supportedDynamicActorIds(");
  const defaultsStart = controls.indexOf("function defaultDynamicActorIds(");
  const selectionStart = controls.indexOf("function dynamicActorIdsForTechnique(");
  const appliedPdfStart = controls.indexOf("function appliedPdfPointIds(");
  assert.ok(supportedStart >= 0, "missing dynamic actor capability filter");
  assert.ok(defaultsStart > supportedStart, "missing standard dynamic actor defaults");
  assert.ok(selectionStart > defaultsStart, "missing technique-change actor selection");
  const actorHelpers = controls.slice(supportedStart, appliedPdfStart);
  assert.match(
    actorHelpers,
    /point\.capabilities\[role\]\?\.status === "supported"/,
  );
  assert.match(
    actorHelpers,
    /configuration\.defaultSpec\.staticAngleLinePointIds/,
  );
  assert.match(
    actorHelpers,
    /const retained = supportedDynamicActorIds\(configuration, technique, currentIds\)/,
  );
  assert.match(
    actorHelpers,
    /retained\.length > 0[\s\S]*\? retained[\s\S]*: defaultDynamicActorIds\(configuration, technique\)/,
  );

  const addStart = controls.indexOf(
    'const technique = configuration.dynamicTechniques[0]?.id ?? "transit"',
  );
  const editorStart = controls.indexOf("function DynamicLayerEditor(");
  assert.ok(addStart >= 0, "missing dynamic-layer add path");
  assert.match(
    controls.slice(addStart, editorStart),
    /movingActorIds: defaultDynamicActorIds\([\s\S]*configuration,[\s\S]*technique,[\s\S]*\)/,
  );
  assert.doesNotMatch(
    controls.slice(addStart, editorStart),
    /movingActorIds:\s*\[\]/,
  );
  assert.match(
    controls.slice(editorStart),
    /movingActorIds: dynamicActorIdsForTechnique\([\s\S]*configuration,[\s\S]*technique,[\s\S]*layer\.movingActorIds,[\s\S]*\)/,
  );
});

test("configuration refreshes geometry and labels independently while preserving the iframe", async () => {
  const workspace = await source(
    "src/components/workshell/workspace-content.tsx",
  );
  const visibilityStart = workspace.indexOf(
    "const applyAstrocartSpecVisibility = React.useCallback",
  );
  const visibilityEnd = workspace.indexOf(
    "const handleAstrocartConfigurationChange = React.useCallback",
    visibilityStart,
  );
  const visibilityBridge = workspace.slice(visibilityStart, visibilityEnd);
  assert.match(workspace, /setConfigurationRevision\(\(revision\) => revision \+ 1\)/);
  assert.match(
    workspace,
    /dataGenerationKey[\s\S]*sessionRevision[\s\S]*configurationRevision/,
  );
  assert.match(workspace, /type: "aries\.setVisibilityFilters"/);
  assert.match(visibilityBridge, /parans: spec\.paran\.enabled/);
  assert.match(
    visibilityBridge,
    /filters:\s*\{[\s\S]*?aspects:\s*enabledAspects/,
  );
  assert.doesNotMatch(visibilityBridge, /aries\.applyState/);
  assert.match(workspace, /<AstrocartControls/);
  assert.match(workspace, /catalogRevision=\{catalogRevision\}/);
  assert.match(workspace, /data-right-pane-module="astrocart-controls"/);
  assert.match(workspace, /<RightPaneSash/);
  assert.match(workspace, /onPreviewChange=\{handleAstrocartConfigurationPreview\}/);
  assert.match(
    workspace,
    /onStandardViewReset=\{handleAstrocartStandardViewReset\}/,
  );
  assert.match(
    workspace,
    /const standardModes = \[\.\.\.ASTROCART_DEFAULT_LINE_MODES\]/,
  );
  assert.match(workspace, /lastRenderedDataSignatureRef/);
  assert.match(workspace, /request\.controller\.abort\(\)/);
  assert.match(workspace, /lastOptionsChange\.listDataChanged !== false/);
  assert.match(workspace, /key=\{url\}/);
  assert.match(workspace, /aspectLabels: Object\.fromEntries/);
  assert.match(workspace, /techniqueLabels: Object\.fromEntries/);
  assert.match(workspace, /pointLabels,/);
  for (const aspectId of [
    "semisextile",
    "semisquare",
    "septile",
    "sextile",
    "quintile",
    "square",
    "trine",
    "sesquisquare",
    "biquintile",
    "quincunx",
    "opposition",
  ]) {
    assert.ok(workspace.includes(`"${aspectId}"`), `missing aspect label ${aspectId}`);
  }
  assert.ok(
    !workspace.match(/const ASTROCART_ASPECT_IDS = \[[^\]]*?"conjunction"/),
    "ordinary angular conjunction lines must not be duplicated as Aspect lines",
  );
  for (const technique of [
    "transit",
    "secondary_progression",
    "minor_progression",
    "tertiary_progression",
    "solar_arc",
  ]) {
    assert.ok(workspace.includes(`"${technique}"`), `missing technique label ${technique}`);
  }
  for (const key of [
    "astrocart.overlay.aspect",
    "astrocart.overlay.zenith",
    "astrocart.overlay.localSpaceOpposition",
    "astrocart.overlay.natalLayer",
    "astrocart.overlay.transitLayer",
    "astrocart.overlay.progressionLayer",
  ]) {
    assert.ok(workspace.includes(key), `missing iframe label ${key}`);
  }
});

test("iframe shortcut intents use the canonical manifest dispatcher and I is surface-aware", async () => {
  const [home, workspace, shortcuts, map] = await Promise.all([
    source("src/components/workshell/home-client.tsx"),
    source("src/components/workshell/workspace-content.tsx"),
    source("src/shortcuts/manifest-shortcuts.ts"),
    source("../../Res/astrocart/map.html"),
  ]);
  assert.match(
    map,
    /sendToHost\(\{ type: 'shortcut', key: key \}\)/,
  );
  assert.match(
    workspace,
    /payload\.type === "shortcut"[\s\S]*new CustomEvent\(EMBEDDED_MANIFEST_SHORTCUT_EVENT/,
  );
  assert.match(
    shortcuts,
    /export const EMBEDDED_MANIFEST_SHORTCUT_EVENT/,
  );
  assert.match(
    shortcuts,
    /window\.addEventListener\([\s\S]*EMBEDDED_MANIFEST_SHORTCUT_EVENT,[\s\S]*onEmbeddedShortcut/,
  );
  assert.match(
    shortcuts,
    /onEmbeddedShortcut[\s\S]*dispatchGesture\(/,
  );

  const inspectorStart = home.indexOf('if (command === "toggle-inspector")');
  const inspectorEnd = home.indexOf('if (command === "menu.data")', inspectorStart);
  const inspectorDispatch = home.slice(inspectorStart, inspectorEnd);
  assert.ok(inspectorStart >= 0 && inspectorEnd > inspectorStart);
  assert.match(inspectorDispatch, /activeDocRef\.current/);
  assert.match(inspectorDispatch, /activeDocument\?\.kind === "astrocart"/);
  assert.match(
    inspectorDispatch,
    /workspace\.astrocartControlsPane\?\.documentId === activeDocument\.id/,
  );
  assert.match(inspectorDispatch, /closeInspectorAndNotes\(\)/);
  assert.match(inspectorDispatch, /workspace\.closeAllRightPanes\(\)/);
  assert.match(inspectorDispatch, /workspace\.openAstrocartControlsPane\(/);
  assert.match(
    inspectorDispatch,
    /closeAllRightPanes\(\);[\s\S]*toggleInspector\(\);/,
  );
});

test("natal line visibility is a persisted display-only layer independent of dynamic geometry", async () => {
  const [workspace, controls] = await Promise.all([
    source("src/components/workshell/workspace-content.tsx"),
    source("src/components/workshell/astrocart-controls.tsx"),
  ]);
  const visibilityStart = workspace.indexOf(
    "const applyAstrocartSpecVisibility = React.useCallback",
  );
  const visibilityEnd = workspace.indexOf(
    "const handleAstrocartConfigurationPreview = React.useCallback",
    visibilityStart,
  );
  const visibilityBridge = workspace.slice(visibilityStart, visibilityEnd);
  assert.match(
    visibilityBridge,
    /const natalVisible = previousOverlays\?\.layers\?\.natal \?\? true/,
  );
  assert.match(visibilityBridge, /natal: natalVisible/);
  assert.doesNotMatch(visibilityBridge, /natal:\s*true/);

  const natalHandlerStart = workspace.indexOf(
    "const handleAstrocartNatalLayerVisibility = React.useCallback",
  );
  const resetHandlerStart = workspace.indexOf(
    "const handleAstrocartStandardViewReset = React.useCallback",
    natalHandlerStart,
  );
  const natalHandler = workspace.slice(natalHandlerStart, resetHandlerStart);
  assert.ok(natalHandlerStart >= 0 && resetHandlerStart > natalHandlerStart);
  assert.match(natalHandler, /\.\.\.\(overlays\.layers \?\? \{\}\)/);
  assert.match(natalHandler, /type: "aries\.setVisibilityFilters"/);
  assert.match(natalHandler, /filters: \{ layers: \{ natal \} \}/);
  assert.match(
    natalHandler,
    /persistViewState\(nextViewState, true, "global"\)/,
  );
  assert.doesNotMatch(natalHandler, /setConfigurationRevision|daemonFetch|setLineModes/);

  const resetHandlerEnd = workspace.indexOf(
    "\n\n  React.useEffect",
    resetHandlerStart,
  );
  const resetHandler = workspace.slice(resetHandlerStart, resetHandlerEnd);
  assert.match(
    resetHandler,
    /const standardModes = \[\.\.\.ASTROCART_DEFAULT_LINE_MODES\]/,
  );
  assert.match(
    resetHandler,
    /setNatalLayerVisible\(true\)/,
  );
  assert.match(
    workspace,
    /restoredViewState\?\.overlays\?\.layers\?\.natal \?\? true/,
  );
  assert.match(workspace, /natalLayerVisible=\{natalLayerVisible\}/);
  assert.match(
    workspace,
    /onNatalLayerVisibilityChange=\{handleAstrocartNatalLayerVisibility\}/,
  );

  assert.match(controls, /natalLayerVisible: boolean/);
  assert.match(
    controls,
    /onNatalLayerVisibilityChange: \(visible: boolean\) => void/,
  );
  assert.match(controls, /title=\{t\("astrocart\.pdf\.layers"\)\}/);
  assert.match(controls, /checked=\{natalLayerVisible\}/);
  assert.match(controls, /label=\{t\("astrocart\.overlay\.natalLayer"\)\}/);
  assert.match(controls, /onChange=\{onNatalLayerVisibilityChange\}/);
  assert.match(
    controls,
    /lineModes\[0\] === "standard" &&[\s\S]*natalLayerVisible/,
  );
});

test("canonical timing visibility wins delayed retained-state replay after real map readiness", async () => {
  const [workspace, map] = await Promise.all([
    source("src/components/workshell/workspace-content.tsx"),
    source("../../Res/astrocart/map.html"),
  ]);
  const visibilityStart = workspace.indexOf(
    "const applyAstrocartSpecVisibility = React.useCallback",
  );
  const visibilityEnd = workspace.indexOf(
    "const handleAstrocartConfigurationPreview = React.useCallback",
    visibilityStart,
  );
  const visibilityBridge = workspace.slice(visibilityStart, visibilityEnd);
  assert.match(visibilityBridge, /spec: AstrocartMapSpec,[\s\S]*force = false/);
  assert.ok(
    visibilityBridge.indexOf("...(previousOverlays?.filters ?? {})") <
      visibilityBridge.indexOf("techniques: null"),
    "canonical visibility must overwrite saved [] or natal-only technique filters",
  );
  assert.equal(
    visibilityBridge.match(/techniques: null/g)?.length,
    2,
    "stored and live map filters must both clear the unowned technique filter",
  );
  assert.match(
    visibilityBridge,
    /if \(!force && lastVisibilitySignatureRef\.current === visibilitySignature\) return/,
  );

  const restoreStart = workspace.indexOf("const restoredViewState = viewState ?");
  const restoreEnd = workspace.indexOf(
    "React.useEffect(() => {",
    restoreStart,
  );
  const restoreFlow = workspace.slice(restoreStart, restoreEnd);
  assert.ok(restoreStart >= 0, "missing retained view-state normalization");
  assert.match(restoreFlow, /techniques: null/);
  assert.match(
    restoreFlow,
    /aries\.applyState", state: restoredViewState/,
  );
  assert.match(
    workspace,
    /applyAstrocartSpecVisibility\(canonicalAstrocartSpecRef\.current, true\)/,
  );

  const styleLoadStart = map.indexOf("map.on('style.load'");
  const pendingReplay = map.indexOf("applyPendingCamera();", styleLoadStart);
  const childReady = map.indexOf(
    "postToParent({ type: 'ready' });",
    pendingReplay,
  );
  assert.ok(
    styleLoadStart >= 0 && pendingReplay > styleLoadStart && childReady > pendingReplay,
    "the child readiness signal must follow delayed pending-state replay",
  );

  const readyHandlerStart = workspace.indexOf('if (payload.type === "ready")');
  const readyHandlerEnd = workspace.indexOf(
    'if (payload.type === "state"',
    readyHandlerStart,
  );
  const readyHandler = workspace.slice(readyHandlerStart, readyHandlerEnd);
  assert.ok(readyHandlerStart >= 0, "missing child-ready message branch");
  assert.match(readyHandler, /canonicalAstrocartSpecRef\.current/);
  assert.match(
    readyHandler,
    /applyAstrocartSpecVisibility\(canonicalSpec, true\)/,
  );
  const listenerEnd = workspace.indexOf("\n\n  return (", readyHandlerEnd);
  const listenerFlow = workspace.slice(readyHandlerStart, listenerEnd);
  assert.match(listenerFlow, /queueAstrocartParanIntent,/);
  assert.match(listenerFlow, /settlePrintAtlasRequest,/);
  assert.match(listenerFlow, /viewStateKey,/);
});

test("astrocart controls use the canonical retained right-pane ontology", async () => {
  const [workspaceStore, frameStore, paneLayout, uiCommands] = await Promise.all([
    source("src/stores/workspace-store.ts"),
    source("src/stores/frame-layout-store.ts"),
    source("src/components/workshell/right-pane-layout.ts"),
    source("src/components/workshell/workspace-ui-commands.ts"),
  ]);
  assert.match(workspaceStore, /astrocartControlsPane: AstrocartControlsPaneState \| null/);
  assert.match(
    workspaceStore,
    /openExclusiveRightPane\("astrocartControlsPane", state\)/,
  );
  assert.match(workspaceStore, /closeAstrocartControlsPane: \(\) => set/);
  assert.match(frameStore, /"astrocart-controls": \{/);
  assert.match(frameStore, /role: "configuration-pane"/);
  assert.match(
    paneLayout,
    /astrocartControlsPane\.documentId === input\.activeAstrocartDocumentId/,
  );
  assert.match(uiCommands, /state\.astrocartControlsPane !== null/);
});

test("map labels prefer localized technique, point, paran, and aspect identities", async () => {
  const map = await source("../../Res/astrocart/map.html");
  assert.match(map, /techniqueLabels: \{\}/);
  assert.match(map, /pointLabels: \{\}/);
  assert.match(map, /aspectLabels: \{\}/);
  assert.match(map, /localizedTechniqueLabelExpression\(\)/);
  assert.match(map, /localizedPointLabelExpression\('point', 'label'\)/);
  assert.match(map, /localizedPointLabelExpression\('a_point', 'a_label'\)/);
  assert.match(map, /localizedPointLabelExpression\('b_point', 'b_label'\)/);
  assert.match(map, /localizedAspectLabel\(f\.properties\)/);
  assert.match(map, /const label = localizedPointLabel\(f\.properties\)/);
  assert.match(map, /const techniqueLabel = String\(techniqueLabels\[technique\]/);
});

test("every shipped locale contains the new astrocart controls", async () => {
  const localeDir = new URL("src/locales/", frontendRoot);
  const localeFiles = (await readdir(localeDir)).filter((name) => name.endsWith(".json"));
  assert.equal(localeFiles.length, 10);
  const required = [
    "astrocart.capability.unsupported",
    "astrocart.config.title",
    "astrocart.config.close",
    "astrocart.config.retry",
    "astrocart.config.resetToStandardView",
    "astrocart.config.standardView",
    "astrocart.config.coordinates",
    "astrocart.config.angularLines",
    "astrocart.config.parans",
    "astrocart.config.aspectLines",
    "astrocart.config.zenithPoints",
    "astrocart.config.localSpaceOppositions",
    "astrocart.config.dynamicLayers",
    "astrocart.coordinate.in_mundo",
    "astrocart.coordinate.zodiacal",
    "astrocart.dynamic.transit",
    "astrocart.dynamic.secondary_progression",
    "astrocart.dynamic.minor_progression",
    "astrocart.dynamic.tertiary_progression",
    "astrocart.dynamic.solar_arc",
    "astrocart.family.asteroid_centaur",
    "astrocart.family.fixed_star",
    "astrocart.family.unsupported",
    "astrocart.overlay.aspect",
    "astrocart.overlay.zenith",
    "astrocart.overlay.localSpaceOpposition",
    "astrocart.pdf.applyFirst",
    "astrocart.pdf.aspects",
    "astrocart.pdf.chooseMode",
    "astrocart.pdf.client",
    "astrocart.pdf.date",
    "astrocart.pdf.description",
    "astrocart.pdf.export",
    "astrocart.pdf.exportFailed",
    "astrocart.pdf.exporting",
    "astrocart.pdf.exportSelection",
    "astrocart.pdf.includeZenith",
    "astrocart.pdf.included",
    "astrocart.pdf.landscape",
    "astrocart.pdf.layers",
    "astrocart.pdf.legend",
    "astrocart.pdf.lineKind.aspect",
    "astrocart.pdf.lineKind.localSpace",
    "astrocart.pdf.lineKind.localSpaceOpposition",
    "astrocart.pdf.lineKind.paran",
    "astrocart.pdf.lineKind.zenith",
    "astrocart.pdf.lineKinds",
    "astrocart.pdf.noAppliedAspects",
    "astrocart.pdf.pageFormat",
    "astrocart.pdf.pdfFiles",
    "astrocart.pdf.points",
    "astrocart.pdf.saveDialogTitle",
    "astrocart.pdf.subtitle",
    "astrocart.pdf.title",
    "optmenu.quincunx",
  ];
  for (const localeFile of localeFiles) {
    const messages = JSON.parse(await readFile(new URL(localeFile, localeDir), "utf8"));
    for (const key of required) {
      assert.equal(
        typeof messages[key],
        "string",
        `${localeFile} is missing ${key}`,
      );
      assert.ok(messages[key].trim(), `${localeFile} has an empty ${key}`);
    }
  }
});
