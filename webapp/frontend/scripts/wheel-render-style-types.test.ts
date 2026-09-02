// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import type {
  ComputeHitRegionsOptions,
  DrawOptions,
} from "../src/lib/chart/draw-chart";
import type { ChartPalette } from "../src/lib/chart/types";
import type { WheelRenderStyle } from "../src/lib/chart/wheel-render-style";

declare const palette: ChartPalette;
declare const renderStyle: WheelRenderStyle;

const typedStyleOptions: DrawOptions = {
  width: 720,
  height: 720,
  renderStyle,
};

const legacyOptions: DrawOptions = {
  width: 720,
  height: 720,
  palette,
  styleRevision: 3,
  fontUi: "UI",
  fontSymbols: "Symbols",
};

const typedHitOptions: ComputeHitRegionsOptions = {
  width: 720,
  height: 720,
  renderStyle,
  textsize: () => [10, 10],
};

const legacyHitOptions: ComputeHitRegionsOptions = {
  width: 720,
  height: 720,
  palette,
  clickAspectState: { selectedBody: null, hideAll: false },
};

// @ts-expect-error Legacy callers without renderStyle must provide a palette.
const legacyMissingPalette: DrawOptions = { width: 720, height: 720 };

// @ts-expect-error A complete renderStyle cannot be mixed with legacy palette fields.
const mixedStyleAuthorities: DrawOptions = {
  width: 720,
  height: 720,
  palette,
  renderStyle,
};

// @ts-expect-error Legacy hit testing without renderStyle must provide a palette.
const legacyHitMissingPalette: ComputeHitRegionsOptions = { width: 720, height: 720 };

// @ts-expect-error Hit testing accepts exactly one style authority.
const mixedHitStyleAuthorities: ComputeHitRegionsOptions = {
  width: 720,
  height: 720,
  palette,
  renderStyle,
};

void [
  typedStyleOptions,
  legacyOptions,
  typedHitOptions,
  legacyHitOptions,
  legacyMissingPalette,
  mixedStyleAuthorities,
  legacyHitMissingPalette,
  mixedHitStyleAuthorities,
];
