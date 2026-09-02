// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import { expect, test } from "@playwright/test";

import {
  normalizeRecentColors,
  useChartStyleEditorStore,
} from "../src/stores/chart-style-editor-store";

function resetStore() {
  useChartStyleEditorStore.setState({
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
