// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import { expect, test } from "@playwright/test";
import { WHEEL_GEOMETRY_LEGACY_TOKENS } from "../src/lib/chart/wheel-geometry-ownership";
import type { WheelPresetsState } from "../src/lib/daemon/wheel-presets-client";
import type { WheelTypographyProfile } from "../src/lib/chart/wheel-render-style";
import { canPersistStyleDraft, refreshStyleDraftForSave } from "../src/lib/style-lab/prepare-save";

import {
  normalizeRecentColors,
  themeWheelModified,
  useChartStyleEditorStore,
} from "../src/stores/chart-style-editor-store";

function resetStore() {
  useChartStyleEditorStore.setState({
    geometryProfile: null,
    geometryTransition: false,
    geometryOverrides: {},
    syncedGeometryOverrides: {},
    wheelPresetState: null,
    themeWheelBaseline: null,
    pendingWheelCompositions: {},
    syncedOverrides: {},
    selectedFamily: null,
    gestureOwner: null,
    semanticOverrides: {},
    resolvedOverrides: {},
    cssOverrides: {},
    undoStack: [],
    redoStack: [],
    gestureStart: null,
    revision: 0,
  });
}

test.beforeEach(resetStore);

test("save remains retryable after a failed write or revision conflict", () => {
  expect(canPersistStyleDraft("error", 3)).toBe(true);
  expect(canPersistStyleDraft("conflict", 3)).toBe(true);
  expect(canPersistStyleDraft("saving", 3)).toBe(false);
  expect(canPersistStyleDraft("connecting", 3)).toBe(false);
  expect(canPersistStyleDraft("error", null)).toBe(false);
});

test("save refreshes a stale revision and preserves local edits and deletions", async () => {
  const originalFetch = globalThis.fetch;
  useChartStyleEditorStore.setState({ remoteDraftId: "draft-save", remoteRevision: 1,
    syncedOverrides: { "app.panel.opacity": 10, "app.panel.radius": 2 },
    semanticOverrides: { "app.panel.opacity": 20 },
  });
  globalThis.fetch = async () => new Response(JSON.stringify({
    id: "draft-save", revision: 4, etag: "revision-4",
    overrides: { "app.panel.opacity": 15, "app.panel.radius": 2, "app.panel.border": 1 },
  }));
  try {
    const state = await refreshStyleDraftForSave("conflict");
    expect(state.remoteRevision).toBe(4);
    expect(state.remoteEtag).toBe("revision-4");
    expect(state.semanticOverrides).toEqual({ "app.panel.opacity": 20, "app.panel.border": 1 });
    expect(state.syncedOverrides["app.panel.opacity"]).toBe(15);
  } finally { globalThis.fetch = originalFetch; }
});

test("save refuses a different current draft without overwriting local work", async () => {
  const originalFetch = globalThis.fetch;
  useChartStyleEditorStore.setState({ remoteDraftId: "draft-save", remoteRevision: 1,
    semanticOverrides: { "app.panel.opacity": 20 },
  });
  globalThis.fetch = async () => new Response(JSON.stringify({
    id: "other-draft", revision: 2, overrides: {},
  }));
  try {
    await expect(refreshStyleDraftForSave("conflict")).rejects.toThrow("conflict");
    expect(useChartStyleEditorStore.getState().remoteDraftId).toBe("draft-save");
    expect(useChartStyleEditorStore.getState().semanticOverrides).toEqual({ "app.panel.opacity": 20 });
  } finally { globalThis.fetch = originalFetch; }
});

test("one continuous gesture creates one undo entry", () => {
  const store = useChartStyleEditorStore.getState();
  store.beginGesture("test");
  store.setOverride("authoring.app.panel.opacity", 10);
  store.setOverride("authoring.app.panel.opacity", 20);
  store.setOverride("authoring.app.panel.opacity", 30);
  store.endGesture("test");

  expect(useChartStyleEditorStore.getState().undoStack).toHaveLength(1);
  useChartStyleEditorStore.getState().undo();
  expect(useChartStyleEditorStore.getState().semanticOverrides).toEqual({});
});

test("paired surface background reset is one undo transaction", () => {
  useChartStyleEditorStore.setState({
    semanticOverrides: {
      "authoring.app.panel.backgroundColor": [20, 30, 40, 0.5],
      "app.panel.background": [20, 30, 40, 0.5],
      "app.panel.foreground": [240, 240, 240],
    },
  });

  useChartStyleEditorStore.getState().resetProperties([
    "authoring.app.panel.backgroundColor",
    "app.panel.background",
  ]);
  const reset = useChartStyleEditorStore.getState();
  expect(reset.semanticOverrides).toEqual({
    "app.panel.foreground": [240, 240, 240],
  });
  expect(reset.undoStack).toHaveLength(1);

  reset.undo();
  expect(useChartStyleEditorStore.getState().semanticOverrides).toMatchObject({
    "authoring.app.panel.backgroundColor": [20, 30, 40, 0.5],
    "app.panel.background": [20, 30, 40, 0.5],
  });
});

test("multi-property style transfer is one undo transaction", () => {
  useChartStyleEditorStore.getState().applyOverrides({
    "authoring.wheel.compact.fills.chartField.fillPattern": "newsprint",
    "authoring.wheel.compact.fills.chartField.opacity": 35,
  });

  const transferred = useChartStyleEditorStore.getState();
  expect(transferred.semanticOverrides).toMatchObject({
    "authoring.wheel.compact.fills.chartField.fillPattern": "newsprint",
    "authoring.wheel.compact.fills.chartField.opacity": 35,
  });
  expect(transferred.undoStack).toHaveLength(1);

  transferred.undo();
  expect(useChartStyleEditorStore.getState().semanticOverrides).toEqual({});
});

test("editing a family writes every member as one undo step", () => {
  // Max: "the pos ° glyph stuff doesn't change yet." A position's degree, sign
  // and minute are read as one thing, so editing them one at a time was three
  // hunts through the list for a single change. Selecting the family edits all
  // of them.
  resetStore();
  const family = [
    "bodies.inner.position.degree",
    "bodies.inner.position.sign",
    "bodies.inner.position.minute",
  ];
  useChartStyleEditorStore.setState({ selectedFamily: family });

  const store = useChartStyleEditorStore.getState();
  store.beginGesture?.("test");
  store.setOverride("authoring.wheel.classic.bodies.inner.position.degree.fontSize", 21);
  const after = useChartStyleEditorStore.getState().semanticOverrides;
  for (const member of family) {
    expect(after[`authoring.wheel.classic.${member}.fontSize`]).toBe(21);
  }

  // One gesture, so one undo returns the whole family.
  useChartStyleEditorStore.getState().endGesture("test");
  useChartStyleEditorStore.getState().undo();
  const undone = useChartStyleEditorStore.getState().semanticOverrides;
  for (const member of family) {
    expect(undone[`authoring.wheel.classic.${member}.fontSize`]).toBeUndefined();
  }
});

test("a family write never touches a class outside the family", () => {
  resetStore();
  useChartStyleEditorStore.setState({
    selectedFamily: [
      "bodies.inner.position.degree",
      "bodies.inner.position.sign",
    ],
  });
  const store = useChartStyleEditorStore.getState();
  // A ring radius is not a member, so it must stay a single write.
  store.setOverride("authoring.wheel.classic.rings.term.radius", 120);
  // A plain design token has no class segment at all.
  store.setOverride("chart.background", "#000000");
  const after = useChartStyleEditorStore.getState().semanticOverrides;
  expect(Object.keys(after).sort()).toEqual([
    "authoring.wheel.classic.rings.term.radius",
    "chart.background",
  ]);
});

test("selecting a single class clears a family selection", () => {
  resetStore();
  useChartStyleEditorStore.setState({
    selectedFamily: ["bodies.inner.position.degree", "bodies.inner.position.sign"],
  });
  useChartStyleEditorStore.getState().selectElement(null);
  expect(useChartStyleEditorStore.getState().selectedFamily).toBeNull();
});

test("stored recent colours are normalised, deduplicated, and capped", () => {
  expect(normalizeRecentColors([
    "#AABBCC",
    "  #aabbcc  ",
    "#ddeeff",
    "rebeccapurple",
    42,
  ])).toEqual(["#aabbcc", "#ddeeff"]);
  // Ten is the strip's capacity; an oversized or corrupt slot is trimmed on
  // read rather than trusted.
  expect(normalizeRecentColors(
    Array.from({ length: 20 }, (_, index) => `#0000${index.toString(16).padStart(2, "0")}`),
  )).toHaveLength(10);
  expect(normalizeRecentColors("#aabbcc")).toEqual([]);
  expect(normalizeRecentColors(null)).toEqual([]);
});

const COLOR_TOKENS = [
  {
    semanticId: "chart.color.signs",
    cssVar: "--morinus-signs",
    label: "Zodiac signs",
    description: "",
    type: "color" as const,
    unit: "",
    defaultValue: [215, 215, 217],
  },
  {
    semanticId: "chart.color.frame",
    cssVar: "--morinus-frame",
    label: "Chart frame",
    description: "",
    type: "color" as const,
    unit: "",
    defaultValue: [220, 220, 221],
  },
];

function withColorTokens() {
  resetStore();
  useChartStyleEditorStore.getState().setTokenMetadata(COLOR_TOKENS);
}

test("a followed role reaches the paint layer as a colour, never as a reference", () => {
  withColorTokens();
  useChartStyleEditorStore.getState().setOverride(
    "chart.color.frame",
    "{chart.color.signs}",
  );
  const state = useChartStyleEditorStore.getState();
  // The authored map keeps the reference; everything downstream sees a colour.
  expect(state.semanticOverrides["chart.color.frame"]).toBe("{chart.color.signs}");
  expect(state.resolvedOverrides["chart.color.frame"]).toEqual([215, 215, 217]);
  expect(state.cssOverrides["--morinus-frame"]).toBe("rgb(215 215 217)");
});

test("editing the followed role moves what follows it", () => {
  withColorTokens();
  const store = useChartStyleEditorStore.getState();
  store.setOverride("chart.color.frame", "{chart.color.signs}");
  store.setOverride("chart.color.signs", [9, 9, 9]);
  const state = useChartStyleEditorStore.getState();
  expect(state.cssOverrides["--morinus-frame"]).toBe("rgb(9 9 9)");
  expect(state.cssOverrides["--morinus-signs"]).toBe("rgb(9 9 9)");
  // The reference itself is untouched by the role's edit.
  expect(state.semanticOverrides["chart.color.frame"]).toBe("{chart.color.signs}");
});

test("a reference resolves against the theme being edited, not the factory", () => {
  withColorTokens();
  useChartStyleEditorStore.getState().setStyleLabBaseTheme({
    sourceThemeName: "test",
    mode: "dark",
    appTokens: {},
    chartPalette: { "--morinus-signs": "rgb(1 2 3)" },
    chartData: {},
    appAuthoring: {},
  });
  useChartStyleEditorStore.getState().setOverride(
    "chart.color.frame",
    "{chart.color.signs}",
  );
  expect(useChartStyleEditorStore.getState().cssOverrides["--morinus-frame"])
    .toBe("rgb(1 2 3)");
});

test("a new base theme re-resolves what follows a role", () => {
  withColorTokens();
  const store = useChartStyleEditorStore.getState();
  store.setOverride("chart.color.frame", "{chart.color.signs}");
  store.setStyleLabBaseTheme({
    sourceThemeName: "next",
    mode: "light",
    appTokens: {},
    chartPalette: { "--morinus-signs": "rgb(7 7 7)" },
    chartData: {},
    appAuthoring: {},
  });
  expect(useChartStyleEditorStore.getState().cssOverrides["--morinus-frame"])
    .toBe("rgb(7 7 7)");
});

test("resetting a followed control ends the reference", () => {
  withColorTokens();
  const store = useChartStyleEditorStore.getState();
  store.setOverride("chart.color.frame", "{chart.color.signs}");
  store.resetProperty("chart.color.frame");
  const state = useChartStyleEditorStore.getState();
  expect(Object.hasOwn(state.semanticOverrides, "chart.color.frame")).toBe(false);
  expect(state.cssOverrides["--morinus-frame"]).toBeUndefined();
});

test("a family size write keeps every member's own value", () => {
  resetStore();
  useChartStyleEditorStore.getState().setFamilyOverrides({
    "authoring.wheel.variant.bodies.inner.position.degree.fontSize": 30,
    "authoring.wheel.variant.bodies.inner.position.sign.fontSize": 15,
  }, "authoring.wheel.variant.bodies.inner.position.degree.fontSize");
  const state = useChartStyleEditorStore.getState();
  expect(state.semanticOverrides).toEqual({
    "authoring.wheel.variant.bodies.inner.position.degree.fontSize": 30,
    "authoring.wheel.variant.bodies.inner.position.sign.fontSize": 15,
  });
  expect(state.revision).toBe(1);
});

test("closing authoring interaction leaves the working appearance parked", () => {
  resetStore();
  const store = useChartStyleEditorStore.getState();
  store.setLiveAppThemePreview(true);
  store.setActive(true);
  store.setOverride("renderer.wheel.metric.chartRingStrokeMin", 0.75);

  useChartStyleEditorStore.getState().setActive(false);
  const closed = useChartStyleEditorStore.getState();

  expect(closed.active).toBe(false);
  expect(closed.liveAppThemePreview).toBe(true);
  expect(closed.semanticOverrides).toEqual({
    "renderer.wheel.metric.chartRingStrokeMin": 0.75,
  });
});

test("a gesture belongs to the surface that opened it", () => {
  // One unowned slot let a canvas drag join a focused field's transaction and
  // then commit it, leaving the field's Escape with nothing to restore.
  const store = useChartStyleEditorStore.getState();
  store.setOverride("authoring.wheel.base.rings.base.radius", 100);
  store.beginGesture("inspector");
  store.setOverride("authoring.wheel.base.rings.base.radius", 111);

  // A second opener does not take the transaction over.
  store.beginGesture("canvas");
  expect(useChartStyleEditorStore.getState().gestureOwner).toBe("inspector");
  // Nor can it close one it does not own.
  useChartStyleEditorStore.getState().endGesture("canvas");
  expect(useChartStyleEditorStore.getState().gestureStart).not.toBeNull();
  // Nor cancel it, which would silently revert the owner's edit.
  useChartStyleEditorStore.getState().cancelGesture("canvas");
  expect(useChartStyleEditorStore.getState()
      .semanticOverrides["authoring.wheel.base.rings.base.radius"]).toBe(111);
  // The owner can.
  useChartStyleEditorStore.getState().endGesture("inspector");
  expect(useChartStyleEditorStore.getState().gestureStart).toBe(null);
  expect(useChartStyleEditorStore.getState().gestureOwner).toBe(null);
});


function wheelPresetFixture(profile: WheelTypographyProfile, overrides: Record<string, number>, revision = 1): WheelPresetsState {
  const composition = {schemaVersion: 1 as const, projection: 'zodiac' as const, rings: []};
  return {schemaVersion: 1, revision, selected: {[profile]: 'factory-' + profile},
    presets: [{id: 'factory-' + profile, name: profile, layout: profile, factory: true, overrides, composition}],
    drafts: {[profile]: {sourcePresetId: 'factory-' + profile, overrides, composition, dirty: false}}};
}
const geometryKey = 'authoring.wheel.anglo.canvas.ring.anglo-terms.bandWidth';
const appearanceKey = 'authoring.wheel.base.bodies.inner.glyph.color';

test('theme activation strips historical geometry and preserves the current wheel draft', () => {
  const store = useChartStyleEditorStore.getState();
  store.acceptWheelPresets(wheelPresetFixture('anglo', {[geometryKey]: 28}), 'anglo');
  store.acceptRemoteDraft({id: 'theme-b', revision: 4, overrides: {}, authoringOverrides: {
    [geometryKey]: 90, [appearanceKey]: '#112233',
  }}, {clearHistory: true});
  const state = useChartStyleEditorStore.getState();
  expect(state.geometryProfile).toBe('anglo');
  expect(state.geometryOverrides).toEqual({[geometryKey]: 28});
  expect(state.semanticOverrides[appearanceKey]).toBe('#112233');
  expect(state.syncedOverrides).toEqual({[appearanceKey]: '#112233'});
  expect(state.syncStatus).toBe('synced');
});

test('geometry edits remain on the selected wheel when appearance scope is shared', () => {
  const store = useChartStyleEditorStore.getState();
  store.acceptWheelPresets(wheelPresetFixture('anglo', {}), 'anglo');
  store.beginGesture('wheel');
  store.setOverride('authoring.wheel.base.rings.term.radius', 120);
  store.setOverride('authoring.wheel.base.rings.term.radius', 130);
  store.endGesture('wheel');
  expect(useChartStyleEditorStore.getState().geometryOverrides).toEqual({
    'authoring.wheel.anglo.rings.term.radius': 130,
  });
  expect(useChartStyleEditorStore.getState().undoStack).toHaveLength(1);
  store.undo();
  expect(useChartStyleEditorStore.getState().geometryOverrides).toEqual({});
  store.redo();
  expect(useChartStyleEditorStore.getState().geometryOverrides['authoring.wheel.anglo.rings.term.radius']).toBe(130);
});

test('resetting theme overrides preserves wheel geometry and resolves every preview map together', () => {
  const store = useChartStyleEditorStore.getState();
  store.acceptWheelPresets(wheelPresetFixture('anglo', {[geometryKey]: 28}), 'anglo');
  store.setOverride(appearanceKey, '#123456');
  store.resetAll();
  const state = useChartStyleEditorStore.getState();
  expect(state.semanticOverrides).toEqual({[geometryKey]: 28});
  expect(state.resolvedOverrides).toEqual({[geometryKey]: 28});
  expect(state.geometryOverrides).toEqual({[geometryKey]: 28});
  store.undo();
  expect(useChartStyleEditorStore.getState().semanticOverrides[appearanceKey]).toBe('#123456');
});

test('a wheel patch acknowledgement keeps newer local edits and theme sync independent', () => {
  const store = useChartStyleEditorStore.getState();
  store.acceptWheelPresets(wheelPresetFixture('anglo', {[geometryKey]: 28}), 'anglo');
  store.setOverride(geometryKey, 30);
  store.setOverride(geometryKey, 35);
  store.markWheelGeometrySynced(wheelPresetFixture('anglo', {[geometryKey]: 30}, 2), 'anglo', {[geometryKey]: 30});
  const state = useChartStyleEditorStore.getState();
  expect(state.geometryOverrides[geometryKey]).toBe(35);
  expect(state.syncedGeometryOverrides[geometryKey]).toBe(30);
  expect(state.syncedOverrides).toEqual({});
});

test('remote preset refresh merges untouched geometry without resurrecting a local deletion', () => {
  const other = 'authoring.wheel.anglo.rings.term.radius';
  const store = useChartStyleEditorStore.getState();
  store.acceptWheelPresets(wheelPresetFixture('anglo', {[geometryKey]: 28, [other]: 100}), 'anglo');
  store.resetProperty(geometryKey);
  store.acceptWheelPresets(wheelPresetFixture('anglo', {[geometryKey]: 28, [other]: 120}, 2), 'anglo', {preserveLocalChanges: true});
  expect(useChartStyleEditorStore.getState().geometryOverrides).toEqual({[other]: 120});
});

test('selecting another wheel replaces the complete shape and clears cross-preset undo history', () => {
  const store = useChartStyleEditorStore.getState();
  store.acceptWheelPresets(wheelPresetFixture('anglo', {[geometryKey]: 28}), 'anglo');
  store.applyOverrides({[geometryKey]: 35, [appearanceKey]: '#123456'});
  store.acceptWheelPresets(wheelPresetFixture('cusps', {}, 2), 'cusps');
  const state = useChartStyleEditorStore.getState();
  expect(state.geometryProfile).toBe('cusps');
  expect(state.geometryOverrides).toEqual({});
  expect(state.semanticOverrides).toEqual({[appearanceKey]: '#123456'});
  expect(state.undoStack).toEqual([]);
  store.undo();
  expect(useChartStyleEditorStore.getState().geometryOverrides).toEqual({});
});

test('stale preset reads cannot roll back an acknowledged revision', () => {
  const store = useChartStyleEditorStore.getState();
  store.acceptWheelPresets(wheelPresetFixture('anglo', {[geometryKey]: 35}, 5), 'anglo');
  store.acceptWheelPresets(wheelPresetFixture('anglo', {[geometryKey]: 20}, 2), 'anglo');
  expect(useChartStyleEditorStore.getState().geometryOverrides).toEqual({[geometryKey]: 35});
  expect(useChartStyleEditorStore.getState().wheelPresetState?.revision).toBe(5);
});


test('a preset response for a departed wheel updates metadata without replacing the active local geometry', () => {
  const store = useChartStyleEditorStore.getState();
  store.acceptWheelPresets(wheelPresetFixture('cusps', {}, 2), 'cusps');
  const key = 'authoring.wheel.cusps.rings.term.radius';
  store.setOverride(key, 120);
  store.acceptWheelPresets(wheelPresetFixture('anglo', {[geometryKey]: 80}, 3), 'anglo', {metadataOnly: true});
  const state = useChartStyleEditorStore.getState();
  expect(state.geometryProfile).toBe('cusps');
  expect(state.geometryOverrides).toEqual({[key]: 120});
  expect(state.wheelPresetState?.revision).toBe(3);
});


test('old theme geometry cannot reappear through inspector fallback values', () => {
  const cssVar = Object.values(WHEEL_GEOMETRY_LEGACY_TOKENS)[0];
  const store = useChartStyleEditorStore.getState();
  store.setStyleLabBaseTheme({sourceThemeName: 'old-theme', mode: 'dark', appAuthoring: {}, chartData: {},
    appTokens: {[cssVar]: '99', '--aries-background': '#123456'},
    chartPalette: {[cssVar]: '99', '--morinus-frame': '#654321'}});
  const base = useChartStyleEditorStore.getState().styleLabBaseTheme;
  expect(base.appTokens[cssVar]).toBeUndefined();
  expect(base.chartPalette[cssVar]).toBeUndefined();
  expect(base.chartPalette['--morinus-frame']).toBe('#654321');
});

test('theme recall replaces pending geometry when the private snapshot changes', () => {
  const themeState = (width: number, revision: number): WheelPresetsState => {
    const state = wheelPresetFixture('anglo', {[geometryKey]: width}, revision);
    const preset = {...state.presets[0], id: 'working.anglo', factory: false};
    state.presets = [];
    state.activePresets = {anglo: preset};
    state.selected.anglo = preset.id;
    state.drafts.anglo!.sourcePresetId = preset.id;
    return state;
  };
  const store = useChartStyleEditorStore.getState();
  store.acceptWheelPresets(themeState(28, 1), 'anglo');
  store.setOverride(geometryKey, 45);
  store.acceptWheelPresets(themeState(60, 2), 'anglo', {preserveLocalChanges: true});
  expect(useChartStyleEditorStore.getState().geometryOverrides[geometryKey]).toBe(60);
  expect(useChartStyleEditorStore.getState().syncedGeometryOverrides[geometryKey]).toBe(60);
  expect(useChartStyleEditorStore.getState().undoStack).toEqual([]);
});


test('theme wheel baseline follows geometry, visibility and order independently of public preset dirtiness', () => {
  const composition = {schemaVersion: 1 as const, projection: 'zodiac' as const, rings: [
    {instanceId: 'anglo-terms', archetypeId: 'terms' as const, enabled: true, chartRole: 'primary' as const},
    {instanceId: 'anglo-decans', archetypeId: 'decans' as const, enabled: true, chartRole: 'primary' as const},
  ]};
  const width = 'authoring.wheel.anglo.canvas.ring.anglo-terms.bandWidth';
  const store = useChartStyleEditorStore.getState();
  store.acceptRemoteDraft({id: 'theme', revision: 1, overrides: {}, modifiedFromBaseline: false,
    wheelBaseline: {geometry: {schemaVersion: 1, layout: 'anglo', designs: {anglo: {overrides: {[width]: 20}, composition}}},
      visibility: {anglo: {terms: false}}}});
  const visible = {...composition, rings: composition.rings.map(ring => ({...ring, enabled: ring.archetypeId !== 'terms'}))};
  const presets: WheelPresetsState = {schemaVersion: 1, revision: 1, presets: [], selected: {anglo: 'user.saved'},
    display: {theme: 2, houses: true, showterms: false, showdecans: true},
    drafts: {anglo: {overrides: {[width]: 20}, composition: visible, dirty: true, sourcePresetId: 'user.saved'}}};
  store.acceptWheelPresets(presets, 'anglo');
  expect(themeWheelModified(useChartStyleEditorStore.getState())).toBe(false);
  store.setOverride(width, 24);
  expect(themeWheelModified(useChartStyleEditorStore.getState())).toBe(true);
  store.setOverride(width, 20);
  expect(themeWheelModified(useChartStyleEditorStore.getState())).toBe(false);
  useChartStyleEditorStore.setState({pendingWheelCompositions: {anglo: composition}});
  expect(themeWheelModified(useChartStyleEditorStore.getState())).toBe(true);
  useChartStyleEditorStore.setState({pendingWheelCompositions: {anglo: {...visible, rings: [...visible.rings].reverse()}}});
  expect(themeWheelModified(useChartStyleEditorStore.getState())).toBe(true);
  useChartStyleEditorStore.setState({pendingWheelCompositions: {}});
  store.acceptWheelPresets({...presets, revision: 2, display: {...presets.display!, theme: 0}}, 'anglo');
  expect(themeWheelModified(useChartStyleEditorStore.getState())).toBe(true);
});

test('shared band background edits are atomic and leave band widths independent', () => {
  resetStore();
  const family = ['fills.termBand', 'fills.decanBand', 'fills.cuspDegreeBand'];
  useChartStyleEditorStore.setState({selectedFamily: family});
  const store = useChartStyleEditorStore.getState();
  store.beginGesture('background');
  store.setOverride('authoring.wheel.anglo.fills.termBand.fillPattern', 'stipple');
  store.setOverride('authoring.wheel.anglo.fills.termBand.backgroundColor', [198, 91, 91, 1]);
  store.endGesture('background');
  for (const member of family) {
    expect(useChartStyleEditorStore.getState().semanticOverrides[`authoring.wheel.anglo.${member}.fillPattern`]).toBe('stipple');
  }
  expect(useChartStyleEditorStore.getState().undoStack).toHaveLength(1);
  useChartStyleEditorStore.getState().undo();
  expect(useChartStyleEditorStore.getState().semanticOverrides).toEqual({});
  useChartStyleEditorStore.getState().setOverride('authoring.wheel.anglo.canvas.ring.anglo-terms.bandWidth', 24);
  expect(Object.keys(useChartStyleEditorStore.getState().semanticOverrides)).toEqual([
    'authoring.wheel.anglo.canvas.ring.anglo-terms.bandWidth',
  ]);
  useChartStyleEditorStore.getState().selectElement(null);
  useChartStyleEditorStore.getState().setOverride('authoring.wheel.anglo.fills.decanBand.fillPattern', 'hatch');
  expect(useChartStyleEditorStore.getState().semanticOverrides['authoring.wheel.anglo.fills.termBand.fillPattern']).toBeUndefined();
});
