// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { create } from "zustand";
import type { Chart, ChartRenderSnapshot } from "@/lib/chart/types";
import type { OptionsColors, RGB } from "@/lib/daemon/client";

/** Paint-only Settings gesture. Canonical value remains in daemon options. */
export const SETTINGS_COLOR_PREVIEW = "aries://settings-color-preview";

export type SettingsColorPreview = {
  attr: keyof OptionsColors;
  index?: number;
  rgb: RGB;
  revision: number;
};

export type SettingsColorPreviewEvent =
  | { kind: "opacity"; value: number; sequence: number }
  | { kind: "color"; color: SettingsColorPreview | null; sequence: number };

type ColorSettingsPreview = {
  zodiacFieldOpacity: number | null;
  setZodiacFieldOpacity: (value: number | null) => void;
  color: SettingsColorPreview | null;
  setColor: (value: SettingsColorPreview | null) => void;
};

export const useColorSettingsPreviewStore = create<ColorSettingsPreview>()((set) => ({
  zodiacFieldOpacity: null,
  setZodiacFieldOpacity: (value) => set((current) => (
    current.zodiacFieldOpacity === value ? current : { zodiacFieldOpacity: value }
  )),
  color: null,
  setColor: (value) => set({ color: value }),
}));

/** Replace only paint inputs; no session/snapshot fetch is part of a drag. */
export function withZodiacFieldOpacityPreview(
  snapshot: ChartRenderSnapshot,
  opacity: number | null,
): ChartRenderSnapshot {
  if (opacity === null) return snapshot;
  const paint = (chart: Chart | null | undefined) => (
    chart && chart.options.zodiacElementFieldOpacity !== opacity
      ? { ...chart, options: { ...chart.options, zodiacElementFieldOpacity: opacity } }
      : chart
  );
  return {
    ...snapshot,
    primaryChart: paint(snapshot.primaryChart) as Chart,
    comparisonChart: paint(snapshot.comparisonChart),
    radixChart: paint(snapshot.radixChart),
    displayAnchorChart: paint(snapshot.displayAnchorChart),
    rings: snapshot.rings?.map((chart) => paint(chart) as Chart),
  };
}
