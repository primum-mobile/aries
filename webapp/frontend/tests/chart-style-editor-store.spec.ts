// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import { expect, test } from "@playwright/test";

import { useChartStyleEditorStore } from "../src/stores/chart-style-editor-store";

function resetStore() {
  useChartStyleEditorStore.setState({
    semanticOverrides: {},
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
  store.beginGesture();
  store.setOverride("authoring.app.panel.opacity", 10);
  store.setOverride("authoring.app.panel.opacity", 20);
  store.setOverride("authoring.app.panel.opacity", 30);
  store.endGesture();

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
